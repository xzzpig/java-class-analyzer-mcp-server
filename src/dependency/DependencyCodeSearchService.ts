import type { DependencySourceFilters, DependencySourceItem } from '../scanner/dependencySourceIndex.js';
import { DecompilerService } from '../decompiler/DecompilerService.js';
import {
    findMatchingLineNumbers,
    getLineTextsByLine,
} from '../decompiler/dependencySourceCache.js';
import {
    cleanupRequestTempNamespace,
    createRequestTempNamespace,
} from '../decompiler/decompileRuntimeConfig.js';
import { DependencyScanner } from '../scanner/DependencyScanner.js';
import {
    getDependencySearchSourceResolutionKey,
    resolveDependencyCodeSearchSources,
} from './dependencyCodeSearchSourceResolution.js';

const DEFAULT_SEARCH_LIMIT = 20 as const;
const MAX_RESPONSE_SIZE_WITH_LINE_TEXT = 1_200 as const;
const MAX_RESPONSE_SIZE = 12_000 as const;

export interface DependencyCodeSearchRequest extends DependencySourceFilters {
    readonly projectPath: string;
    readonly query: string;
    readonly limit?: number;
    readonly caseSensitive?: boolean;
    readonly useCache?: boolean;
    readonly includeLineText?: boolean;
    readonly cfrPath?: string;
}

export interface DependencyCodeSearchSourceRequest {
    readonly entry: DependencySourceItem;
    readonly projectPath: string;
    readonly useCache: boolean;
    readonly cfrPath?: string;
    readonly requestTempNamespace?: string;
    readonly workerId?: number;
}

export interface DependencyCodeSearchDependencies {
    readonly resolveSource?: (request: DependencyCodeSearchSourceRequest) => Promise<string>;
}

export type DependencyCodeSearchHit = {
    readonly className: string;
    readonly packageName: string;
    readonly jarPath: string;
    readonly matchCount: number;
    readonly matchedLines: readonly number[];
    readonly lineTextsByLine?: Readonly<Record<number, string>>;
};

export type DependencyCodeSearchStructuredContent = {
    readonly hits: readonly DependencyCodeSearchHit[];
    readonly failedClasses: number;
    readonly scannedClasses: number;
    readonly totalHits: number;
    readonly returnedHits: number;
    readonly hasMore: boolean;
    readonly truncatedCount: number;
    readonly lineTextOmitted?: true;
};

export interface DependencyCodeSearchResult {
    readonly content: string;
    readonly structuredContent: DependencyCodeSearchStructuredContent;
}

export class EmptyDependencyCodeSearchQueryError extends Error {
    readonly name = 'EmptyDependencyCodeSearchQueryError';

    constructor() {
        super('search_dependency_code requires a non-empty query string after trimming whitespace.');
    }
}

export class DependencyCodeSearchResponseTooLargeError extends Error {
    readonly name = 'DependencyCodeSearchResponseTooLargeError';

    constructor() {
        super(
            'Dependency search response is too large even without line texts. Narrow packagePrefix/jarName/jarPath filters or use decompile_dependencies_to_dir for local grep.'
        );
    }
}

export class DependencyCodeSearchService {
    private readonly scanner = new DependencyScanner();
    private readonly decompiler = new DecompilerService();

    constructor(private readonly dependencies: DependencyCodeSearchDependencies = {}) {}

