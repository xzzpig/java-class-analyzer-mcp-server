export const MCP_STRUCTURED_CONTENT_JSON_START = '<mcp-structured-content-json>' as const;
export const MCP_STRUCTURED_CONTENT_JSON_END = '</mcp-structured-content-json>' as const;

export type McpTextResponse = {
    readonly content: readonly [{ readonly type: 'text'; readonly text: string }];
    readonly structuredContent?: unknown;
};

export type McpStructuredTextResponse<StructuredContent extends object> = McpTextResponse & {
    readonly structuredContent: StructuredContent;
};

export function buildTextResponse(text: string): McpTextResponse {
    return {
        content: [{ type: 'text', text }],
    };
}

export function buildStructuredTextResponse<StructuredContent extends object>(
    summary: string,
    structuredContent: StructuredContent
): McpStructuredTextResponse<StructuredContent> {
    return {
        ...buildTextResponse([
            summary,
            '',
            MCP_STRUCTURED_CONTENT_JSON_START,
            JSON.stringify(structuredContent),
            MCP_STRUCTURED_CONTENT_JSON_END,
        ].join('\n')),
        structuredContent,
    };
}
