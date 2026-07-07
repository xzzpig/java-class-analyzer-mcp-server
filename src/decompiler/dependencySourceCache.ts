import fs from 'fs-extra';
import os from 'os';
import * as path from 'path';

interface ClassNameParts {
    readonly packageSegments: readonly string[];
    readonly simpleName: string;
}

const CACHE_APPLICATION_DIRECTORY = 'java-class-analyzer-mcp-server' as const;

export interface CachedSourceText {
    readonly source: string;
    readonly cachePath: string;
}

export interface SourceRefreshRequest {
    readonly className: string;
    readonly jarPath: string;
    readonly projectPath: string;
}

export interface ResolveSourceTextRequest extends SourceRefreshRequest {
    readonly useCache: boolean;
    readonly refreshSource: (request: SourceRefreshRequest) => Promise<string>;
}

export interface ResolvedSourceText {
    readonly source: string;
    readonly cachePath: string;
    readonly refreshed: boolean;
}

function getClassNameParts(className: string): ClassNameParts {
    const lastDotIndex = className.lastIndexOf('.');
    if (lastDotIndex <= 0) {
        return {
            packageSegments: [],
            simpleName: className,
        };
    }

    const packageName = className.slice(0, lastDotIndex);

    return {
        packageSegments: packageName.split('.'),
        simpleName: className.slice(lastDotIndex + 1),
    };
}

function getMavenRepoRoot(): string {
    const configuredRepo = process.env.MAVEN_REPO?.trim();
    return configuredRepo && configuredRepo.length > 0
        ? configuredRepo
        : path.join(os.homedir(), '.m2', 'repository');
}

function getMavenRepoRelativeSegments(jarPath: string): readonly string[] | null {
    const resolved = path.resolve(jarPath);
    const mavenRepoRoot = path.resolve(getMavenRepoRoot());
    const relative = path.relative(mavenRepoRoot, resolved);

    if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        return relative
            .split(path.sep)
            .filter((segment) => segment.length > 0)
            .map((segment) => segment.replace(/:/gu, ''));
    }

    return null;
}

function getCacheRelativeSegments(jarPath: string): readonly string[] {
    const mavenRepoRelativeSegments = getMavenRepoRelativeSegments(jarPath);
    if (mavenRepoRelativeSegments !== null) {
        return ['maven-repo', ...mavenRepoRelativeSegments];
    }

    const resolved = path.resolve(jarPath);
    const parsed = path.parse(resolved);
    // Encode root info (drive letter, UNC server/share, or POSIX `/`) as safe segments
    const rootParts = parsed.root
        .split(path.sep)
        .filter((segment) => segment.length > 0)
        .map((segment) => segment.replace(/:/gu, ''));
    const remainingPath = resolved.slice(parsed.root.length);
    const segments = [
        ...rootParts,
        ...remainingPath
            .split(path.sep)
            .filter((segment) => segment.length > 0)
            .map((segment) => segment.replace(/:/gu, '')),
    ];
    return ['external', ...segments];
}

export function getDecompileCacheRoot(projectPath: string): string {
    return path.join(projectPath, '.mcp-decompile-cache');
}

function getGlobalDecompileCacheRoot(): string {
    const configuredDirectory = process.env.MCP_MAVEN_DECOMPILE_CACHE_DIR?.trim();
    if (configuredDirectory !== undefined && configuredDirectory.length > 0) {
        return path.resolve(configuredDirectory);
    }

    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Caches', CACHE_APPLICATION_DIRECTORY, 'decompile');
    }

    if (process.platform === 'win32') {
        const localApplicationData = process.env.LOCALAPPDATA?.trim()
            || path.join(os.homedir(), 'AppData', 'Local');
        return path.join(localApplicationData, CACHE_APPLICATION_DIRECTORY, 'decompile');
    }

    const cacheHome = process.env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), '.cache');
    return path.join(cacheHome, CACHE_APPLICATION_DIRECTORY, 'decompile');
}

export function getJarScopedCacheDirectory(projectPath: string, jarPath: string): string {
    const mavenRepoRelativeSegments = getMavenRepoRelativeSegments(jarPath);
    return mavenRepoRelativeSegments === null
        ? path.join(getDecompileCacheRoot(projectPath), ...getCacheRelativeSegments(jarPath))
        : path.join(getGlobalDecompileCacheRoot(), 'maven-repo', ...mavenRepoRelativeSegments);
}

export function getJarScopedSourcePath(
    baseDirectory: string,
    className: string,
    jarPath: string,
    extension: string = 'java'
): string {
    const classNameParts = getClassNameParts(className);

    return path.join(
        baseDirectory,
        ...getCacheRelativeSegments(jarPath),
        ...classNameParts.packageSegments,
        `${classNameParts.simpleName}.${extension}`
    );
}

export function getJarScopedCachePath(projectPath: string, className: string, jarPath: string): string {
    const classNameParts = getClassNameParts(className);
    return path.join(
        getJarScopedCacheDirectory(projectPath, jarPath),
        ...classNameParts.packageSegments,
        `${classNameParts.simpleName}.java`
    );
}

export async function readCachedSource(
    projectPath: string,
    className: string,
    jarPath: string
): Promise<CachedSourceText | null> {
    const cachePath = getJarScopedCachePath(projectPath, className, jarPath);
    if (await fs.pathExists(cachePath)) {
        return {
            source: await fs.readFile(cachePath, 'utf-8'),
            cachePath,
        };
    }

    return null;
}

export async function writeCachedSource(
    projectPath: string,
    className: string,
    jarPath: string,
    source: string
): Promise<string> {
    const cachePath = getJarScopedCachePath(projectPath, className, jarPath);
    await fs.ensureDir(path.dirname(cachePath));
    await fs.outputFile(cachePath, source, 'utf-8');
    return cachePath;
}

export async function resolveSourceText(request: ResolveSourceTextRequest): Promise<ResolvedSourceText> {
    if (request.useCache) {
        const cachedSource = await readCachedSource(
            request.projectPath,
            request.className,
            request.jarPath
        );
        if (cachedSource !== null) {
            return {
                source: cachedSource.source,
                cachePath: cachedSource.cachePath,
                refreshed: false,
            };
        }
    }

    const refreshedSource = await request.refreshSource(request);
    const cachePath = await writeCachedSource(
        request.projectPath,
        request.className,
        request.jarPath,
        refreshedSource
    );

    return {
        source: refreshedSource,
        cachePath,
        refreshed: true,
    };
}

export function getSourceLines(source: string): readonly string[] {
    return source.split(/\r?\n/u);
}

export function buildLineTextMap(source: string): ReadonlyMap<number, string> {
    return new Map<number, string>(
        getSourceLines(source).map((line, index) => [index + 1, line])
    );
}

export function findMatchingLineNumbers(
    source: string,
    query: string,
    caseSensitive: boolean
): readonly number[] {
    const normalizedQuery = caseSensitive ? query : query.toLowerCase();
    const matchedLines: number[] = [];

    getSourceLines(source).forEach((line, index) => {
        const candidate = caseSensitive ? line : line.toLowerCase();
        if (candidate.includes(normalizedQuery)) {
            matchedLines.push(index + 1);
        }
    });

    return matchedLines;
}

export function getLineTextsByLine(
    source: string,
    lineNumbers: readonly number[]
): Readonly<Record<number, string>> {
    const sourceLines = getSourceLines(source);
    const result: Record<number, string> = {};

    for (const lineNumber of lineNumbers) {
        const lineText = sourceLines[lineNumber - 1];
        if (lineText !== undefined) {
            result[lineNumber] = lineText;
        }
    }

    return result;
}
