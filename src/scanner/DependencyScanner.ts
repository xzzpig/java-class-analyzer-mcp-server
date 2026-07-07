import { execFile } from 'child_process';
import os from 'os';
import { promisify } from 'util';
import fs from 'fs-extra';
import * as path from 'path';
import type { Entry, ZipFile } from 'yauzl';
import * as yauzl from 'yauzl';
import {
    ALLOW_REPO_FALLBACK_ENV,
    isRepoFallbackAllowed,
    RepoFallbackDisabledError,
} from '../dependency/dependencyRuntimeConfig.js';
import {
    filterDependencySourceItems,
    getClassIndexPath,
    readClassIndexEntries,
    readScanResult,
    type ClassIndexEntry,
    type DependencySourceFilters,
    type DependencySourceItem,
    type ScanResult,
    writeClassIndexFile,
} from './dependencySourceIndex.js';

const execFileAsync = promisify(execFile);

export { type ClassIndexEntry, type ScanResult } from './dependencySourceIndex.js';

export class DependencyScanner {
    async scanProject(projectPath: string, forceRefresh: boolean = false): Promise<ScanResult> {
        const indexPath = getClassIndexPath(projectPath);
        const isDebug = process.env.NODE_ENV === 'development';
        const indexExists = await fs.pathExists(indexPath);

        if (indexExists) {
            if (forceRefresh) {
                if (isDebug) {
                    console.error('强制刷新：删除旧的索引文件');
                }
                await fs.remove(indexPath);
            } else {
                if (isDebug) {
                    console.error('使用缓存的类索引');
                }
                return readScanResult(projectPath);
            }
        }

        if (isDebug) {
            console.error('开始扫描Maven依赖...');
        }

        const dependencies = await this.getMavenDependencies(projectPath);
        console.error(`找到 ${dependencies.length} 个依赖JAR包`);

        const classIndex: ClassIndexEntry[] = [];
        let processedJars = 0;

        for (const jarPath of dependencies) {
            try {
                const classes = await this.extractClassesFromJar(jarPath);
                classIndex.push(...classes);
                processedJars += 1;

                if (processedJars % 10 === 0) {
                    console.error(`已处理 ${processedJars}/${dependencies.length} 个JAR包`);
                }
            } catch (error) {
                console.warn(`处理JAR包失败: ${jarPath}, 错误: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        const result: ScanResult = {
            jarCount: processedJars,
            classCount: classIndex.length,
            indexPath,
            sampleEntries: classIndex.slice(0, 10).map((entry) => `${entry.className} -> ${path.basename(entry.jarPath)}`),
        };

        await writeClassIndexFile(projectPath, result, classIndex);
        console.error(`扫描完成！处理了 ${processedJars} 个JAR包，索引了 ${classIndex.length} 个类`);

        return result;
    }

    async ensureClassIndexEntries(
        projectPath: string,
        forceRefresh: boolean = false
    ): Promise<readonly ClassIndexEntry[]> {
        const indexPath = getClassIndexPath(projectPath);
        const shouldRefresh = forceRefresh || !await fs.pathExists(indexPath);
        if (shouldRefresh) {
            await this.scanProject(projectPath, forceRefresh);
        }
        return readClassIndexEntries(projectPath);
    }

    async listClassIndexEntries(
        projectPath: string,
        filters: DependencySourceFilters = {}
    ): Promise<readonly DependencySourceItem[]> {
        const classIndex = await this.ensureClassIndexEntries(projectPath);
        return filterDependencySourceItems(classIndex, filters);
    }

    async getClassSourceItems(
        className: string,
        projectPath: string,
        filters: DependencySourceFilters = {}
    ): Promise<readonly DependencySourceItem[]> {
        const classIndex = await this.listClassIndexEntries(projectPath, filters);
        return classIndex.filter((entry) => entry.className === className);
    }

    async getClassSourceItem(
        className: string,
        projectPath: string,
        jarPath?: string
    ): Promise<DependencySourceItem | null> {
        return (await this.getClassSourceItems(className, projectPath, { jarPath }))[0] ?? null;
    }

    async findJarForClass(className: string, projectPath: string, jarPath?: string): Promise<string | null> {
        const entry = await this.getClassSourceItem(className, projectPath, jarPath);
        return entry?.jarPath ?? null;
    }

    async getAllClassNames(projectPath: string): Promise<string[]> {
        const classIndex = await this.ensureClassIndexEntries(projectPath);
        return classIndex.map((entry) => entry.className);
    }

    private async getMavenDependencies(projectPath: string): Promise<string[]> {
        const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'java-class-analyzer-maven-'));
        const classpathFile = path.join(tempDirectory, 'classpath.txt');

        try {
            const mavenCmd = this.getMavenCommand();
            try {
                await execFileAsync(
                    mavenCmd,
                    [
                        'dependency:build-classpath',
                        '-DincludeScope=runtime',
                        `-Dmdep.outputFile=${classpathFile}`,
                    ],
                    {
                        cwd: projectPath,
                        shell: process.platform === 'win32',
                        timeout: 60000,
                    }
                );
            } catch (error) {
                console.error('获取Maven依赖失败:', error);
                if (!isRepoFallbackAllowed()) {
                    throw new RepoFallbackDisabledError(error);
                }

                console.error(`Maven依赖失败，因 ${ALLOW_REPO_FALLBACK_ENV} 已启用，回退扫描本地 Maven 仓库`);
                return this.scanLocalMavenRepo();
            }

            const classpath = await fs.readFile(classpathFile, 'utf8');
            const jarPaths = new Set<string>();
            for (const classpathEntry of classpath.split(path.delimiter)) {
                const jarPath = classpathEntry.trim();
                if (
                    jarPath === ''
                    || !path.isAbsolute(jarPath)
                    || !jarPath.endsWith('.jar')
                    || jarPaths.has(jarPath)
                    || !await fs.pathExists(jarPath)
                ) {
                    continue;
                }

                if ((await fs.stat(jarPath)).isFile()) {
                    jarPaths.add(jarPath);
                }
            }

            return [...jarPaths];
        } finally {
            await fs.remove(tempDirectory);
        }
    }

    private async scanLocalMavenRepo(): Promise<string[]> {
        const mavenRepoPath = this.getMavenRepositoryPath();

        if (!await fs.pathExists(mavenRepoPath)) {
            throw new Error('Maven本地仓库不存在');
        }

        const jarFiles: string[] = [];

        const scanDir = async (dir: string): Promise<void> => {
            const entries = await fs.readdir(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await scanDir(fullPath);
                    continue;
                }

                if (entry.isFile() && entry.name.endsWith('.jar')) {
                    jarFiles.push(fullPath);
                }
            }
        };

        await scanDir(mavenRepoPath);
        return jarFiles;
    }

    private async extractClassesFromJar(jarPath: string): Promise<ClassIndexEntry[]> {
        return new Promise((resolve, reject) => {
            const classes: ClassIndexEntry[] = [];

            yauzl.open(jarPath, { lazyEntries: true }, (openError: Error | null, zipfile?: ZipFile) => {
                if (openError || zipfile === undefined) {
                    reject(openError ?? new Error(`无法打开JAR包 ${jarPath}`));
                    return;
                }

                zipfile.readEntry();

                zipfile.on('entry', (entry: Entry) => {
                    if (entry.fileName.endsWith('.class') && !entry.fileName.includes('$')) {
                        const className = entry.fileName.replace(/\.class$/u, '').replace(/\//gu, '.');
                        const lastDotIndex = className.lastIndexOf('.');
                        const packageName = lastDotIndex > 0 ? className.slice(0, lastDotIndex) : '';
                        const simpleName = lastDotIndex > 0 ? className.slice(lastDotIndex + 1) : className;

                        classes.push({
                            className,
                            jarPath,
                            packageName,
                            simpleName,
                        });
                    }

                    zipfile.readEntry();
                });

                zipfile.on('end', () => resolve(classes));
                zipfile.on('error', (zipError: Error) => reject(zipError));
            });
        });
    }

    private getMavenCommand(): string {
        const mavenHome = process.env.MAVEN_HOME;
        if (mavenHome) {
            const mavenCmd = process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
            return path.join(mavenHome, 'bin', mavenCmd);
        }
        return 'mvn';
    }

    private getMavenRepositoryPath(): string {
        const mavenRepo = process.env.MAVEN_REPO;
        if (mavenRepo) {
            return mavenRepo;
        }

        const homeDir = process.env.HOME ?? process.env.USERPROFILE;
        if (homeDir === undefined) {
            throw new Error('无法确定用户目录，无法定位 Maven 本地仓库');
        }
        return path.join(homeDir, '.m2', 'repository');
    }
}
