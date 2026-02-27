# @splashcodex/ApiKeyManager v5.0 — Ecosystem Edition

> Universal API Key Management Gateway with Provider Presets, Built-in Persistence, and Multi-Provider Vault.

[![npm version](https://img.shields.io/npm/v/@splashcodex/ApiKeyManager)](https://www.npmjs.com/package/@splashcodex/ApiKeyManager)

## New in v5.0 (Ecosystem Edition)

- **Provider Presets** — One-line setup for `GeminiManager`, `OpenAIManager`, and `MultiManager`.
- **Automatic Env Parsing** — Reads `GOOGLE_GEMINI_API_KEY`, `OPENAI_API_KEY`, etc. (supports JSON arrays and comma-separated strings).
- **Built-in Persistence** — `FileStorage` (survives restarts) and `MemoryStorage` included.
- **Singleton Pattern** — Thread-safe singletons with `getInstance()` and `Result<T>` pattern.
- **Multi-Provider Vault** — Manage multiple providers (`gemini`, `openai`, `anthropic`) from a single entry point.

## Features

- **Circuit Breaker** — Keys transition through `CLOSED → OPEN → HALF_OPEN → DEAD`
- **Error Classification** — Automatic detection of 429 (Quota), 403 (Auth), 5xx (Transient), Timeout, Safety blocks
- **Pluggable Strategies** — `StandardStrategy`, `WeightedStrategy`, `LatencyStrategy`
- **`execute()` Wrapper** — Single method: get key → call → latency → retry → fallback
- **Event Emitter** — Typed lifecycle hooks for monitoring & alerting
- **Auto-Retry with Backoff** — Built-in retry loop with exponential backoff + jitter
- **Semantic Cache** — Cosine-similarity cache with pluggable embeddings
- **Streaming Support** — `executeStream()` with initial retry + cache replay
- **100% Backward Compatible** — v1.x through v4.x code works without changes

## Installation

```bash
npm install @splashcodex/api-key-manager
```

## Quick Start (v5 Presets)

The fastest way to get started in any CodeDex repository.

### Gemini Preset
Reads `GOOGLE_GEMINI_API_KEY` or `GEMINI_API_KEY` from environment.

```typescript
import { GeminiManager } from '@splashcodex/api-key-manager/presets/gemini';

const result = GeminiManager.getInstance();
if (!result.success) throw result.error;

const gemini = result.data;
const response = await gemini.execute(async (key) => {
    // result.data is the underlying ApiKeyManager
    return await callGemini(key, "Hello!");
});
```

### Multi-Provider Vault
Perfect for gateways or complex bots handling multiple models.

```typescript
import { MultiManager } from '@splashcodex/api-key-manager/presets/multi';

const vault = MultiManager.getInstance({
    providers: {
        gemini: { envKeys: ['GOOGLE_GEMINI_API_KEY'] },
        openai: { envKeys: ['OPENAI_API_KEY'] }
    }
}).data!;

// Route by provider
const res = await vault.execute(fn, { provider: 'gemini' });
```

---

## v5.0 — Architecture & Persistence

### Built-in Persistence
State (cooling down keys, dead keys) now survives application restarts by default.

```typescript
import { FileStorage } from '@splashcodex/api-key-manager/persistence/file';

const manager = new ApiKeyManager(keys, {
    storage: new FileStorage({
        filePath: './api_state.json'
    })
});
```

### Subpath Imports
To keep your bundles small, you can import only what you need:

```typescript
import { GeminiManager } from '@splashcodex/api-key-manager/presets/gemini';
import { FileStorage } from '@splashcodex/api-key-manager/persistence/file';
```

---

## v4.0 — Semantic Cache

Automatically cache API responses by semantic similarity.

```typescript
const manager = new ApiKeyManager(['key1', 'key2'], {
  semanticCache: {
    threshold: 0.92,
    getEmbedding: async (text) => await myModel.embed(text)
  }
});

// Cache HIT if prompt is semantically similar
const r1 = await manager.execute(apiFn, { prompt: 'What is the weather?' });
const r2 = await manager.execute(apiFn, { prompt: 'How is the weather today?' });
```

### v4.1 — Streaming Support
Real-time response handling with the same resilience as `execute()`.

```typescript
const stream = await manager.executeStream(async (key) => {
    return await gemini.generateContentStream({ prompt: "..." });
}, { prompt: "..." });

for await (const chunk of stream) {
    console.log(chunk.text());
}
```

---

## execute() Wrapper

Wraps the entire lifecycle into one method:

```typescript
const result = await manager.execute(
  async (key, signal) => {
    const res = await fetch(url, { headers: { 'x-api-key': key }, signal });
    return res.json();
  },
  { maxRetries: 3, timeoutMs: 10000 }
);
```

## API Reference

### Presets

| Class | Env Vars | Description |
|-------|----------|-------------|
| `GeminiManager` | `GOOGLE_GEMINI_API_KEY`, `GEMINI_API_KEY` | Gemini-optimized singleton |
| `OpenAIManager` | `OPENAI_API_KEY` | OpenAI-optimized singleton |
| `MultiManager` | Custom | Vault for multiple provider pools |

### Persistence

| Class | Description |
|-------|-------------|
| `FileStorage` | Persists to a JSON file (recommended for servers) |
| `MemoryStorage` | In-memory only (best for serverless/short-lived) |

### Core Methods

| Method | Description |
|--------|-------------|
| `execute(fn, opts)` | Standard wrapper |
| `executeStream(fn, opts)` | Streaming wrapper |
| `getStats()` | Get pool health |
| `getKey()` | Manual key rotation |
| `markFailed(key, err)` | Manual failure reporting |

## License

ISC
