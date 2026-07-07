import { exec } from 'child_process';
import { createWriteStream } from 'fs';
import { readdir } from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import { fileURLToPath } from 'url';
import type { Entry, ZipFile } from 'yauzl';
import * as yauzl from 'yauzl';
import { DependencyScanner } from '../scanner/DependencyScanner.js';
import {
    buildLineTextMap,
    readCachedSource,
    resolveSourceText,
} from './dependencySourceCache.js';
import {
    decompileJarBatchToCache,
    type BatchDecompileClassResult,
} from './decompileJarBatch.js';
import {
    cleanupRequestTempNamespace,
    createRequestTempNamespace,
    getRequestTempNamespacePath,
    toWorkerDirectoryName,
    type DecompileClassOptions,
} from './decompileRuntimeConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);
const SINGLE_CLASS_CFR_TIMEOUT_ERROR = 'CFR反编译超时，请检查Java环境和CFR工具';
const BATCH_CFR_TIMEOUT_ERROR = 'CFR 批量反编译超时，请检查 Java 环境和 CFR 工具';

function toSingleClassDecompileError(errorMessage: string): Error {
    if (errorMessage === SINGLE_CLASS_CFR_TIMEOUT_ERROR || errorMessage === BATCH_CFR_TIMEOUT_ERROR) {
        return new Error(SINGLE_CLASS_CFR_TIMEOUT_ERROR);
    }

    if (errorMessage.startsWith('CFR 批量反编译失败: ')) {
        return new Error(`CFR反编译失败: ${errorMessage.slice('CFR 批量反编译失败: '.length)}`);
    }

    if (errorMessage.startsWith('CFR 批量反编译')) {
        return new Error(`CFR反编译失败: ${errorMessage.replace(/^CFR 批量反编译/gu, 'CFR反编译')}`);
    }

    if (errorMessage.startsWith('批量反编译')) {
        return new Error(`CFR反编译失败: ${errorMessage.replace(/^批量反编译/gu, '反编译')}`);
    }

    if (errorMessage.startsWith('CFR反编译失败: ')) {
        return new Error(errorMessage);
    }

    return new Error(`CFR反编译失败: ${errorMessage}`);
}

export class DecompilerService {
    private readonly scanner: DependencyScanner;
    private cfrPathPromise?: Promise<string>;

    constructor() {
        this.scanner = new DependencyScanner();
    }

