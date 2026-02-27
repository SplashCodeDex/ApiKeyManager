/**
 * File-Based Storage Adapter
 *
 * Persists API key state to a JSON file on disk.
 * Survives process restarts so keys don't reset to CLOSED
 * when an app reboots.
 *
 * Extracted from the proven WhatsDeX adapter pattern.
 *
 * @module persistence/file
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

export interface FileStorageOptions {
    /** Full path to the state file. Defaults to `os.tmpdir()/codedex_api_key_state.json` */
    filePath?: string;
    /** If true, clears any existing state file on construction (fresh start). Default: true */
    clearOnInit?: boolean;
}

/**
 * File-based storage adapter for ApiKeyManager.
 *
 * @example
 * ```ts
 * import { ApiKeyManager } from '@splashcodex/api-key-manager';
 * import { FileStorage } from '@splashcodex/api-key-manager/persistence/file';
 *
 * const manager = new ApiKeyManager(keys, {
 *   storage: new FileStorage({ filePath: './state.json' })
 * });
 * ```
 */
export class FileStorage {
    private filePath: string;

    constructor(options: FileStorageOptions = {}) {
        this.filePath = options.filePath || join(tmpdir(), 'codedex_api_key_state.json');

        if (options.clearOnInit !== false) {
            this.clear();
        }
    }

    getItem(_key: string): string | null {
        try {
            if (existsSync(this.filePath)) {
                return readFileSync(this.filePath, 'utf-8');
            }
        } catch {
            // Silently fail — state will be rebuilt from scratch
        }
        return null;
    }

    setItem(_key: string, value: string): void {
        try {
            const dir = dirname(this.filePath);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            writeFileSync(this.filePath, value, 'utf-8');
        } catch {
            // Silently fail — state will be lost on restart
        }
    }

    /**
     * Delete the persisted state file.
     * Useful for clearing stale dead-key states from a previous session.
     */
    clear(): void {
        try {
            if (existsSync(this.filePath)) {
                unlinkSync(this.filePath);
            }
        } catch {
            // Silently fail
        }
    }

    /** Get the path to the state file (for debugging/logging) */
    getFilePath(): string {
        return this.filePath;
    }
}
