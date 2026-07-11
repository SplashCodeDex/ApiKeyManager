# @splashcodex/ApiKeyManager v5.4 — Ecosystem Edition

> Universal API Key Management Gateway with Provider Presets, Built-in Persistence, Multi-Provider Vault, and Production-Hardened Transparent Proxy.

[![npm version](https://img.shields.io/npm/v/@splashcodex/ApiKeyManager)](https://www.npmjs.com/package/@splashcodex/ApiKeyManager)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![CI](https://github.com/SplashCodeDex/ApiKeyManager/actions/workflows/test.yml/badge.svg)](https://github.com/SplashCodeDex/ApiKeyManager/actions/workflows/test.yml)

---

## 📖 Table of Contents

- [Why This Project?](#-why-this-project)
- [Architecture Overview](#-architecture-overview)
- [What's New in v5.4](#-whats-new-in-v54)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Centralized Environment Loader](#-centralized-environment-loader)
- [API Gateway](#-api-gateway)
- [API Reference](#-api-reference)
- [Advanced Features](#-advanced-features)
- [CLI Commands](#-cli-commands)
- [Configuration Reference](#-configuration-reference)
- [Event System](#-event-system)
- [Python SDK](#-python-sdk)
- [Development & Testing](#-development--testing)
- [Migration Guide](#-migration-guide)
- [License](#-license)

---

## 💡 Why This Project?

Managing API keys across 35+ projects is painful. Each project has its own `.env`, yet many share the same keys (Gemini, OpenAI, Stripe, Redis). When a key rotates, hits quota, or gets rate-limited, you have to hunt through every project to update it.

**SplashCodeX ApiKeyManager** solves this with three layers:

| Layer | What It Does |
|-------|-------------|
| **Central Env Loader** | All keys live in `~/codedex/env/` — shared across every project. Add `loadCentralEnv()` once at your entry point. |
| **Key Rotation & Resilience** | Circuit breakers, exponential backoff, automatic key rotation on 429/403/5xx. Keys heal themselves. |
| **API Gateway** | A single Fastify proxy server that all your apps call. Zero API keys in client code. The gateway injects them behind the scenes. |

Read more in [`WhyThisProject.md`](./WhyThisProject.md).

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   YOUR PROJECTS (35+)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ WhatsDeX  │  │  DeXdo   │  │  Other   │  ...          │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘               │
│        │              │              │                     │
│        └──────────────┼──────────────┘                     │
│                       │                                    │
│         loadCentralEnv()  ←  reads ~/codedex/env/         │
│                       │                                    │
│         ┌─────────────┴──────────────┐                     │
│         │   ApiKeyManager (Preset)    │                     │
│         │  • Circuit Breaker          │                     │
│         │  • Auto-Retry + Backoff     │                     │
│         │  • Semantic Cache           │                     │
│         │  • File Persistence         │                     │
│         └─────────────┬──────────────┘                     │
│                       │                                    │
│          OR: HTTP calls to the Gateway                     │
└───────────────────────┼────────────────────────────────────┘
                        │
┌───────────────────────┼────────────────────────────────────┐
│              API GATEWAY (Fastify :9000)                    │
│  ┌─────────────────────┴──────────────────────┐            │
│  │         Transparent Reverse Proxy           │            │
│  │  /gemini/*  →  Google Generative Language   │            │
│  │  /openai/*  →  OpenAI API                   │            │
│  │  /anthropic/* → Anthropic API               │            │
│  │  /{custom}/* → Any registered provider       │            │
│  └─────────────────────────────────────────────┘            │
│  • Per-App Rate Limiting (x-app-id header)                  │
│  • Request Audit Trail (/v1/audit)                          │
│  • Health Monitoring (/v1/health, /v1/providers)            │
│  • Graceful Shutdown (SIGTERM/SIGINT)                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 🆕 What's New in v5.4

### Production-Hardened Gateway

| Feature | Description |
|---------|-------------|
| **Per-App Rate Limiting** | Sliding-window rate limiter via `GATEWAY_RATE_LIMITS` env var, enforced by `x-app-id` header |
| **Graceful Shutdown** | `SIGTERM`/`SIGINT` handlers cleanly close connections and destroy the key vault |
| **Provider Extensibility** | Register custom providers at runtime via `GATEWAY_EXTRA_PROVIDERS` JSON env var |
| **Request Audit Trail** | `/v1/audit` endpoint with ring-buffer logging (10K entries), filterable by `?app=` and `?provider=` |
| **SSE Resilience** | Mid-stream error handling with structured `event: error` emissions — clients no longer hang on failures |

### Existing v5.x Features

- **Provider Presets** — `GeminiManager`, `OpenAIManager`, `AnthropicManager`, `MultiManager`
- **Automatic Env Parsing** — JSON arrays, comma-separated strings, home directory config
- **Built-in Persistence** — `FileStorage` (survives restarts, atomic writes) and `MemoryStorage`
- **Singleton Pattern** — Thread-safe singletons with `getInstance()` and `Result<T>` pattern
- **Multi-Provider Vault** — Manage `gemini`, `openai`, `anthropic` from a single entry point
- **Centralized API Gateway** — Fastify transparent proxy, auto key injection
- **Semantic Cache** — Cosine-similarity cache with pluggable embedding functions
- **Streaming Support** — `executeStream()` with initial retry logic and cache replay
- **100% Backward Compatible** — v1.x through v4.x code works without changes

---

## 📦 Installation

```bash
npm install @splashcodex/api-key-manager
```

Requires **Node.js 18+** (tested on 18.x, 20.x, 22.x via CI).

### Dependencies

- **[cockatiel](https://github.com/connor4312/cockatiel)** — Bulkhead/concurrency queueing + exponential backoff with decorrelated jitter
- **[fastify](https://www.fastify.io/)** — High-performance HTTP server for the API gateway
- **[dotenv](https://github.com/motdotla/dotenv)** — Robust `.env` file parsing
- **[zod](https://zod.dev/)** — Runtime schema validation for options

---

## 🚀 Quick Start

The fastest way to get started is the `init` command:

```bash
npx @splashcodex/api-key-manager init
```

This creates a `~/codedex/env/` directory with template env files and a `demo.ts` file.

### Layer 1: Centralized Env Loader

```typescript
// At the TOP of your entry point, before anything else reads process.env
import { loadCentralEnv } from '@splashcodex/api-key-manager/env';
loadCentralEnv();
// Now process.env.GOOGLE_GEMINI_API_KEY, OPENAI_API_KEY, etc. are available
```

### Layer 2: Provider Presets

#### Gemini Preset

```typescript
import { GeminiManager } from '@splashcodex/api-key-manager/presets/gemini';

const result = GeminiManager.getInstance();
if (!result.success) throw result.error;

const gemini = result.data;
const response = await gemini.execute(async (key) => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Hello!' }] }] }),
    });
    return res.json();
}, { maxRetries: 3, timeoutMs: 30000 });
```

#### OpenAI Preset

```typescript
import { OpenAIManager } from '@splashcodex/api-key-manager/presets/openai';

const result = OpenAIManager.getInstance();
if (!result.success) throw result.error;

const openai = result.data;
const response = await openai.execute(async (key) => {
    const client = new OpenAI({ apiKey: key });
    return await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello!' }],
    });
}, { maxRetries: 3, timeoutMs: 30000 });
```

#### Anthropic Preset

```typescript
import { AnthropicManager } from '@splashcodex/api-key-manager/presets/anthropic';

const result = AnthropicManager.getInstance();
if (!result.success) throw result.error;

const claude = result.data;
const response = await claude.execute(async (key) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, messages: [{ role: 'user', content: 'Hello!' }] }),
    });
    return res.json();
}, { maxRetries: 3, timeoutMs: 60000 });
```

---

## 🌐 Centralized Environment Loader

The `@splashcodex/api-key-manager/env` module loads environment variables from `~/codedex/env/` so all your projects share a single source of truth.

### Directory Structure

```
~/codedex/env/
  common.env       — DATABASE_URL, REDIS_URL, SUPABASE_URL (shared secrets)
  llm.env          — GOOGLE_GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY
  stripe.env       — STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
  <custom>.env     — Any additional groupings
```

### Usage

```typescript
import { loadCentralEnv, getCentralEnvVar } from '@splashcodex/api-key-manager/env';

// Load ALL .env files from ~/codedex/env/
const result = loadCentralEnv();
console.log(`Loaded ${result.varsSet} vars from ${result.filesLoaded.join(', ')}`);

// Load specific files only
loadCentralEnv({ files: ['llm.env', 'common.env'] });

// Use a custom directory (e.g., team-shared location)
loadCentralEnv({ envDir: '/shared/team/env' });

// Preserve existing process.env values (local overrides)
loadCentralEnv({ preserveExisting: true });

// Throw if the env directory doesn't exist
loadCentralEnv({ silent: false });

// Read a single value without loading everything
const geminiKey = getCentralEnvVar('GOOGLE_GEMINI_API_KEY');
```

### CLI Setup

```bash
# Create ~/codedex/env/ with template files (common.env, llm.env, stripe.env)
npx @splashcodex/api-key-manager setup

# Show status of your centralized env
npx @splashcodex/api-key-manager status
```

---

## 🌍 API Gateway

Run a standalone Fastify proxy server that centralizes key management, circuit breaking, and rate limiting for all your microservices.

### Starting the Gateway

```bash
# Start the gateway (default port 9000)
npm run gateway

# Or with ts-node
npx ts-node gateway/server.ts

# Development mode with auto-restart
npm run gateway:dev
```

### Configuration

Set via environment variables:

```bash
# Server settings
export GATEWAY_PORT=9000          # Default: 9000
export GATEWAY_HOST=0.0.0.0       # Default: 0.0.0.0

# Per-app rate limiting (JSON object)
export GATEWAY_RATE_LIMITS='{"my-frontend":{"requestsPerMin":100},"my-backend":{"requestsPerMin":500}}'

# Custom providers at runtime (JSON array)
export GATEWAY_EXTRA_PROVIDERS='[{"name":"deepseek","envKeys":["DEEPSEEK_API_KEY"],"baseUrl":"https://api.deepseek.com","models":{"deepseek-chat":"/v1/chat/completions"},"authStyle":"header","authKey":"Authorization","authPrefix":"Bearer "}]'
```

### Transparent Proxy

The gateway exposes `/:provider/*` routes. You send the exact upstream API path, headers, and body — the gateway strips the provider prefix, injects the API key, and forwards to the real provider.

```bash
# Gemini via Google's native API path
curl -X POST "http://localhost:9000/gemini/v1beta/models/gemini-2.0-flash:generateContent" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hello!"}]}]}'

# OpenAI via standard chat completions
curl -X POST "http://localhost:9000/openai/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "x-app-id: my-frontend" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello!"}]}'

# Anthropic via Messages API
curl -X POST "http://localhost:9000/anthropic/v1/messages" \
  -H "Content-Type: application/json" \
  -H "x-app-id: my-backend" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":1024,"messages":[{"role":"user","content":"Hello!"}]}'

# Streaming (Gemini SSE)
curl -X POST "http://localhost:9000/gemini/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Tell me a story"}]}]}'
```

### Monitoring Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /v1/health` | Pool health across all providers (healthy/cooling/dead key counts, uptime) |
| `GET /v1/providers` | Available providers, model names, and key counts |
| `GET /v1/audit` | Recent request audit trail (filterable by `?app=` and `?provider=`, `?limit=`) |
| `GET /v1/rate-limits` | Active per-app rate limit configuration and current usage |

### Custom Providers

Add any API provider at runtime without modifying code:

```bash
export GATEWAY_EXTRA_PROVIDERS='[
  {
    "name": "deepseek",
    "envKeys": ["DEEPSEEK_API_KEY"],
    "baseUrl": "https://api.deepseek.com",
    "models": {"deepseek-chat": "/v1/chat/completions"},
    "authStyle": "header",
    "authKey": "Authorization",
    "authPrefix": "Bearer "
  },
  {
    "name": "cohere",
    "envKeys": ["COHERE_API_KEY"],
    "baseUrl": "https://api.cohere.com",
    "models": {"command-r": "/v1/chat"},
    "authStyle": "header",
    "authKey": "Authorization",
    "authPrefix": "Bearer "
  }
]'
```

---

## 📚 API Reference

### Presets

| Class | Env Vars | Subpath Import |
|-------|----------|---------------|
| `GeminiManager` | `GOOGLE_GEMINI_API_KEY`, `GEMINI_API_KEY` | `.../presets/gemini` |
| `OpenAIManager` | `OPENAI_API_KEY` | `.../presets/openai` |
| `AnthropicManager` | `ANTHROPIC_API_KEY` | `.../presets/anthropic` |
| `MultiManager` | Custom per-provider | `.../presets/multi` |

All presets share these defaults:
- **Strategy**: `LatencyStrategy` (lowest-latency key with LRU tie-break)
- **Concurrency**: 20 concurrent requests
- **Health Checks**: Every 5 minutes (disabled by default — set `healthCheckFn` to enable)
- **Persistence**: `FileStorage` — survives restarts, uses atomic writes

### Persistence

| Class | Subpath Import | Description |
|-------|---------------|-------------|
| `FileStorage` | `.../persistence/file` | Persists to a JSON file with atomic writes (write-tmp → rename). Best for servers and long-running processes. |
| `MemoryStorage` | `.../persistence/memory` | In-memory only. Best for serverless, testing, or short-lived processes. |

### Core `ApiKeyManager`

#### Constructor

```typescript
// Legacy (v1/v2 — still works)
new ApiKeyManager(['key1', 'key2'], storage, strategy);

// Modern (v3+)
new ApiKeyManager(keys, {
    storage: new FileStorage({ filePath: './state.json' }),
    strategy: new LatencyStrategy(),
    fallbackFn: () => cachedResponse,
    concurrency: 20,
    concurrencyQueueSize: 10,  // Queue up to 10 waiting requests
    semanticCache: {
        threshold: 0.92,
        ttlMs: 24 * 60 * 60 * 1000,
        getEmbedding: async (text) => await embed(text),
    },
});
```

#### Core Methods

| Method | Description |
|--------|-------------|
| `execute(fn, opts?)` | Full lifecycle: get key → call with timeout → classify error → retry with backoff → fallback. Returns `Promise<T>`. |
| `executeStream(fn, opts?)` | Streaming variant. Retries on initial connection failure. Returns `AsyncGenerator<T>`. |
| `getKey()` | Manual key selection (best healthy key). Returns `string \| null`. |
| `getKeyByProvider(provider)` | Get a key filtered by provider tag. Returns `string \| null`. |
| `getStats()` | Pool health snapshot: `{ total, healthy, cooling, dead }` |
| `getKeyCount()` | Number of non-dead keys |
| `markSuccess(key, durationMs?)` | Mark a key as healthy, update latency stats |
| `markFailed(key, classification)` | Mark a key as failed, trigger circuit breaker |
| `markFailedLegacy(key, isQuota?)` | Legacy compatibility method |
| `classifyError(error, finishReason?)` | Classify an error: `QUOTA`, `AUTH`, `TRANSIENT`, `SAFETY`, `RECITATION`, `TIMEOUT`, `BAD_REQUEST`, `UNKNOWN` |
| `setHealthCheck(fn)` | Set a health check function `(key) => Promise<boolean>` |
| `startHealthChecks(intervalMs?)` | Start periodic health checks (default: 60s) |
| `stopHealthChecks()` | Stop health checks and flush state to disk |
| `flushState()` | Immediately flush state to storage |
| `calculateBackoff(attempt)` | Get backoff delay for a given attempt (decorrelated jitter) |

#### ExecuteOptions

```typescript
interface ExecuteOptions {
    timeoutMs?: number;       // Timeout per attempt (ms)
    maxRetries?: number;      // Max retries (default: 0 = no retry)
    finishReason?: string;    // Gemini finishReason handling (SAFETY, RECITATION)
    provider?: string;        // Filter keys by provider tag
    prompt?: string;          // For semantic cache lookup
}
```

#### Load Balancing Strategies

| Strategy | Description |
|----------|-------------|
| `StandardStrategy` | Least failed → Least recently used |
| `WeightedStrategy` | Probabilistic selection based on key weight (0.0–1.0) |
| `LatencyStrategy` | Lowest average latency with LRU tie-break (default for presets) |

### Multi-Provider Vault

```typescript
import { MultiManager } from '@splashcodex/api-key-manager/presets/multi';

const result = MultiManager.getInstance({
    providers: {
        gemini: {
            envKeys: ['GOOGLE_GEMINI_API_KEY'],
            strategy: new LatencyStrategy(),
            concurrency: 15,
        },
        openai: {
            envKeys: ['OPENAI_API_KEY'],
            concurrency: 10,
        },
        anthropic: {
            envKeys: ['ANTHROPIC_API_KEY'],
        },
    },
    healthCheckIntervalMs: 300_000,  // 5 minutes
    logger: {
        info: (msg) => console.log(msg),
        warn: (msg) => console.warn(msg),
        error: (msg) => console.error(msg),
    },
});

if (!result.success) {
    console.error(result.error.message);
    process.exit(1);
}

const vault = result.data;

// Route to a specific provider
const text = await vault.execute(apiCall, { provider: 'gemini', maxRetries: 3 });

// Stream from a provider
const stream = vault.executeStream(streamApiCall, { provider: 'openai' });

// Get stats per provider
vault.getStats('gemini');  // { total, healthy, cooling, dead }
vault.getMultiStats();     // { gemini: {...}, openai: {...} }
vault.getProviders();      // ['gemini', 'openai', 'anthropic']

// Clean shutdown
vault.destroy();
```

---

## ⚡ Advanced Features

### Circuit Breaker States

```
CLOSED ──fail──▶ OPEN ──cooldown──▶ HALF_OPEN ──success──▶ CLOSED
  ▲                                  │                       
  │                              fail│                       
  └──────────────────────────────────┘                       
                    │
              (5 consecutive failures or 403)
                    ▼
                  DEAD (retested after 1 hour TTL)
```

Keys transition through states automatically based on error classification. `QUOTA` (429) errors open the circuit immediately. `AUTH` (403) errors mark the key as permanently dead.

### Error Classification

| Error Type | HTTP Code | Retryable? | Effect on Key |
|------------|-----------|------------|---------------|
| `QUOTA` | 429 | Yes | Opens circuit, respects `Retry-After` header |
| `AUTH` | 403 | No | Marks key **DEAD** permanently |
| `TRANSIENT` | 500/502/503/504 | Yes | Increments fail count, 1min cooldown |
| `TIMEOUT` | — | Yes | Increments fail count, 1min cooldown |
| `SAFETY` | — | No | **No effect** on key (not a key issue) |
| `RECITATION` | — | No | **No effect** on key (not a key issue) |
| `BAD_REQUEST` | 400 | No | **No effect** on key (fix your request) |

### Semantic Cache

Cache API responses by semantic similarity, not exact text match:

```typescript
const manager = new ApiKeyManager(keys, {
    semanticCache: {
        threshold: 0.92,  // Cosine similarity threshold
        ttlMs: 24 * 60 * 60 * 1000,  // 24 hours
        getEmbedding: async (text) => await myEmbeddingModel.embed(text),
    },
});

// First call — cache MISS, goes to API
const r1 = await manager.execute(apiCall, { prompt: 'What is the capital of France?' });

// Second call — cache HIT (semantically similar)
const r2 = await manager.execute(apiCall, { prompt: 'Tell me the capital city of France' });
// Returns cached response — zero API cost!

// Works with streaming too
const stream = await manager.executeStream(streamApiCall, { prompt: 'What is the weather?' });
```

The cache uses vanilla cosine similarity math with no external dependencies. Max 500 entries (FIFO eviction). Includes a recursion guard for when `getEmbedding` itself calls `execute()`.

### Concurrency Control (Bulkhead)

Limit concurrent `execute()` calls to prevent overwhelming providers:

```typescript
const manager = new ApiKeyManager(keys, {
    concurrency: 20,            // Max 20 concurrent calls
    concurrencyQueueSize: 10,   // Queue up to 10 waiting (FIFO)
});

// When all 20 slots are busy:
//   - Requests 21-30 wait in the queue (drain as slots free)
//   - Request 31+ throws BulkheadRejectionError immediately
//   - The 'bulkheadRejected' event fires on rejections
```

Backed by **[cockatiel](https://github.com/connor4312/cockatiel)** for production-grade concurrency management.

### Exponential Backoff

Uses **decorrelated jitter** (statistically superior to simple random jitter):

| Attempt | Base Delay | With Jitter (range) |
|---------|-----------|---------------------|
| 1 | 1s | 0.5s – 1.5s |
| 2 | 2s | 1s – 3s |
| 3 | 4s | 2s – 6s |
| 4 | 8s | 4s – 12s |
| 5+ | 16s | 8s – 24s |

Max backoff: 64 seconds. Backed by cockatiel's `ExponentialBackoff` with `decorrelatedJitterGenerator`.

### Persistence

State survives restarts — cooled-down keys stay cooled-down across reboots:

```typescript
import { FileStorage } from '@splashcodex/api-key-manager/persistence/file';

const storage = new FileStorage({
    filePath: './api_state.json',  // Default: os.tmpdir()/codedex_api_key_state.json
    clearOnInit: false,            // Default: true (false = preserve state)
});

// Atomic writes: write → tmp → rename (never half-written)
// Auto-creates parent directories
// Silently handles permission errors
```

The `BasePreset` automatically uses `FileStorage` with per-project state files (e.g., `codedex_gemini_whatsdex_a3f2_state.json`) to avoid collisions between projects.

### Health Checks

Automatically test keys in OPEN/HALF_OPEN state to see if they've recovered:

```typescript
manager.setHealthCheck(async (key) => {
    try {
        const res = await fetch(`https://api.example.com/health?key=${key}`);
        return res.ok;
    } catch {
        return false;
    }
});

manager.startHealthChecks(60_000); // Check every 60 seconds
manager.stopHealthChecks();        // Stop + flush state to disk
```

---

## ⌨️ CLI Commands

```bash
# Show help and version
npx @splashcodex/api-key-manager

# Initialize: create ~/codedex/env/ + demo.ts in current directory
npx @splashcodex/api-key-manager init

# Set up centralized env directory with template files
npx @splashcodex/api-key-manager setup

# Show which env files exist and variables defined
npx @splashcodex/api-key-manager status
```

---

## ⚙️ Configuration Reference

### ApiKeyManager Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storage` | `FileStorage \| MemoryStorage` | `MemoryStorage` (no-op) | Persistence adapter |
| `strategy` | `LoadBalancingStrategy` | `StandardStrategy` | Key selection algorithm |
| `fallbackFn` | `() => any` | `undefined` | Called when all keys exhausted |
| `concurrency` | `number` | `Infinity` | Max concurrent `execute()` calls |
| `concurrencyQueueSize` | `number` | `0` | Queue size when at concurrency limit |
| `semanticCache.threshold` | `number` (0–1) | `0.95` | Cosine similarity threshold |
| `semanticCache.ttlMs` | `number` | `86400000` (24h) | Cache entry TTL |
| `semanticCache.getEmbedding` | `(text: string) => Promise<number[]>` | required | Embedding function |

### Preset Options (`BasePreset`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `envKeys` | `string[]` | `[]` | Env var names to read keys from |
| `provider` | `string` | `'default'` | Provider tag for logging & state isolation |
| `strategy` | `LoadBalancingStrategy` | `LatencyStrategy` | Key selection algorithm |
| `concurrency` | `number` | `20` | Max concurrent calls |
| `healthCheckIntervalMs` | `number` | `300_000` (5 min) | Health check interval (0 to disable) |
| `healthCheckFn` | `(key) => Promise<boolean>` | `undefined` | Health check function |
| `semanticCache` | `object` | `undefined` | Semantic cache config |
| `fallbackFn` | `() => any` | `undefined` | Fallback when all keys exhausted |
| `stateFilePath` | `string` | auto (tmpdir) | Custom state file path |
| `logger` | `PresetLogger` | `console` | Custom logger |

### Gateway Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `GATEWAY_PORT` | `number` | `9000` | Gateway HTTP port |
| `GATEWAY_HOST` | `string` | `0.0.0.0` | Gateway bind address |
| `GATEWAY_RATE_LIMITS` | JSON object | `{}` | Per-app rate limits `{"appId":{"requestsPerMin":N}}` |
| `GATEWAY_EXTRA_PROVIDERS` | JSON array | `[]` | Custom provider definitions |
| `CODEDEX_ENV_DIR` | `string` | `~/codedex/env/` | Centralized env directory path |

### Internal Config Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_CONSECUTIVE_FAILURES` | 5 | Failures before circuit opens |
| `COOLDOWN_TRANSIENT` | 60s | Cooldown after transient error |
| `COOLDOWN_QUOTA` | 5 min | Cooldown after 429 (if no Retry-After) |
| `COOLDOWN_QUOTA_DAILY` | 1 hour | Cooldown for RPD exhaustion |
| `HALF_OPEN_TEST_DELAY` | 60s | Wait before testing HALF_OPEN key |
| `MAX_BACKOFF` | 64s | Maximum exponential backoff |
| `BASE_BACKOFF` | 1s | Starting backoff delay |
| `DEAD_KEY_TTL` | 1 hour | DEAD keys get retested after this |

---

## 📡 Event System

Every `ApiKeyManager` instance emits typed lifecycle events for monitoring and alerting:

```typescript
const manager = new ApiKeyManager(keys, options);

manager.on('keyDead', (key) => {
    // Key permanently dead (403 Auth error)
    sendAlert(`Key ${key.slice(-4)} is DEAD`);
});

manager.on('circuitOpen', (key) => {
    // Circuit opened (too many failures or quota)
    log.warn(`Circuit OPEN for key ...${key.slice(-4)}`);
});

manager.on('circuitHalfOpen', (key) => {
    // Circuit testing recovery
    log.info(`Testing key ...${key.slice(-4)}`);
});

manager.on('keyRecovered', (key) => {
    // Key successfully recovered!
    log.info(`Key ...${key.slice(-4)} is healthy again`);
});

manager.on('fallback', (reason) => {
    // Fallback function was triggered
    metrics.increment('fallback_triggered', { reason });
});

manager.on('allKeysExhausted', () => {
    // All keys are dead or cooling — CRITICAL
    sendPagerDutyAlert('ALL API KEYS EXHAUSTED');
});

manager.on('retry', (key, attempt, delayMs) => {
    // About to retry with a different key
    metrics.increment('retry_attempt', { key: key.slice(-4), attempt });
});

manager.on('healthCheckPassed', (key) => {
    log.info(`Health check passed for ...${key.slice(-4)}`);
});

manager.on('healthCheckFailed', (key, error) => {
    log.warn(`Health check failed for ...${key.slice(-4)}: ${error}`);
});

manager.on('executeSuccess', (key, durationMs) => {
    metrics.record('api_call_duration', durationMs);
});

manager.on('executeFailed', (key, error) => {
    metrics.increment('api_call_failed', { key: key.slice(-4) });
});

manager.on('bulkheadRejected', () => {
    metrics.increment('bulkhead_rejected');
});
```

---

## 🐍 Python SDK

A Python port of the core ApiKeyManager is available at [`python-sdk/`](./python-sdk/):

```bash
pip install splashcodex-api-manager
```

Supports Python 3.9+. Feature parity with the TypeScript version:
- `GeminiManager`, `OpenAIManager`, `MultiManager` presets
- Circuit breaker, error classification, exponential backoff
- `FileStorage` and `MemoryStorage`
- `execute()` and `executeStream()` wrappers
- CLI: `splashcodex-api-manager init`

See [`python-sdk/README.md`](./python-sdk/README.md) for full documentation.

---

## 🧪 Development & Testing

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run all tests
npm test

# Run specific test file
npx jest tests/v5_presets.test.ts --verbose

# Start gateway in dev mode
npm run gateway:dev

# Start gateway
npm run gateway
```

### Test Suite

| Test File | What It Covers |
|-----------|---------------|
| `tests/index.test.ts` | Core ApiKeyManager: rotation, circuit breaker, backoff |
| `tests/gateway.test.ts` | Gateway server: proxy, health, audit, providers |
| `tests/v5_presets.test.ts` | Presets: GeminiManager, OpenAIManager, AnthropicManager, MultiManager |
| `tests/validation.test.ts` | Options validation, edge cases |
| `tests/v2_strategies.test.ts` | Strategy implementations |
| `tests/v3_features.test.ts` | v3 features: error classification, bulkhead |
| `tests/v4_semantic.test.ts` | Semantic cache: cosine similarity, TTL, FIFO |
| `tests/v4_streaming.test.ts` | Streaming: executeStream, retry logic |
| `tests/env_loader.test.ts` | Centralized env loader |

CI runs on Node.js 18.x, 20.x, and 22.x via GitHub Actions.

---

## 🔄 Migration Guide

### v4.x → v5.x

- Presets now use `getInstance()` returning `Result<T>` instead of raw instances. Check `.success` before using `.data`.
- `FileStorage` now defaults to `clearOnInit: true` in the base class but `false` in presets (preserves state). Set explicitly if needed.
- The `provider` field on `KeyState` is now required. Keys without a provider default to `'default'`.
- Subpath imports are now the recommended way to import presets and persistence adapters for smaller bundles.

### v3.x → v4.x

- `execute()` now supports a `prompt` option for semantic cache lookup.
- New `executeStream()` method for streaming APIs.
- Semantic cache requires a `semanticCache` config with a `getEmbedding` function.

### v2.x → v3.x

- Constructor now accepts an options object instead of positional arguments (legacy still supported).
- New error classification system: `classifyError()` returns `ErrorClassification` with `markKeyFailed` and `markKeyDead` booleans.
- New `markFailed(key, classification)` replaces `markFailedLegacy()`.
- Concurrency control via `concurrency` and `concurrencyQueueSize` options.
- Provider tags for multi-provider key pools.

### v1.x → v2.x

- Key weight and latency tracking added. All existing code works without changes.
- New `WeightedStrategy` and `LatencyStrategy` options.

---

## 📄 License

ISC © [SplashCodeDex](https://github.com/SplashCodeDex)
