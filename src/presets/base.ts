/**
 * BasePreset — Shared foundation for all provider presets
 *
 * Provides the "batteries included" pattern:
 * - Singleton lifecycle management
 * - Environment variable parsing (single key or JSON array)
 * - File-based persistence (survives restarts)
 * - Event-to-logger wiring
 * - Health check scheduling
 * - Result<T> pattern for safe initialization
 *
 * @module presets/base
 */

import {
    ApiKeyManager,
    LatencyStrategy,
    ExecuteOptions,
    ApiKeyManagerOptions,
    LoadBalancingStrategy,
} from '../index';
import { FileStorage } from '../persistence/file';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── Result Type ─────────────────────────────────────────────────────────────

/**
 * A discriminated union for safe error handling without exceptions.
 * Used by `getInstance()` to avoid crashing on missing env vars.
 */
export type Result<T> =
    | { success: true; data: T }
    | { success: false; error: Error };

// ─── Configuration ──────────────────────────────────────────────────────────

export interface PresetOptions {
    /** Environment variable name(s) to read API keys from. */
    envKeys: string[];
    /** Provider name for logging and file state isolation. Default: 'default' */
    provider?: string;
    /** Load balancing strategy. Default: LatencyStrategy */
    strategy?: LoadBalancingStrategy;
    /** Max concurrent execute() calls. Default: 20 */
    concurrency?: number;
    /** Health check interval in ms. Set to 0 to disable. Default: 300_000 (5 min) */
    healthCheckIntervalMs?: number;
    /** Custom health check function. If not set, health checks are disabled. */
    healthCheckFn?: (key: string) => Promise<boolean>;
    /** Semantic cache config. Optional. */
    semanticCache?: ApiKeyManagerOptions['semanticCache'];
    /** Custom logger. Defaults to console. */
    logger?: PresetLogger;
    /** Fallback function when all keys are exhausted. */
    fallbackFn?: () => any;
    /** Custom state file path. Defaults to `os.tmpdir()/codedex_{provider}_state.json` */
    stateFilePath?: string;
}

export interface PresetLogger {
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
}

// ─── Base Preset Class ──────────────────────────────────────────────────────

/**
 * Abstract base class for provider presets.
 * Subclasses only need to define `getDefaultOptions()` with provider-specific
 * defaults (env var name, health check function, etc.).
 *
 * @example
 * ```ts
 * // Creating a custom preset:
 * class MyProviderPreset extends BasePreset {
 *   protected static getDefaultOptions(): Partial<PresetOptions> {
 *     return {
 *       envKeys: ['MY_PROVIDER_API_KEY'],
 *       provider: 'my-provider',
 *     };
 *   }
 * }
 * ```
 */
export abstract class BasePreset {
    private static instances: Map<string, BasePreset> = new Map();

    protected manager: ApiKeyManager;
    protected logger: PresetLogger;
    protected options: Required<Pick<PresetOptions, 'provider' | 'concurrency' | 'healthCheckIntervalMs'>> & PresetOptions;

    protected constructor(apiKeys: string[], options: PresetOptions) {
        this.logger = options.logger || console;

        this.options = {
            provider: options.provider || 'default',
            concurrency: options.concurrency ?? 20,
            healthCheckIntervalMs: options.healthCheckIntervalMs ?? 300_000,
            ...options,
        };

        const stateFile = this.options.stateFilePath ||
            join(tmpdir(), `codedex_${this.options.provider}_state.json`);

        const storage = new FileStorage({
            filePath: stateFile,
            clearOnInit: true, // Fresh start each session to clear stale DEAD keys
        });

        this.manager = new ApiKeyManager(apiKeys, {
            storage,
            strategy: this.options.strategy || new LatencyStrategy(),
            fallbackFn: this.options.fallbackFn,
            concurrency: this.options.concurrency,
            semanticCache: this.options.semanticCache,
        });

        this.wireEvents();

        if (this.options.healthCheckFn && this.options.healthCheckIntervalMs > 0) {
            this.manager.setHealthCheck(this.options.healthCheckFn);
            this.manager.startHealthChecks(this.options.healthCheckIntervalMs);
        }

        this.logger.info(
            `[${this.options.provider}] ApiKeyManager initialized with ${apiKeys.length} keys ` +
            `(Strategy: ${this.options.strategy?.constructor.name || 'LatencyStrategy'}, ` +
            `Concurrency: ${this.options.concurrency}, ` +
            `HealthChecks: ${this.options.healthCheckIntervalMs > 0 ? `every ${this.options.healthCheckIntervalMs / 1000}s` : 'disabled'})`
        );
    }

