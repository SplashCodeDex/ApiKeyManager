"use strict";
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
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiKeyManager = exports.SemanticCache = exports.LatencyStrategy = exports.WeightedStrategy = exports.StandardStrategy = exports.AllKeysExhaustedError = exports.BulkheadRejectionError = exports.TimeoutError = exports.ApiKeyManagerOptionsSchema = exports.RedisStorage = exports.MemoryStorage = exports.FileStorage = void 0;
var events_1 = require("events");
var cockatiel_1 = require("cockatiel");
var zod_1 = require("zod");
// ─── Re-exports: Persistence ─────────────────────────────────────────────────
// Persistence adapters can be imported from root or via subpath
var file_1 = require("./persistence/file");
Object.defineProperty(exports, "FileStorage", { enumerable: true, get: function () { return file_1.FileStorage; } });
var memory_1 = require("./persistence/memory");
Object.defineProperty(exports, "MemoryStorage", { enumerable: true, get: function () { return memory_1.MemoryStorage; } });
var redis_1 = require("./persistence/redis");
Object.defineProperty(exports, "RedisStorage", { enumerable: true, get: function () { return redis_1.RedisStorage; } });
exports.ApiKeyManagerOptionsSchema = zod_1.z
    .object({
    storage: zod_1.z.any().optional(),
    strategy: zod_1.z.any().optional(), // Expected: LoadBalancingStrategy
    fallbackFn: zod_1.z.custom(function (val) { return typeof val === 'function'; }, 'Must be a function').optional(),
    /** Max concurrent execute() calls. When limit is reached, excess requests queue (up to concurrencyQueueSize) then reject. */
    concurrency: zod_1.z.number().int().positive().optional(),
    /**
     * Maximum number of requests to hold in the bulkhead queue when all concurrency slots are busy.
     * - Default: `0` — excess requests are rejected immediately (preserves v3 behavior).
     * - Set to a positive number to allow requests to wait for a free slot.
     *
     * @example
     * // Queue up to 10 waiting requests before rejecting
     * new ApiKeyManager(keys, { concurrency: 5, concurrencyQueueSize: 10 })
     */
    concurrencyQueueSize: zod_1.z.number().int().nonnegative().optional(),
    semanticCache: zod_1.z
        .object({
        threshold: zod_1.z.number().min(0).max(1).optional(), // Similarity threshold (0.0 - 1.0, default 0.95)
        ttlMs: zod_1.z.number().int().positive().optional(), // Cache TTL
        getEmbedding: zod_1.z.custom(function (val) { return typeof val === 'function'; }, 'Must be a function'),
    })
        .optional(),
})
    .passthrough();
// ─── Config ──────────────────────────────────────────────────────────────────
var CONFIG = {
    MAX_CONSECUTIVE_FAILURES: 5,
    COOLDOWN_TRANSIENT: 60 * 1000, // 1 minute
    COOLDOWN_QUOTA: 5 * 60 * 1000, // 5 minutes (default if no Retry-After)
    COOLDOWN_QUOTA_DAILY: 60 * 60 * 1000, // 1 hour for RPD exhaustion
    HALF_OPEN_TEST_DELAY: 60 * 1000, // 1 minute after open
    MAX_BACKOFF: 64 * 1000, // 64 seconds max
    BASE_BACKOFF: 1000, // 1 second base
    DEAD_KEY_TTL: 60 * 60 * 1000, // 1 hour — DEAD keys get retested after this
};
// Error classification patterns
var ERROR_PATTERNS = {
    isQuotaError: /429|quota|exhausted|resource.?exhausted|too.?many.?requests|rate.?limit/i,
    isAuthError: /403|permission.?denied|invalid.?api.?key|unauthorized|unauthenticated/i,
    isSafetyBlock: /safety|blocked|recitation|harmful/i,
    isTransient: /500|502|503|504|internal|unavailable|deadline|timeout|overloaded/i,
    isBadRequest: /400|invalid.?argument|failed.?precondition|malformed|not.?found|404/i,
};
// ─── Custom Errors ───────────────────────────────────────────────────────────
var TimeoutError = /** @class */ (function (_super) {
    __extends(TimeoutError, _super);
    function TimeoutError(ms) {
        var _this = _super.call(this, "Request timed out after ".concat(ms, "ms")) || this;
        _this.name = 'TimeoutError';
        return _this;
    }
    return TimeoutError;
}(Error));
exports.TimeoutError = TimeoutError;
var BulkheadRejectionError = /** @class */ (function (_super) {
    __extends(BulkheadRejectionError, _super);
    function BulkheadRejectionError() {
        var _this = _super.call(this, 'Bulkhead capacity exceeded — too many concurrent requests') || this;
        _this.name = 'BulkheadRejectionError';
        return _this;
    }
    return BulkheadRejectionError;
}(Error));
exports.BulkheadRejectionError = BulkheadRejectionError;
var AllKeysExhaustedError = /** @class */ (function (_super) {
    __extends(AllKeysExhaustedError, _super);
    function AllKeysExhaustedError() {
        var _this = _super.call(this, 'All API keys exhausted — no healthy keys available') || this;
        _this.name = 'AllKeysExhaustedError';
        return _this;
    }
    return AllKeysExhaustedError;
}(Error));
exports.AllKeysExhaustedError = AllKeysExhaustedError;
/**
 * Standard Strategy: Least Failed > Least Recently Used
 */