    async decompileClass(
        className: string,
        projectPath: string,
        useCache: boolean = true,
        cfrPath?: string,
        jarPath?: string,
        options: DecompileClassOptions = {}
    ): Promise<string> {
        const ownsRequestTempNamespace = options.requestTempNamespace === undefined;
        const requestTempNamespace = options.requestTempNamespace ?? createRequestTempNamespace();

        try {
            const resolvedCfrPath = await this.resolveCfrPath(cfrPath);

            console.error(`查找类 ${className} 对应的JAR包...`);
            const sourceItems = await Promise.race([
                this.scanner.getClassSourceItems(className, projectPath),
                new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('查找JAR包超时')), 10000);
                }),
            ]);
            const sourceItem = jarPath === undefined
                ? (sourceItems[0] ?? null)
                : (sourceItems.find((item) => item.jarPath === jarPath) ?? null);

            if (sourceItem === null) {
                throw new Error(
                    jarPath
                        ? `未找到类 ${className} 在 ${jarPath} 中的索引条目，请先运行 scan_dependencies 建立类索引`
                        : `未找到类 ${className} 对应的JAR包，请先运行 scan_dependencies 建立类索引`
                );
            }

            console.error(`找到JAR包: ${sourceItem.jarPath}`);
            const resolvedSource = await resolveSourceText({
                projectPath,
                className,
                jarPath: sourceItem.jarPath,
                useCache,
                refreshSource: async (refreshRequest) => {
                    const batchResults = await decompileJarBatchToCache({
                        classNames: [refreshRequest.className],
                        projectPath: refreshRequest.projectPath,
                        jarPath: refreshRequest.jarPath,
                        resolvedCfrPath,
                        javaCommand: this.getJavaCommand(),
                        options: {
                            ...options,
                            requestTempNamespace,
                        },
                    });
                    const batchResult = batchResults.find((result) => result.className === refreshRequest.className);
                    if (batchResult?.success !== true) {
                        throw toSingleClassDecompileError(
                            batchResult?.error ?? `未返回 ${refreshRequest.className} 的结果`
                        );
                    }

                    if (batchResult.source === undefined || batchResult.source.trim().length === 0) {
                        throw toSingleClassDecompileError(
                            `未返回 ${refreshRequest.className} 的源码`
                        );
                    }

                    return batchResult.source;
                },
            });

            if (resolvedSource.refreshed) {
                console.error(`反编译结果已缓存: ${resolvedSource.cachePath}`);
            } else {
                console.error(`使用缓存的反编译结果: ${resolvedSource.cachePath}`);
            }

            return resolvedSource.source;
        } catch (error) {
            console.error(`反编译类 ${className} 失败:`, error);
            throw error;
        } finally {
            if (ownsRequestTempNamespace) {
                await cleanupRequestTempNamespace(requestTempNamespace);
            }
        }
    }

    async getCachedSource(className: string, projectPath: string, jarPath: string): Promise<string | null> {
        const cachedSource = await readCachedSource(projectPath, className, jarPath);
        return cachedSource?.source ?? null;
    }

    async getCachedSourceLineMap(
        className: string,
        projectPath: string,
        jarPath: string
    ): Promise<ReadonlyMap<number, string> | null> {
        const cachedSource = await this.getCachedSource(className, projectPath, jarPath);
        return cachedSource === null ? null : buildLineTextMap(cachedSource);
    }

    async decompileClasses(
        classNames: string[],
        projectPath: string,
        useCache: boolean = true,
        cfrPath?: string
    ): Promise<Map<string, string>> {
        const results = new Map<string, string>();

        for (const className of classNames) {
            try {
                const sourceCode = await this.decompileClass(className, projectPath, useCache, cfrPath);
                results.set(className, sourceCode);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.warn(`反编译类 ${className} 失败: ${message}`);
                results.set(className, `// 反编译失败: ${message}`);
            }
        }

        return results;
    }

    async decompileJarClasses(
        classNames: readonly string[],
        projectPath: string,
        jarPath: string,
        cfrPath?: string,
        options: DecompileClassOptions = {}
    ): Promise<readonly BatchDecompileClassResult[]> {
        const ownsRequestTempNamespace = options.requestTempNamespace === undefined;
        const requestTempNamespace = options.requestTempNamespace ?? createRequestTempNamespace();

        try {
            const resolvedCfrPath = await this.resolveCfrPath(cfrPath);
            return decompileJarBatchToCache({
                classNames,
                projectPath,
                jarPath,
                resolvedCfrPath,
                javaCommand: this.getJavaCommand(),
                options: {
                    ...options,
                    requestTempNamespace,
                },
            });
        } finally {
            if (ownsRequestTempNamespace) {
                await cleanupRequestTempNamespace(requestTempNamespace);
            }
        }
    }

    private async resolveCfrPath(cfrPath?: string): Promise<string> {
        if (cfrPath) {
            console.error(`使用外部指定的CFR工具路径: ${cfrPath}`);
            return cfrPath;
        }

        if (this.cfrPathPromise === undefined) {
            this.cfrPathPromise = this.findCfrJar()
                .then((resolvedCfrPath) => {
                    if (resolvedCfrPath.length === 0) {
                        throw new Error('未找到CFR反编译工具。请下载CFR jar包到lib目录或设置CFR_PATH环境变量');
                    }
                    console.error(`CFR工具路径: ${resolvedCfrPath}`);
                    return resolvedCfrPath;
                })
                .catch((error: unknown) => {
                    this.cfrPathPromise = undefined;
                    throw error;
                });
        }

        return this.cfrPathPromise;
    }

    private async extractClassFile(
        jarPath: string,
        className: string,
        requestTempNamespace: string,
        workerId?: number
    ): Promise<string> {
        const classFileName = `${className.replace(/\./gu, '/')}.class`;
        const tempDir = path.join(
            getRequestTempNamespacePath(requestTempNamespace),
            toWorkerDirectoryName(workerId)
        );
        const lastDotIndex = className.lastIndexOf('.');
        const packageName = lastDotIndex > 0 ? className.slice(0, lastDotIndex) : '';
        const simpleName = lastDotIndex > 0 ? className.slice(lastDotIndex + 1) : className;
        const classFilePath = path.join(tempDir, packageName.replace(/\./gu, path.sep), `${simpleName}.class`);

        await fs.ensureDir(path.dirname(classFilePath));
        console.error(`从JAR包提取类文件: ${jarPath} -> ${classFileName}`);

        return new Promise((resolve, reject) => {
            yauzl.open(jarPath, { lazyEntries: true }, (openError: Error | null, zipfile?: ZipFile) => {
                if (openError || zipfile === undefined) {
                    reject(new Error(`无法打开JAR包 ${jarPath}: ${openError?.message ?? '未知错误'}`));
                    return;
                }

                let found = false;
                zipfile.readEntry();

                zipfile.on('entry', (entry: Entry) => {
                    if (entry.fileName !== classFileName) {
                        zipfile.readEntry();
                        return;
                    }

                    found = true;
                    zipfile.openReadStream(entry, (streamError, readStream) => {
                        if (streamError || readStream === undefined) {
                            reject(new Error(`无法读取JAR包中的类文件 ${classFileName}: ${streamError?.message ?? '未知错误'}`));
                            return;
                        }

                        const writeStream = createWriteStream(classFilePath);
                        readStream.pipe(writeStream);

                        writeStream.on('close', () => {
                            console.error(`类文件提取成功: ${classFilePath}`);
                            resolve(classFilePath);
                        });

                        writeStream.on('error', (writeError) => {
                            reject(new Error(`写入临时文件失败: ${writeError.message}`));
                        });
                    });
                });

                zipfile.on('end', () => {
                    if (!found) {
                        reject(new Error(`在JAR包 ${jarPath} 中未找到类文件: ${classFileName}`));
                    }
                });

                zipfile.on('error', (zipError: Error) => {
                    reject(new Error(`读取JAR包失败: ${zipError.message}`));
                });
            });
        });
    }

    private async cleanupExtractedClassFile(classFilePath: string): Promise<void> {
        try {
            await fs.remove(classFilePath);
            console.error(`清理临时文件: ${classFilePath}`);
        } catch (cleanupError) {
            console.warn(`清理临时文件失败: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
        }
    }

    private async decompileWithCfr(classFilePath: string, cfrPath: string): Promise<string> {
        try {
            const javaCmd = this.getJavaCommand();
            const quotedJavaCmd = javaCmd.includes(' ') ? `"${javaCmd}"` : javaCmd;
            console.error(`执行CFR反编译: ${quotedJavaCmd} -jar "${cfrPath}" "${classFilePath}"`);

            const { stdout, stderr } = await execAsync(
                `${quotedJavaCmd} -jar "${cfrPath}" "${classFilePath}" --silent true`,
                { timeout: 30000 }
            );

            if (stderr && stderr.trim().length > 0) {
                console.warn('CFR警告:', stderr);
            }
            if (!stdout || stdout.trim() === '') {
                throw new Error('CFR反编译返回空结果，可能是类文件损坏或CFR版本不兼容');
            }

            return stdout;
        } catch (error) {
            console.error('CFR反编译执行失败:', error);
            if (error instanceof Error && error.message.includes('timeout')) {
                throw new Error(SINGLE_CLASS_CFR_TIMEOUT_ERROR);
            }
            throw new Error(`CFR反编译失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async findCfrJar(): Promise<string> {
        const searchPaths = [
            path.join(process.cwd(), 'lib'),
            process.cwd(),
            path.join(__dirname, '..', '..', 'lib'),
            path.join(__dirname, '..', '..'),
        ];

        for (const searchPath of searchPaths) {
            if (!await fs.pathExists(searchPath)) {
                continue;
            }

            const files = await readdir(searchPath);
            const cfrJar = files.find((file) => /^cfr-.*\.jar$/u.test(file));
            if (cfrJar) {
                return path.join(searchPath, cfrJar);
            }
        }

        const classpath = process.env.CLASSPATH || '';
        for (const entry of classpath.split(path.delimiter)) {
            if (entry.includes('cfr') && entry.endsWith('.jar')) {
                return entry;
            }
        }

        return '';
    }

    private getJavaCommand(): string {
        const javaHome = process.env.JAVA_HOME;
        if (javaHome) {
            const javaCmd = process.platform === 'win32' ? 'java.exe' : 'java';
            return path.join(javaHome, 'bin', javaCmd);
        }
        return 'java';
    }
}
