import { MissingDependencyDecompileScopeError } from '../dependency/DependencyDecompileDirectoryService.js';
import { JavaClassAnalyzerToolDispatcher } from '../mcp/JavaClassAnalyzerToolDispatcher.js';
import {
    buildStructuredTextResponse,
    buildTextResponse,
} from '../mcp/mcpToolResponse.js';
import { runDependencyDecompileDirectoryForTesting } from './dependencyDecompileDirectoryRunner.js';
import type { SyntheticDependencySearchFixtureConfig } from './dependencySearchFixtures.js';
import { readLockedFixtureSource } from './dependencySearchFixtures.js';
import { DecompilerService } from '../decompiler/DecompilerService.js';
import { resolveSourceText } from '../decompiler/dependencySourceCache.js';
import { DependencyScanner } from '../scanner/DependencyScanner.js';
import type {
    DependencyCodeSearchRequest,
    DependencyCodeSearchResult,
} from '../dependency/DependencyCodeSearchService.js';
import { DependencyCodeSearchService } from '../dependency/DependencyCodeSearchService.js';

const dispatcher = new JavaClassAnalyzerToolDispatcher();
const scanner = new DependencyScanner();
const decompiler = new DecompilerService();

interface PublicMcpRunnerOptions {
    readonly syntheticFixture?: SyntheticDependencySearchFixtureConfig;
}

interface DecompileClassRunnerRequest {
    readonly projectPath: string;
    readonly className: string;
    readonly jarPath?: string;
    readonly useCache: boolean;
    readonly cfrPath?: string;
}

export async function runPublicMcpToolForTesting(
    name: string,
    toolArguments: Record<string, unknown>,
    options: PublicMcpRunnerOptions = {}
): Promise<unknown> {
    try {
        const syntheticProjectPath = getSyntheticProjectPath(toolArguments, options.syntheticFixture);
        if (syntheticProjectPath === undefined) {
            return dispatcher.callTool(name, toolArguments);
        }

    if (
        name === 'decompile_class'
        && typeof toolArguments.className === 'string'
    ) {
        try {
            const source = await runDecompileClassForTesting({
                projectPath: syntheticProjectPath,
                className: toolArguments.className,
                    ...(typeof toolArguments.jarPath === 'string' ? { jarPath: toolArguments.jarPath } : {}),
                ...(typeof toolArguments.cfrPath === 'string' ? { cfrPath: toolArguments.cfrPath } : {}),
                useCache: toolArguments.useCache !== false,
            });

            if (
                typeof toolArguments.startLine === 'number'
                || typeof toolArguments.endLine === 'number'
            ) {
                return buildTextResponse(`\`\`\`java\n${clipSourceToRange(source, {
                    startLine: typeof toolArguments.startLine === 'number' ? toolArguments.startLine : undefined,
                    endLine: typeof toolArguments.endLine === 'number' ? toolArguments.endLine : undefined,
                })}\n\`\`\``);
            }

            return buildTextResponse([
                `类 ${toolArguments.className} 的反编译源码:`,
                '',
                '```java',
                    source,
                    '```',
                ].join('\n'));
            } catch (error) {
                return buildTextResponse(
                    `反编译失败: ${error instanceof Error ? error.message : String(error)}\n\n建议:\n1. 确保已运行 scan_dependencies 建立类索引\n2. 检查CFR工具是否正确安装\n3. 验证类名是否正确`
                );
            }
        }

        if (
            name === 'search_dependency_code'
            && typeof toolArguments.query === 'string'
        ) {
            const result = await runDependencyCodeSearchForTesting({
                projectPath: syntheticProjectPath,
                query: toolArguments.query,
                ...(typeof toolArguments.packagePrefix === 'string' ? { packagePrefix: toolArguments.packagePrefix } : {}),
                ...(typeof toolArguments.jarName === 'string' ? { jarName: toolArguments.jarName } : {}),
                ...(typeof toolArguments.jarPath === 'string' ? { jarPath: toolArguments.jarPath } : {}),
                ...(typeof toolArguments.limit === 'number' ? { limit: toolArguments.limit } : {}),
                ...(toolArguments.caseSensitive === false ? { caseSensitive: false } : {}),
                ...(toolArguments.useCache === false ? { useCache: false } : {}),
                ...(toolArguments.includeLineText === true ? { includeLineText: true } : {}),
            });

            return buildStructuredTextResponse(result.content, result.structuredContent);
        }

        if (name === 'decompile_dependencies_to_dir') {
            try {
                const result = await runDependencyDecompileDirectoryForTesting({
                    projectPath: syntheticProjectPath,
                    ...(typeof toolArguments.packagePrefix === 'string' ? { packagePrefix: toolArguments.packagePrefix } : {}),
                    ...(typeof toolArguments.jarName === 'string' ? { jarName: toolArguments.jarName } : {}),
                    ...(typeof toolArguments.jarPath === 'string' ? { jarPath: toolArguments.jarPath } : {}),
                    ...(typeof toolArguments.maxClasses === 'number' ? { maxClasses: toolArguments.maxClasses } : {}),
                    ...(toolArguments.useCache === false ? { useCache: false } : {}),
                });

                return buildStructuredTextResponse(result.content, result.structuredContent);
            } catch (error) {
                if (error instanceof MissingDependencyDecompileScopeError) {
                    return buildTextResponse(
                        `工具调用失败: ${error.message}\n\n建议:\n1. 检查输入参数是否正确\n2. 确保已运行必要的准备工作\n3. 查看服务器日志获取详细信息`
                    );
                }

                throw error;
            }
        }

        return dispatcher.callTool(name, toolArguments);
    } catch (error) {
        return buildTextResponse(
            `工具调用失败: ${error instanceof Error ? error.message : String(error)}\n\n建议:\n1. 检查输入参数是否正确\n2. 确保已运行必要的准备工作\n3. 查看服务器日志获取详细信息`
        );
    }
}

