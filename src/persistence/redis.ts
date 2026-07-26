/**
 * Redis-Based Storage Adapter
 *
 * Persists API key state to a Redis database.
 * Ideal for Serverless environments (Vercel, Cloudflare Workers) where local memory
 * or files are ephemeral, allowing cross-instance quota tracking.
 *
 * @module persistence/redis
 */

export interface RedisClient {
    /** Gets the string value of a key. Returns null if key doesn't exist. */
    get(key: string): Promise<string | null>;
    /** Sets the string value of a key. */
    set(key: string, value: string): Promise<any>;
}

export interface RedisStorageOptions {
    /** The Redis client instance (e.g. from @upstash/redis or ioredis) */
    client: RedisClient;
    /** Optional prefix for the Redis key. Defaults to "apikey_manager:" */
    keyPrefix?: string;
}

/**
 * Redis-based storage adapter for ApiKeyManager.
 * Note: Because Redis is asynchronous, you MUST call `await manager.init()` after instantiation.
 *
 * @example
 * ```ts
 * import { ApiKeyManager } from '@splashcodex/api-key-manager';
 * import { RedisStorage } from '@splashcodex/api-key-manager/persistence/redis';
 * import { Redis } from '@upstash/redis';
 *
 * const redisClient = new Redis({ url: '...', token: '...' });
 * 
 * const manager = new ApiKeyManager(keys, {
 *   storage: new RedisStorage({ client: redisClient })
 * });
 * 
 * await manager.init(); // Required for async storage!
 * ```
 */
export class RedisStorage {
    public isAsync = true;
    private client: RedisClient;
    private keyPrefix: string;

    constructor(options: RedisStorageOptions) {
        if (!options.client) {
            throw new Error('[RedisStorage] A Redis client must be provided.');
        }
        this.client = options.client;
        this.keyPrefix = options.keyPrefix || 'apikey_manager:';
    }

    private resolveKey(key: string): string {
        return this.keyPrefix + key;
    }

    public async getItem(key: string): Promise<string | null> {
        try {
            return await this.client.get(this.resolveKey(key));
        } catch (error) {
            console.error('[RedisStorage] Failed to getItem:', error);
            return null; // Fallback to blank state if Redis is unreachable
        }
    }

    public async setItem(key: string, value: string): Promise<void> {
        try {
            await this.client.set(this.resolveKey(key), value);
        } catch (error) {
            console.error('[RedisStorage] Failed to setItem:', error);
        }
    }
}
