/**
 * Universal ApiKeyManager v3.0
 * Implements: Rotation, Circuit Breaker, Persistence, Exponential Backoff, Strategies,
 *             Event Emitter, Fallback, execute(), Timeout, Auto-Retry, Provider Tags,
 *             Health Checks, Bulkhead/Concurrency
 * Gemini-Specific: finishReason handling, Safety blocks, RECITATION detection
 */

import { EventEmitter } from 'events';

// ─── Interfaces & Types ──────────────────────────────────────────────────────

export interface KeyState {
    key: string;
    failCount: number;           // Consecutive failures
    failedAt: number | null;     // Timestamp of last failure
    isQuotaError: boolean;       // Was last error a 429?
    circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' | 'DEAD';
    lastUsed: number;
    successCount: number;
    totalRequests: number;
    halfOpenTestTime: number | null;
    customCooldown: number | null; // From Retry-After header
    // v2.0 Stats
    weight: number;              // 0.0 - 1.0 (Default 1.0)
    averageLatency: number;      // Rolling average latency in ms
    totalLatency: number;        // Sum of all latency checks (for calculating average)
    latencySamples: number;      // Number of samples
    // v3.0 Fields
    provider: string;            // Provider tag (e.g. 'openai', 'gemini')
}

export type ErrorType =
    | 'QUOTA'       // 429 - Rotate key, respect cooldown
    | 'TRANSIENT'   // 500/503/504 - Retry with backoff
    | 'AUTH'        // 403 - Key is dead, remove from pool
    | 'BAD_REQUEST' // 400 - Do not retry, fix request
    | 'SAFETY'      // finishReason: SAFETY - Not a key issue
    | 'RECITATION'  // finishReason: RECITATION - Not a key issue
    | 'TIMEOUT'     // Request timed out
    | 'UNKNOWN';    // Catch-all

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
    timeoutMs?: number;      // Timeout per attempt in ms
    maxRetries?: number;     // Max retry attempts (default: 0 = no retry)
    finishReason?: string;   // For Gemini finishReason handling
}

export interface ApiKeyManagerOptions {
    storage?: any;
    strategy?: LoadBalancingStrategy;
    fallbackFn?: () => any;
    concurrency?: number;    // Max concurrent execute() calls
    semanticCache?: {
        threshold?: number;  // Similarity threshold (0.0 - 1.0, default 0.95)
        ttlMs?: number;      // Cache TTL
        getEmbedding: (text: string) => Promise<number[]>;
    };
}

export interface CacheEntry {
    vector: number[];
    prompt: string;
    response: any;
    timestamp: number;
}

// ─── Event Types ─────────────────────────────────────────────────────────────

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

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG = {
    MAX_CONSECUTIVE_FAILURES: 5,
    COOLDOWN_TRANSIENT: 60 * 1000,        // 1 minute
    COOLDOWN_QUOTA: 5 * 60 * 1000,        // 5 minutes (default if no Retry-After)
    COOLDOWN_QUOTA_DAILY: 60 * 60 * 1000, // 1 hour for RPD exhaustion
    HALF_OPEN_TEST_DELAY: 60 * 1000,      // 1 minute after open
    MAX_BACKOFF: 64 * 1000,               // 64 seconds max
    BASE_BACKOFF: 1000,                   // 1 second base
};

// Error classification patterns
const ERROR_PATTERNS = {
    isQuotaError: /429|quota|exhausted|resource.?exhausted|too.?many.?requests|rate.?limit/i,
    isAuthError: /403|permission.?denied|invalid.?api.?key|unauthorized|unauthenticated/i,
    isSafetyBlock: /safety|blocked|recitation|harmful/i,
    isTransient: /500|502|503|504|internal|unavailable|deadline|timeout|overloaded/i,
    isBadRequest: /400|invalid.?argument|failed.?precondition|malformed|not.?found|404/i,
};

// ─── Custom Errors ───────────────────────────────────────────────────────────

export class TimeoutError extends Error {
    constructor(ms: number) {
        super(`Request timed out after ${ms}ms`);
        this.name = 'TimeoutError';
    }
}

export class BulkheadRejectionError extends Error {
    constructor() {
        super('Bulkhead capacity exceeded — too many concurrent requests');
        this.name = 'BulkheadRejectionError';
    }
}

export class AllKeysExhaustedError extends Error {
    constructor() {
        super('All API keys exhausted — no healthy keys available');
        this.name = 'AllKeysExhaustedError';
    }
}

