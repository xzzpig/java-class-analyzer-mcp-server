import type {
    DependencySourceFilters,
    DependencySourceItem,
} from './dependencySourceIndex.js';
import { DependencyScanner } from './DependencyScanner.js';

const DEFAULT_CLASS_SEARCH_LIMIT = 20 as const;

export interface ClassSearchRequest extends DependencySourceFilters {
    readonly projectPath: string;
    readonly query: string;
    readonly limit?: number;
    readonly caseSensitive?: boolean;
}

export type ClassSearchStructuredContent = {
    readonly query: string;
    readonly classes: readonly DependencySourceItem[];
    readonly scannedClasses: number;
    readonly totalMatches: number;
    readonly returnedMatches: number;
    readonly hasMore: boolean;
    readonly truncatedCount: number;
};

export type ClassSearchResult = {
    readonly content: string;
    readonly structuredContent: ClassSearchStructuredContent;
};

export class EmptyClassSearchQueryError extends Error {
    readonly name = 'EmptyClassSearchQueryError';

    constructor() {
        super('search_classes requires a non-empty query string after trimming whitespace.');
    }
}

export class InvalidClassSearchLimitError extends Error {
    readonly name = 'InvalidClassSearchLimitError';

    constructor() {
        super('search_classes limit must be a positive integer.');
    }
}

export class ClassSearchService {
    private readonly scanner = new DependencyScanner();

    async search(request: ClassSearchRequest): Promise<ClassSearchResult> {
        const query = request.query.trim();
        if (query.length === 0) {
            throw new EmptyClassSearchQueryError();
        }

        const limit = request.limit ?? DEFAULT_CLASS_SEARCH_LIMIT;
        if (!Number.isInteger(limit) || limit < 1) {
            throw new InvalidClassSearchLimitError();
        }

        const entries = await this.scanner.listClassIndexEntries(request.projectPath, {
            packagePrefix: request.packagePrefix,
            jarName: request.jarName,
            jarPath: request.jarPath,
        });
        const caseSensitive = request.caseSensitive ?? false;
        const normalizedQuery = caseSensitive ? query : query.toLowerCase();
        const matches = entries
            .filter((entry) => {
                const className = caseSensitive ? entry.className : entry.className.toLowerCase();
                return className.includes(normalizedQuery);
            })
            .sort((left, right) => {
                const classNameOrder = left.className.localeCompare(right.className);
                return classNameOrder !== 0 ? classNameOrder : left.jarPath.localeCompare(right.jarPath);
            });
        const classes = matches.slice(0, limit);
        const truncatedCount = Math.max(matches.length - classes.length, 0);

        const structuredContent: ClassSearchStructuredContent = {
            query,
            classes,
            scannedClasses: entries.length,
            totalMatches: matches.length,
            returnedMatches: classes.length,
            hasMore: truncatedCount > 0,
            truncatedCount,
        };

        const summarySuffix = structuredContent.hasMore
            ? ` Returned ${structuredContent.returnedMatches}; skipped ${structuredContent.truncatedCount}.`
            : '';
        return {
            content: `Found ${structuredContent.totalMatches} matching classes for ${JSON.stringify(query)}.${summarySuffix}`,
            structuredContent,
        };
    }
}
