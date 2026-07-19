/**
 * MultiManager Preset — Multi-Provider Key Vault
 *
 * Manages API keys across multiple providers from a single entry point.
 * Aggregates keys from multiple environment variables and routes
 * requests to the correct provider pool.
 *
 * @module presets/multi
 *
 * @example
 * ```ts
 * import { MultiManager } from '@splashcodex/api-key-manager/presets/multi';
 *
 * const result = MultiManager.getInstance({
 *   providers: {
 *     gemini: { envKeys: ['GOOGLE_GEMINI_API_KEY'] },
 *     openai: { envKeys: ['OPENAI_API_KEY'] },
 *   }
 * });
 *
 * if (result.success) {
 *   const vault = result.data;
 *
 *   // Route to specific provider
 *   const text = await vault.execute(async (key) => {
 *     // key is from the gemini pool
 *     return callGemini(key, prompt);
 *   }, { provider: 'gemini', maxRetries: 3 });
 *
 *   // Get stats across all providers
 *   const stats = vault.getMultiStats();
 * }
 * ```
 */
import { ApiKeyManager, ExecuteOptions, ApiKeyManagerStats, LoadBalancingStrategy, ApiKeyManagerOptions } from '../index';
export type Result<T> = {
    success: true;
    data: T;
} | {
    success: false;
    error: Error;
};
export interface ProviderConfig {
    /** Environment variable names to read API keys from */
    envKeys: string[];
    /** Strategy override. Default: LatencyStrategy */
    strategy?: LoadBalancingStrategy;
    /** Concurrency limit. Default: 20 */
    concurrency?: number;
    /** Semantic cache configuration. Optional. */
    semanticCache?: ApiKeyManagerOptions['semanticCache'];
}
export interface MultiManagerOptions {
    /** Provider configurations keyed by name (e.g., 'gemini', 'openai') */
    providers: Record<string, ProviderConfig>;
    /** Health check interval in ms. Default: 300_000 (5 min). Set to 0 to disable. */
    healthCheckIntervalMs?: number;
    /** Custom logger. Defaults to console. */
    logger?: {
        info(msg: string, ...args: any[]): void;
        warn(msg: string, ...args: any[]): void;
        error(msg: string, ...args: any[]): void;
    };
}
export declare class MultiManager {
    private static instance;
    private managers;
    private logger;
    private constructor();
    /**
     * Get or create the singleton MultiManager instance.
     */
    static getInstance(options: MultiManagerOptions): Result<MultiManager>;
    /**
     * Reset the singleton (primarily for testing).
     */
    static reset(): void;
    /**
     * Execute a function with a specific provider's key pool.
     *
     * @param fn - The function to execute with a key
     * @param options - Must include `provider` to select the pool
     */
    execute<T>(fn: (key: string, signal?: AbortSignal) => Promise<T>, options: ExecuteOptions & {
        prompt?: string;
        provider: string;
    }): Promise<T>;
    /**
     * Execute a streaming function with a specific provider's key pool.
     */
    executeStream<T>(fn: (key: string, signal?: AbortSignal) => AsyncGenerator<T, any, unknown>, options: ExecuteOptions & {
        prompt?: string;
        provider: string;
    }): AsyncGenerator<T, any, unknown>;
    /**
     * Get a raw key from a specific provider pool.
     */
    getKey(provider: string): string | null;
    /**
     * Get stats for a specific provider.
     */
    getStats(provider: string): ApiKeyManagerStats | null;
    /**
     * Get aggregate stats across ALL providers.
     */
    getMultiStats(): Record<string, ApiKeyManagerStats>;
    /**
     * Get the list of available provider names.
     */
    getProviders(): string[];
    /**
     * Get the underlying ApiKeyManager for a specific provider.
     */
    getManager(provider: string): ApiKeyManager | undefined;
    /**
     * Stop all health checks and clean up.
     */
    destroy(): void;
    private static parseKeysFromEnv;
}
//# sourceMappingURL=multi.d.ts.map