    async search(request: DependencyCodeSearchRequest): Promise<DependencyCodeSearchResult> {
        const normalizedQuery = request.query.trim();
        if (normalizedQuery.length === 0) {
            throw new EmptyDependencyCodeSearchQueryError();
        }

        const limit = request.limit ?? DEFAULT_SEARCH_LIMIT;
        const caseSensitive = request.caseSensitive ?? true;
        const useCache = request.useCache ?? true;
        const includeLineText = request.includeLineText ?? false;
        const entries = await this.scanner.listClassIndexEntries(request.projectPath, {
            packagePrefix: request.packagePrefix,
            jarName: request.jarName,
            jarPath: request.jarPath,
        });

        const hits: DependencyCodeSearchHit[] = [];
        let failedClasses = 0;
        const requestTempNamespace = createRequestTempNamespace();

        try {
            const sourceResolutions = await resolveDependencyCodeSearchSources({
                entries,
                projectPath: request.projectPath,
                useCache,
                cfrPath: request.cfrPath,
                requestTempNamespace,
                resolveSource: this.dependencies.resolveSource === undefined
                    ? undefined
                    : async (entry) => this.resolveSource({
                        entry,
                        projectPath: request.projectPath,
                        useCache,
                        cfrPath: request.cfrPath,
                        requestTempNamespace,
                    }),
                decompiler: this.decompiler,
            });

            for (const entry of entries) {
                const sourceResolution = sourceResolutions.get(getDependencySearchSourceResolutionKey(entry));
                if (sourceResolution === undefined || sourceResolution.success === false) {
                    failedClasses += 1;
                    continue;
                }

                const matchedLines = findMatchingLineNumbers(sourceResolution.source, normalizedQuery, caseSensitive);
                if (matchedLines.length === 0) {
                    continue;
                }

                hits.push({
                    className: entry.className,
                    packageName: entry.packageName,
                    jarPath: entry.jarPath,
                    matchCount: matchedLines.length,
                    matchedLines,
                    ...(includeLineText
                        ? { lineTextsByLine: getLineTextsByLine(sourceResolution.source, matchedLines) }
                        : {}),
                });
            }

            hits.sort((left, right) => {
                if (left.matchCount !== right.matchCount) {
                    return right.matchCount - left.matchCount;
                }
                const classNameOrder = left.className.localeCompare(right.className);
                return classNameOrder !== 0 ? classNameOrder : left.jarPath.localeCompare(right.jarPath);
            });

            const totalHits = hits.length;
            const returnedHits = hits.slice(0, limit);
            const truncatedCount = Math.max(totalHits - returnedHits.length, 0);
            const baseStructuredContent = {
                hits: returnedHits,
                failedClasses,
                scannedClasses: entries.length,
                totalHits,
                returnedHits: returnedHits.length,
                hasMore: truncatedCount > 0,
                truncatedCount,
            } satisfies DependencyCodeSearchStructuredContent;

            const structuredContent = this.applyLargeResponseProtocol(baseStructuredContent, includeLineText);

            return {
                content: buildSummary(normalizedQuery, structuredContent),
                structuredContent,
            };
        } finally {
            await cleanupRequestTempNamespace(requestTempNamespace);
        }
    }

    private applyLargeResponseProtocol(
        structuredContent: DependencyCodeSearchStructuredContent,
        includeLineText: boolean
    ): DependencyCodeSearchStructuredContent {
        if (!includeLineText) {
            if (estimateResponseSize(structuredContent) > MAX_RESPONSE_SIZE) {
                throw new DependencyCodeSearchResponseTooLargeError();
            }
            return structuredContent;
        }

        if (estimateResponseSize(structuredContent) <= MAX_RESPONSE_SIZE_WITH_LINE_TEXT) {
            return structuredContent;
        }

        const degradedStructuredContent = {
            ...structuredContent,
            hits: structuredContent.hits.map(({ lineTextsByLine: _omittedLineTexts, ...hit }) => hit),
            lineTextOmitted: true,
        } satisfies DependencyCodeSearchStructuredContent;

        if (estimateResponseSize(degradedStructuredContent) > MAX_RESPONSE_SIZE) {
            throw new DependencyCodeSearchResponseTooLargeError();
        }

        return degradedStructuredContent;
    }

    private async resolveSource(request: DependencyCodeSearchSourceRequest): Promise<string> {
        if (this.dependencies.resolveSource !== undefined) {
            return this.dependencies.resolveSource(request);
        }

        return this.decompiler.decompileClass(
            request.entry.className,
            request.projectPath,
            request.useCache,
            request.cfrPath,
            request.entry.jarPath,
            {
                requestTempNamespace: request.requestTempNamespace,
                workerId: request.workerId,
            }
        );
    }
}

function estimateResponseSize(structuredContent: DependencyCodeSearchStructuredContent): number {
    return JSON.stringify({ structuredContent }).length;
}

function buildSummary(query: string, structuredContent: DependencyCodeSearchStructuredContent): string {
    if (structuredContent.totalHits === 0) {
        return `No dependency classes matched ${JSON.stringify(query)}.`;
    }

    const lineTextSuffix = structuredContent.lineTextOmitted === true
        ? ' Line texts were omitted due to response size.'
        : '';

    return `Found ${structuredContent.totalHits} matching dependency classes for ${JSON.stringify(query)}; returned ${structuredContent.returnedHits} and skipped ${structuredContent.failedClasses} failed classes.${lineTextSuffix}`;
}
