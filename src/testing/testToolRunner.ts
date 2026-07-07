import { DependencyScanner } from '../scanner/DependencyScanner.js';
import { DecompilerService } from '../decompiler/DecompilerService.js';
import { JavaClassAnalyzer } from '../analyzer/JavaClassAnalyzer.js';
import { JavaClassAnalyzerToolDispatcher } from '../mcp/JavaClassAnalyzerToolDispatcher.js';
import {
    resolveSyntheticDependencySearchFixtureConfig,
    type SyntheticDependencySearchFixtureConfig,
} from './dependencySearchFixtures.js';
import { buildPublicMcpToolArguments } from './publicMcpToolArguments.js';
import { runPublicMcpToolForTesting } from './publicMcpRunner.js';
import {
    prepareTestProject,
} from './testProjectPreparation.js';
import {
    asPublicToolResponse,
    assertDecompileDirectoryResult,
    assertDecompileRangeResponse,
    assertPublicSearchResult,
    assertTextContains,
    printJson,
} from './testToolAssertions.js';

export interface TestToolConfig {
    readonly tool: string;
    readonly projectPath: string;
    readonly className: string;
    readonly forceRefresh: boolean;
    readonly useCache: boolean;
    readonly cfrPath?: string;
    readonly query: string;
    readonly packagePrefix?: string;
    readonly jarName?: string;
    readonly jarPath?: string;
    readonly caseSensitive: boolean;
    readonly limit?: number;
    readonly includeLineText: boolean;
    readonly name: string;
    readonly startLine?: number;
    readonly endLine?: number;
    readonly maxClasses?: number;
    readonly fixtureSourcesPath?: string;
    readonly prepareIndexJarPath?: string;
}

interface ResolvedTestToolConfig extends TestToolConfig {
    readonly syntheticFixture?: SyntheticDependencySearchFixtureConfig;
}

const scanner = new DependencyScanner();
const decompiler = new DecompilerService();
const analyzer = new JavaClassAnalyzer();
const publicMcpDispatcher = new JavaClassAnalyzerToolDispatcher();

export async function runConfiguredTestTool(config: TestToolConfig): Promise<unknown> {
    const resolvedConfig = await resolveTestToolConfig(config);

    if (shouldPrepareProject(resolvedConfig)) {
        await prepareTestProject({
            projectPath: resolvedConfig.projectPath,
            syntheticFixture: resolvedConfig.syntheticFixture,
            prepareIndexJarPath: resolvedConfig.prepareIndexJarPath,
        });
    }

    switch (resolvedConfig.tool) {
        case 'scan':
            return testScanDependencies(resolvedConfig);
        case 'decompile':
            return testDecompileClass(resolvedConfig);
        case 'analyze':
            return testAnalyzeClass(resolvedConfig);
        case 'lookup':
            return testClassLookup(resolvedConfig);
        case 'search':
            return testSearch(resolvedConfig);
        case 'decompile-dir':
            return testDecompileDirectory(resolvedConfig);
        case 'mcp-call':
            return testExplicitPublicMcpCall(resolvedConfig);
        case 'tools-list':
            return printToolsList();
        case 'all':
        default:
            await testScanDependencies(resolvedConfig);
            await testClassLookup(resolvedConfig);
            await testDecompileClass(resolvedConfig);
            await testAnalyzeClass(resolvedConfig);
            console.log('🎉 所有测试通过！');
            return null;
    }
}

function shouldPrepareProject(config: TestToolConfig): boolean {
    return config.tool !== 'tools-list'
        && !(config.tool === 'search' && config.query.trim().length === 0)
        && !(
            config.tool === 'decompile-dir'
            && [config.packagePrefix, config.jarName, config.jarPath].every((value) => (value?.trim().length ?? 0) === 0)
        )
        && config.projectPath.trim().length > 0;
}

function printToolsList(): ReturnType<JavaClassAnalyzerToolDispatcher['listTools']> {
    const result = publicMcpDispatcher.listTools();
    printJson(result);
    console.log('✅ Public MCP tools/list 完成\n');
    return result;
}

async function testScanDependencies(config: ResolvedTestToolConfig): Promise<unknown> {
    console.log('=== 测试依赖扫描 ===');
    console.log(`项目路径: ${config.projectPath}`);
    console.log(`强制刷新: ${config.forceRefresh}\n`);

    const scanResult = await scanner.scanProject(config.projectPath, config.forceRefresh);

    console.log('扫描结果:', {
        jarCount: scanResult.jarCount,
        classCount: scanResult.classCount,
        indexPath: scanResult.indexPath,
    });
    console.log('示例条目:', scanResult.sampleEntries.slice(0, 3));
    console.log('✅ 依赖扫描完成\n');

    return scanResult;
}

async function testDecompileClass(config: ResolvedTestToolConfig): Promise<unknown> {
    console.log('=== 测试类反编译 ===');
    console.log(`类名: ${config.className}`);
    console.log(`项目路径: ${config.projectPath}`);
    console.log(`使用缓存: ${config.useCache}`);
    console.log(`CFR路径: ${config.cfrPath || '自动查找'}\n`);

    if (config.startLine !== undefined || config.endLine !== undefined || config.syntheticFixture !== undefined) {
        const result = asPublicToolResponse(await runPublicMcpToolForTesting('decompile_class', buildPublicMcpToolArguments({
            ...config,
            name: 'decompile_class',
        }), { syntheticFixture: config.syntheticFixture }));
        assertDecompileRangeResponse(result, config);
        printJson(result);
        console.log('✅ 类反编译完成\n');
        return result;
    }

    const sourceCode = await decompiler.decompileClass(
        config.className,
        config.projectPath,
        config.useCache,
        config.cfrPath,
        config.jarPath
    );

    console.log('反编译结果长度:', sourceCode.length);
    console.log('源码预览:', `${sourceCode.substring(0, 200)}...`);
    console.log('✅ 反编译完成\n');

    return sourceCode;
}

