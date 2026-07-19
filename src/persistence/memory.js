"use strict";
/**
 * In-Memory Storage Adapter
 *
 * Simple key-value storage that lives only for the process lifetime.
 * Useful for testing, serverless functions, or when persistence isn't needed.
 *
 * @module persistence/memory
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryStorage = void 0;
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
class MemoryStorage {
    store = new Map();
    getItem(key) {
        return this.store.get(key) ?? null;
    }
    setItem(key, value) {
        this.store.set(key, value);
    }
    /** Clear all stored state */
    clear() {
        this.store.clear();
    }
    /** Get the number of stored entries */
    get size() {
        return this.store.size;
    }
}
exports.MemoryStorage = MemoryStorage;
//# sourceMappingURL=memory.js.map