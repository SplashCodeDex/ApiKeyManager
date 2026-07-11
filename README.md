# @splashcodex/ApiKeyManager v5.0 — Ecosystem Edition

> Universal API Key Management Gateway with Provider Presets, Built-in Persistence, and Multi-Provider Vault.

[![npm version](https://img.shields.io/npm/v/@splashcodex/ApiKeyManager)](https://www.npmjs.com/package/@splashcodex/ApiKeyManager)

## New in v5.3.0 (Resilience Upgrade)
- **Bulkhead Queueing (`cockatiel`)** — Safely handle traffic spikes. Requests that exceed your `concurrency` limit are queued (up to `concurrencyQueueSize`) rather than immediately rejected!
- **Strict Configuration Validation (`zod`)** — Deep runtime validation on all initialization options.
- **Improved Gateway SSE Parser** — Uses `eventsource-parser` for 100% reliable Server-Sent Events proxying.

## Features in v5.0 (Ecosystem Edition)

- **Provider Presets** — One-line setup for `GeminiManager`, `OpenAIManager`, and `MultiManager`.
- **Automatic Env Parsing** — Reads `GOOGLE_GEMINI_API_KEY`, `OPENAI_API_KEY`, etc. (supports JSON arrays and comma-separated strings) from any OS directory smoothly.
- **Built-in Persistence** — `FileStorage` (survives restarts) and `MemoryStorage` included.
- **Singleton Pattern** — Thread-safe singletons with `getInstance()` and `Result<T>` pattern.
- **Multi-Provider Vault** — Manage multiple providers (`gemini`, `openai`, `anthropic`) from a single entry point.
- **Centralized API Gateway** — Built-in Fastify proxy server to centralize AI requests for multiple apps securely.

## Core Features

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

### 🚀 Auto-Scaffold (New!)
The fastest way to get started is to run the `init` command in your project directory:
```bash
npx @splashcodex/api-key-manager init
```
This will automatically create a `.env` template and a `demo.ts` file showing the Gemini Preset in action.

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

### Centralized API Gateway (New!)

Run a standalone proxy server that acts as a single point of entry for all your microservices or repositories. It centralizes key management, circuit breaking, and rate limiting across applications.

1. Install global/local and export your keys:
```bash
export GOOGLE_GEMINI_API_KEY="AIzaSy...1,AIzaSy...2"
```

2. Start the gateway:
```bash
npm run gateway
# Server runs on http://localhost:9000
```

3. Call the **transparent proxy** from ANY language — use your official SDKs or raw HTTP, the gateway handles key injection behind the scenes:

```bash
# Gemini via Google's native API path
curl -X POST "http://localhost:9000/gemini/v1beta/models/gemini-2.0-flash:generateContent" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hello!"}]}]}'

# OpenAI via the standard chat completions path
curl -X POST "http://localhost:9000/openai/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "x-app-id: my-frontend" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello!"}]}'

# Streaming (Gemini)
curl -X POST "http://localhost:9000/gemini/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Tell me a story"}]}]}'
```

**Transparent Proxy Architecture:** The gateway exposes `/:provider/*` routes (e.g. `/gemini/...`, `/openai/...`, `/anthropic/...`). You send the exact upstream API path, headers, and body — the gateway strips the provider prefix, injects the API key, and forwards to the real provider. Your client code doesn't need to know or manage API keys.

**Rate Limiting (NEW):** Set per-app rate limits via `GATEWAY_RATE_LIMITS` env var:
```bash
export GATEWAY_RATE_LIMITS='{"my-frontend":{"requestsPerMin":100},"my-backend":{"requestsPerMin":500}}'
```
Apps identify themselves via the `x-app-id` request header.

**Custom Providers (NEW):** Add providers at runtime without modifying code via `GATEWAY_EXTRA_PROVIDERS`:
```bash
export GATEWAY_EXTRA_PROVIDERS='[{"name":"deepseek","envKeys":["DEEPSEEK_API_KEY"],"baseUrl":"https://api.deepseek.com","models":{"deepseek-chat":"/v1/chat/completions"},"authStyle":"header","authKey":"Authorization","authPrefix":"Bearer "}]'
```

**Monitoring Endpoints:**

| Endpoint | Description |
|---|---|
| `GET /v1/health` | Pool health across all providers (healthy/cooling/dead key counts, uptime) |
| `GET /v1/providers` | Available providers, model names, and key counts |
| `GET /v1/audit` | Recent request audit trail (filterable by `?app=` and `?provider=`) |
| `GET /v1/rate-limits` | Active per-app rate limit configuration and current usage |

---

### Multi-Provider Vault

Manage ALL your provider keys across your system from one pool.Perfect for gateways or complex bots handling multiple models.

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
