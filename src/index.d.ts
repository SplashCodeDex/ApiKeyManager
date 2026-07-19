/**
 * Universal ApiKeyManager v5.4 — Ecosystem Edition
 * Implements: Rotation, Circuit Breaker, Persistence, Exponential Backoff, Strategies,
 *             Event Emitter, Fallback, execute(), Timeout, Auto-Retry, Provider Tags,
 *             Health Checks, Bulkhead/Concurrency
 * NEW in v5.4: Production-hardened API Gateway with transparent proxy,
 *              per-app rate limiting, graceful shutdown, provider extensibility,
 *              request audit trail, and SSE error resilience.
 * v5.0: Provider Presets (GeminiManager, OpenAIManager, MultiManager),
 *       Built-in Persistence (FileStorage, MemoryStorage)
 * Gemini-Specific: finishReason handling, Safety blocks, RECITATION detection
 * Infrastructure: cockatiel (Bulkhead queueing + ExponentialBackoff w/ decorrelated jitter)
 */
import { EventEmitter } from 'events';
import { z } from 'zod';
export { FileStorage } from './persistence/file';
export type { FileStorageOptions, EncryptionOptions } from './persistence/file';
export { MemoryStorage } from './persistence/memory';
export interface KeyState {
    key: string;
    failCount: number;
    failedAt: number | null;
    isQuotaError: boolean;
    circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' | 'DEAD';
    lastUsed: number;
    successCount: number;
    totalRequests: number;
    halfOpenTestTime: number | null;
    customCooldown: number | null;
    weight: number;
    averageLatency: number;
    totalLatency: number;
    latencySamples: number;
    provider: string;
}
export type ErrorType = 'QUOTA' | 'TRANSIENT' | 'AUTH' | 'BAD_REQUEST' | 'SAFETY' | 'RECITATION' | 'TIMEOUT' | 'UNKNOWN';
export interface ErrorClassification {
    type: ErrorType;
    retryable: boolean;
    cooldownMs: number;
    markKeyFailed: boolean;
    markKeyDead: boolean;
}
export interface ApiKeyManagerStats {
    total: number;
    healthy: number;
    cooling: number;
    dead: number;
}
export interface ExecuteOptions {
    timeoutMs?: number;
    maxRetries?: number;
    finishReason?: string;
    provider?: string;
}
export declare const ApiKeyManagerOptionsSchema: z.ZodObject<{
    storage: z.ZodOptional<z.ZodAny>;
    strategy: z.ZodOptional<z.ZodAny>;
    fallbackFn: z.ZodOptional<z.ZodCustom<() => any, () => any>>;
    concurrency: z.ZodOptional<z.ZodNumber>;
    concurrencyQueueSize: z.ZodOptional<z.ZodNumber>;
    semanticCache: z.ZodOptional<z.ZodObject<{
        threshold: z.ZodOptional<z.ZodNumber>;
        ttlMs: z.ZodOptional<z.ZodNumber>;
        getEmbedding: z.ZodCustom<(text: string) => Promise<number[]>, (text: string) => Promise<number[]>>;
    }, z.core.$strip>>;
}, z.core.$loose>;
export type ApiKeyManagerOptions = z.infer<typeof ApiKeyManagerOptionsSchema>;
export interface CacheEntry {
    vector: number[];
    prompt: string;
    response: any;
    timestamp: number;
}
export interface ApiKeyManagerEventMap {
    keyDead: (key: string) => void;
    circuitOpen: (key: string) => void;
    circuitHalfOpen: (key: string) => void;
    keyRecovered: (key: string) => void;
    fallback: (reason: string) => void;
    allKeysExhausted: () => void;
    retry: (key: string, attempt: number, delayMs: number) => void;
    healthCheckFailed: (key: string, error: any) => void;
    healthCheckPassed: (key: string) => void;
    executeSuccess: (key: string, durationMs: number) => void;
    executeFailed: (key: string, error: any) => void;
    bulkheadRejected: () => void;
}
export declare class TimeoutError extends Error {
    constructor(ms: number);
}
export declare class BulkheadRejectionError extends Error {
    constructor();
}
export declare class AllKeysExhaustedError extends Error {
    constructor();
}
/**
 * Strategy Interface for selecting the next key
 */
export interface LoadBalancingStrategy {
    next(candidates: KeyState[]): KeyState | null;
}
/**
 * Standard Strategy: Least Failed > Least Recently Used
 */
export declare class StandardStrategy implements LoadBalancingStrategy {
    next(candidates: KeyState[]): KeyState | null;
}
/**
 * Weighted Strategy: Probabilistic selection based on weight
 * Higher weight = Higher chance of selection
 */
