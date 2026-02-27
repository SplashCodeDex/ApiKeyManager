/**
 * In-Memory Storage Adapter
 *
 * Simple key-value storage that lives only for the process lifetime.
 * Useful for testing, serverless functions, or when persistence isn't needed.
 *
 * @module persistence/memory
 */

/**
 * In-memory storage adapter for ApiKeyManager.
 *
 * @example
 * ```ts
 * import { ApiKeyManager } from '@splashcodex/api-key-manager';
 * import { MemoryStorage } from '@splashcodex/api-key-manager/persistence/memory';
 *
 * const manager = new ApiKeyManager(keys, {
 *   storage: new MemoryStorage()
 * });
 * ```
 */
export class MemoryStorage {
    private store: Map<string, string> = new Map();

    getItem(key: string): string | null {
        return this.store.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        this.store.set(key, value);
    }

    /** Clear all stored state */
    clear(): void {
        this.store.clear();
    }

    /** Get the number of stored entries */
    get size(): number {
        return this.store.size;
    }
}
