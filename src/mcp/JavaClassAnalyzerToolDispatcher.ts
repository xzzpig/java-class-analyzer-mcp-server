import { JavaClassAnalyzer } from '../analyzer/JavaClassAnalyzer.js';
import {
    ALLOW_REPO_FALLBACK_ENV,
    MCP_TOOL_DEFINITIONS,
} from '../contracts/dependencyToolContracts.js';
import { DependencyCodeSearchService } from '../dependency/DependencyCodeSearchService.js';
import { DependencyDecompileDirectoryService } from '../dependency/DependencyDecompileDirectoryService.js';
import { DecompilerService } from '../decompiler/DecompilerService.js';
import { getSourceLines } from '../decompiler/dependencySourceCache.js';
import { DependencyScanner } from '../scanner/DependencyScanner.js';
import { ClassSearchService } from '../scanner/ClassSearchService.js';
import {
    asToolArguments,
    readOptionalBoolean,
    readOptionalInteger,
    readOptionalString,
    readRequiredString,
    type ToolArguments,
} from './mcpToolArguments.js';
import {
    buildStructuredTextResponse,
    buildTextResponse,
    type McpTextResponse,
} from './mcpToolResponse.js';

export class JavaClassAnalyzerToolDispatcher {
    private readonly analyzer = new JavaClassAnalyzer();
    private readonly scanner = new DependencyScanner();
    private readonly decompiler = new DecompilerService();
    private readonly dependencySearchService = new DependencyCodeSearchService();
    private readonly dependencyDecompileDirectoryService = new DependencyDecompileDirectoryService();
    private readonly classSearchService = new ClassSearchService();

    listTools(): readonly (typeof MCP_TOOL_DEFINITIONS)[number][] {
        return [...MCP_TOOL_DEFINITIONS];
    }