function shouldUseSyntheticFixture(
    projectPath: string | undefined,
    syntheticFixture: SyntheticDependencySearchFixtureConfig | undefined
): boolean {
    return projectPath !== undefined
        && syntheticFixture !== undefined
        && projectPath === syntheticFixture.projectPath;
}

function getSyntheticProjectPath(
    toolArguments: Record<string, unknown>,
    syntheticFixture: SyntheticDependencySearchFixtureConfig | undefined
): string | undefined {
    if (syntheticFixture === undefined) {
        return undefined;
    }

    const projectPath = typeof toolArguments.projectPath === 'string' ? toolArguments.projectPath : undefined;
    if (!shouldUseSyntheticFixture(projectPath, syntheticFixture)) {
        return undefined;
    }

    return syntheticFixture.projectPath;
}

function clipSourceToRange(
    source: string,
    range: { readonly startLine?: number; readonly endLine?: number }
): string {
    if (range.startLine !== undefined && range.startLine <= 0) {
        throw new Error('startLine must be a positive 1-based integer.');
    }

    if (range.endLine !== undefined && range.endLine <= 0) {
        throw new Error('endLine must be a positive 1-based integer.');
    }

    if (
        range.startLine !== undefined
        && range.endLine !== undefined
        && range.startLine > range.endLine
    ) {
        throw new Error('startLine must be less than or equal to endLine.');
    }

    const sourceLines = source.split(/\r?\n/u);
    if (sourceLines.length === 0) {
        return '';
    }

    const clippedStartLine = Math.min(range.startLine ?? 1, sourceLines.length);
    const clippedEndLine = Math.min(range.endLine ?? sourceLines.length, sourceLines.length);
    return sourceLines.slice(clippedStartLine - 1, clippedEndLine).join('\n');
}

export async function runDecompileClassForTesting(request: DecompileClassRunnerRequest): Promise<string> {
    const sourceItems = await scanner.getClassSourceItems(request.className, request.projectPath);
    const sourceItem = request.jarPath === undefined
        ? (sourceItems[0] ?? null)
        : (sourceItems.find((item) => item.jarPath === request.jarPath) ?? null);

    if (sourceItem === null) {
        throw new Error(
            request.jarPath
                ? `未找到类 ${request.className} 在 ${request.jarPath} 中的索引条目，请先运行 scan_dependencies 建立类索引`
                : `未找到类 ${request.className} 对应的JAR包，请先运行 scan_dependencies 建立类索引`
        );
    }

    return (await resolveSourceText({
        projectPath: request.projectPath,
        className: request.className,
        jarPath: sourceItem.jarPath,
        useCache: request.useCache,
        refreshSource: async ({ className, jarPath }) => {
            const lockedSource = await readLockedFixtureSource(request.projectPath, className, jarPath);
            if (lockedSource !== null) {
                return lockedSource;
            }

            return decompiler.decompileClass(className, request.projectPath, false, request.cfrPath, jarPath);
        },
    })).source;
}

export async function runDependencyCodeSearchForTesting(
    request: DependencyCodeSearchRequest
): Promise<DependencyCodeSearchResult> {
    const service = new DependencyCodeSearchService({
        resolveSource: async ({ entry, projectPath, useCache, cfrPath }) => {
            return (await resolveSourceText({
                projectPath,
                className: entry.className,
                jarPath: entry.jarPath,
                useCache,
                refreshSource: async ({ className, jarPath }) => {
                    const lockedSource = await readLockedFixtureSource(projectPath, className, jarPath);
                    if (lockedSource !== null) {
                        return lockedSource;
                    }

                    return decompiler.decompileClass(className, projectPath, false, cfrPath, jarPath);
                },
            })).source;
        },
    });

    return service.search(request);
}
