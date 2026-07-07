import { readCachedSource } from '../decompiler/dependencySourceCache.js';
import {
    cleanupRequestTempNamespace,
    createRequestTempNamespace,
} from '../decompiler/decompileRuntimeConfig.js';
import type { DependencySourceItem } from '../scanner/dependencySourceIndex.js';

export interface DecompileDirectoryExecutionFailure {
    readonly className: string;
    readonly jarPath: string;
    readonly error: string;
}

export interface DecompileDirectoryExecutionRequest {
    readonly entries: readonly DependencySourceItem[];
    readonly projectPath: string;
    readonly useCache: boolean;
    readonly maxClasses?: number;
    readonly cfrPath?: string;
    readonly decompiler: {
        decompileJarClasses: (
            classNames: readonly string[],
            projectPath: string,
            jarPath: string,
            cfrPath?: string,
            options?: {
                readonly requestTempNamespace?: string;
                readonly workerId?: number;
            }
        ) => Promise<readonly {
            readonly className: string;
            readonly success: boolean;
            readonly error?: string;
        }[]>;
    };
}

export interface DecompileDirectoryExecutionResult {
    readonly processedClasses: number;
    readonly decompiledClasses: number;
    readonly skippedCachedClasses: number;
    readonly failures: readonly DecompileDirectoryExecutionFailure[];
}

export async function runDecompileDirectoryExecution(
    request: DecompileDirectoryExecutionRequest
): Promise<DecompileDirectoryExecutionResult> {
    let decompiledClasses = 0;
    let skippedCachedClasses = 0;
    const failures: DecompileDirectoryExecutionFailure[] = [];
    const requestTempNamespace = createRequestTempNamespace();
    const entriesToDecompile: DependencySourceItem[] = [];

    const recordFailure = (entry: DependencySourceItem, error: unknown): void => {
        failures.push({
            className: entry.className,
            jarPath: entry.jarPath,
            error: error instanceof Error ? error.message : String(error),
        });
    };

    try {
        for (const entry of request.entries) {
            const cachedSource = request.useCache
                ? await readCachedSource(request.projectPath, entry.className, entry.jarPath)
                : null;
            if (request.useCache && cachedSource !== null) {
                skippedCachedClasses += 1;
                continue;
            }

            if (request.maxClasses !== undefined && entriesToDecompile.length >= request.maxClasses) {
                break;
            }

            entriesToDecompile.push(entry);
        }

        for (const jarGroup of groupEntriesByJar(entriesToDecompile)) {
            try {
                const results = await request.decompiler.decompileJarClasses(
                    jarGroup.entries.map((entry) => entry.className),
                    request.projectPath,
                    jarGroup.jarPath,
                    request.cfrPath,
                    {
                        requestTempNamespace,
                    }
                );
                const resultsByClassName = new Map(results.map((result) => [result.className, result]));

                for (const entry of jarGroup.entries) {
                    const result = resultsByClassName.get(entry.className);
                    if (result?.success === true) {
                        decompiledClasses += 1;
                        continue;
                    }

                    recordFailure(entry, result?.error ?? `批量反编译未返回 ${entry.className} 的结果`);
                }
            } catch (error) {
                for (const entry of jarGroup.entries) {
                    recordFailure(entry, error);
                }
            }
        }

        return {
            processedClasses: entriesToDecompile.length,
            decompiledClasses,
            skippedCachedClasses,
            failures,
        };
    } finally {
        await cleanupRequestTempNamespace(requestTempNamespace);
    }
}

function groupEntriesByJar(
    entries: readonly DependencySourceItem[]
): readonly { readonly jarPath: string; readonly entries: readonly DependencySourceItem[] }[] {
    const groups = new Map<string, DependencySourceItem[]>();

    for (const entry of entries) {
        const existingGroup = groups.get(entry.jarPath);
        if (existingGroup === undefined) {
            groups.set(entry.jarPath, [entry]);
            continue;
        }

        existingGroup.push(entry);
    }

    return Array.from(groups.entries(), ([jarPath, jarEntries]) => ({
        jarPath,
        entries: jarEntries,
    }));
}
