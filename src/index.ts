#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
    buildToolCapabilities,
    JavaClassAnalyzerToolDispatcher,
} from './mcp/JavaClassAnalyzerToolDispatcher.js';

export class JavaClassAnalyzerMCPServer {
    private readonly server: Server;
    private readonly dispatcher: JavaClassAnalyzerToolDispatcher;

    constructor() {
        this.dispatcher = new JavaClassAnalyzerToolDispatcher();
        this.server = new Server(
            {
                name: 'java-class-analyzer',
                version: '1.0.0',
                capabilities: buildToolCapabilities(),
            }
        );

        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: this.dispatcher.listTools(),
            };
        });

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            return this.dispatcher.callTool(request.params.name, request.params.arguments);
        });
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);

        const env = process.env.NODE_ENV || 'development';
        if (env === 'development') {
            console.error('Java Class Analyzer MCP Server running on stdio (DEBUG MODE)');
        } else {
            console.error('Java Class Analyzer MCP Server running on stdio');
        }
    }
}

const mcpServer = new JavaClassAnalyzerMCPServer();

process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的Promise拒绝:', reason);
});

mcpServer.run().catch((error) => {
    console.error('服务器启动失败:', error);
    process.exit(1);
});
