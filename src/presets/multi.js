"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiManager = void 0;
const index_1 = require("../index");
const file_1 = require("../persistence/file");
const path_1 = require("path");
const os_1 = require("os");
const crypto_1 = require("crypto");
function getProjectId() {
    const cwd = process.cwd();
    const dirName = (0, path_1.basename)(cwd)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    const hash = (0, crypto_1.createHash)('md5').update(cwd).digest('hex').slice(0, 4);
    return `${dirName}_${hash}`;
}
// ─── MultiManager ───────────────────────────────────────────────────────────
class MultiManager {
    static instance = null;
    managers = new Map();
    logger;
    constructor(options) {
        this.logger = options.logger || console;
        for (const [providerName, config] of Object.entries(options.providers)) {
            const keys = MultiManager.parseKeysFromEnv(config.envKeys);
            if (keys.length === 0) {
                this.logger.warn(`[MultiManager:${providerName}] No API keys found in: ${config.envKeys.join(', ')} — provider skipped`);
                continue;
            }
            const projectId = getProjectId();
            const storage = new file_1.FileStorage({
                filePath: (0, path_1.join)((0, os_1.tmpdir)(), `codedex_multi_${providerName}_${projectId}_state.json`),
                clearOnInit: false, // Preserve circuit breaker state across restarts
            });
            const manager = new index_1.ApiKeyManager(keys, {
                storage,
                strategy: config.strategy || new index_1.LatencyStrategy(),
                concurrency: config.concurrency ?? 20,
                semanticCache: config.semanticCache,
            });
            // Wire events
            manager.on('keyDead', (key) => this.logger.error(`[MultiManager:${providerName}] Key DEAD: ...${key.slice(-4)}`));
            manager.on('circuitOpen', (key) => this.logger.warn(`[MultiManager:${providerName}] Circuit OPEN: ...${key.slice(-4)}`));
            manager.on('keyRecovered', (key) => this.logger.info(`[MultiManager:${providerName}] Key RECOVERED: ...${key.slice(-4)}`));
            manager.on('allKeysExhausted', () => this.logger.error(`[MultiManager:${providerName}] ALL KEYS EXHAUSTED`));
            // Health checks
            const interval = options.healthCheckIntervalMs ?? 300_000;
            if (interval > 0) {
                manager.startHealthChecks(interval);
            }
            this.managers.set(providerName, manager);
            this.logger.info(`[MultiManager:${providerName}] Initialized with ${keys.length} keys`);
        }
    }
    // ─── Factory ────────────────────────────────────────────────────────────
    /**
     * Get or create the singleton MultiManager instance.
     */
    static getInstance(options) {
        if (MultiManager.instance) {
            return { success: true, data: MultiManager.instance };
        }
        try {
            MultiManager.instance = new MultiManager(options);
            return { success: true, data: MultiManager.instance };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    }
    /**
     * Reset the singleton (primarily for testing).
     */
    static reset() {
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
    async execute(fn, options) {
        const manager = this.managers.get(options.provider);
        if (!manager) {
            throw new Error(`[MultiManager] Unknown provider "${options.provider}". ` +
                `Available: ${[...this.managers.keys()].join(', ')}`);
        }
        // Strip `provider` before delegating — each manager only has keys for one provider
        const { provider, ...delegateOptions } = options;
        return manager.execute(fn, delegateOptions);
    }
    /**
     * Execute a streaming function with a specific provider's key pool.
     */
    async *executeStream(fn, options) {
        const manager = this.managers.get(options.provider);
        if (!manager) {
            throw new Error(`[MultiManager] Unknown provider "${options.provider}". ` +
                `Available: ${[...this.managers.keys()].join(', ')}`);
        }
        const { provider, ...delegateOptions } = options;
        yield* manager.executeStream(fn, delegateOptions);
    }
    /**
     * Get a raw key from a specific provider pool.
     */
    getKey(provider) {
        const manager = this.managers.get(provider);
        if (!manager)
            return null;
        return manager.getKey();
    }
    /**
     * Get stats for a specific provider.
     */
    getStats(provider) {
        const manager = this.managers.get(provider);
        if (!manager)
            return null;
        return manager.getStats();
    }
    /**
     * Get aggregate stats across ALL providers.
     */
    getMultiStats() {
        const stats = {};
        for (const [name, manager] of this.managers) {
            stats[name] = manager.getStats();
        }
        return stats;
    }
    /**
     * Get the list of available provider names.
     */
    getProviders() {
        return [...this.managers.keys()];
    }
    /**
     * Get the underlying ApiKeyManager for a specific provider.
     */
    getManager(provider) {
        return this.managers.get(provider);
    }
    /**
     * Stop all health checks and clean up.
     */
    destroy() {
        for (const [, manager] of this.managers) {
            manager.stopHealthChecks();
        }
        this.managers.clear();
    }
    // ─── Helpers ────────────────────────────────────────────────────────────
    static parseKeysFromEnv(envKeys) {
        const keys = [];
        for (const envName of envKeys) {
            const envValue = process.env[envName];
            if (!envValue)
                continue;
            const trimmed = envValue.trim();
            if (!trimmed)
                continue;
            if (trimmed.startsWith('[')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed)) {
                        keys.push(...parsed.filter((k) => typeof k === 'string' && k.trim()));
                        continue;
                    }
                }
                catch {
                    /* not JSON */
                }
            }
            keys.push(...trimmed
                .split(',')
                .map((k) => k.trim())
                .filter((k) => k.length > 0));
        }
        return [...new Set(keys)];
    }
}
exports.MultiManager = MultiManager;
//# sourceMappingURL=multi.js.map