var StandardStrategy = /** @class */ (function () {
    function StandardStrategy() {
    }
    StandardStrategy.prototype.next = function (candidates) {
        candidates.sort(function (a, b) {
            if (a.failCount !== b.failCount)
                return a.failCount - b.failCount;
            return a.lastUsed - b.lastUsed;
        });
        return candidates[0] || null;
    };
    return StandardStrategy;
}());
exports.StandardStrategy = StandardStrategy;
/**
 * Weighted Strategy: Probabilistic selection based on weight
 * Higher weight = Higher chance of selection
 */
var WeightedStrategy = /** @class */ (function () {
    function WeightedStrategy() {
    }
    WeightedStrategy.prototype.next = function (candidates) {
        if (candidates.length === 0)
            return null;
        var totalWeight = candidates.reduce(function (sum, k) { return sum + k.weight; }, 0);
        var random = Math.random() * totalWeight;
        for (var _i = 0, candidates_1 = candidates; _i < candidates_1.length; _i++) {
            var key = candidates_1[_i];
            random -= key.weight;
            if (random <= 0)
                return key;
        }
        return candidates[0]; // Fallback
    };
    return WeightedStrategy;
}());
exports.WeightedStrategy = WeightedStrategy;
/**
 * Latency Strategy: Pick lowest average latency with LRU tie-break
 */
var LatencyStrategy = /** @class */ (function () {
    function LatencyStrategy() {
    }
    LatencyStrategy.prototype.next = function (candidates) {
        if (candidates.length === 0)
            return null;
        candidates.sort(function (a, b) {
            if (a.averageLatency !== b.averageLatency)
                return a.averageLatency - b.averageLatency;
            return a.lastUsed - b.lastUsed; // LRU tie-break
        });
        return candidates[0];
    };
    return LatencyStrategy;
}());
exports.LatencyStrategy = LatencyStrategy;
// ─── Semantic Engine ─────────────────────────────────────────────────────────
/**
 * High-performance Vanilla Semantic Cache
 * Implements Cosine Similarity math from scratch.
 */