    async callTool(name: string, rawArguments: unknown): Promise<McpTextResponse> {
        const args = asToolArguments(rawArguments);

        try {
            switch (name) {
                case 'scan_dependencies':
                    return await this.handleScanDependencies(args);
                case 'decompile_class':
                    return await this.handleDecompileClass(args);
                case 'search_dependency_code':
                    return await this.handleSearchDependencyCode(args);
                case 'decompile_dependencies_to_dir':
                    return await this.handleDecompileDependenciesToDir(args);
                case 'analyze_class':
                    return await this.handleAnalyzeClass(args);
                case 'search_classes':
                    return await this.handleSearchClasses(args);
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        } catch (error) {
            console.error(`工具调用异常 [${name}]:`, error);
            return buildTextResponse(
                `工具调用失败: ${error instanceof Error ? error.message : String(error)}\n\n建议:\n1. 检查输入参数是否正确\n2. 确保已运行必要的准备工作\n3. 查看服务器日志获取详细信息`
            );
        }
    }

    private async handleScanDependencies(args: ToolArguments): Promise<McpTextResponse> {
        const projectPath = readRequiredString(args, 'projectPath');
        const forceRefresh = readOptionalBoolean(args, 'forceRefresh') ?? false;
        const result = await this.scanner.scanProject(projectPath, forceRefresh);

        return buildTextResponse(
            `依赖扫描完成！\n\n`
            + `扫描的JAR包数量: ${result.jarCount}\n`
            + `索引的类数量: ${result.classCount}\n`
            + `索引文件路径: ${result.indexPath}\n\n`
            + `示例索引条目:\n${result.sampleEntries.slice(0, 5).join('\n')}`
        );
    }

    private async handleDecompileClass(args: ToolArguments): Promise<McpTextResponse> {
        const className = readRequiredString(args, 'className');
        const projectPath = readRequiredString(args, 'projectPath');
        const useCache = readOptionalBoolean(args, 'useCache') ?? true;
        const cfrPath = readOptionalString(args, 'cfrPath');
        const jarPath = readOptionalString(args, 'jarPath');
        const startLine = readOptionalInteger(args, 'startLine');
        const endLine = readOptionalInteger(args, 'endLine');

        try {
            console.error(`开始反编译类: ${className}, 项目路径: ${projectPath}, 使用缓存: ${useCache}, CFR路径: ${cfrPath || '自动查找'}`);
            await this.ensureIndexExists(projectPath);

            const sourceCode = await this.decompiler.decompileClass(className, projectPath, useCache, cfrPath, jarPath);

            if (sourceCode.trim() === '') {
                return buildTextResponse(`警告: 类 ${className} 的反编译结果为空，可能是CFR工具问题或类文件损坏`);
            }

            if (startLine !== undefined || endLine !== undefined) {
                return buildTextResponse(`\`\`\`java\n${clipSourceToRange(sourceCode, { startLine, endLine })}\n\`\`\``);
            }

            return buildTextResponse(`类 ${className} 的反编译源码:\n\n\`\`\`java\n${sourceCode}\n\`\`\``);
        } catch (error) {
            console.error(`反编译类 ${className} 失败:`, error);
            return buildTextResponse(
                `反编译失败: ${error instanceof Error ? error.message : String(error)}\n\n建议:\n1. 确保已运行 scan_dependencies 建立类索引\n2. 检查CFR工具是否正确安装\n3. 验证类名是否正确`
            );
        }
    }

    private async handleSearchDependencyCode(args: ToolArguments): Promise<McpTextResponse> {
        const limit = readOptionalInteger(args, 'limit');
        const caseSensitive = readOptionalBoolean(args, 'caseSensitive');
        const useCache = readOptionalBoolean(args, 'useCache');
        const packagePrefix = readOptionalString(args, 'packagePrefix');
        const jarName = readOptionalString(args, 'jarName');
        const jarPath = readOptionalString(args, 'jarPath');
        const includeLineText = readOptionalBoolean(args, 'includeLineText');
        const result = await this.dependencySearchService.search({
            projectPath: readRequiredString(args, 'projectPath'),
            query: readRequiredString(args, 'query'),
            ...(limit === undefined ? {} : { limit }),
            ...(caseSensitive === undefined ? {} : { caseSensitive }),
            ...(useCache === undefined ? {} : { useCache }),
            ...(packagePrefix === undefined ? {} : { packagePrefix }),
            ...(jarName === undefined ? {} : { jarName }),
            ...(jarPath === undefined ? {} : { jarPath }),
            ...(includeLineText === undefined ? {} : { includeLineText }),
        });
        return buildStructuredTextResponse(result.content, result.structuredContent);
    }

    private async handleDecompileDependenciesToDir(args: ToolArguments): Promise<McpTextResponse> {
        const packagePrefix = readOptionalString(args, 'packagePrefix');
        const jarName = readOptionalString(args, 'jarName');
        const jarPath = readOptionalString(args, 'jarPath');
        const maxClasses = readOptionalInteger(args, 'maxClasses');
        const useCache = readOptionalBoolean(args, 'useCache');
        const result = await this.dependencyDecompileDirectoryService.decompileToDirectory({
            projectPath: readRequiredString(args, 'projectPath'),
            ...(packagePrefix === undefined ? {} : { packagePrefix }),
            ...(jarName === undefined ? {} : { jarName }),
            ...(jarPath === undefined ? {} : { jarPath }),
            ...(maxClasses === undefined ? {} : { maxClasses }),
            ...(useCache === undefined ? {} : { useCache }),
        });
        return buildStructuredTextResponse(result.content, result.structuredContent);
    }

    private async handleAnalyzeClass(args: ToolArguments): Promise<McpTextResponse> {
        const className = readRequiredString(args, 'className');
        const projectPath = readRequiredString(args, 'projectPath');
        await this.ensureIndexExists(projectPath);
        const analysis = await this.analyzer.analyzeClass(className, projectPath);

        const lines = [
            `类 ${className} 的分析结果:`,
            '',
            `包名: ${analysis.packageName}`,
            `类名: ${analysis.className}`,
            `修饰符: ${analysis.modifiers.join(' ')}`,
            `父类: ${analysis.superClass || '无'}`,
            `实现的接口: ${analysis.interfaces.join(', ') || '无'}`,
            '',
        ];

        if (analysis.fields.length > 0) {
            lines.push(`字段 (${analysis.fields.length}个):`);
            analysis.fields.forEach((field) => {
                lines.push(`  - ${field.modifiers.join(' ')} ${field.type} ${field.name}`);
            });
            lines.push('');
        }

        if (analysis.methods.length > 0) {
            lines.push(`方法 (${analysis.methods.length}个):`);
            analysis.methods.forEach((method) => {
                lines.push(`  - ${method.modifiers.join(' ')} ${method.returnType} ${method.name}(${method.parameters.join(', ')})`);
            });
            lines.push('');
        }

        return buildTextResponse(lines.join('\n'));
    }

    private async handleSearchClasses(args: ToolArguments): Promise<McpTextResponse> {
        const limit = readOptionalInteger(args, 'limit');
        const caseSensitive = readOptionalBoolean(args, 'caseSensitive');
        const packagePrefix = readOptionalString(args, 'packagePrefix');
        const jarName = readOptionalString(args, 'jarName');
        const jarPath = readOptionalString(args, 'jarPath');
        const result = await this.classSearchService.search({
            projectPath: readRequiredString(args, 'projectPath'),
            query: readRequiredString(args, 'query'),
            ...(limit === undefined ? {} : { limit }),
            ...(caseSensitive === undefined ? {} : { caseSensitive }),
            ...(packagePrefix === undefined ? {} : { packagePrefix }),
            ...(jarName === undefined ? {} : { jarName }),
            ...(jarPath === undefined ? {} : { jarPath }),
        });
        return buildStructuredTextResponse(result.content, result.structuredContent);
    }

    private async ensureIndexExists(projectPath: string): Promise<void> {
        try {
            await this.scanner.ensureClassIndexEntries(projectPath);
        } catch (error) {
            console.error(`索引文件不存在，自动创建失败（repo fallback 仅在 ${ALLOW_REPO_FALLBACK_ENV} 时允许）:`, error);
            throw new Error(`无法创建类索引文件: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

export function buildToolCapabilities() {
    return {
        tools: {},
    };
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

    const sourceLines = getSourceLines(source);
    if (sourceLines.length === 0) {
        return '';
    }

    const clippedStartLine = Math.min(range.startLine ?? 1, sourceLines.length);
    const clippedEndLine = Math.min(range.endLine ?? sourceLines.length, sourceLines.length);
    return sourceLines.slice(clippedStartLine - 1, clippedEndLine).join('\n');
}