export declare class WeightedStrategy implements LoadBalancingStrategy {
    next(candidates: KeyState[]): KeyState | null;
}
/**
 * Latency Strategy: Pick lowest average latency with LRU tie-break
 */
export declare class LatencyStrategy implements LoadBalancingStrategy {
    next(candidates: KeyState[]): KeyState | null;
}
/**
 * High-performance Vanilla Semantic Cache
 * Implements Cosine Similarity math from scratch.
 */
export declare class SemanticCache {
    private entries;
    private threshold;
    private ttlMs;
    constructor(threshold?: number, ttlMs?: number);
    set(prompt: string, vector: number[], response: any): void;
    get(vector: number[]): any | null;
    /**
     * Vanilla Cosine Similarity: (A·B) / (||A|| * ||B||)
     */
    private calculateCosineSimilarity;
}
export declare class ApiKeyManager extends EventEmitter {
    private keys;
    private storageKey;
    private storage;
    private strategy;
    private fallbackFn?;
    private bulkheadPolicy;
    private healthCheckFn?;
    private healthCheckInterval?;
    private _saveTimer?;
    private _saveDirty;
    private semanticCache?;
    private getEmbeddingFn?;
    private _isResolvingEmbedding;
    /**
     * Constructor accepts an options object for configuration.
     *
     * @example
     *   new ApiKeyManager(keys, { storage, strategy, fallbackFn, concurrency })
     */
    constructor(initialKeys: string[] | {
        key: string;
        weight?: number;
        provider?: string;
    }[], options?: ApiKeyManagerOptions);
    /**
     * CLASSIFIES an error to determine handling strategy
     */
    classifyError(error: any, finishReason?: string): ErrorClassification;
    private parseRetryAfter;
    private isOnCooldown;
    getKey(): string | null;
    /**
     * Get a key filtered by provider tag
     */
    getKeyByProvider(provider: string): string | null;
    getKeyCount(): number;
    /**
     * Mark success AND update latency stats
     * @param durationMs Duration of the request in milliseconds
     */
    markSuccess(key: string, durationMs?: number): void;
    markFailed(key: string, classification: ErrorClassification): void;
    /**
     * Calculate exponential backoff with decorrelated jitter using cockatiel.
     * Decorrelated jitter avoids thundering-herd by randomizing retry intervals
     * independent of the previous delay, which is statistically superior to
     * simple `random * exponential` jitter.
     *
     * @param attempt - Zero-indexed attempt number
     */
    private readonly _backoffFactory;
    calculateBackoff(attempt: number): number;
    getStats(): ApiKeyManagerStats;
    _getKeys(): KeyState[];
    /**
     * Wraps the entire API call lifecycle into a single method.
     *
     * @example
     *   const result = await manager.execute(
     *     (key) => fetch(`https://api.example.com?key=${key}`),
     *     { maxRetries: 3, timeoutMs: 5000 }
     *   );
     */
    execute<T>(fn: (key: string, signal?: AbortSignal) => Promise<T>, options?: ExecuteOptions & {
        prompt?: string;
    }): Promise<T>;
    /**
     * Executes a streaming function (AsyncGenerator) with retry logic and semantic caching.
     *
     * @example
     *   const stream = await manager.executeStream(async (key) => {
     *     return await gemini.generateContentStream({ prompt: "..." });
     *   }, { prompt: "..." });
     *
     *   for await (const chunk of stream) {
     *     console.log(chunk.text());
     *   }
     */
    executeStream<T>(fn: (key: string, signal?: AbortSignal) => AsyncGenerator<T, any, unknown>, options?: ExecuteOptions & {
        prompt?: string;
    }): AsyncGenerator<T, any, unknown>;
    /**
     * Helper: stores result in semantic cache then returns it.
     * Called by the bulkhead execute() callback and the no-bulkhead path.
     */
    private _executeWithSemanticAndRetry;
    private _executeWithRetry;
    private _executeWithTimeout;
    private _sleep;
    /**
     * Set a health check function that tests if a key is operational
     */
    setHealthCheck(fn: (key: string) => Promise<boolean>): void;
    /**
     * Start periodic health checks
     * @param intervalMs How often to run health checks (default: 60s)
     */
    startHealthChecks(intervalMs?: number): void;
    /**
     * Stop periodic health checks
     */
    stopHealthChecks(): void;
    private _runHealthChecks;
    /**
     * Debounced save — marks state as dirty and flushes after 500ms of inactivity.
     * Under heavy load (multiple getKey/markSuccess/markFailed calls), this coalesces
     * dozens of writeFileSync calls into one.
     */
    private saveState;
    /**
     * Immediately flush state to storage. Called by the debounce timer
     * and by stopHealthChecks() to ensure clean shutdown.
     */
    flushState(): void;
    private _flushState;
    private loadState;
}
//# sourceMappingURL=index.d.ts.map