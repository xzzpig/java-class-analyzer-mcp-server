import fs from 'fs-extra';
import * as path from 'path';
import type { TestToolConfig } from './testToolRunner.js';

interface PublicToolTextPart {
    readonly type: 'text';
    readonly text: string;
}

interface PublicToolResponse {
    readonly content: readonly PublicToolTextPart[];
    readonly structuredContent?: unknown;
}

interface DecompileDirectoryFailureSummary {
    readonly className: string;
    readonly jarPath: string;
    readonly error: string;
}

interface DecompileDirectoryRequestedScope {
    readonly useCache: boolean;
    readonly maxClasses?: number;
}

interface DecompileDirectoryStructuredContentLike {
    readonly outputDir: string;
    readonly requestedScope: DecompileDirectoryRequestedScope;
    readonly processedClasses: number;
    readonly decompiledClasses: number;
    readonly skippedCachedClasses: number;
    readonly failedClasses: number;
    readonly failedSummaryTopN: readonly DecompileDirectoryFailureSummary[];
    readonly truncatedCount: number;
}

export function asPublicToolResponse(result: unknown): PublicToolResponse {
    if (!isPublicToolResponse(result)) {
        throw new Error('Public MCP harness 返回了无法识别的响应形状');
    }
    return result;
}

export function printJson(value: unknown): void {
    console.log(JSON.stringify(value, null, 2));
}

export function assertTextContains(result: PublicToolResponse, expectedText: string): void {
    const responseText = getResponseText(result);
    if (!responseText.includes(expectedText)) {
        throw new Error(`未在响应中找到预期文本: ${expectedText}`);
    }
}

export function assertPublicSearchResult(result: PublicToolResponse): void {
    if (result.structuredContent === undefined) {
        throw new Error('search_dependency_code 成功路径缺少 structuredContent');
    }

    const structuredContent = result.structuredContent;
    if (typeof structuredContent !== 'object' || structuredContent === null || !('hits' in structuredContent)) {
        throw new Error('search_dependency_code structuredContent 形状不正确');
    }
}

export async function assertDecompileDirectoryResult(
    result: PublicToolResponse,
    config: TestToolConfig
): Promise<void> {
    const structuredContent = asDecompileDirectoryStructuredContent(result.structuredContent);
    if (structuredContent === null) {
        throw new Error('decompile_dependencies_to_dir 成功路径缺少 structuredContent');
    }
    if (!path.isAbsolute(structuredContent.outputDir)) {
        throw new Error('decompile_dependencies_to_dir outputDir 必须是绝对路径');
    }
    if (!await fs.pathExists(structuredContent.outputDir)) {
        throw new Error(`decompile_dependencies_to_dir outputDir 不存在: ${structuredContent.outputDir}`);
    }

    if (structuredContent.decompiledClasses + structuredContent.failedClasses !== structuredContent.processedClasses) {
        throw new Error('decompile_dependencies_to_dir processedClasses 必须等于 decompiledClasses + failedClasses');
    }

    const failedSummaryTopN = structuredContent.failedSummaryTopN;
    if (failedSummaryTopN.length > structuredContent.failedClasses) {
        throw new Error('decompile_dependencies_to_dir failedSummaryTopN 不能超过 failedClasses');
    }
    if (structuredContent.truncatedCount !== structuredContent.failedClasses - failedSummaryTopN.length) {
        throw new Error('decompile_dependencies_to_dir truncatedCount 与 failedSummaryTopN / failedClasses 不一致');
    }

    if (config.useCache === false && structuredContent.skippedCachedClasses !== 0) {
        throw new Error('decompile_dependencies_to_dir 在 useCache=false 时不应出现 skippedCachedClasses');
    }

    if (structuredContent.requestedScope.useCache !== config.useCache) {
        throw new Error('decompile_dependencies_to_dir requestedScope.useCache 与请求不一致');
    }
    if (config.maxClasses !== undefined && structuredContent.decompiledClasses > config.maxClasses) {
        throw new Error('decompile_dependencies_to_dir decompiledClasses 超出 maxClasses');
    }

    if (config.maxClasses !== undefined && structuredContent.requestedScope.maxClasses !== config.maxClasses) {
        throw new Error('decompile_dependencies_to_dir requestedScope.maxClasses 与请求不一致');
    }
}

