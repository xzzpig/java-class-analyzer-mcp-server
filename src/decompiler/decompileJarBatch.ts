import { execFile } from 'child_process';
import { createHash } from 'crypto';
import * as path from 'path';
import { promisify } from 'util';
import fs from 'fs-extra';
import { writeCachedSource } from './dependencySourceCache.js';
import {
    getRequestTempNamespacePath,
    toWorkerDirectoryName,
    type DecompileClassOptions,
} from './decompileRuntimeConfig.js';

const execFileAsync = promisify(execFile);
const CFR_TIMEOUT_MS = 30_000 as const;

export interface BatchDecompileClassResult {
    readonly className: string;
    readonly success: boolean;
    readonly error?: string;
    readonly source?: string;
}

export interface DecompileJarBatchRequest {
    readonly classNames: readonly string[];
    readonly projectPath: string;
    readonly jarPath: string;
    readonly resolvedCfrPath: string;
    readonly javaCommand: string;
    readonly options: DecompileClassOptions;
}

type ExecFileErrorWithOutput = Error & {
    readonly stderr?: string | Buffer;
    readonly code?: number | string;
};

export async function decompileJarBatchToCache(
    request: DecompileJarBatchRequest
): Promise<readonly BatchDecompileClassResult[]> {
    const classNames = Array.from(new Set(request.classNames));
    if (classNames.length === 0) {
        return [];
    }

    const outputDir = getBatchOutputDirectory(request.jarPath, request.options);
    await fs.emptyDir(outputDir);

    const batchError = await runBatchDecompile(request, outputDir, classNames);
    const results: BatchDecompileClassResult[] = [];

    for (const className of classNames) {
        const sourcePath = getBatchSourcePath(outputDir, className);
        try {
            if (!await fs.pathExists(sourcePath)) {
                results.push({
                    className,
                    success: false,
                    error: batchError ?? `CFR 批量反编译后未生成 ${className} 的源码文件`,
                });
                continue;
            }

            const source = await fs.readFile(sourcePath, 'utf-8');
            if (source.trim().length === 0) {
                results.push({
                    className,
                    success: false,
                    error: batchError ?? `CFR 批量反编译为 ${className} 生成了空源码文件`,
                });
                continue;
            }

            await writeCachedSource(request.projectPath, className, request.jarPath, source);
            results.push({ className, success: true, source });
        } catch (error) {
            results.push({
                className,
                success: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return results;
}

async function runBatchDecompile(
    request: DecompileJarBatchRequest,
    outputDir: string,
    classNames: readonly string[]
): Promise<string | null> {
    const jarFilter = buildJarFilter(classNames);
    console.error(
        `执行 CFR JAR 批量反编译: ${request.javaCommand} -jar "${request.resolvedCfrPath}" "${request.jarPath}" --outputdir "${outputDir}" --jarfilter "${jarFilter}"`
    );

    try {
        const { stderr } = await execFileAsync(
            request.javaCommand,
            [
                '-jar',
                request.resolvedCfrPath,
                request.jarPath,
                '--silent',
                'true',
                '--outputdir',
                outputDir,
                '--jarfilter',
                jarFilter,
            ],
            { timeout: CFR_TIMEOUT_MS },
        );

        if (stderr.trim().length > 0) {
            console.warn('CFR警告:', stderr);
        }

        return null;
    } catch (error) {
        console.error('CFR 批量反编译执行失败:', error);
        return formatBatchError(error);
    }
}

function formatBatchError(error: unknown): string {
    if (error instanceof Error && error.message.includes('timeout')) {
        return 'CFR 批量反编译超时，请检查 Java 环境和 CFR 工具';
    }

    const stderr = getErrorStderr(error);
    if (stderr !== undefined && stderr.trim().length > 0) {
        return `CFR 批量反编译失败: ${stderr.trim()}`;
    }

    return `CFR 批量反编译失败: ${error instanceof Error ? error.message : String(error)}`;
}

function getErrorStderr(error: unknown): string | undefined {
    if (!(error instanceof Error) || !('stderr' in error)) {
        return undefined;
    }

    const stderr = (error as ExecFileErrorWithOutput).stderr;
    if (typeof stderr === 'string') {
        return stderr;
    }
    if (stderr instanceof Buffer) {
        return stderr.toString('utf-8');
    }

    return undefined;
}

function getBatchOutputDirectory(jarPath: string, options: DecompileClassOptions): string {
    return path.join(
        getRequestTempNamespacePath(options.requestTempNamespace ?? buildJarDirectoryName(jarPath)),
        toWorkerDirectoryName(options.workerId),
        'jar-batch',
        buildJarDirectoryName(jarPath)
    );
}

function buildJarDirectoryName(jarPath: string): string {
    const jarBasename = path.basename(jarPath, path.extname(jarPath));
    const jarHash = createHash('sha1').update(path.resolve(jarPath)).digest('hex').slice(0, 12);
    return `${jarBasename}-${jarHash}`;
}

function getBatchSourcePath(outputDir: string, className: string): string {
    const lastDotIndex = className.lastIndexOf('.');
    const packageSegments = lastDotIndex > 0 ? className.slice(0, lastDotIndex).split('.') : [];
    const simpleName = lastDotIndex > 0 ? className.slice(lastDotIndex + 1) : className;
    return path.join(outputDir, ...packageSegments, `${simpleName}.java`);
}

function buildJarFilter(classNames: readonly string[]): string {
    const escapedClassNames = classNames.map((className) => escapeRegex(className));
    return `(?:^|\\b)(?:${escapedClassNames.join('|')})(?:$|\\b)`;
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
