# @splashcodex/ApiKeyManager v4.0 — Mastermind Edition

> Universal API Key Rotation System with Resilience, Load Balancing, Semantic Caching & AI Gateway Features

[![npm version](https://img.shields.io/npm/v/@splashcodex/ApiKeyManager)](https://www.npmjs.com/package/@splashcodex/ApiKeyManager)

## Features

- **Circuit Breaker** — Keys transition through `CLOSED → OPEN → HALF_OPEN → DEAD`
- **Error Classification** — Automatic detection of 429 (Quota), 403 (Auth), 5xx (Transient), Timeout, Safety blocks
- **Pluggable Strategies** — `StandardStrategy`, `WeightedStrategy`, `LatencyStrategy`
- **`execute()` Wrapper** — Single method: get key → call → latency → retry → fallback
- **Event Emitter** — Typed lifecycle hooks for monitoring & alerting
- **Auto-Retry with Backoff** — Built-in retry loop with exponential backoff + jitter
- **Request Timeout** — `AbortController`-based timeout per attempt
- **Fallback Function** — Graceful degradation when all keys fail
- **Provider Tagging** — Multi-provider routing (`openai`, `gemini`, etc.)
- **Health Checks** — Periodic key validation and auto-recovery
- **Bulkhead / Concurrency** — Limits concurrent `execute()` calls
- **Semantic Cache** *(v4 NEW)* — Cosine-similarity cache with pluggable embeddings
- **Recursion Guard** *(v4 NEW)* — Prevents infinite loops when `getEmbedding` calls `execute()`
- **State Persistence** — Survives restarts via pluggable storage
- **100% Backward Compatible** — v1.x, v2.x, and v3.x code works without changes

## Installation

```bash
npm install @splashcodex/api-key-manager
```

## Quick Start

```typescript
import { ApiKeyManager } from '@splashcodex/api-key-manager';

// Simple (v1/v2 compatible)
const manager = new ApiKeyManager(['key1', 'key2', 'key3']);
const key = manager.getKey();
manager.markSuccess(key!);

// v3+ — Full power
const result = await manager.execute(
  (key) => fetch(`https://api.example.com?key=${key}`),
  { maxRetries: 3, timeoutMs: 5000 }
);
```

## v4.0 — Semantic Cache (Mastermind Edition)

Automatically cache API responses by semantic similarity. Identical or near-identical prompts return cached results without consuming API quota.

```typescript
import { ApiKeyManager } from '@splashcodex/api-key-manager';

const manager = new ApiKeyManager(['key1', 'key2'], {
  semanticCache: {
    threshold: 0.92,  // 92% cosine similarity to match
    ttlMs: 86400000,  // 24-hour TTL (default)
    getEmbedding: async (text) => {
      // Your embedding function (e.g. OpenAI, Gemini, local model)
      return await myEmbeddingModel.embed(text);
    }
  }
});

// First call → API hit, cached
const r1 = await manager.execute(apiFn, { prompt: 'What is the weather?' });

// Second call → Semantic Cache HIT (no API call)
const r2 = await manager.execute(apiFn, { prompt: 'How is the weather today?' });
```

> **Recursion Guard**: If your `getEmbedding` callback internally calls `execute()`,
> the cache automatically skips on nested calls to prevent infinite recursion.

## execute() Wrapper

Wraps the entire lifecycle into one method:

```typescript
const manager = new ApiKeyManager(keys, {
  storage: localStorage,
  strategy: new WeightedStrategy(),
  fallbackFn: () => cachedResponse,
  concurrency: 10
});

const result = await manager.execute(
  async (key, signal) => {
    const res = await fetch(url, { headers: { 'x-api-key': key }, signal });
    return res.json();
  },
  { maxRetries: 3, timeoutMs: 10000 }
);
// Handles: key selection → cache → timeout → retry → fallback → latency tracking
```

## Event Emitter

Monitor every state change:

```typescript
manager.on('keyDead', (key) => alertTeam(`Key ${key} permanently dead`));
manager.on('circuitOpen', (key) => metrics.increment('circuit_opens'));
manager.on('keyRecovered', (key) => log(`Key ${key} recovered`));
manager.on('retry', (key, attempt, delay) => log(`Retry #${attempt} in ${delay}ms`));
manager.on('fallback', (reason) => log(`Fallback triggered: ${reason}`));
manager.on('allKeysExhausted', () => alert('No healthy keys!'));
manager.on('bulkheadRejected', () => metrics.increment('rejected'));
manager.on('healthCheckPassed', (key) => log(`${key} healthy`));
manager.on('healthCheckFailed', (key, err) => log(`${key} unhealthy`));
```

## Load Balancing Strategies

### Weighted (Cost Optimization)

```typescript
import { ApiKeyManager, WeightedStrategy } from '@splashcodex/api-key-manager';

const manager = new ApiKeyManager(
  [
    { key: 'free-key-1', weight: 1.0 },
    { key: 'free-key-2', weight: 1.0 },
    { key: 'paid-backup', weight: 0.1 },
  ],
  { strategy: new WeightedStrategy() }
);
```

### Latency (Performance)

```typescript
import { ApiKeyManager, LatencyStrategy } from '@splashcodex/api-key-manager';

const manager = new ApiKeyManager(keys, { strategy: new LatencyStrategy() });
// After execute(), latency is tracked automatically
```

## Provider Tagging

Route requests to specific providers:

```typescript
const manager = new ApiKeyManager([
  { key: 'sk-openai-1', weight: 1.0, provider: 'openai' },
  { key: 'sk-openai-2', weight: 1.0, provider: 'openai' },
  { key: 'AIza-gemini',  weight: 0.5, provider: 'gemini' },
]);

const openaiKey = manager.getKeyByProvider('openai');
const geminiKey = manager.getKeyByProvider('gemini');
```

## Health Checks

Proactively detect recovered keys:

```typescript
manager.setHealthCheck(async (key) => {
  const res = await fetch(`https://api.openai.com/v1/models`, {
    headers: { Authorization: `Bearer ${key}` }
  });
  return res.ok;
});

manager.startHealthChecks(60_000); // Check every 60 seconds
// manager.stopHealthChecks();     // Stop when done
```

## Error Handling

```typescript
try {
  const result = await callApi(key);
  manager.markSuccess(key, duration);
} catch (error) {
  const classification = manager.classifyError(error);
  manager.markFailed(key, classification);

  if (classification.retryable) {
    const delay = manager.calculateBackoff(attempt);
    await sleep(delay);
  }
}
```

## API Reference

### Constructor

```typescript
// Legacy (v1/v2)
new ApiKeyManager(keys, storage?, strategy?)

// v3+ Options
new ApiKeyManager(keys, {
  storage?,        // Pluggable storage { getItem, setItem }
  strategy?,       // LoadBalancingStrategy instance
  fallbackFn?,     // () => any — called when all keys exhausted
  concurrency?,    // Max concurrent execute() calls
  semanticCache?,  // v4: { threshold, ttlMs, getEmbedding }
})
```

### Methods

| Method | Description |
|--------|-------------|
| `getKey()` | Returns best available key via strategy |
| `getKeyByProvider(provider)` | Get key filtered by provider tag |
| `markSuccess(key, durationMs?)` | Report success + optional latency |
| `markFailed(key, classification)` | Report failure with error type |
| `classifyError(error, finishReason?)` | Classify an error automatically |
| `execute(fn, options?)` | Full lifecycle wrapper with retry/timeout |
| `calculateBackoff(attempt)` | Get backoff delay with jitter |
| `getStats()` | Get pool health statistics |
| `getKeyCount()` | Count of non-DEAD keys |
| `setHealthCheck(fn)` | Set health check function |
| `startHealthChecks(ms)` | Start periodic health checks |
| `stopHealthChecks()` | Stop health checks |

### Events

| Event | Payload | Trigger |
|-------|---------|---------|
| `keyDead` | `key: string` | Key marked as permanently dead |
| `circuitOpen` | `key: string` | Key circuit opened (cooldown) |
| `circuitHalfOpen` | `key: string` | Key entering test phase |
| `keyRecovered` | `key: string` | Key recovered from failure |
| `fallback` | `reason: string` | Fallback function invoked |
| `allKeysExhausted` | — | All keys dead, no fallback |
| `retry` | `key, attempt, delayMs` | Retry attempt starting |
| `executeSuccess` | `key, durationMs` | execute() completed successfully |
| `executeFailed` | `key, error` | execute() attempt failed |
| `bulkheadRejected` | — | Concurrency limit reached |
| `healthCheckPassed` | `key: string` | Health check succeeded |
| `healthCheckFailed` | `key, error` | Health check failed |

### Custom Errors

| Error | When |
|-------|------|
| `TimeoutError` | Request exceeded `timeoutMs` |
| `BulkheadRejectionError` | Concurrency limit exceeded |
| `AllKeysExhaustedError` | All keys dead, no fallback |

### Strategies

| Strategy | Algorithm | Best For |
|----------|-----------|----------|
| `StandardStrategy` | Least Failures → LRU | General use |
| `WeightedStrategy` | Probabilistic by weight | Cost optimization |
| `LatencyStrategy` | Lowest avg latency | Performance |

## License

ISC