export function assertDecompileRangeResponse(result: PublicToolResponse, config: TestToolConfig): void {
    const responseText = getResponseText(result);
    const hasRequestedRange = config.startLine !== undefined || config.endLine !== undefined;
    if (hasRequestedRange && !responseText.includes('```java')) {
        throw new Error('decompile_class 行范围返回必须包含 java 代码块');
    }

    const hasClosedRange = config.startLine !== undefined
        && config.endLine !== undefined
        && config.startLine <= config.endLine;
    if (hasClosedRange && responseText.includes(`类 ${config.className} 的反编译源码`)) {
        throw new Error('decompile_class 行范围回查不应退化为完整源码标题');
    }
}

function getResponseText(result: PublicToolResponse): string {
    return result.content.map((entry) => entry.text).join('\n');
}

function isPublicToolResponse(value: unknown): value is PublicToolResponse {
    if (typeof value !== 'object' || value === null || !('content' in value)) {
        return false;
    }

    const content = value.content;
    return Array.isArray(content)
        && content.every((entry) => typeof entry === 'object'
            && entry !== null
            && 'type' in entry
            && entry.type === 'text'
            && 'text' in entry
            && typeof entry.text === 'string');
}

function asDecompileDirectoryStructuredContent(
    value: unknown
): DecompileDirectoryStructuredContentLike | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    if (typeof candidate.outputDir !== 'string') {
        return null;
    }

    const requestedScope = candidate.requestedScope;
    if (typeof requestedScope !== 'object' || requestedScope === null) {
        return null;
    }

    const requestedScopeRecord = requestedScope as Record<string, unknown>;
    if (typeof requestedScopeRecord.useCache !== 'boolean') {
        return null;
    }

    if (
        typeof candidate.processedClasses !== 'number'
        || typeof candidate.decompiledClasses !== 'number'
        || typeof candidate.skippedCachedClasses !== 'number'
        || typeof candidate.failedClasses !== 'number'
        || typeof candidate.truncatedCount !== 'number'
        || !Array.isArray(candidate.failedSummaryTopN)
    ) {
        return null;
    }

    return {
        outputDir: candidate.outputDir,
        requestedScope: {
            useCache: requestedScopeRecord.useCache,
            ...(typeof requestedScopeRecord.maxClasses === 'number'
                ? { maxClasses: requestedScopeRecord.maxClasses }
                : {}),
        },
        processedClasses: candidate.processedClasses,
        decompiledClasses: candidate.decompiledClasses,
        skippedCachedClasses: candidate.skippedCachedClasses,
        failedClasses: candidate.failedClasses,
        failedSummaryTopN: candidate.failedSummaryTopN.map((entry) => normalizeFailureSummary(entry)),
        truncatedCount: candidate.truncatedCount,
    };
}

function normalizeFailureSummary(value: unknown): DecompileDirectoryFailureSummary {
    if (typeof value !== 'object' || value === null) {
        throw new Error('decompile_dependencies_to_dir failedSummaryTopN 条目形状不正确');
    }

    const candidate = value as Record<string, unknown>;
    if (
        typeof candidate.className !== 'string'
        || typeof candidate.jarPath !== 'string'
        || typeof candidate.error !== 'string'
    ) {
        throw new Error('decompile_dependencies_to_dir failedSummaryTopN 条目字段缺失');
    }

    return {
        className: candidate.className,
        jarPath: candidate.jarPath,
        error: candidate.error,
    };
}
