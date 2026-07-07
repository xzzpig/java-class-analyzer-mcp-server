import fs from 'fs-extra';
import * as path from 'path';
import {
    MissingDependencyDecompileScopeError,
    type DependencyDecompileDirectoryFailure,
    type DependencyDecompileDirectoryRequest,
    type DependencyDecompileDirectoryResult,
    type DependencyDecompileDirectoryScope,
    type DependencyDecompileDirectoryStructuredContent,
} from '../dependency/DependencyDecompileDirectoryService.js';
import {
    getDecompileCacheRoot,
    getJarScopedCacheDirectory,
    getJarScopedCachePath,
    readCachedSource,
    writeCachedSource,
} from '../decompiler/dependencySourceCache.js';
import { DependencyScanner } from '../scanner/DependencyScanner.js';
import {
    normalizeDependencySourceFilters,
    type DependencySourceItem,
    type NormalizedDependencySourceFilters,
} from '../scanner/dependencySourceIndex.js';
import { readLockedFixtureSource } from './dependencySearchFixtures.js';

const FAILURE_SUMMARY_LIMIT = 5 as const;

const scanner = new DependencyScanner();

export async function runDependencyDecompileDirectoryForTesting(
    request: DependencyDecompileDirectoryRequest
): Promise<DependencyDecompileDirectoryResult> {
    const requestedScope = buildRequestedScope(request);
    const entries = await scanner.listClassIndexEntries(request.projectPath, requestedScope);
    const outputDir = await resolveOutputDir(request.projectPath, requestedScope, entries);

    let processedClasses = 0;
    let decompiledClasses = 0;
    let skippedCachedClasses = 0;
    const failures: DependencyDecompileDirectoryFailure[] = [];

    for (const entry of entries) {
        const cachedSource = await readCachedSource(request.projectPath, entry.className, entry.jarPath);
        if (requestedScope.useCache && cachedSource !== null) {
            skippedCachedClasses += 1;
            continue;
        }

        if (requestedScope.maxClasses !== undefined && decompiledClasses >= requestedScope.maxClasses) {
            break;
        }

        processedClasses += 1;

        try {
            const lockedSource = await readLockedFixtureSource(request.projectPath, entry.className, entry.jarPath);
            if (lockedSource === null) {
                throw new Error(`未找到 locked fixture source: ${entry.className}`);
            }
            await writeCachedSource(request.projectPath, entry.className, entry.jarPath, lockedSource);
            decompiledClasses += 1;
        } catch (error) {
            failures.push({
                className: entry.className,
                jarPath: entry.jarPath,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    const failedSummaryTopN = failures.slice(0, FAILURE_SUMMARY_LIMIT);
    const structuredContent = {
        outputDir,
        requestedScope,
        processedClasses,
        decompiledClasses,
        skippedCachedClasses,
        failedClasses: failures.length,
        failedSummaryTopN,
        truncatedCount: Math.max(failures.length - failedSummaryTopN.length, 0),
    } satisfies DependencyDecompileDirectoryStructuredContent;

    return {
        content: buildSummary(structuredContent),
        structuredContent,
    };
}

function buildRequestedScope(request: DependencyDecompileDirectoryRequest): DependencyDecompileDirectoryScope {
    const filters = normalizeDependencySourceFilters({
        packagePrefix: request.packagePrefix,
        jarName: request.jarName,
        jarPath: request.jarPath,
    });

    if (filters.packagePrefix === undefined && filters.jarName === undefined && filters.jarPath === undefined) {
        throw new MissingDependencyDecompileScopeError();
    }

    return {
        ...filters,
        ...(request.maxClasses === undefined ? {} : { maxClasses: request.maxClasses }),
        useCache: request.useCache ?? true,
    };
}

async function resolveOutputDir(
    projectPath: string,
    filters: NormalizedDependencySourceFilters,
    entries: readonly DependencySourceItem[]
): Promise<string> {
    const fallbackDirectory = filters.jarPath === undefined
        ? getDecompileCacheRoot(projectPath)
        : getJarScopedCacheDirectory(projectPath, filters.jarPath);
    const candidateDirectories = entries.map((entry) => path.dirname(
        getJarScopedCachePath(projectPath, entry.className, entry.jarPath)
    ));
    const outputDir = candidateDirectories.length === 0
        ? fallbackDirectory
        : getCommonDirectory(candidateDirectories, fallbackDirectory);

    await fs.ensureDir(outputDir);
    return outputDir;
}

function buildSummary(content: DependencyDecompileDirectoryStructuredContent): string {
    return `Prepared dependency sources in ${content.outputDir}; decompiled ${content.decompiledClasses} classes, reused ${content.skippedCachedClasses} cached classes, failed ${content.failedClasses}.`;
}

function getCommonDirectory(directories: readonly string[], fallbackDirectory: string): string {
    const fallbackPath = path.resolve(fallbackDirectory);
    const [firstDirectory, ...remainingDirectories] = directories;
    const firstPath = splitPath(path.resolve(firstDirectory));
    let commonSegments = firstPath.segments;

    for (const currentPath of remainingDirectories) {
        const parsedPath = splitPath(path.resolve(currentPath));
        if (parsedPath.root !== firstPath.root) {
            return fallbackPath;
        }

        const nextSegments: string[] = [];
        const limit = Math.min(commonSegments.length, parsedPath.segments.length);

        for (let index = 0; index < limit; index += 1) {
            if (commonSegments[index] !== parsedPath.segments[index]) {
                break;
            }
            nextSegments.push(commonSegments[index]);
        }

        commonSegments = nextSegments;
        if (commonSegments.length === 0) {
            return fallbackPath;
        }
    }

    return path.join(firstPath.root, ...commonSegments);
}

function splitPath(targetPath: string): { readonly root: string; readonly segments: readonly string[] } {
    const parsedPath = path.parse(targetPath);
    return {
        root: parsedPath.root,
        segments: targetPath.slice(parsedPath.root.length).split(path.sep).filter((segment) => segment.length > 0),
    };
}
