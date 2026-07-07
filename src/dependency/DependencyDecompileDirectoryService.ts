import fs from 'fs-extra';
import * as path from 'path';
import type {
    DependencySourceFilters,
    DependencySourceItem,
    NormalizedDependencySourceFilters,
} from '../scanner/dependencySourceIndex.js';
import {
    filterDependencySourceItems,
    normalizeDependencySourceFilters,
} from '../scanner/dependencySourceIndex.js';
import {
    DecompilerService,
} from '../decompiler/DecompilerService.js';
import {
    getDecompileCacheRoot,
    getJarScopedCacheDirectory,
    getJarScopedCachePath,
} from '../decompiler/dependencySourceCache.js';
import { DependencyScanner } from '../scanner/DependencyScanner.js';
import { runDecompileDirectoryExecution } from './decompileDirectoryExecution.js';

const FAILURE_SUMMARY_LIMIT = 5 as const;

export interface DependencyDecompileDirectoryRequest extends DependencySourceFilters {
    readonly projectPath: string;
    readonly maxClasses?: number;
    readonly useCache?: boolean;
    readonly cfrPath?: string;
}

export interface DependencyDecompileDirectoryFailure {
    readonly className: string;
    readonly jarPath: string;
    readonly error: string;
}

export interface DependencyDecompileDirectoryScope extends NormalizedDependencySourceFilters {
    readonly maxClasses?: number;
    readonly useCache: boolean;
}

export interface DependencyDecompileDirectoryStructuredContent {
    readonly outputDir: string;
    readonly requestedScope: DependencyDecompileDirectoryScope;
    readonly processedClasses: number;
    readonly decompiledClasses: number;
    readonly skippedCachedClasses: number;
    readonly failedClasses: number;
    readonly failedSummaryTopN: readonly DependencyDecompileDirectoryFailure[];
    readonly truncatedCount: number;
}

export interface DependencyDecompileDirectoryResult {
    readonly content: string;
    readonly structuredContent: DependencyDecompileDirectoryStructuredContent;
}

export class MissingDependencyDecompileScopeError extends Error {
    readonly name = 'MissingDependencyDecompileScopeError';

    constructor() {
        super('decompile_dependencies_to_dir requires at least one of packagePrefix, jarName, or jarPath.');
    }
}

export class DependencyDecompileDirectoryService {
    private readonly scanner = new DependencyScanner();
    private readonly decompiler = new DecompilerService();

    async decompileToDirectory(
        request: DependencyDecompileDirectoryRequest
    ): Promise<DependencyDecompileDirectoryResult> {
        const allIndexEntries = await this.scanner.ensureClassIndexEntries(request.projectPath);
        const requestedScope = this.buildRequestedScope(request);
        const entries = filterDependencySourceItems(allIndexEntries, requestedScope);
        const outputDir = await this.resolveOutputDir(request.projectPath, requestedScope, entries);
        const execution = await runDecompileDirectoryExecution({
            entries,
            projectPath: request.projectPath,
            useCache: requestedScope.useCache,
            maxClasses: requestedScope.maxClasses,
            cfrPath: request.cfrPath,
            decompiler: this.decompiler,
        });
        const failedSummaryTopN = execution.failures.slice(0, FAILURE_SUMMARY_LIMIT);
        const structuredContent = {
            outputDir,
            requestedScope,
            processedClasses: execution.processedClasses,
            decompiledClasses: execution.decompiledClasses,
            skippedCachedClasses: execution.skippedCachedClasses,
            failedClasses: execution.failures.length,
            failedSummaryTopN,
            truncatedCount: Math.max(execution.failures.length - failedSummaryTopN.length, 0),
        } satisfies DependencyDecompileDirectoryStructuredContent;

        return {
            content: buildSummary(structuredContent),
            structuredContent,
        };
    }

    private buildRequestedScope(
        request: DependencyDecompileDirectoryRequest
    ): DependencyDecompileDirectoryScope {
        const filters = normalizeDependencySourceFilters({
            packagePrefix: request.packagePrefix,
            jarName: request.jarName,
            jarPath: request.jarPath,
        });

        if (
            filters.packagePrefix === undefined
            && filters.jarName === undefined
            && filters.jarPath === undefined
        ) {
            throw new MissingDependencyDecompileScopeError();
        }

        return {
            ...filters,
            ...(request.maxClasses === undefined ? {} : { maxClasses: request.maxClasses }),
            useCache: request.useCache ?? true,
        };
    }

    private async resolveOutputDir(
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
}

function buildSummary(content: DependencyDecompileDirectoryStructuredContent): string {
    return `Prepared dependency sources in ${content.outputDir}; decompiled ${content.decompiledClasses} classes, reused ${content.skippedCachedClasses} cached classes, failed ${content.failedClasses}.`;
}

function getCommonDirectory(paths: readonly string[], fallbackDirectory: string): string {
    const fallbackPath = path.resolve(fallbackDirectory);
    const firstPath = splitPath(path.resolve(paths[0] ?? fallbackDirectory));
    let commonSegments = firstPath.segments;

    for (const currentPath of paths.slice(1)) {
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
