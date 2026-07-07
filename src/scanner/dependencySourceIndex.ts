import fs from 'fs-extra';
import * as path from 'path';

export interface ClassIndexEntry {
    readonly className: string;
    readonly jarPath: string;
    readonly packageName: string;
    readonly simpleName: string;
}

export interface ScanResult {
    readonly jarCount: number;
    readonly classCount: number;
    readonly indexPath: string;
    readonly sampleEntries: readonly string[];
}

interface ClassIndexFile extends ScanResult {
    readonly classIndex: readonly ClassIndexEntry[];
    readonly lastUpdated: string;
}

export interface DependencySourceFilters {
    readonly packagePrefix?: string;
    readonly jarName?: string;
    readonly jarPath?: string;
}

export interface NormalizedDependencySourceFilters {
    readonly packagePrefix?: string;
    readonly jarName?: string;
    readonly jarPath?: string;
}

export interface DependencySourceItem extends ClassIndexEntry {
    readonly jarName: string;
}

function normalizeOptionalFilter(value?: string): string | undefined {
    const trimmed = value?.trim();
    return trimmed === '' ? undefined : trimmed;
}

export function normalizeDependencySourceFilters(
    filters: DependencySourceFilters = {}
): NormalizedDependencySourceFilters {
    const packagePrefix = normalizeOptionalFilter(filters.packagePrefix);

    return {
        packagePrefix: packagePrefix?.replace(/\.+$/u, ''),
        jarName: normalizeOptionalFilter(filters.jarName),
        jarPath: normalizeOptionalFilter(filters.jarPath),
    };
}

export function getClassIndexPath(projectPath: string): string {
    return path.join(projectPath, '.mcp-class-index.json');
}

export function toDependencySourceItem(entry: ClassIndexEntry): DependencySourceItem {
    return {
        ...entry,
        jarName: path.basename(entry.jarPath),
    };
}

export function filterDependencySourceItems(
    entries: readonly ClassIndexEntry[],
    filters: DependencySourceFilters = {}
): readonly DependencySourceItem[] {
    const { packagePrefix, jarName, jarPath } = normalizeDependencySourceFilters(filters);

    return entries
        .map(toDependencySourceItem)
        .filter((entry) => {
            const packageMatches = packagePrefix === undefined
                || entry.packageName === packagePrefix
                || entry.packageName.startsWith(`${packagePrefix}.`);
            const jarNameMatches = jarName === undefined || entry.jarName === jarName;
            const jarPathMatches = jarPath === undefined || entry.jarPath === jarPath;

            return packageMatches && jarNameMatches && jarPathMatches;
        });
}

async function readClassIndexFile(projectPath: string): Promise<ClassIndexFile> {
    return fs.readJson(getClassIndexPath(projectPath)) as Promise<ClassIndexFile>;
}

export async function readClassIndexEntries(projectPath: string): Promise<readonly ClassIndexEntry[]> {
    const indexData = await readClassIndexFile(projectPath);
    return indexData.classIndex;
}

export async function readScanResult(projectPath: string): Promise<ScanResult> {
    const indexData = await readClassIndexFile(projectPath);
    return {
        jarCount: indexData.jarCount,
        classCount: indexData.classCount,
        indexPath: indexData.indexPath,
        sampleEntries: [...indexData.sampleEntries],
    };
}

export async function writeClassIndexFile(
    projectPath: string,
    result: ScanResult,
    classIndex: readonly ClassIndexEntry[]
): Promise<void> {
    await fs.outputJson(
        getClassIndexPath(projectPath),
        {
            ...result,
            classIndex,
            lastUpdated: new Date().toISOString(),
        },
        { spaces: 2 }
    );
}
