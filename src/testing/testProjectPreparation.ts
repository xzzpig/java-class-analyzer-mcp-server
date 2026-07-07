import fs from 'fs-extra';
import { open as openFile } from 'node:fs/promises';
import * as path from 'path';
import type { SyntheticDependencySearchFixtureConfig } from './dependencySearchFixtures.js';
import type { Entry, ZipFile } from 'yauzl';
import * as yauzl from 'yauzl';
import {
    prepareSyntheticDependencySearchFixture,
} from './dependencySearchFixtures.js';
import {
    getClassIndexPath,
    readClassIndexEntries,
    type ClassIndexEntry,
    type ScanResult,
    writeClassIndexFile,
} from '../scanner/dependencySourceIndex.js';

const LOCK_RETRY_DELAY_MS = 100 as const;
const LOCK_TIMEOUT_MS = 30_000 as const;

export interface ProjectPreparationOptions {
    readonly projectPath: string;
    readonly syntheticFixture?: SyntheticDependencySearchFixtureConfig;
    readonly prepareIndexJarPath?: string;
}

export async function prepareTestProject(options: ProjectPreparationOptions): Promise<void> {
    const syntheticFixture = options.syntheticFixture;
    if (syntheticFixture !== undefined) {
        await withFileLock(path.join(options.projectPath, '.mcp-harness.lock'), async () => {
            await prepareSyntheticDependencySearchFixture(syntheticFixture);
        });
        return;
    }

    const prepareIndexJarPath = options.prepareIndexJarPath?.trim();
    if (prepareIndexJarPath !== undefined && prepareIndexJarPath.length > 0) {
        await withFileLock(path.join(options.projectPath, '.mcp-harness.lock'), async () => {
            const jarPath = path.resolve(prepareIndexJarPath);
            await assertJarPathExists(jarPath);
            if (!await isJarClassIndexReady(options.projectPath, jarPath)) {
                await prepareJarClassIndex(options.projectPath, jarPath);
            }
        });
    }
}

async function assertJarPathExists(jarPath: string): Promise<void> {
    if (!await fs.pathExists(jarPath)) {
        throw new Error(`未找到待预写 class index 的 JAR: ${jarPath}`);
    }
}

async function withFileLock<T>(lockPath: string, task: () => Promise<T>): Promise<T> {
    await fs.ensureDir(path.dirname(lockPath));
    const deadline = Date.now() + LOCK_TIMEOUT_MS;

    while (true) {
        try {
            const handle = await openFile(lockPath, 'wx');
            try {
                return await task();
            } finally {
                await handle.close();
                await fs.remove(lockPath);
            }
        } catch (error) {
            if (!isExistingLockError(error)) {
                throw error;
            }

            if (Date.now() >= deadline) {
                throw new Error(`等待 harness 锁超时: ${lockPath}`);
            }

            await new Promise<void>((resolve) => {
                setTimeout(resolve, LOCK_RETRY_DELAY_MS);
            });
        }
    }
}

function isExistingLockError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

async function isJarClassIndexReady(projectPath: string, jarPath: string): Promise<boolean> {
    try {
        const entries = await readClassIndexEntries(projectPath);
        return entries.length > 0
            && entries.every((entry) => entry.jarPath === jarPath);
    } catch {
        return false;
    }
}

async function prepareJarClassIndex(projectPath: string, jarPath: string): Promise<void> {
    const classIndex = await collectClassEntriesFromJar(jarPath);
    const result: ScanResult = {
        jarCount: 1,
        classCount: classIndex.length,
        indexPath: getClassIndexPath(projectPath),
        sampleEntries: classIndex.slice(0, 10).map((entry) => `${entry.className} -> ${path.basename(entry.jarPath)}`),
    };

    await writeClassIndexFile(projectPath, result, classIndex);
}

async function collectClassEntriesFromJar(jarPath: string): Promise<readonly ClassIndexEntry[]> {
    return new Promise((resolve, reject) => {
        const classes: ClassIndexEntry[] = [];

        yauzl.open(jarPath, { lazyEntries: true }, (openError: Error | null, zipfile?: ZipFile) => {
            if (openError !== null || zipfile === undefined) {
                reject(openError ?? new Error(`无法打开 JAR 包: ${jarPath}`));
                return;
            }

            zipfile.readEntry();

            zipfile.on('entry', (entry: Entry) => {
                if (entry.fileName.endsWith('.class') && !entry.fileName.includes('$')) {
                    const className = entry.fileName.replace(/\.class$/u, '').replace(/\//gu, '.');
                    const lastDotIndex = className.lastIndexOf('.');
                    const packageName = lastDotIndex > 0 ? className.slice(0, lastDotIndex) : '';
                    const simpleName = lastDotIndex > 0 ? className.slice(lastDotIndex + 1) : className;

                    classes.push({
                        className,
                        jarPath,
                        packageName,
                        simpleName,
                    });
                }

                zipfile.readEntry();
            });

            zipfile.on('end', () => resolve(classes));
            zipfile.on('error', (zipError: Error) => reject(zipError));
        });
    });
}
