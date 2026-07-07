import type { TestToolConfig } from './testToolRunner.js';

export function buildPublicMcpToolArguments(config: TestToolConfig): Record<string, unknown> {
    switch (config.name) {
        case 'scan_dependencies':
            return { projectPath: config.projectPath, forceRefresh: config.forceRefresh };
        case 'decompile_class':
            return {
                className: config.className,
                projectPath: config.projectPath,
                ...(config.useCache === false ? { useCache: false } : {}),
                ...(config.cfrPath ? { cfrPath: config.cfrPath } : {}),
                ...(config.jarPath ? { jarPath: config.jarPath } : {}),
                ...(config.startLine === undefined ? {} : { startLine: config.startLine }),
                ...(config.endLine === undefined ? {} : { endLine: config.endLine }),
            };
        case 'search_dependency_code':
            return {
                projectPath: config.projectPath,
                query: config.query,
                ...(config.limit === undefined ? {} : { limit: config.limit }),
                ...(config.caseSensitive === false ? { caseSensitive: false } : {}),
                ...(config.useCache === false ? { useCache: false } : {}),
                ...(config.packagePrefix ? { packagePrefix: config.packagePrefix } : {}),
                ...(config.jarName ? { jarName: config.jarName } : {}),
                ...(config.jarPath ? { jarPath: config.jarPath } : {}),
                ...(config.includeLineText === true ? { includeLineText: true } : {}),
            };
        case 'decompile_dependencies_to_dir':
            return {
                projectPath: config.projectPath,
                ...(config.packagePrefix ? { packagePrefix: config.packagePrefix } : {}),
                ...(config.jarName ? { jarName: config.jarName } : {}),
                ...(config.jarPath ? { jarPath: config.jarPath } : {}),
                ...(config.maxClasses === undefined ? {} : { maxClasses: config.maxClasses }),
                ...(config.useCache === false ? { useCache: false } : {}),
            };
        case 'analyze_class':
            return { className: config.className, projectPath: config.projectPath };
        case 'search_classes':
            return {
                projectPath: config.projectPath,
                query: config.query,
                ...(config.limit === undefined ? {} : { limit: config.limit }),
                ...(config.packagePrefix ? { packagePrefix: config.packagePrefix } : {}),
                ...(config.jarName ? { jarName: config.jarName } : {}),
                ...(config.jarPath ? { jarPath: config.jarPath } : {}),
            };
        default:
            return {};
    }
}
