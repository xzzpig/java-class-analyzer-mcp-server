import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs-extra';

const DECOMPILE_TEMP_ROOT = '.mcp-class-temp' as const;

export interface DecompileClassOptions {
    readonly requestTempNamespace?: string;
    readonly workerId?: number;
}

export function toWorkerDirectoryName(workerId?: number): string {
    return workerId === undefined ? 'worker-main' : `worker-${workerId}`;
}

export function createRequestTempNamespace(): string {
    return `request-${randomUUID()}`;
}

export function getRequestTempNamespacePath(requestTempNamespace: string): string {
    return path.join(process.cwd(), DECOMPILE_TEMP_ROOT, requestTempNamespace);
}

export async function cleanupRequestTempNamespace(requestTempNamespace: string): Promise<void> {
    const requestTempNamespacePath = getRequestTempNamespacePath(requestTempNamespace);

    try {
        await fs.remove(requestTempNamespacePath);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`清理临时请求目录失败: ${requestTempNamespacePath}: ${message}`);
    }
}