// ─── Strategies ──────────────────────────────────────────────────────────────

/**
 * Strategy Interface for selecting the next key
 */
export interface LoadBalancingStrategy {
    next(candidates: KeyState[]): KeyState | null;
}

/**
 * Standard Strategy: Least Failed > Least Recently Used
 */
export class StandardStrategy implements LoadBalancingStrategy {
    next(candidates: KeyState[]): KeyState | null {
        candidates.sort((a, b) => {
            if (a.failCount !== b.failCount) return a.failCount - b.failCount;
            return a.lastUsed - b.lastUsed;
        });
        return candidates[0] || null;
    }
}

/**
 * Weighted Strategy: Probabilistic selection based on weight
 * Higher weight = Higher chance of selection
 */
export class WeightedStrategy implements LoadBalancingStrategy {
    next(candidates: KeyState[]): KeyState | null {
        if (candidates.length === 0) return null;

        const totalWeight = candidates.reduce((sum, k) => sum + k.weight, 0);
        let random = Math.random() * totalWeight;

        for (const key of candidates) {
            random -= key.weight;
            if (random <= 0) return key;
        }

        return candidates[0]; // Fallback
    }
}

/**
 * Latency Strategy: Pick lowest average latency
 */
export class LatencyStrategy implements LoadBalancingStrategy {
    next(candidates: KeyState[]): KeyState | null {
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => a.averageLatency - b.averageLatency);
        return candidates[0];
    }
}

// ─── Semantic Engine ─────────────────────────────────────────────────────────

/**
 * High-performance Vanilla Semantic Cache
 * Implements Cosine Similarity math from scratch.
 */
export class SemanticCache {
    private entries: CacheEntry[] = [];
    private threshold: number;
    private ttlMs: number;

    constructor(threshold: number = 0.95, ttlMs: number = 24 * 60 * 60 * 1000) {
        this.threshold = threshold;
        this.ttlMs = ttlMs;
    }

    public set(prompt: string, vector: number[], response: any) {
        // Expire old entry for same prompt if exists
        this.entries = this.entries.filter(e => e.prompt !== prompt);
        this.entries.push({
            prompt,
            vector,
            response,
            timestamp: Date.now()
        });
        // Optional: Cap size to prevent memory leaks
        if (this.entries.length > 500) this.entries.shift();
    }

    public get(vector: number[]): any | null {
        const now = Date.now();
        let bestMatch: CacheEntry | null = null;
        let highestSimilarity = -1;

        for (let i = this.entries.length - 1; i >= 0; i--) {
            const entry = this.entries[i];

            // Check TTL
            if (now - entry.timestamp > this.ttlMs) {
                this.entries.splice(i, 1);
                continue;
            }

            const similarity = this.calculateCosineSimilarity(vector, entry.vector);
            if (similarity >= this.threshold && similarity > highestSimilarity) {
                highestSimilarity = similarity;
                bestMatch = entry;
            }
        }

        return bestMatch ? bestMatch.response : null;
    }

    /**
     * Vanilla Cosine Similarity: (A·B) / (||A|| * ||B||)
     */
    private calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
        if (vecA.length !== vecB.length) return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }

        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator === 0 ? 0 : dotProduct / denominator;
    }
}

// ─── Main Class ──────────────────────────────────────────────────────────────

export class ApiKeyManager extends EventEmitter {
    private keys: KeyState[] = [];
    private storageKey = 'api_rotation_state_v2';
    private storage: any;
    private strategy: LoadBalancingStrategy;
    private fallbackFn?: () => any;

    // Bulkhead state
    private maxConcurrency: number;
    private activeCalls: number = 0;

    // Health check state
    private healthCheckFn?: (key: string) => Promise<boolean>;
    private healthCheckInterval?: ReturnType<typeof setInterval>;

    // Semantic Cache v4
    private semanticCache?: SemanticCache;
    private getEmbeddingFn?: (text: string) => Promise<number[]>;

