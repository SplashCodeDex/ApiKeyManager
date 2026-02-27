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

import {
    ApiKeyManager,
    LatencyStrategy,
    ExecuteOptions,
    ApiKeyManagerStats,
    LoadBalancingStrategy,
    ApiKeyManagerOptions,
} from '../index';
import { FileStorage } from '../persistence/file';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── Types ──────────────────────────────────────────────────────────────────

export type Result<T> =
    | { success: true; data: T }
    | { success: false; error: Error };

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

// ─── MultiManager ───────────────────────────────────────────────────────────

export class MultiManager {
    private static instance: MultiManager | null = null;

    private managers = new Map<string, ApiKeyManager>();
    private logger: NonNullable<MultiManagerOptions['logger']>;

    private constructor(options: MultiManagerOptions) {
        this.logger = options.logger || console;

        for (const [providerName, config] of Object.entries(options.providers)) {
            const keys = MultiManager.parseKeysFromEnv(config.envKeys);

            if (keys.length === 0) {
                this.logger.warn(`[MultiManager:${providerName}] No API keys found in: ${config.envKeys.join(', ')}`);
            }

            const storage = new FileStorage({
                filePath: join(tmpdir(), `codedex_multi_${providerName}_state.json`),
                clearOnInit: true,
            });

            const manager = new ApiKeyManager(keys, {
                storage,
                strategy: config.strategy || new LatencyStrategy(),
                concurrency: config.concurrency ?? 20,
                semanticCache: config.semanticCache,
            });

            // Wire events
            manager.on('keyDead', (key) =>
                this.logger.error(`[MultiManager:${providerName}] Key DEAD: ...${key.slice(-4)}`));
            manager.on('circuitOpen', (key) =>
                this.logger.warn(`[MultiManager:${providerName}] Circuit OPEN: ...${key.slice(-4)}`));
            manager.on('keyRecovered', (key) =>
                this.logger.info(`[MultiManager:${providerName}] Key RECOVERED: ...${key.slice(-4)}`));
            manager.on('allKeysExhausted', () =>
                this.logger.error(`[MultiManager:${providerName}] ALL KEYS EXHAUSTED`));

            // Health checks
            const interval = options.healthCheckIntervalMs ?? 300_000;
            if (interval > 0) {
                manager.startHealthChecks(interval);
            }

            this.managers.set(providerName, manager);
            this.logger.info(
                `[MultiManager:${providerName}] Initialized with ${keys.length} keys`
            );
        }
    }

    // ─── Factory ────────────────────────────────────────────────────────────

    /**
     * Get or create the singleton MultiManager instance.
     */
    static getInstance(options: MultiManagerOptions): Result<MultiManager> {
        if (MultiManager.instance) {
            return { success: true, data: MultiManager.instance };
        }

        try {
            MultiManager.instance = new MultiManager(options);
            return { success: true, data: MultiManager.instance };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    }

    /**
     * Reset the singleton (primarily for testing).
     */
    static reset(): void {
        if (MultiManager.instance) {
            MultiManager.instance.destroy();
            MultiManager.instance = null;
        }
    }

    // ─── Public API ─────────────────────────────────────────────────────────

    /**
     * Execute a function with a specific provider's key pool.
     *
     * @param fn - The function to execute with a key
     * @param options - Must include `provider` to select the pool
     */
    async execute<T>(
        fn: (key: string, signal?: AbortSignal) => Promise<T>,
        options: ExecuteOptions & { prompt?: string; provider: string }
    ): Promise<T> {
        const manager = this.managers.get(options.provider);
        if (!manager) {
            throw new Error(
                `[MultiManager] Unknown provider "${options.provider}". ` +
                `Available: ${[...this.managers.keys()].join(', ')}`
            );
        }
        // Strip `provider` before delegating — each manager only has keys for one provider
        const { provider, ...delegateOptions } = options;
        return manager.execute(fn, delegateOptions);
    }

    /**
     * Execute a streaming function with a specific provider's key pool.
     */
    async *executeStream<T>(
        fn: (key: string, signal?: AbortSignal) => AsyncGenerator<T, any, unknown>,
        options: ExecuteOptions & { prompt?: string; provider: string }
    ): AsyncGenerator<T, any, unknown> {
        const manager = this.managers.get(options.provider);
        if (!manager) {
            throw new Error(
                `[MultiManager] Unknown provider "${options.provider}". ` +
                `Available: ${[...this.managers.keys()].join(', ')}`
            );
        }
        const { provider, ...delegateOptions } = options;
        yield* manager.executeStream(fn, delegateOptions);
    }

    /**
     * Get a raw key from a specific provider pool.
     */
    getKey(provider: string): string | null {
        const manager = this.managers.get(provider);
        if (!manager) return null;
        return manager.getKey();
    }

    /**
     * Get stats for a specific provider.
     */
    getStats(provider: string): ApiKeyManagerStats | null {
        const manager = this.managers.get(provider);
        if (!manager) return null;
        return manager.getStats();
    }

    /**
     * Get aggregate stats across ALL providers.
     */
    getMultiStats(): Record<string, ApiKeyManagerStats> {
        const stats: Record<string, ApiKeyManagerStats> = {};
        for (const [name, manager] of this.managers) {
            stats[name] = manager.getStats();
        }
        return stats;
    }

    /**
     * Get the list of available provider names.
     */
    getProviders(): string[] {
        return [...this.managers.keys()];
    }

    /**
     * Get the underlying ApiKeyManager for a specific provider.
     */
    getManager(provider: string): ApiKeyManager | undefined {
        return this.managers.get(provider);
    }

    /**
     * Stop all health checks and clean up.
     */
    destroy(): void {
        for (const [, manager] of this.managers) {
            manager.stopHealthChecks();
        }
        this.managers.clear();
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    private static parseKeysFromEnv(envKeys: string[]): string[] {
        const keys: string[] = [];
        for (const envName of envKeys) {
            const envValue = process.env[envName];
            if (!envValue) continue;
            const trimmed = envValue.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith('[')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed)) {
                        keys.push(...parsed.filter((k: any) => typeof k === 'string' && k.trim()));
                        continue;
                    }
                } catch { /* not JSON */ }
            }
            keys.push(...trimmed.split(',').map(k => k.trim()).filter(k => k.length > 0));
        }
        return [...new Set(keys)];
    }
}