    /**
     * Wire all manager events to the logger.
     */
    private wireEvents(): void {
        const tag = this.options.provider;
        this.manager.on('keyDead', (key) =>
            this.logger.error(`[${tag}] Key PERMANENTLY DEAD: ...${key.slice(-4)}`));
        this.manager.on('circuitOpen', (key) =>
            this.logger.warn(`[${tag}] Circuit OPEN (cooldown): ...${key.slice(-4)}`));
        this.manager.on('keyRecovered', (key) =>
            this.logger.info(`[${tag}] Key RECOVERED: ...${key.slice(-4)}`));
        this.manager.on('retry', (key, attempt, delay) =>
            this.logger.info(`[${tag}] Retry with ...${key.slice(-4)} (Attempt ${attempt}, Delay ${delay}ms)`));
        this.manager.on('fallback', (reason) =>
            this.logger.warn(`[${tag}] Triggering FALLBACK: ${reason}`));
        this.manager.on('allKeysExhausted', () =>
            this.logger.error(`[${tag}] ALL KEYS EXHAUSTED! No fallback available.`));
        this.manager.on('bulkheadRejected', () =>
            this.logger.warn(`[${tag}] Bulkhead rejected request (concurrency limit reached)`));
        this.manager.on('healthCheckPassed', (key) =>
            this.logger.info(`[${tag}] Health check PASSED: ...${key.slice(-4)}`));
        this.manager.on('healthCheckFailed', (key) =>
            this.logger.warn(`[${tag}] Health check FAILED: ...${key.slice(-4)}`));
    }

    // ─── Public API ─────────────────────────────────────────────────────────

    /**
     * Execute a function with automatic key rotation, retries, timeout, and caching.
     */
    async execute<T>(
        fn: (key: string, signal?: AbortSignal) => Promise<T>,
        options?: ExecuteOptions & { prompt?: string }
    ): Promise<T> {
        return this.manager.execute(fn, options);
    }

    /**
     * Execute a streaming function with retry on initial connection failure.
     */
    async *executeStream<T>(
        fn: (key: string, signal?: AbortSignal) => AsyncGenerator<T, any, unknown>,
        options?: ExecuteOptions & { prompt?: string }
    ): AsyncGenerator<T, any, unknown> {
        yield* this.manager.executeStream(fn, options);
    }

    /**
     * Get the best available API key directly (low-level).
     */
    getKey(): string | null {
        return this.manager.getKey();
    }

    /**
     * Get the number of non-dead keys.
     */
    getKeyCount(): number {
        return this.manager.getKeyCount();
    }

    /**
     * Get pool health statistics.
     */
    getStats() {
        return this.manager.getStats();
    }

    /**
     * Get the underlying ApiKeyManager instance for advanced use.
     */
    getManager(): ApiKeyManager {
        return this.manager;
    }

    /**
     * Stop health checks and clean up. Call when shutting down.
     */
    destroy(): void {
        this.manager.stopHealthChecks();
    }

    // ─── Static Factory ─────────────────────────────────────────────────────

    /**
     * Parse API keys from environment variables.
     * Supports:
     * - Single key: `"AIza..."`
     * - JSON array: `'["AIza...", "AIzb..."]'`
     * - Comma-separated: `"AIza...,AIzb..."`
     */
    protected static parseKeysFromEnv(envKeys: string[]): string[] {
        const keys: string[] = [];

        for (const envName of envKeys) {
            const envValue = process.env[envName];
            if (!envValue) continue;

            const trimmed = envValue.trim();
            if (!trimmed) continue;

            // Try JSON array
            if (trimmed.startsWith('[')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed)) {
                        keys.push(...parsed.filter((k: any) => typeof k === 'string' && k.trim()));
                        continue;
                    }
                } catch {
                    // Not valid JSON, fall through to comma split
                }
            }

            // Comma-separated or single key
            keys.push(...trimmed.split(',').map(k => k.trim()).filter(k => k.length > 0));
        }

        return [...new Set(keys)]; // Deduplicate
    }

    /**
     * Get or create the singleton instance for a preset.
     * This is the core factory used by all preset subclasses.
     *
     * @param PresetClass - The preset class to instantiate
     * @param overrides - Optional overrides for preset options
     * @returns Result<T> — either `{ success: true, data: instance }` or `{ success: false, error }`
     */
    protected static createInstance<T extends BasePreset>(
        PresetClass: new (keys: string[], options: PresetOptions) => T,
        defaultOptions: Partial<PresetOptions>,
        overrides?: Partial<PresetOptions>
    ): Result<T> {
        const mergedOptions = { ...defaultOptions, ...overrides } as PresetOptions;
        const instanceKey = mergedOptions.provider || PresetClass.name;

        // Return existing singleton
        const existing = BasePreset.instances.get(instanceKey);
        if (existing) {
            return { success: true, data: existing as T };
        }

        // Parse keys
        const envKeys = mergedOptions.envKeys || [];
        const keys = BasePreset.parseKeysFromEnv(envKeys);

        if (keys.length === 0) {
            const logger = mergedOptions.logger || console;
            logger.warn(
                `[${instanceKey}] No API keys found in env vars: ${envKeys.join(', ')}. ` +
                `AI features will be disabled.`
            );
            // Still create the instance with empty keys — allows graceful degradation
        }

        try {
            const instance = new PresetClass(keys, mergedOptions);
            BasePreset.instances.set(instanceKey, instance);
            return { success: true, data: instance };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    }

    /**
     * Reset a singleton instance (primarily for testing).
     */
    protected static resetInstance(provider: string): void {
        const existing = BasePreset.instances.get(provider);
        if (existing) {
            existing.destroy();
            BasePreset.instances.delete(provider);
        }
    }

    /**
     * Reset ALL singleton instances (primarily for testing).
     */
    static resetAll(): void {
        for (const [, instance] of BasePreset.instances) {
            instance.destroy();
        }
        BasePreset.instances.clear();
    }
}