    /**
     * Constructor supports both legacy positional args and new options object.
     *
     * @example Legacy (v1/v2 — still works):
     *   new ApiKeyManager(['key1', 'key2'], storage, strategy)
     *
     * @example New (v3):
     *   new ApiKeyManager(keys, { storage, strategy, fallbackFn, concurrency })
     */
    constructor(
        initialKeys: string[] | { key: string; weight?: number; provider?: string }[],
        storageOrOptions?: any | ApiKeyManagerOptions,
        strategy?: LoadBalancingStrategy
    ) {
        super();

        // Detect if second arg is options object or legacy storage
        let options: ApiKeyManagerOptions = {};
        if (storageOrOptions && typeof storageOrOptions === 'object' && ('storage' in storageOrOptions || 'strategy' in storageOrOptions || 'fallbackFn' in storageOrOptions || 'concurrency' in storageOrOptions || 'semanticCache' in storageOrOptions)) {
            // New v3 options object
            options = storageOrOptions as ApiKeyManagerOptions;
        } else {
            // Legacy positional args
            options = {
                storage: storageOrOptions,
                strategy: strategy,
            };
        }

        this.storage = options.storage || {
            getItem: () => null,
            setItem: () => { },
        };
        this.strategy = options.strategy || new StandardStrategy();
        this.fallbackFn = options.fallbackFn;
        this.maxConcurrency = options.concurrency || Infinity;

        // Init Semantic Cache if provided
        if (options.semanticCache) {
            this.semanticCache = new SemanticCache(
                options.semanticCache.threshold,
                options.semanticCache.ttlMs
            );
            this.getEmbeddingFn = options.semanticCache.getEmbedding;
        }

        // Normalize input to objects
        let inputKeys: { key: string; weight?: number; provider?: string }[] = [];
        if (initialKeys.length > 0 && typeof initialKeys[0] === 'string') {
            inputKeys = (initialKeys as string[]).flatMap(k => k.split(',').map(s => ({ key: s.trim(), weight: 1.0, provider: 'default' })));
        } else {
            inputKeys = initialKeys as { key: string; weight?: number; provider?: string }[];
        }

        // Deduplicate
        const uniqueMap = new Map<string, { weight: number; provider: string }>();
        inputKeys.forEach(k => {
            if (k.key.length > 0) uniqueMap.set(k.key, { weight: k.weight ?? 1.0, provider: k.provider ?? 'default' });
        });

        if (uniqueMap.size < inputKeys.length) {
            console.warn(`[ApiKeyManager] Removed ${inputKeys.length - uniqueMap.size} duplicate/empty keys.`);
        }

        this.keys = Array.from(uniqueMap.entries()).map(([key, meta]) => ({
            key,
            failCount: 0,
            failedAt: null,
            isQuotaError: false,
            circuitState: 'CLOSED',
            lastUsed: 0,
            successCount: 0,
            totalRequests: 0,
            halfOpenTestTime: null,
            customCooldown: null,
            weight: meta.weight,
            averageLatency: 0,
            totalLatency: 0,
            latencySamples: 0,
            provider: meta.provider,
        }));

        this.loadState();
    }

    // ─── Error Classification ────────────────────────────────────────────────

    /**
     * CLASSIFIES an error to determine handling strategy
     */
    public classifyError(error: any, finishReason?: string): ErrorClassification {
        const status = error?.status || error?.response?.status;
        const message = error?.message || error?.error?.message || String(error);

        // 1. Check finishReason first
        if (finishReason === 'SAFETY') return { type: 'SAFETY', retryable: false, cooldownMs: 0, markKeyFailed: false, markKeyDead: false };
        if (finishReason === 'RECITATION') return { type: 'RECITATION', retryable: false, cooldownMs: 0, markKeyFailed: false, markKeyDead: false };

        // 2. Check timeout
        if (error instanceof TimeoutError || error?.name === 'TimeoutError') {
            return { type: 'TIMEOUT', retryable: true, cooldownMs: CONFIG.COOLDOWN_TRANSIENT, markKeyFailed: true, markKeyDead: false };
        }

        // 3. Check HTTP status codes
        if (status === 403 || ERROR_PATTERNS.isAuthError.test(message)) {
            return { type: 'AUTH', retryable: false, cooldownMs: Infinity, markKeyFailed: true, markKeyDead: true };
        }
        if (status === 429 || ERROR_PATTERNS.isQuotaError.test(message)) {
            const retryAfter = this.parseRetryAfter(error);
            return {
                type: 'QUOTA',
                retryable: true,
                cooldownMs: retryAfter || CONFIG.COOLDOWN_QUOTA,
                markKeyFailed: true,
                markKeyDead: false
            };
        }
        if (status === 400 || ERROR_PATTERNS.isBadRequest.test(message)) {
            return { type: 'BAD_REQUEST', retryable: false, cooldownMs: 0, markKeyFailed: false, markKeyDead: false };
        }
        if (ERROR_PATTERNS.isTransient.test(message) || [500, 502, 503, 504].includes(status)) {
            return { type: 'TRANSIENT', retryable: true, cooldownMs: CONFIG.COOLDOWN_TRANSIENT, markKeyFailed: true, markKeyDead: false };
        }

        return { type: 'UNKNOWN', retryable: true, cooldownMs: CONFIG.COOLDOWN_TRANSIENT, markKeyFailed: true, markKeyDead: false };
    }

