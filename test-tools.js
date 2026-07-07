#!/usr/bin/env node

import {
    runConfiguredTestTool,
} from './dist/testing/testToolRunner.js';

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        tool: 'tools-list',
        projectPath: '',
        className: '',
        forceRefresh: true,
        useCache: true,
        cfrPath: undefined,
        query: '',
        packagePrefix: undefined,
        jarName: undefined,
        jarPath: undefined,
        caseSensitive: true,
        limit: undefined,
        includeLineText: false,
        name: '',
        startLine: undefined,
        endLine: undefined,
        maxClasses: undefined,
        fixtureSourcesPath: undefined,
        prepareIndexJarPath: undefined,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--tool':
            case '-t':
                config.tool = args[++i];
                break;
            case '--project':
            case '-p':
                config.projectPath = args[++i];
                break;
            case '--class':
            case '-c':
                config.className = args[++i];
                break;
            case '--no-refresh':
                config.forceRefresh = false;
                break;
            case '--no-cache':
                config.useCache = false;
                break;
            case '--cfr-path':
                config.cfrPath = args[++i];
                break;
            case '--query':
                config.query = args[++i];
                break;
            case '--package-prefix':
                config.packagePrefix = args[++i];
                break;
            case '--jar-name':
                config.jarName = args[++i];
                break;
            case '--jar-path':
                config.jarPath = args[++i];
                break;
            case '--ignore-case':
                config.caseSensitive = false;
                break;
            case '--limit':
                config.limit = Number.parseInt(args[++i], 10);
                break;
            case '--name':
                config.name = args[++i];
                break;
            case '--start-line':
                config.startLine = Number.parseInt(args[++i], 10);
                break;
            case '--end-line':
                config.endLine = Number.parseInt(args[++i], 10);
                break;
            case '--max-classes':
                config.maxClasses = Number.parseInt(args[++i], 10);
                break;
            case '--include-line-text':
                config.includeLineText = true;
                break;
            case '--fixture-sources':
                config.fixtureSourcesPath = args[++i];
                break;
            case '--prepare-index-jar':
                config.prepareIndexJarPath = args[++i];
                break;
            case '--help':
            case '-h':
                console.log('用法: node test-tools.js --tool <scan|decompile|analyze|lookup|search|decompile-dir|mcp-call|tools-list|all> [其余参数]');
                console.log('类名关键词搜索: --tool mcp-call --name search_classes --query <keyword>');
                console.log('显式 fixture 参数: --fixture-sources <json>');
                console.log('显式 class index 预热: --prepare-index-jar <jar-path>');
                console.log('启用 synthetic fixture 时必须同时传 --project。');
                process.exit(0);
        }
    }

    return config;
}

async function testTools() {
    const config = parseArgs();

    console.log('=== 直接测试MCP工具 ===');
    console.log('配置:', config);
    console.log('');

    try {
        await runConfiguredTestTool(config);
    } catch (error) {
        console.error('❌ 测试失败:', error instanceof Error ? error.message : String(error));
        console.error('错误详情:', error);
        process.exit(1);
    }
}

testTools();
