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
var MemoryStorage = /** @class */ (function () {
    function MemoryStorage() {
        this.store = new Map();
    }
    MemoryStorage.prototype.getItem = function (key) {
        var _a;
        return (_a = this.store.get(key)) !== null && _a !== void 0 ? _a : null;
    };
    MemoryStorage.prototype.setItem = function (key, value) {
        this.store.set(key, value);
    };
    /** Clear all stored state */
    MemoryStorage.prototype.clear = function () {
        this.store.clear();
    };
    Object.defineProperty(MemoryStorage.prototype, "size", {
        /** Get the number of stored entries */
        get: function () {
            return this.store.size;
        },
        enumerable: false,
        configurable: true
    });
    return MemoryStorage;
}());
exports.MemoryStorage = MemoryStorage;