var SemanticCache = /** @class */ (function () {
    function SemanticCache(threshold, ttlMs) {
        if (threshold === void 0) { threshold = 0.95; }
        if (ttlMs === void 0) { ttlMs = 24 * 60 * 60 * 1000; }
        this.entries = [];
        this.threshold = threshold;
        this.ttlMs = ttlMs;
    }
    SemanticCache.prototype.set = function (prompt, vector, response) {
        // Expire old entry for same prompt if exists
        this.entries = this.entries.filter(function (e) { return e.prompt !== prompt; });
        this.entries.push({
            prompt: prompt,
            vector: vector,
            response: response,
            timestamp: Date.now(),
        });
        // Optional: Cap size to prevent memory leaks
        if (this.entries.length > 500)
            this.entries.shift();
    };
    SemanticCache.prototype.get = function (vector) {
        var now = Date.now();
        var bestMatch = null;
        var highestSimilarity = -1;
        for (var i = this.entries.length - 1; i >= 0; i--) {
            var entry = this.entries[i];
            // Check TTL
            if (now - entry.timestamp > this.ttlMs) {
                this.entries.splice(i, 1);
                continue;
            }
            var similarity = this.calculateCosineSimilarity(vector, entry.vector);
            if (similarity >= this.threshold && similarity > highestSimilarity) {
                highestSimilarity = similarity;
                bestMatch = entry;
            }
        }
        return bestMatch ? bestMatch.response : null;
    };
    /**
     * Vanilla Cosine Similarity: (A·B) / (||A|| * ||B||)
     */
    SemanticCache.prototype.calculateCosineSimilarity = function (vecA, vecB) {
        if (vecA.length !== vecB.length)
            return 0;
        var dotProduct = 0;
        var normA = 0;
        var normB = 0;
        for (var i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        var denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator === 0 ? 0 : dotProduct / denominator;
    };
    return SemanticCache;
}());
exports.SemanticCache = SemanticCache;
// ─── Main Class ──────────────────────────────────────────────────────────────
var ApiKeyManager = /** @class */ (function (_super) {
    __extends(ApiKeyManager, _super);
    /**
     * Constructor accepts an options object for configuration.
     *
     * @example
     *   new ApiKeyManager(keys, { storage, strategy, fallbackFn, concurrency })
     */
    function ApiKeyManager(initialKeys, options) {
        var _a, _b;
        var _this = _super.call(this) || this;
        _this.keys = [];
        _this.storageKey = 'api_rotation_state_v2';
        // Bulkhead state — managed by cockatiel BulkheadPolicy
        // Provides FIFO queueing (requests wait for a slot) instead of immediate rejection
        _this.bulkheadPolicy = null;
        _this._saveDirty = false;
        _this._isResolvingEmbedding = false; // Recursion guard
        // ─── Backoff ─────────────────────────────────────────────────────────────
        /**
         * Calculate exponential backoff with decorrelated jitter using cockatiel.
         * Decorrelated jitter avoids thundering-herd by randomizing retry intervals
         * independent of the previous delay, which is statistically superior to
         * simple `random * exponential` jitter.
         *
         * @param attempt - Zero-indexed attempt number
         */
        _this._backoffFactory = new cockatiel_1.ExponentialBackoff({
            initialDelay: CONFIG.BASE_BACKOFF,
            maxDelay: CONFIG.MAX_BACKOFF,
            generator: cockatiel_1.decorrelatedJitterGenerator,
        });
        // Normalize to options object
        var opts = options !== null && options !== void 0 ? options : {};
        // Validate options with Zod (will throw meaningful errors on invalid configs)
        opts = exports.ApiKeyManagerOptionsSchema.parse(opts);
        _this.storage = opts.storage || {
            getItem: function () { return null; },
            setItem: function () { },
        };
        _this.strategy = opts.strategy || new StandardStrategy();
        _this.fallbackFn = opts.fallbackFn;
        // Build cockatiel bulkhead.
        // queueSize defaults to 0 (immediate rejection — preserves existing API contract).
        // Set concurrencyQueueSize > 0 to opt-in to queuing instead of rejection.
        var maxConcurrency = (_a = opts.concurrency) !== null && _a !== void 0 ? _a : Infinity;
        var queueSize = (_b = opts.concurrencyQueueSize) !== null && _b !== void 0 ? _b : 0;
        if (maxConcurrency !== Infinity) {
            _this.bulkheadPolicy = (0, cockatiel_1.bulkhead)(maxConcurrency, queueSize);
            _this.bulkheadPolicy.onReject(function () {
                _this.emit('bulkheadRejected');
            });
        }
        // Init Semantic Cache if provided
        if (opts.semanticCache) {
            _this.semanticCache = new SemanticCache(opts.semanticCache.threshold, opts.semanticCache.ttlMs);
            _this.getEmbeddingFn = opts.semanticCache.getEmbedding;
        }
        // Normalize input to objects
        var inputKeys = [];
        if (initialKeys.length > 0 && typeof initialKeys[0] === 'string') {
            inputKeys = initialKeys.flatMap(function (k) {
                return k.split(',').map(function (s) { return ({ key: s.trim(), weight: 1.0, provider: 'default' }); });
            });
        }
        else {
            inputKeys = initialKeys;
        }
        // Deduplicate
        var uniqueMap = new Map();
        inputKeys.forEach(function (k) {
            var _a, _b;
            if (k.key.length > 0)
                uniqueMap.set(k.key, { weight: (_a = k.weight) !== null && _a !== void 0 ? _a : 1.0, provider: (_b = k.provider) !== null && _b !== void 0 ? _b : 'default' });
        });
        if (uniqueMap.size < inputKeys.length) {
            console.warn("[ApiKeyManager] Removed ".concat(inputKeys.length - uniqueMap.size, " duplicate/empty keys."));
        }
        _this.keys = Array.from(uniqueMap.entries()).map(function (_a) {
            var key = _a[0], meta = _a[1];
            return ({
                key: key,
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
            });
        });
        if (!_this.storage.isAsync) {
            _this.loadState();
        }
        return _this;
    }
    // ─── Error Classification ────────────────────────────────────────────────
    /**
     * CLASSIFIES an error to determine handling strategy
     */
    ApiKeyManager.prototype.classifyError = function (error, finishReason) {
        var _a, _b;
        var status = (error === null || error === void 0 ? void 0 : error.status) || ((_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status);
        var message = (error === null || error === void 0 ? void 0 : error.message) || ((_b = error === null || error === void 0 ? void 0 : error.error) === null || _b === void 0 ? void 0 : _b.message) || String(error);
        // 1. Check finishReason first
        if (finishReason === 'SAFETY')
            return { type: 'SAFETY', retryable: false, cooldownMs: 0, markKeyFailed: false, markKeyDead: false };
        if (finishReason === 'RECITATION')
            return { type: 'RECITATION', retryable: false, cooldownMs: 0, markKeyFailed: false, markKeyDead: false };
        // 2. Check timeout
        if (error instanceof TimeoutError || (error === null || error === void 0 ? void 0 : error.name) === 'TimeoutError') {
            return {
                type: 'TIMEOUT',
                retryable: true,
                cooldownMs: CONFIG.COOLDOWN_TRANSIENT,
                markKeyFailed: true,
                markKeyDead: false,
            };
        }
        // 3. Check HTTP status codes
        if (status === 403 || ERROR_PATTERNS.isAuthError.test(message)) {
            return { type: 'AUTH', retryable: false, cooldownMs: Infinity, markKeyFailed: true, markKeyDead: true };
        }
        if (status === 429 || ERROR_PATTERNS.isQuotaError.test(message)) {
            var retryAfter = this.parseRetryAfter(error);
            return {
                type: 'QUOTA',
                retryable: true,
                cooldownMs: retryAfter || CONFIG.COOLDOWN_QUOTA,
                markKeyFailed: true,
                markKeyDead: false,
            };
        }
        if (status === 400 || ERROR_PATTERNS.isBadRequest.test(message)) {
            return { type: 'BAD_REQUEST', retryable: false, cooldownMs: 0, markKeyFailed: false, markKeyDead: false };
        }
        if (ERROR_PATTERNS.isTransient.test(message) || [500, 502, 503, 504].includes(status)) {
            return {
                type: 'TRANSIENT',
                retryable: true,
                cooldownMs: CONFIG.COOLDOWN_TRANSIENT,
                markKeyFailed: true,
                markKeyDead: false,
            };
        }
        return {
            type: 'UNKNOWN',
            retryable: true,
            cooldownMs: CONFIG.COOLDOWN_TRANSIENT,
            markKeyFailed: true,
            markKeyDead: false,
        };
    };
    ApiKeyManager.prototype.parseRetryAfter = function (error) {
        var _a, _b, _c;
        var retryAfter = ((_b = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.headers) === null || _b === void 0 ? void 0 : _b['retry-after']) || ((_c = error === null || error === void 0 ? void 0 : error.headers) === null || _c === void 0 ? void 0 : _c['retry-after']) || (error === null || error === void 0 ? void 0 : error.retryAfter);
        if (!retryAfter)
            return null;
        var seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds))
            return seconds * 1000;
        var date = Date.parse(retryAfter);
        if (!isNaN(date))
            return Math.max(0, date - Date.now());
        return null;
    };
    // ─── Cooldown ────────────────────────────────────────────────────────────
    ApiKeyManager.prototype.isOnCooldown = function (k) {
        if (k.circuitState === 'DEAD')
            return true;
        var now = Date.now();
        if (k.circuitState === 'OPEN') {
            if (k.halfOpenTestTime && now >= k.halfOpenTestTime) {
                k.circuitState = 'HALF_OPEN';
                this.emit('circuitHalfOpen', k.key);
                return false;
            }
            return true;
        }
        if (k.failedAt) {
            if (k.customCooldown && now - k.failedAt < k.customCooldown)
                return true;
            var cooldown = k.isQuotaError ? CONFIG.COOLDOWN_QUOTA : CONFIG.COOLDOWN_TRANSIENT;
            if (now - k.failedAt < cooldown)
                return true;
        }
        return false;
    };
    // ─── Key Selection ───────────────────────────────────────────────────────
    ApiKeyManager.prototype.getKey = function () {
        var _this = this;
        var _a;
        // 1. Filter out dead and cooling down keys
        var candidates = this.keys.filter(function (k) { return k.circuitState !== 'DEAD' && !_this.isOnCooldown(k); });
        if (candidates.length === 0) {
            // FALLBACK: Return oldest failed key (excluding DEAD)
            var nonDead = this.keys.filter(function (k) { return k.circuitState !== 'DEAD'; });
            if (nonDead.length === 0) {
                this.emit('allKeysExhausted');
                return null;
            }
            return ((_a = nonDead.sort(function (a, b) { return (a.failedAt || 0) - (b.failedAt || 0); })[0]) === null || _a === void 0 ? void 0 : _a.key) || null;
        }
        // 2. Delegate to Strategy
        var selected = this.strategy.next(candidates);
        if (selected) {
            selected.lastUsed = Date.now();
            this.saveState();
            return selected.key;
        }
        return null;
    };
    /**
     * Get a key filtered by provider tag
     */
    ApiKeyManager.prototype.getKeyByProvider = function (provider) {
        var _this = this;
        var candidates = this.keys.filter(function (k) { return k.provider === provider && k.circuitState !== 'DEAD' && !_this.isOnCooldown(k); });
        if (candidates.length === 0)
            return null;
        var selected = this.strategy.next(candidates);
        if (selected) {
            selected.lastUsed = Date.now();
            this.saveState();
            return selected.key;
        }
        return null;
    };
    ApiKeyManager.prototype.getKeyCount = function () {
        return this.keys.filter(function (k) { return k.circuitState !== 'DEAD'; }).length;
    };
    // ─── Mark Success / Failed ───────────────────────────────────────────────
    /**
     * Mark success AND update latency stats
     * @param durationMs Duration of the request in milliseconds
     */
    ApiKeyManager.prototype.markSuccess = function (key, durationMs) {
        var k = this.keys.find(function (x) { return x.key === key; });
        if (!k)
            return;
        var wasRecovering = k.circuitState !== 'CLOSED' && k.circuitState !== 'DEAD';
        if (wasRecovering) {
            console.log("[Key Recovered] ...".concat(key.slice(-4)));
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
    };
    ApiKeyManager.prototype.markFailed = function (key, classification) {
        var k = this.keys.find(function (x) { return x.key === key; });
        if (!k || k.circuitState === 'DEAD')
            return;
        if (!classification.markKeyFailed)
            return;
        k.failedAt = Date.now();
        k.failCount++;
        k.totalRequests++;
        k.isQuotaError = classification.type === 'QUOTA';
        k.customCooldown = classification.cooldownMs || null;
        if (classification.markKeyDead) {
            k.circuitState = 'DEAD';
            console.error("[Key DEAD] ...".concat(key.slice(-4), " - Permanently removed"));
            this.emit('keyDead', key);
        }
        else {
            // State Transitions
            if (k.circuitState === 'HALF_OPEN') {
                k.circuitState = 'OPEN';
                k.halfOpenTestTime = Date.now() + CONFIG.HALF_OPEN_TEST_DELAY;
                this.emit('circuitOpen', key);
            }
            else if (k.failCount >= CONFIG.MAX_CONSECUTIVE_FAILURES || classification.type === 'QUOTA') {
                k.circuitState = 'OPEN';
                k.halfOpenTestTime = Date.now() + (classification.cooldownMs || CONFIG.HALF_OPEN_TEST_DELAY);
                this.emit('circuitOpen', key);
            }
        }
        this.saveState();
    };
    ApiKeyManager.prototype.calculateBackoff = function (attempt) {
        // ExponentialBackoff is a linked-list: _backoffFactory.next() returns an
        // IBackoff node with { duration, next() }. Walk `attempt` steps to get
        // the correctly scaled delay. Uses decorrelated jitter (superior to random*exp).
        // We cast via `any` to bypass the interface vs concrete class arg-count conflict.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        var node = this._backoffFactory.next();
        for (var i = 0; i < attempt; i++) {
            node = node.next();
        }
        return node.duration;
    };
    // ─── Stats ───────────────────────────────────────────────────────────────
    ApiKeyManager.prototype.getStats = function () {
        var total = this.keys.length;
        var dead = this.keys.filter(function (k) { return k.circuitState === 'DEAD'; }).length;
        var cooling = this.keys.filter(function (k) { return k.circuitState === 'OPEN' || k.circuitState === 'HALF_OPEN'; }).length;
        var healthy = total - dead - cooling;
        return { total: total, healthy: healthy, cooling: cooling, dead: dead };
    };
    ApiKeyManager.prototype._getKeys = function () {
        return this.keys;
    };
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
    ApiKeyManager.prototype.execute = function (fn, options) {
        return __awaiter(this, void 0, void 0, function () {
            var maxRetries, timeoutMs, finishReason, prompt, provider, currentPromptVector, cachedResponse, e_1, result, err_1;
            var _this = this;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        maxRetries = (_a = options === null || options === void 0 ? void 0 : options.maxRetries) !== null && _a !== void 0 ? _a : 0;
                        timeoutMs = options === null || options === void 0 ? void 0 : options.timeoutMs;
                        finishReason = options === null || options === void 0 ? void 0 : options.finishReason;
                        prompt = options === null || options === void 0 ? void 0 : options.prompt;
                        provider = options === null || options === void 0 ? void 0 : options.provider;
                        currentPromptVector = null;
                        if (!(this.semanticCache && this.getEmbeddingFn && prompt && !this._isResolvingEmbedding)) return [3 /*break*/, 5];
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, 4, 5]);
                        this._isResolvingEmbedding = true;
                        return [4 /*yield*/, this.getEmbeddingFn(prompt)];
                    case 2:
                        currentPromptVector = _b.sent();
                        cachedResponse = this.semanticCache.get(currentPromptVector);
                        if (cachedResponse !== null) {
                            console.log("[Semantic Cache HIT] for prompt: \"".concat(prompt.slice(0, 30), "...\""));
                            this.emit('executeSuccess', 'CACHE_HIT', 0);
                            return [2 /*return*/, cachedResponse];
                        }
                        return [3 /*break*/, 5];
                    case 3:
                        e_1 = _b.sent();
                        console.warn('[Semantic Cache Check Failed] Proceeding to live API', e_1);
                        return [3 /*break*/, 5];
                    case 4:
                        this._isResolvingEmbedding = false;
                        return [7 /*endfinally*/];
                    case 5:
                        if (!this.bulkheadPolicy) return [3 /*break*/, 9];
                        _b.label = 6;
                    case 6:
                        _b.trys.push([6, 8, , 9]);
                        return [4 /*yield*/, this.bulkheadPolicy.execute(function () { return __awaiter(_this, void 0, void 0, function () {
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0: return [4 /*yield*/, this._executeWithSemanticAndRetry(fn, maxRetries, timeoutMs, finishReason, provider, prompt, currentPromptVector)];
                                        case 1: return [2 /*return*/, _a.sent()];
                                    }
                                });
                            }); })];
                    case 7:
                        result = _b.sent();
                        return [2 /*return*/, result];
                    case 8:
                        err_1 = _b.sent();
                        if (err_1 instanceof cockatiel_1.BulkheadRejectedError) {
                            throw new BulkheadRejectionError();
                        }
                        throw err_1;
                    case 9: 
                    // No concurrency limit configured — run directly
                    return [2 /*return*/, this._executeWithSemanticAndRetry(fn, maxRetries, timeoutMs, finishReason, provider, prompt, currentPromptVector)];
                }
            });
        });
    };
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
    ApiKeyManager.prototype.executeStream = function (fn, options) {
        return __asyncGenerator(this, arguments, function executeStream_1() {
            var maxRetries, timeoutMs, finishReason, prompt, provider, currentPromptVector, cachedResponse, _i, cachedResponse_1, chunk, e_2, useBulkhead, slots, hasSlot, accumulatedChunks, lastError, attempt, key, iterator, firstResult, _a, iterator_1, iterator_1_1, chunk, e_3_1, error_1, classification, delay;
            var _b, e_3, _c, _d;
            var _e;
            return __generator(this, function (_f) {
                switch (_f.label) {
                    case 0:
                        maxRetries = (_e = options === null || options === void 0 ? void 0 : options.maxRetries) !== null && _e !== void 0 ? _e : 0;
                        timeoutMs = options === null || options === void 0 ? void 0 : options.timeoutMs;
                        finishReason = options === null || options === void 0 ? void 0 : options.finishReason;
                        prompt = options === null || options === void 0 ? void 0 : options.prompt;
                        provider = options === null || options === void 0 ? void 0 : options.provider;
                        currentPromptVector = null;
                        if (!(this.semanticCache && this.getEmbeddingFn && prompt && !this._isResolvingEmbedding)) return [3 /*break*/, 16];
                        _f.label = 1;
                    case 1:
                        _f.trys.push([1, 14, 15, 16]);
                        this._isResolvingEmbedding = true;
                        return [4 /*yield*/, __await(this.getEmbeddingFn(prompt))];
                    case 2:
                        currentPromptVector = _f.sent();
                        cachedResponse = this.semanticCache.get(currentPromptVector);
                        if (!(cachedResponse !== null)) return [3 /*break*/, 13];
                        console.log("[Semantic Cache HIT] Streaming cached response for prompt: \"".concat(prompt.slice(0, 30), "...\""));
                        this.emit('executeSuccess', 'CACHE_HIT_STREAM', 0);
                        if (!Array.isArray(cachedResponse)) return [3 /*break*/, 8];
                        _i = 0, cachedResponse_1 = cachedResponse;
                        _f.label = 3;
                    case 3:
                        if (!(_i < cachedResponse_1.length)) return [3 /*break*/, 7];
                        chunk = cachedResponse_1[_i];
                        return [4 /*yield*/, __await(chunk)];
                    case 4: return [4 /*yield*/, _f.sent()];
                    case 5:
                        _f.sent();
                        _f.label = 6;
                    case 6:
                        _i++;
                        return [3 /*break*/, 3];
                    case 7: return [3 /*break*/, 11];
                    case 8: return [4 /*yield*/, __await(cachedResponse)];
                    case 9: return [4 /*yield*/, _f.sent()];
                    case 10:
                        _f.sent();
                        _f.label = 11;
                    case 11: return [4 /*yield*/, __await(void 0)];
                    case 12: return [2 /*return*/, _f.sent()];
                    case 13: return [3 /*break*/, 16];
                    case 14:
                        e_2 = _f.sent();
                        console.warn('[Semantic Cache Check Failed] Proceeding to live stream', e_2);
                        return [3 /*break*/, 16];
                    case 15:
                        this._isResolvingEmbedding = false;
                        return [7 /*endfinally*/];
                    case 16:
                        useBulkhead = this.bulkheadPolicy !== null;
                        if (useBulkhead) {
                            slots = this.bulkheadPolicy;
                            hasSlot = slots.executionSlots > 0 || slots.queueSlots > 0;
                            if (!hasSlot) {
                                this.emit('bulkheadRejected');
                                throw new BulkheadRejectionError();
                            }
                        }
                        accumulatedChunks = [];
                        _f.label = 17;
                    case 17:
                        _f.trys.push([17, , 54, 55]);
                        attempt = 0;
                        _f.label = 18;
                    case 18:
                        if (!(attempt <= maxRetries)) return [3 /*break*/, 53];
                        key = provider ? this.getKeyByProvider(provider) : this.getKey();
                        if (!!key) return [3 /*break*/, 23];
                        if (!this.fallbackFn) return [3 /*break*/, 22];
                        this.emit('fallback', 'all keys exhausted (stream)');
                        return [4 /*yield*/, __await(this.fallbackFn())];
                    case 19: return [4 /*yield*/, _f.sent()];
                    case 20:
                        _f.sent();
                        return [4 /*yield*/, __await(void 0)];
                    case 21: return [2 /*return*/, _f.sent()];
                    case 22: throw new AllKeysExhaustedError();
                    case 23:
                        iterator = void 0;
                        _f.label = 24;
                    case 24:
                        _f.trys.push([24, 45, , 52]);
                        // Start the generator
                        iterator = fn(key);
                        return [4 /*yield*/, __await(iterator.next())];
                    case 25:
                        firstResult = _f.sent();
                        if (!firstResult.done) return [3 /*break*/, 27];
                        return [4 /*yield*/, __await(void 0)];
                    case 26: return [2 /*return*/, _f.sent()];
                    case 27: return [4 /*yield*/, __await(firstResult.value)];
                    case 28: 
                    // Yield first chunk
                    return [4 /*yield*/, _f.sent()];
                    case 29:
                        // Yield first chunk
                        _f.sent();
                        if (this.semanticCache && prompt)
                            accumulatedChunks.push(firstResult.value);
                        _f.label = 30;
                    case 30:
                        _f.trys.push([30, 37, 38, 43]);
                        _a = true, iterator_1 = (e_3 = void 0, __asyncValues(iterator));
                        _f.label = 31;
                    case 31: return [4 /*yield*/, __await(iterator_1.next())];
                    case 32:
                        if (!(iterator_1_1 = _f.sent(), _b = iterator_1_1.done, !_b)) return [3 /*break*/, 36];
                        _d = iterator_1_1.value;
                        _a = false;
                        chunk = _d;
                        return [4 /*yield*/, __await(chunk)];
                    case 33: return [4 /*yield*/, _f.sent()];
                    case 34:
                        _f.sent();
                        if (this.semanticCache && prompt)
                            accumulatedChunks.push(chunk);
                        _f.label = 35;
                    case 35:
                        _a = true;
                        return [3 /*break*/, 31];
                    case 36: return [3 /*break*/, 43];
                    case 37:
                        e_3_1 = _f.sent();
                        e_3 = { error: e_3_1 };
                        return [3 /*break*/, 43];
                    case 38:
                        _f.trys.push([38, , 41, 42]);
                        if (!(!_a && !_b && (_c = iterator_1.return))) return [3 /*break*/, 40];
                        return [4 /*yield*/, __await(_c.call(iterator_1))];
                    case 39:
                        _f.sent();
                        _f.label = 40;
                    case 40: return [3 /*break*/, 42];
                    case 41:
                        if (e_3) throw e_3.error;
                        return [7 /*endfinally*/];
                    case 42: return [7 /*endfinally*/];
                    case 43:
                        // Success! Store in cache
                        if (this.semanticCache && prompt && currentPromptVector && accumulatedChunks.length > 0) {
                            this.semanticCache.set(prompt, currentPromptVector, accumulatedChunks);
                        }
                        return [4 /*yield*/, __await(void 0)];
                    case 44: return [2 /*return*/, _f.sent()]; // Full success, exit retry loop
                    case 45:
                        error_1 = _f.sent();
                        lastError = error_1;
                        classification = this.classifyError(error_1, finishReason);
                        this.markFailed(key, classification);
                        this.emit('executeFailed', key, error_1);
                        // Note: If we already yielded the FIRST chunk, we CANNOT retry the connection
                        // because the user has already received data. Mid-stream failures propagate.
                        if (accumulatedChunks.length > 0) {
                            throw error_1;
                        }
                        if (!(!classification.retryable || attempt >= maxRetries)) return [3 /*break*/, 50];
                        if (!(this.fallbackFn && attempt >= maxRetries)) return [3 /*break*/, 49];
                        this.emit('fallback', 'max retries exceeded (stream)');
                        return [4 /*yield*/, __await(this.fallbackFn())];
                    case 46: return [4 /*yield*/, _f.sent()];
                    case 47:
                        _f.sent();
                        return [4 /*yield*/, __await(void 0)];
                    case 48: return [2 /*return*/, _f.sent()];
                    case 49: throw error_1;
                    case 50:
                        delay = this.calculateBackoff(attempt);
                        this.emit('retry', key, attempt + 1, delay);
                        return [4 /*yield*/, __await(this._sleep(delay))];
                    case 51:
                        _f.sent();
                        return [3 /*break*/, 52];
                    case 52:
                        attempt++;
                        return [3 /*break*/, 18];
                    case 53: return [3 /*break*/, 55];
                    case 54: return [7 /*endfinally*/];
                    case 55: throw lastError;
                }
            });
        });
    };
    /**
     * Helper: stores result in semantic cache then returns it.
     * Called by the bulkhead execute() callback and the no-bulkhead path.
     */
    ApiKeyManager.prototype._executeWithSemanticAndRetry = function (fn, maxRetries, timeoutMs, finishReason, provider, prompt, currentPromptVector) {
        return __awaiter(this, void 0, void 0, function () {
            var result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this._executeWithRetry(fn, maxRetries, timeoutMs, finishReason, provider)];
                    case 1:
                        result = _a.sent();
                        // Store in Semantic Cache on success
                        if (this.semanticCache && prompt && currentPromptVector) {
                            this.semanticCache.set(prompt, currentPromptVector, result);
                        }
                        return [2 /*return*/, result];
                }
            });
        });
    };
    ApiKeyManager.prototype._executeWithRetry = function (fn, maxRetries, timeoutMs, finishReason, provider) {
        return __awaiter(this, void 0, void 0, function () {
            var lastError, attempt, key, start, result, duration, error_2, classification, delay;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        attempt = 0;
                        _a.label = 1;
                    case 1:
                        if (!(attempt <= maxRetries)) return [3 /*break*/, 10];
                        key = provider ? this.getKeyByProvider(provider) : this.getKey();
                        if (!key) {
                            // All keys exhausted — try fallback
                            if (this.fallbackFn) {
                                this.emit('fallback', 'all keys exhausted');
                                return [2 /*return*/, this.fallbackFn()];
                            }
                            throw new AllKeysExhaustedError();
                        }
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 7, , 9]);
                        start = Date.now();
                        result = void 0;
                        if (!timeoutMs) return [3 /*break*/, 4];
                        return [4 /*yield*/, this._executeWithTimeout(fn, key, timeoutMs)];
                    case 3:
                        result = _a.sent();
                        return [3 /*break*/, 6];
                    case 4: return [4 /*yield*/, fn(key)];
                    case 5:
                        result = _a.sent();
                        _a.label = 6;
                    case 6:
                        duration = Date.now() - start;
                        this.markSuccess(key, duration);
                        this.emit('executeSuccess', key, duration);
                        return [2 /*return*/, result];
                    case 7:
                        error_2 = _a.sent();
                        lastError = error_2;
                        classification = this.classifyError(error_2, finishReason);
                        this.markFailed(key, classification);
                        this.emit('executeFailed', key, error_2);
                        if (!classification.retryable || attempt >= maxRetries) {
                            // Non-retryable or out of retries
                            if (this.fallbackFn && attempt >= maxRetries) {
                                this.emit('fallback', 'max retries exceeded');
                                return [2 /*return*/, this.fallbackFn()];
                            }
                            throw error_2;
                        }
                        delay = this.calculateBackoff(attempt);
                        this.emit('retry', key, attempt + 1, delay);
                        return [4 /*yield*/, this._sleep(delay)];
                    case 8:
                        _a.sent();
                        return [3 /*break*/, 9];
                    case 9:
                        attempt++;
                        return [3 /*break*/, 1];
                    case 10: 
                    // Should not reach here, but safety net
                    throw lastError;
                }
            });
        });
    };
    ApiKeyManager.prototype._executeWithTimeout = function (fn, key, timeoutMs) {
        return __awaiter(this, void 0, void 0, function () {
            var controller, timer, result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        controller = new AbortController();
                        timer = setTimeout(function () { return controller.abort(); }, timeoutMs);
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, , 3, 4]);
                        return [4 /*yield*/, Promise.race([
                                fn(key, controller.signal),
                                new Promise(function (_, reject) {
                                    controller.signal.addEventListener('abort', function () {
                                        reject(new TimeoutError(timeoutMs));
                                    });
                                }),
                            ])];
                    case 2:
                        result = _a.sent();
                        return [2 /*return*/, result];
                    case 3:
                        clearTimeout(timer);
                        return [7 /*endfinally*/];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    ApiKeyManager.prototype._sleep = function (ms) {
        return new Promise(function (resolve) {
            var timer = setTimeout(resolve, ms);
            if (timer.unref)
                timer.unref();
        });
    };
    // ─── Health Checks ───────────────────────────────────────────────────────
    /**
     * Set a health check function that tests if a key is operational
     */
    ApiKeyManager.prototype.setHealthCheck = function (fn) {
        this.healthCheckFn = fn;
    };
    /**
     * Start periodic health checks
     * @param intervalMs How often to run health checks (default: 60s)
     */
    ApiKeyManager.prototype.startHealthChecks = function (intervalMs) {
        var _this = this;
        if (intervalMs === void 0) { intervalMs = 60000; }
        this.stopHealthChecks(); // Clear any existing interval
        this.healthCheckInterval = setInterval(function () { return _this._runHealthChecks(); }, intervalMs);
        if (this.healthCheckInterval.unref)
            this.healthCheckInterval.unref();
    };
    /**
     * Stop periodic health checks
     */
    ApiKeyManager.prototype.stopHealthChecks = function () {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = undefined;
        }
        // Flush any pending state to disk on shutdown
        this._flushState();
    };
    ApiKeyManager.prototype._runHealthChecks = function () {
        return __awaiter(this, void 0, void 0, function () {
            var keysToCheck, _i, keysToCheck_1, k, healthy, error_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.healthCheckFn)
                            return [2 /*return*/];
                        keysToCheck = this.keys.filter(function (k) { return k.circuitState === 'OPEN' || k.circuitState === 'HALF_OPEN'; });
                        _i = 0, keysToCheck_1 = keysToCheck;
                        _a.label = 1;
                    case 1:
                        if (!(_i < keysToCheck_1.length)) return [3 /*break*/, 6];
                        k = keysToCheck_1[_i];
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, this.healthCheckFn(k.key)];
                    case 3:
                        healthy = _a.sent();
                        if (healthy) {
                            this.markSuccess(k.key);
                            this.emit('healthCheckPassed', k.key);
                        }
                        else {
                            this.emit('healthCheckFailed', k.key, new Error('Health check returned false'));
                        }
                        return [3 /*break*/, 5];
                    case 4:
                        error_3 = _a.sent();
                        this.emit('healthCheckFailed', k.key, error_3);
                        return [3 /*break*/, 5];
                    case 5:
                        _i++;
                        return [3 /*break*/, 1];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    // ─── Persistence ─────────────────────────────────────────────────────────
    /**
     * Debounced save — marks state as dirty and flushes after 500ms of inactivity.
     * Under heavy load (multiple getKey/markSuccess/markFailed calls), this coalesces
     * dozens of writeFileSync calls into one.
     */
    ApiKeyManager.prototype.saveState = function () {
        var _this = this;
        if (!this.storage)
            return;
        this._saveDirty = true;
        if (!this._saveTimer) {
            this._saveTimer = setTimeout(function () {
                _this._flushState();
                _this._saveTimer = undefined;
            }, 500);
            if (this._saveTimer.unref)
                this._saveTimer.unref();
        }
    };
    /**
     * Immediately flush state to storage. Called by the debounce timer
     * and by stopHealthChecks() to ensure clean shutdown.
     */
    ApiKeyManager.prototype.flushState = function () {
        this._flushState();
    };
    ApiKeyManager.prototype._flushState = function () {
        if (!this._saveDirty || !this.storage)
            return;
        this._saveDirty = false;
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = undefined;
        }
        var state = this.keys.reduce(function (acc, k) {
            var _a;
            return (__assign(__assign({}, acc), (_a = {}, _a[k.key] = {
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
                provider: k.provider,
            }, _a)));
        }, {});
        var serialized = JSON.stringify(state);
        if (this.storage.isAsync) {
            // Fire and forget for async storage to avoid blocking the main thread,
            // but catch errors to prevent unhandled promise rejections.
            Promise.resolve(this.storage.setItem(this.storageKey, serialized)).catch(function (err) {
                console.error('[ApiKeyManager] Async storage setItem failed:', err);
            });
        }
        else {
            try {
                this.storage.setItem(this.storageKey, serialized);
            }
            catch (err) {
                console.error('[ApiKeyManager] Sync storage setItem failed:', err);
            }
        }
    };
    ApiKeyManager.prototype.loadState = function () {
        if (!this.storage)
            return;
        try {
            var raw = this.storage.getItem(this.storageKey);
            if (!raw)
                return;
            this._applyState(raw);
        }
        catch (e) {
            console.error('[ApiKeyManager] Failed to load key state synchronously:', e);
        }
    };
    /**
     * Call this after instantiating ApiKeyManager if you are using an async storage adapter (e.g. Redis).
     */
    ApiKeyManager.prototype.init = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!(this.storage && this.storage.isAsync)) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.loadStateAsync()];
                    case 1:
                        _a.sent();
                        _a.label = 2;
                    case 2: return [2 /*return*/];
                }
            });
        });
    };
    ApiKeyManager.prototype.loadStateAsync = function () {
        return __awaiter(this, void 0, void 0, function () {
            var raw, e_4;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.storage)
                            return [2 /*return*/];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this.storage.getItem(this.storageKey)];
                    case 2:
                        raw = _a.sent();
                        if (!raw)
                            return [2 /*return*/];
                        this._applyState(raw);
                        return [3 /*break*/, 4];
                    case 3:
                        e_4 = _a.sent();
                        console.error('[ApiKeyManager] Failed to load key state asynchronously:', e_4);
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    ApiKeyManager.prototype._applyState = function (raw) {
        try {
            var data_1 = JSON.parse(raw);
            var now_1 = Date.now();
            this.keys.forEach(function (k) {
                if (!data_1[k.key])
                    return;
                Object.assign(k, data_1[k.key]);
                // Resurrect DEAD keys that have exceeded the TTL.
                // This allows keys that were marked dead (e.g., temporary 403)
                // to be retested after a cooldown period instead of staying dead forever.
                if (k.circuitState === 'DEAD' && k.failedAt) {
                    var deadDuration = now_1 - k.failedAt;
                    if (deadDuration >= CONFIG.DEAD_KEY_TTL) {
                        k.circuitState = 'HALF_OPEN';
                        k.halfOpenTestTime = null; // Allow immediate test
                        k.failCount = 0;
                    }
                }
                // Clear stale cooldowns from previous sessions.
                // If a key was cooling down and the process restarted after the
                // cooldown would have expired, reset it to CLOSED.
                if (k.circuitState === 'OPEN' && k.failedAt) {
                    var cooldown = k.customCooldown || (k.isQuotaError ? CONFIG.COOLDOWN_QUOTA : CONFIG.COOLDOWN_TRANSIENT);
                    if (now_1 - k.failedAt >= cooldown) {
                        k.circuitState = 'HALF_OPEN';
                        k.halfOpenTestTime = null;
                    }
                }
            });
        }
        catch (e) {
            console.error('[ApiKeyManager] Failed to parse key state:', e);
        }
    };
    return ApiKeyManager;
}(events_1.EventEmitter));
exports.ApiKeyManager = ApiKeyManager;
