import type { BatchDecompileClassResult } from '../decompiler/decompileJarBatch.js';
import type { DecompileClassOptions } from '../decompiler/decompileRuntimeConfig.js';
import type { DependencySourceItem } from '../scanner/dependencySourceIndex.js';

export interface ResolveDependencyCodeSearchSourcesRequest {
    readonly entries: readonly DependencySourceItem[];
    readonly projectPath: string;
    readonly useCache: boolean;
    readonly cfrPath?: string;
    readonly requestTempNamespace?: string;
    readonly resolveSource?: (entry: DependencySourceItem) => Promise<string>;
    readonly decompiler: {
        getCachedSource(className: string, projectPath: string, jarPath: string): Promise<string | null>;
        decompileJarClasses(
            classNames: readonly string[],
            projectPath: string,
            jarPath: string,
            cfrPath?: string,
            options?: DecompileClassOptions
        ): Promise<readonly BatchDecompileClassResult[]>;
    };
}

export type SourceResolution = {
    readonly success: true;
    readonly source: string;
} | {
    readonly success: false;
    readonly error: Error;
};

export async function resolveDependencyCodeSearchSources(
    request: ResolveDependencyCodeSearchSourcesRequest
): Promise<ReadonlyMap<string, SourceResolution>> {
    if (request.resolveSource !== undefined) {
        return resolveSourcesIndividually(request);
    }

    return resolveSourcesByJar(request);
}

export function getDependencySearchSourceResolutionKey(
    entry: Pick<DependencySourceItem, 'className' | 'jarPath'>
): string {
    return `${entry.jarPath}\u0000${entry.className}`;
}

async function resolveSourcesIndividually(
    request: ResolveDependencyCodeSearchSourcesRequest
): Promise<ReadonlyMap<string, SourceResolution>> {
    const resolutions = new Map<string, SourceResolution>();

    for (const entry of request.entries) {
        try {
            const source = await request.resolveSource?.(entry);
            if (source === undefined) {
                resolutions.set(getDependencySearchSourceResolutionKey(entry), {
                    success: false,
                    error: new Error(`未返回 ${entry.className} 的源码`),
                });
                continue;
            }

            resolutions.set(getDependencySearchSourceResolutionKey(entry), { success: true, source });
        } catch (error) {
            resolutions.set(getDependencySearchSourceResolutionKey(entry), {
                success: false,
                error: toSearchSourceError(error),
            });
        }
    }

    return resolutions;
}

async function resolveSourcesByJar(
    request: ResolveDependencyCodeSearchSourcesRequest
): Promise<ReadonlyMap<string, SourceResolution>> {
    const resolutions = new Map<string, SourceResolution>();
    const entriesByJar = new Map<string, DependencySourceItem[]>();

    for (const entry of request.entries) {
        if (request.useCache) {
            const cachedSource = await request.decompiler.getCachedSource(
                entry.className,
                request.projectPath,
                entry.jarPath
            );
            if (cachedSource !== null) {
                resolutions.set(getDependencySearchSourceResolutionKey(entry), { success: true, source: cachedSource });
                continue;
            }
        }

        const jarEntries = entriesByJar.get(entry.jarPath);
        if (jarEntries === undefined) {
            entriesByJar.set(entry.jarPath, [entry]);
            continue;
        }

        jarEntries.push(entry);
    }

    for (const [jarPath, jarEntries] of entriesByJar.entries()) {
        try {
            const results = await request.decompiler.decompileJarClasses(
                jarEntries.map((entry) => entry.className),
                request.projectPath,
                jarPath,
                request.cfrPath,
                { requestTempNamespace: request.requestTempNamespace }
            );
            const resultsByClassName = new Map(results.map((result) => [result.className, result]));

            for (const entry of jarEntries) {
                const batchResult = resultsByClassName.get(entry.className);
                if (batchResult?.success === true && batchResult.source !== undefined) {
                    resolutions.set(getDependencySearchSourceResolutionKey(entry), {
                        success: true,
                        source: batchResult.source,
                    });
                    continue;
                }

                resolutions.set(getDependencySearchSourceResolutionKey(entry), {
                    success: false,
                    error: new Error(batchResult?.error ?? `批量反编译未返回 ${entry.className} 的结果`),
                });
            }
        } catch (error) {
            const batchError = toSearchSourceError(error);
            for (const entry of jarEntries) {
                resolutions.set(getDependencySearchSourceResolutionKey(entry), {
                    success: false,
                    error: batchError,
                });
            }
        }
    }

    return resolutions;
}

function toSearchSourceError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
