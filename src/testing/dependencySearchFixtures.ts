import archiver from 'archiver';
import fs from 'fs-extra';
import * as path from 'path';
import {
    getJarScopedSourcePath,
    writeCachedSource,
} from '../decompiler/dependencySourceCache.js';
import {
    type ClassIndexEntry,
    type ScanResult,
    writeClassIndexFile,
} from '../scanner/dependencySourceIndex.js';

export interface LockedFixtureSource {
    readonly className: string;
    readonly jarPath: string;
    readonly packageName: string;
    readonly simpleName: string;
    readonly source: string;
}

export interface SyntheticDependencySearchFixtureConfig {
    readonly projectPath: string;
    readonly sources: readonly LockedFixtureSource[];
}

interface SyntheticFixtureResolutionOptions {
    readonly projectPath: string;
    readonly fixtureSourcesPath?: string;
}

function hasExplicitFixtureOptions(options: SyntheticFixtureResolutionOptions): boolean {
    return options.fixtureSourcesPath !== undefined;
}

function getFixtureSourceRoot(projectPath: string): string {
    return path.join(projectPath, '.mcp-fixture-sources');
}

async function createJarWithClasses(jarPath: string, classNames: readonly string[]): Promise<void> {
    await fs.ensureDir(path.dirname(jarPath));

    await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(jarPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => resolve());
        output.on('error', (error) => reject(error));
        archive.on('error', (error) => reject(error));

        archive.pipe(output);
        for (const className of classNames) {
            archive.append(Buffer.from('fixture-bytecode', 'utf-8'), {
                name: `${className.replace(/\./gu, '/')}.class`,
            });
        }

        archive.finalize().catch(reject);
    });
}

async function writeFixtureSourceRegistry(projectPath: string, source: LockedFixtureSource): Promise<void> {
    const fixtureSourcePath = getJarScopedSourcePath(getFixtureSourceRoot(projectPath), source.className, source.jarPath);
    await fs.ensureDir(path.dirname(fixtureSourcePath));
    await fs.outputFile(fixtureSourcePath, source.source, 'utf-8');
}

async function prepareSyntheticProjectFixture(config: SyntheticDependencySearchFixtureConfig): Promise<void> {
    await fs.ensureDir(config.projectPath);

    const classIndex: readonly ClassIndexEntry[] = config.sources.map((source) => ({
        className: source.className,
        jarPath: source.jarPath,
        packageName: source.packageName,
        simpleName: source.simpleName,
    }));

    for (const source of config.sources) {
        await writeCachedSource(config.projectPath, source.className, source.jarPath, source.source);
        await writeFixtureSourceRegistry(config.projectPath, source);
        await createJarWithClasses(source.jarPath, [source.className]);
    }

    const scanResult: ScanResult = {
        jarCount: new Set(config.sources.map((source) => source.jarPath)).size,
        classCount: classIndex.length,
        indexPath: path.join(config.projectPath, '.mcp-class-index.json'),
        sampleEntries: classIndex.slice(0, 4).map((entry) => `${entry.className} -> ${path.basename(entry.jarPath)}`),
    };

    await writeClassIndexFile(config.projectPath, scanResult, classIndex);
}

export async function prepareSyntheticDependencySearchFixture(
    config: SyntheticDependencySearchFixtureConfig
): Promise<void> {
    await prepareSyntheticProjectFixture(config);
}

export async function resolveSyntheticDependencySearchFixtureConfig(
    options: SyntheticFixtureResolutionOptions
): Promise<SyntheticDependencySearchFixtureConfig | undefined> {
    if (!hasExplicitFixtureOptions(options)) {
        return undefined;
    }

    if (options.projectPath.trim().length === 0) {
        throw new Error('显式 fixture 模式要求通过 --project 指定测试项目目录');
    }

    if (options.fixtureSourcesPath === undefined) {
        throw new Error('显式 fixture 模式要求提供 --fixture-sources <json>');
    }

    const sources = await readLockedFixtureSourcesFromFile(options.fixtureSourcesPath);

    return {
        projectPath: options.projectPath,
        sources,
    };
}

export async function readLockedFixtureSource(
    projectPath: string,
    className: string,
    jarPath: string
): Promise<string | null> {
    const fixtureSourceRoot = getFixtureSourceRoot(projectPath);
    const fixtureSourcePath = getJarScopedSourcePath(fixtureSourceRoot, className, jarPath);

    if (!await fs.pathExists(fixtureSourcePath)) {
        return null;
    }

    return fs.readFile(fixtureSourcePath, 'utf-8');
}

async function readLockedFixtureSourcesFromFile(filePath: string): Promise<readonly LockedFixtureSource[]> {
    const fileContents = await fs.readJson(filePath);
    if (!Array.isArray(fileContents) || !fileContents.every(isLockedFixtureSourceLike)) {
        throw new Error(`fixture sources 文件形状不正确: ${filePath}`);
    }

    const baseDirectory = path.dirname(path.resolve(filePath));
    return fileContents.map((source) => ({
        ...source,
        jarPath: path.isAbsolute(source.jarPath) ? source.jarPath : path.resolve(baseDirectory, source.jarPath),
    }));
}

function isLockedFixtureSourceLike(value: unknown): value is LockedFixtureSource {
    return typeof value === 'object'
        && value !== null
        && isNonEmptyString(value, 'className')
        && isNonEmptyString(value, 'jarPath')
        && isNonEmptyString(value, 'packageName')
        && isNonEmptyString(value, 'simpleName')
        && isNonEmptyString(value, 'source');
}

function isNonEmptyString(value: object, key: keyof LockedFixtureSource): boolean {
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === 'string' && candidate.trim().length > 0;
}
