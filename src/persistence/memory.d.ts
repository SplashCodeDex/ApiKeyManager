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
export declare class MemoryStorage {
    private store;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    /** Clear all stored state */
    clear(): void;
    /** Get the number of stored entries */
    get size(): number;
}
//# sourceMappingURL=memory.d.ts.map