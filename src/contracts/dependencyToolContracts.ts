import { ALLOW_REPO_FALLBACK_ENV } from '../dependency/dependencyRuntimeConfig.js';

export { ALLOW_REPO_FALLBACK_ENV };

const PROJECT_PATH_PROPERTY = {
    type: 'string',
    description: 'Maven项目根目录路径。',
} as const;

const PACKAGE_PREFIX_PROPERTY = {
    type: 'string',
    description: '包名前缀过滤，按前缀匹配并规范化尾随 `.`；trim 后为空字符串时视为未传。',
} as const;

const JAR_NAME_PROPERTY = {
    type: 'string',
    description: 'JAR basename 精确匹配，例如 `alpha-lib-1.0.jar`；trim 后为空字符串时视为未传。',
} as const;

const JAR_PATH_PROPERTY = {
    type: 'string',
    description: 'JAR 绝对路径精确匹配；也是重复 `className` 来源的显式消歧键；trim 后为空字符串时视为未传。',
} as const;

export const SCAN_DEPENDENCIES_TOOL_DEFINITION = {
    name: 'scan_dependencies',
    description: '扫描 Maven 依赖并建立类索引。',
    inputSchema: {
        type: 'object',
        properties: {
            projectPath: PROJECT_PATH_PROPERTY,
            forceRefresh: {
                type: 'boolean',
                description: '是否强制刷新索引。',
                default: false,
            },
        },
        required: ['projectPath'],
    },
} as const;

export const DECOMPILE_CLASS_TOOL_DEFINITION = {
    name: 'decompile_class',
    description: '反编译指定依赖类源码，支持同名类来源消歧与可选行区间返回。',
    inputSchema: {
        type: 'object',
        properties: {
            className: {
                type: 'string',
                description: '要反编译的Java类全名，如：com.example.QueryBizOrderDO。',
            },
            projectPath: PROJECT_PATH_PROPERTY,
            useCache: {
                type: 'boolean',
                description: '是否使用反编译缓存，默认 true；Maven 依赖缓存可跨项目复用。',
                default: true,
            },
            cfrPath: {
                type: 'string',
                description: 'CFR反编译工具的jar包路径，可选；保留现有兼容输入。',
            },
            jarPath: JAR_PATH_PROPERTY,
            startLine: {
                type: 'integer',
                description: '源码起始行号，1-based 且为闭区间起点；单独提供时返回 `[startLine, EOF]`，越界自动裁剪，非正数直接报错。',
                minimum: 1,
            },
            endLine: {
                type: 'integer',
                description: '源码结束行号，1-based 且为闭区间终点；单独提供时返回 `[1, endLine]`，越界自动裁剪，非正数直接报错。',
                minimum: 1,
            },
        },
        required: ['className', 'projectPath'],
        additionalProperties: false,
    },
} as const;

export const SEARCH_DEPENDENCY_CODE_TOOL_DEFINITION = {
    name: 'search_dependency_code',
    description: '在已索引依赖的反编译源码中做文本搜索，并返回结构化命中结果。',
    inputSchema: {
        type: 'object',
        properties: {
            projectPath: PROJECT_PATH_PROPERTY,
            query: {
                type: 'string',
                description: '要搜索的文本子串；trim 后不能为空。',
            },
            limit: {
                type: 'integer',
                description: '返回的类结果总数上限，默认 20；不设置服务端硬上限。',
                default: 20,
                minimum: 1,
            },
            caseSensitive: {
                type: 'boolean',
                description: '是否区分大小写；搜索语义固定为反编译 Java 源码上的文本子串匹配；默认 true。',
                default: true,
            },
            useCache: {
                type: 'boolean',
                description: '是否复用反编译缓存，默认 true；Maven 依赖缓存可跨项目复用，设为 false 时仅对本次搜索涉及的类重新反编译。',
                default: true,
            },
            packagePrefix: PACKAGE_PREFIX_PROPERTY,
            jarName: JAR_NAME_PROPERTY,
            jarPath: JAR_PATH_PROPERTY,
            includeLineText: {
                type: 'boolean',
                description: '是否返回 `lineTextsByLine` 行号到行文本映射，仅覆盖命中行；默认 false。',
                default: false,
            },
        },
        required: ['projectPath', 'query'],
        additionalProperties: false,
    },
} as const;

export const DECOMPILE_DEPENDENCIES_TO_DIR_TOOL_DEFINITION = {
    name: 'decompile_dependencies_to_dir',
    description: '按范围批量反编译依赖类到本地缓存目录，并返回输出目录与统计信息。',
    inputSchema: {
        type: 'object',
        properties: {
            projectPath: PROJECT_PATH_PROPERTY,
            packagePrefix: PACKAGE_PREFIX_PROPERTY,
            jarName: JAR_NAME_PROPERTY,
            jarPath: JAR_PATH_PROPERTY,
            maxClasses: {
                type: 'integer',
                description: '仅限制实际发生反编译并写入/覆盖缓存的类数；已缓存且跳过的类不计入配额。',
                minimum: 1,
            },
            useCache: {
                type: 'boolean',
                description: '是否复用反编译缓存，默认 true；Maven 依赖缓存可跨项目复用，设为 false 时强制重新反编译命中类并覆盖缓存。',
                default: true,
            },
        },
        required: ['projectPath'],
        anyOf: [
            { required: ['packagePrefix'] },
            { required: ['jarName'] },
            { required: ['jarPath'] },
        ],
        additionalProperties: false,
    },
} as const;

export const ANALYZE_CLASS_TOOL_DEFINITION = {
    name: 'analyze_class',
    description: '分析Java类的结构、方法、字段等信息。',
    inputSchema: {
        type: 'object',
        properties: {
            className: {
                type: 'string',
                description: '要分析的Java类全名。',
            },
            projectPath: PROJECT_PATH_PROPERTY,
        },
        required: ['className', 'projectPath'],
    },
} as const;

export const SEARCH_CLASSES_TOOL_DEFINITION = {
    name: 'search_classes',
    description: '根据关键词搜索已索引的 Java 类名，不执行反编译。',
    inputSchema: {
        type: 'object',
        properties: {
            projectPath: PROJECT_PATH_PROPERTY,
            query: {
                type: 'string',
                description: '类名关键词，匹配完整类名的文本子串；trim 后不能为空。',
            },
            limit: {
                type: 'integer',
                description: '返回类结果的最大数量，默认 20。',
                default: 20,
                minimum: 1,
            },
            caseSensitive: {
                type: 'boolean',
                description: '是否区分大小写，默认 false。',
                default: false,
            },
            packagePrefix: PACKAGE_PREFIX_PROPERTY,
            jarName: JAR_NAME_PROPERTY,
            jarPath: JAR_PATH_PROPERTY,
        },
        required: ['projectPath', 'query'],
        additionalProperties: false,
    },
} as const;

export const MCP_TOOL_DEFINITIONS = [
    SCAN_DEPENDENCIES_TOOL_DEFINITION,
    DECOMPILE_CLASS_TOOL_DEFINITION,
    SEARCH_DEPENDENCY_CODE_TOOL_DEFINITION,
    DECOMPILE_DEPENDENCIES_TO_DIR_TOOL_DEFINITION,
    ANALYZE_CLASS_TOOL_DEFINITION,
    SEARCH_CLASSES_TOOL_DEFINITION,
] as const;