async function testAnalyzeClass(config: ResolvedTestToolConfig): Promise<unknown> {
    console.log('=== 测试类分析 ===');
    console.log(`类名: ${config.className}`);
    console.log(`项目路径: ${config.projectPath}`);

    const analysis = await analyzer.analyzeClass(config.className, config.projectPath);

    console.log('类分析结果:', {
        className: analysis.className,
        packageName: analysis.packageName,
        modifiers: analysis.modifiers,
        fields: analysis.fields.length,
        methods: analysis.methods.length,
    });
    console.log('✅ 类分析完成\n');
    return analysis;
}

async function testClassLookup(config: ResolvedTestToolConfig): Promise<unknown> {
    console.log('=== 测试类查找 ===');
    console.log(`类名: ${config.className}`);
    console.log(`项目路径: ${config.projectPath}\n`);

    const jarPath = await scanner.findJarForClass(config.className, config.projectPath, config.jarPath);

    console.log(`类 ${config.className} 对应的JAR包:`, jarPath);
    console.log('✅ 类查找完成\n');
    return jarPath;
}

async function testSearch(config: ResolvedTestToolConfig): Promise<unknown> {
    console.log('=== 测试依赖缓存源码搜索 ===');
    console.log(`查询文本: ${config.query}`);
    console.log(`项目路径: ${config.projectPath}`);
    console.log(`包前缀: ${config.packagePrefix || '未设置'}`);
    console.log(`JAR 名称: ${config.jarName || '未设置'}`);
    console.log(`JAR 路径: ${config.jarPath || '未设置'}`);
    console.log(`结果上限: ${config.limit ?? 20}`);
    console.log(`返回行文本: ${config.includeLineText}`);
    console.log(`使用缓存: ${config.useCache}`);
    console.log('');

    if (config.query.trim().length === 0) {
        const failureResult = asPublicToolResponse(await runPublicMcpToolForTesting('search_dependency_code', buildPublicMcpToolArguments({
            ...config,
            name: 'search_dependency_code',
        }), { syntheticFixture: config.syntheticFixture }));
        assertTextContains(
            failureResult,
            'search_dependency_code requires a non-empty query string after trimming whitespace.'
        );
        printJson(failureResult);
        console.log('✅ 依赖缓存源码搜索失败路径符合预期\n');
        return failureResult;
    }

    const result = asPublicToolResponse(await runPublicMcpToolForTesting('search_dependency_code', buildPublicMcpToolArguments({
        ...config,
        name: 'search_dependency_code',
    }), { syntheticFixture: config.syntheticFixture }));
    assertPublicSearchResult(result);
    printJson(result);
    console.log('✅ 依赖缓存源码搜索完成\n');
    return result;
}

async function testDecompileDirectory(config: ResolvedTestToolConfig): Promise<unknown> {
    console.log('=== 测试依赖批量反编译目录 ===');
    console.log(`项目路径: ${config.projectPath}`);
    console.log(`包前缀: ${config.packagePrefix || '未设置'}`);
    console.log(`JAR 名称: ${config.jarName || '未设置'}`);
    console.log(`JAR 路径: ${config.jarPath || '未设置'}`);
    console.log(`maxClasses: ${config.maxClasses ?? '未设置'}`);
    console.log(`使用缓存: ${config.useCache}`);
    console.log('');

    const result = asPublicToolResponse(await runPublicMcpToolForTesting(
        'decompile_dependencies_to_dir',
        buildPublicMcpToolArguments({
            ...config,
            name: 'decompile_dependencies_to_dir',
        }),
        { syntheticFixture: config.syntheticFixture }
    ));

    if (
        [config.packagePrefix, config.jarName, config.jarPath].every((value) => (value?.trim().length ?? 0) === 0)
    ) {
        assertTextContains(result, 'decompile_dependencies_to_dir requires at least one of packagePrefix, jarName, or jarPath.');
        printJson(result);
        console.log('✅ 批量反编译目录失败路径符合预期\n');
        return result;
    }

    await assertDecompileDirectoryResult(result, config);
    printJson(result);
    console.log('✅ 批量反编译目录完成\n');
    return result;
}

async function testExplicitPublicMcpCall(config: ResolvedTestToolConfig): Promise<unknown> {
    if (config.name.trim() === '') {
        throw new Error('mcp-call 工具要求 --name 非空');
    }

    const result = await runPublicMcpToolForTesting(config.name, buildPublicMcpToolArguments(config), {
        syntheticFixture: config.syntheticFixture,
    });
    printJson(result);
    console.log(`✅ Public MCP ${config.name} 完成\n`);
    return result;
}

async function resolveTestToolConfig(config: TestToolConfig): Promise<ResolvedTestToolConfig> {
    const syntheticFixture = await resolveSyntheticDependencySearchFixtureConfig({
        projectPath: config.projectPath,
        fixtureSourcesPath: config.fixtureSourcesPath,
    });

    return {
        ...config,
        ...(syntheticFixture === undefined ? {} : { syntheticFixture }),
    };
}