    private parseRetryAfter(error: any): number | null {
        const retryAfter = error?.response?.headers?.['retry-after'] ||
            error?.headers?.['retry-after'] ||
            error?.retryAfter;

        if (!retryAfter) return null;

        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) return seconds * 1000;

        const date = Date.parse(retryAfter);
        if (!isNaN(date)) return Math.max(0, date - Date.now());

        return null;
    }

    // ─── Cooldown ────────────────────────────────────────────────────────────

    private isOnCooldown(k: KeyState): boolean {
        if (k.circuitState === 'DEAD') return true;
        const now = Date.now();

        if (k.circuitState === 'OPEN') {
            if (k.halfOpenTestTime && now >= k.halfOpenTestTime) {
                k.circuitState = 'HALF_OPEN';
                this.emit('circuitHalfOpen', k.key);
                return false;
            }
            return true;
        }

        if (k.failedAt) {
            if (k.customCooldown && now - k.failedAt < k.customCooldown) return true;
            const cooldown = k.isQuotaError ? CONFIG.COOLDOWN_QUOTA : CONFIG.COOLDOWN_TRANSIENT;
            if (now - k.failedAt < cooldown) return true;
        }

        return false;
    }

    // ─── Key Selection ───────────────────────────────────────────────────────

    public getKey(): string | null {
        // 1. Filter out dead and cooling down keys
        const candidates = this.keys.filter(k => k.circuitState !== 'DEAD' && !this.isOnCooldown(k));

        if (candidates.length === 0) {
            // FALLBACK: Return oldest failed key (excluding DEAD)
            const nonDead = this.keys.filter(k => k.circuitState !== 'DEAD');
            if (nonDead.length === 0) {
                this.emit('allKeysExhausted');
                return null;
            }
            return nonDead.sort((a, b) => (a.failedAt || 0) - (b.failedAt || 0))[0]?.key || null;
        }

        // 2. Delegate to Strategy
        const selected = this.strategy.next(candidates);

        if (selected) {
            selected.lastUsed = Date.now();
            this.saveState();
            return selected.key;
        }
        return null;
    }

    /**
     * Get a key filtered by provider tag
     */
    public getKeyByProvider(provider: string): string | null {
        const candidates = this.keys.filter(k =>
            k.provider === provider && k.circuitState !== 'DEAD' && !this.isOnCooldown(k)
        );

        if (candidates.length === 0) return null;

        const selected = this.strategy.next(candidates);
        if (selected) {
            selected.lastUsed = Date.now();
            this.saveState();
            return selected.key;
        }
        return null;
    }

    public getKeyCount(): number {
        return this.keys.filter(k => k.circuitState !== 'DEAD').length;
    }

    // ─── Mark Success / Failed ───────────────────────────────────────────────

    /**
     * Mark success AND update latency stats
     * @param durationMs Duration of the request in milliseconds
     */
    public markSuccess(key: string, durationMs?: number) {
        const k = this.keys.find(x => x.key === key);
        if (!k) return;

        const wasRecovering = k.circuitState !== 'CLOSED' && k.circuitState !== 'DEAD';
        if (wasRecovering) {
            console.log(`[Key Recovered] ...${key.slice(-4)}`);
            this.emit('keyRecovered', key);
        }

        k.circuitState = 'CLOSED';
        k.failCount = 0;
        k.failedAt = null;
        k.isQuotaError = false;
        k.customCooldown = null;
        k.successCount++;
        k.totalRequests++;

        if (durationMs !== undefined) {
            k.totalLatency += durationMs;
            k.latencySamples++;
            k.averageLatency = k.totalLatency / k.latencySamples;
        }

        this.saveState();
    }

    public markFailed(key: string, classification: ErrorClassification) {
        const k = this.keys.find(x => x.key === key);
        if (!k || k.circuitState === 'DEAD') return;
        if (!classification.markKeyFailed) return;

        k.failedAt = Date.now();
        k.failCount++;
        k.totalRequests++;
        k.isQuotaError = classification.type === 'QUOTA';
        k.customCooldown = classification.cooldownMs || null;

        if (classification.markKeyDead) {
            k.circuitState = 'DEAD';
            console.error(`[Key DEAD] ...${key.slice(-4)} - Permanently removed`);
            this.emit('keyDead', key);
        } else {
            // State Transitions
            if (k.circuitState === 'HALF_OPEN') {
                k.circuitState = 'OPEN';
                k.halfOpenTestTime = Date.now() + CONFIG.HALF_OPEN_TEST_DELAY;
                this.emit('circuitOpen', key);
            } else if (k.failCount >= CONFIG.MAX_CONSECUTIVE_FAILURES || classification.type === 'QUOTA') {
                k.circuitState = 'OPEN';
                k.halfOpenTestTime = Date.now() + (classification.cooldownMs || CONFIG.HALF_OPEN_TEST_DELAY);
                this.emit('circuitOpen', key);
            }
        }
        this.saveState();
    }

    public markFailedLegacy(key: string, isQuota: boolean = false) {
        this.markFailed(key, {
            type: isQuota ? 'QUOTA' : 'TRANSIENT',
            retryable: true,
            cooldownMs: isQuota ? CONFIG.COOLDOWN_QUOTA : CONFIG.COOLDOWN_TRANSIENT,
            markKeyFailed: true,
            markKeyDead: false,
        });
    }

    // ─── Backoff ─────────────────────────────────────────────────────────────

    public calculateBackoff(attempt: number): number {
        const exponential = CONFIG.BASE_BACKOFF * Math.pow(2, attempt);
        const capped = Math.min(exponential, CONFIG.MAX_BACKOFF);
        const jitter = Math.random() * 1000;
        return capped + jitter;
    }

    // ─── Stats ───────────────────────────────────────────────────────────────

    public getStats(): ApiKeyManagerStats {
        const total = this.keys.length;
        const dead = this.keys.filter(k => k.circuitState === 'DEAD').length;
        const cooling = this.keys.filter(k => k.circuitState === 'OPEN' || k.circuitState === 'HALF_OPEN').length;
        const healthy = total - dead - cooling;
        return { total, healthy, cooling, dead };
    }

    public _getKeys(): KeyState[] { return this.keys; }

    // ─── execute() Wrapper ───────────────────────────────────────────────────

    /**
     * Wraps the entire API call lifecycle into a single method.
     *
     * @example
     *   const result = await manager.execute(
     *     (key) => fetch(`https://api.example.com?key=${key}`),
     *     { maxRetries: 3, timeoutMs: 5000 }
     *   );
     */
    public async execute<T>(
        fn: (key: string, signal?: AbortSignal) => Promise<T>,
        options?: ExecuteOptions & { prompt?: string }
    ): Promise<T> {
        const maxRetries = options?.maxRetries ?? 0;
        const timeoutMs = options?.timeoutMs;
        const finishReason = options?.finishReason;
        const prompt = options?.prompt;

        // 1. Semantic Cache Check (Mastermind Edition)
        let currentPromptVector: number[] | null = null;
        if (this.semanticCache && this.getEmbeddingFn && prompt) {
            try {
                currentPromptVector = await this.getEmbeddingFn(prompt);
                const cachedResponse = this.semanticCache.get(currentPromptVector);
                if (cachedResponse !== null) {
                    console.log(`[Semantic Cache HIT] for prompt: "${prompt.slice(0, 30)}..."`);
                    this.emit('executeSuccess', 'CACHE_HIT', 0);
                    return cachedResponse as T;
                }
            } catch (e) {
                console.warn('[Semantic Cache Check Failed] Proceeding to live API', e);
            }
        }

        // 2. Bulkhead check
        if (this.activeCalls >= this.maxConcurrency) {
            this.emit('bulkheadRejected');
            throw new BulkheadRejectionError();
        }

        this.activeCalls++;
        try {
            const result = await this._executeWithRetry(fn, maxRetries, timeoutMs, finishReason);

            // 3. Store in Semantic Cache on success
            if (this.semanticCache && prompt && currentPromptVector) {
                this.semanticCache.set(prompt, currentPromptVector, result);
            }

            return result;
        } finally {
            this.activeCalls--;
        }
    }

    private async _executeWithRetry<T>(
        fn: (key: string, signal?: AbortSignal) => Promise<T>,
        maxRetries: number,
        timeoutMs?: number,
        finishReason?: string
    ): Promise<T> {
        let lastError: any;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const key = this.getKey();

            if (!key) {
                // All keys exhausted — try fallback
                if (this.fallbackFn) {
                    this.emit('fallback', 'all keys exhausted');
                    return this.fallbackFn();
                }
                throw new AllKeysExhaustedError();
            }

            try {
                const start = Date.now();
                let result: T;

                if (timeoutMs) {
                    result = await this._executeWithTimeout(fn, key, timeoutMs);
                } else {
                    result = await fn(key);
                }

                const duration = Date.now() - start;
                this.markSuccess(key, duration);
                this.emit('executeSuccess', key, duration);
                return result;

            } catch (error: any) {
                lastError = error;
                const classification = this.classifyError(error, finishReason);

                this.markFailed(key, classification);
                this.emit('executeFailed', key, error);

                if (!classification.retryable || attempt >= maxRetries) {
                    // Non-retryable or out of retries
                    if (this.fallbackFn && attempt >= maxRetries) {
                        this.emit('fallback', 'max retries exceeded');
                        return this.fallbackFn();
                    }
                    throw error;
                }

                // Retry with backoff
                const delay = this.calculateBackoff(attempt);
                this.emit('retry', key, attempt + 1, delay);
                await this._sleep(delay);
            }
        }

        // Should not reach here, but safety net
        throw lastError;
    }

    private async _executeWithTimeout<T>(
        fn: (key: string, signal?: AbortSignal) => Promise<T>,
        key: string,
        timeoutMs: number
    ): Promise<T> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const result = await Promise.race([
                fn(key, controller.signal),
                new Promise<never>((_, reject) => {
                    controller.signal.addEventListener('abort', () => {
                        reject(new TimeoutError(timeoutMs));
                    });
                })
            ]);
            return result;
        } finally {
            clearTimeout(timer);
        }
    }

    private _sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ─── Health Checks ───────────────────────────────────────────────────────

    /**
     * Set a health check function that tests if a key is operational
     */
    public setHealthCheck(fn: (key: string) => Promise<boolean>) {
        this.healthCheckFn = fn;
    }

    /**
     * Start periodic health checks
     * @param intervalMs How often to run health checks (default: 60s)
     */
    public startHealthChecks(intervalMs: number = 60_000) {
        this.stopHealthChecks(); // Clear any existing interval
        this.healthCheckInterval = setInterval(() => this._runHealthChecks(), intervalMs);
    }

    /**
     * Stop periodic health checks
     */
    public stopHealthChecks() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = undefined;
        }
    }

    private async _runHealthChecks() {
        if (!this.healthCheckFn) return;

        // Check non-DEAD keys that are in OPEN or HALF_OPEN state
        const keysToCheck = this.keys.filter(k =>
            k.circuitState === 'OPEN' || k.circuitState === 'HALF_OPEN'
        );

        for (const k of keysToCheck) {
            try {
                const healthy = await this.healthCheckFn(k.key);
                if (healthy) {
                    this.markSuccess(k.key);
                    this.emit('healthCheckPassed', k.key);
                } else {
                    this.emit('healthCheckFailed', k.key, new Error('Health check returned false'));
                }
            } catch (error) {
                this.emit('healthCheckFailed', k.key, error);
            }
        }
    }

    // ─── Persistence ─────────────────────────────────────────────────────────

    private saveState() {
        if (!this.storage) return;
        const state = this.keys.reduce((acc, k) => ({
            ...acc,
            [k.key]: {
                failCount: k.failCount,
                failedAt: k.failedAt,
                isQuotaError: k.isQuotaError,
                circuitState: k.circuitState,
                lastUsed: k.lastUsed,
                successCount: k.successCount,
                totalRequests: k.totalRequests,
                customCooldown: k.customCooldown,
                weight: k.weight,
                averageLatency: k.averageLatency,
                totalLatency: k.totalLatency,
                latencySamples: k.latencySamples,
                provider: k.provider
            }
        }), {});
        this.storage.setItem(this.storageKey, JSON.stringify(state));
    }

    private loadState() {
        if (!this.storage) return;
        try {
            const raw = this.storage.getItem(this.storageKey);
            if (!raw) return;
            const data = JSON.parse(raw);
            this.keys.forEach(k => {
                if (data[k.key]) Object.assign(k, data[k.key]);
            });
        } catch (e) {
            console.error("Failed to load key state");
        }
    }
}
