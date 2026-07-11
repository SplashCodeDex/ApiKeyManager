# Changelog

All notable changes to `@splashcodex/api-key-manager` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [5.5.0] — 2026-07 — Production Packaging

### Added

- **Compiled Gateway Exports**: Gateway subpath exports now point to compiled `dist/gateway/*.js` instead of raw TypeScript source. Consumers can import `@splashcodex/api-key-manager/gateway/config` and get working JavaScript.
- **Declaration Maps** (`.d.ts.map`): Better IDE "Go to Definition" experience — navigates to source instead of generated `.d.ts`.
- **`.npmignore`**: Explicit exclusion of source, test, playground, IDE, and development files from the npm tarball.
- **Package Metadata**: Added `repository`, `bugs`, `homepage`, `engines` (Node >= 18), `publishConfig`, and `sideEffects: false`.
- **Build Clean Step**: `npm run clean` removes stale `dist/` before every build to prevent old artifacts.
- **CI Package Verification**: `npm pack --dry-run` step in CI workflow to catch packaging regressions.
- **Gateway Type Definitions**: `typesVersions` now includes `gateway/config`, `gateway/proxy`, and `gateway/middleware`.

### Changed

- **Build Command**: Now compiles both `src/` and `gateway/` via `tsc && tsc -p tsconfig.gateway.json`.
- **`files` Array**: Now only includes `dist/`, `bin/`, `README.md`, and `CHANGELOG.md` — trimmed from shipping raw `src/` and `gateway/`.
- **`prepublishOnly`**: Now runs `npm test` after build to enforce passing tests before any publish.
- **`prepack`**: Added to ensure `dist/` is always fresh when packaging.
- **`postinstall`**: Simplified to a one-line version banner.

### Fixed

- Gateway exports no longer resolve to `.ts` files that Node.js can't run (#broken-in-production).
- `tsconfig.gateway.json` excludes `gateway/server.ts` (standalone app) to avoid `rootDir` conflicts with `src/` imports.

---

## [5.4.0] — 2026-07 — Production-Hardened Gateway (Ecosystem Edition)

### Added

- **Per-App Rate Limiting**: Sliding-window rate limiter via `GATEWAY_RATE_LIMITS` env var, enforced by `x-app-id` request header. Configurable per-app with `requestsPerMin`.
- **Graceful Shutdown**: `SIGTERM`/`SIGINT` handlers in the gateway server that cleanly close Fastify connections and call `vault.destroy()` to flush state.
- **Provider Extensibility**: Register custom providers at runtime via `GATEWAY_EXTRA_PROVIDERS` JSON env var. Supports `header` and `query` auth styles, custom prefixes (e.g., `Bearer `), and model mapping.
- **Request Audit Trail**: `GET /v1/audit` endpoint with in-memory ring buffer (10,000 entries). Filterable by `?app=` and `?provider=`. Logs timestamp, app ID, provider, method, path, stream flag, status code, latency, and errors.
- **SSE Resilience**: Mid-stream error handling emits structured `event: error\ndata: {"error":"..."}\n\n` chunks followed by `data: [DONE]\n\n`. Clients no longer hang on streaming failures.
- **Rate Limit Monitoring**: `GET /v1/rate-limits` endpoint returning configured limits and current per-app usage snapshots.

### Changed

- Gateway `log()` now includes ISO timestamps and colorized level prefixes (cyan/yellow/red).
- Provider definitions now merge with extra providers taking precedence over built-ins (overrides by name).
- Anthropic provider in gateway now auto-adds `anthropic-version: 2023-06-01` header.

### Fixed

- Streaming responses now emit a proper `[DONE]` marker for SSE-compliant clients.
- Headers already sent edge case (streaming race condition) now handled gracefully with SSE error emission.

---

## [5.3.0] — 2026-06 — Azure & Bedrock Extension

### Added

- **Azure OpenAI Gateway Provider**: Built-in Azure provider with `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT` env vars. Configurable deployment-to-model mapping.
- **AWS Bedrock Gateway Provider**: Built-in Bedrock provider via `AWS_BEDROCK_ACCESS_KEY`/`AWS_BEDROCK_SECRET_KEY` env vars.
- **`CODEDEX_ENV_DIR` Env Var**: Override the default `~/codedex/env/` directory path for the central env loader.

### Changed

- Gateway models updated: `gemini-2.5-flash` → `gemini-2.5-flash-preview-04-17`, `gemini-2.5-pro` → `gemini-2.5-pro-preview-05-06`.
- `DEAD_KEY_TTL` constant added (1 hour) — DEAD keys now get retested after the TTL expires instead of staying dead forever.

### Fixed

- Stale cooldowns from previous sessions now properly cleared on state load (keys that would have recovered during downtime are now marked HALF_OPEN instead of staying OPEN).

---

## [5.2.0] — 2026-05 — Anthropic & Home Dir Config

### Added

- **`AnthropicManager` Preset**: New preset for Claude API keys. Reads `ANTHROPIC_API_KEY` from env. Includes pre-configured health checks, concurrency limit (20), and latency strategy.
- **`~/.codedex/api_keys.json` Support**: `BasePreset.parseKeysFromHomeDir()` reads API keys from `~/.codedex/api_keys.json` as a fallback when environment variables are not set.
- **`preserveExisting` Option**: `loadCentralEnv()` now supports `preserveExisting: true` to prevent central env values from overwriting existing `process.env` values (project-local overrides).

### Changed

- Subpath exports in `package.json` now include `./presets/anthropic` and `./presets/base`.
- `postinstall` message updated to include `loadCentralEnv` usage and v5.4 version.

---

## [5.1.0] — 2026-04 — Gateway Transparency

### Added

- **Transparent Reverse Proxy**: Gateway routes changed from `/v1/generate` and `/v1/stream` to `/:provider/*`. The gateway now acts as a transparent proxy — clients send exact upstream API paths, headers, and bodies. The gateway strips the provider prefix, injects the API key, and forwards to the real provider.
- **Multi-Provider Gateway**: Gateway supports `gemini`, `openai`, `anthropic` providers out of the box with model-specific path mapping.
- **SSE Streaming Proxy**: Streaming responses from upstream providers are piped verbatim through the gateway (raw `Uint8Array` chunks).
- **`GET /v1/providers`**: New endpoint listing available providers, models, and key counts.

### Changed

- CLI `init` now also runs `setup` (creates `~/codedex/env/` directory with template files).
- Gateway port defaults to 9000 (was 3000).

---

## [5.0.0] — 2026-03 — Architecture & Persistence (Ecosystem Edition)

### Added

- **Provider Presets**: `GeminiManager`, `OpenAIManager`, `MultiManager` classes with singleton pattern and `Result<T>` return type.
- **`BasePreset` Class**: Abstract base for all presets with shared infrastructure:
  - Singleton lifecycle management (`getInstance()`, `reset()`, `resetAll()`)
  - Per-project state isolation (project ID derived from CWD hash)
  - Event-to-logger wiring
  - Health check scheduling
  - `Result<T>` pattern for safe initialization
- **Built-in Persistence**: `FileStorage` and `MemoryStorage` adapters.
  - `FileStorage`: JSON file persistence with atomic writes (write-tmp → rename), auto-create parent directories, `clear()` method.
  - `MemoryStorage`: In-memory only for serverless/testing.
- **Centralized Environment Loader** (`@splashcodex/api-key-manager/env`):
  - `loadCentralEnv()`: Loads all `.env` files from `~/codedex/env/`
  - `getCentralEnvVar()`: Read a single value without loading everything
  - `getDefaultEnvDir()`: Returns `~/codedex/env/` path
  - Options: `envDir`, `files`, `silent`, `preserveExisting`
- **API Gateway** (Fastify server):
  - `npm run gateway` / `npm run gateway:dev` scripts
  - `gateway/config.ts`: Provider definitions, env var parsing, rate limit config
  - `gateway/server.ts`: Fastify server with `/:provider/*` routes
  - `gateway/proxy.ts`: Upstream proxy logic with `createProxyFn()` and `createStreamProxyFn()`
  - `gateway/middleware.ts`: Logging, app tracking, error formatting
- **CLI Commands**: `init`, `setup`, `status` via `bin/cli.js`.
- **Subpath Imports**: Tree-shakeable imports for presets and persistence adapters.
- **`Health Checks`**: `setHealthCheck()`, `startHealthChecks()`, `stopHealthChecks()` on ApiKeyManager.

### Changed

- `ApiKeyManager` constructor now supports options object with Zod validation (`ApiKeyManagerOptionsSchema`).
- `KeyState` now includes `provider` field for multi-provider key pools.
- `getKeyByProvider(provider)` added for provider-filtered key selection.
- `ExecuteOptions` now includes `provider` and `prompt` fields.
- State persistence is now debounced (500ms) with `flushState()` for clean shutdown.
- DEAD keys now have a 1-hour TTL — resurrected to HALF_OPEN for retesting after expiry.
- Stale cooldowns from previous sessions are cleared on state load.

---

## [4.1.0] — 2025-11 — Streaming Support

### Added

- **`executeStream()` Method**: AsyncGenerator-based streaming wrapper with:
  - Initial retry logic (retries on connection failure before any data is yielded)
  - Mid-stream error propagation (if data already yielded, error is thrown directly — no retry)
  - Semantic cache integration (stream chunks accumulated and cached on success)
  - Cache replay for stream responses (yields as chunks if array, or as single chunk)
- **Recursion Guard**: `_isResolvingEmbedding` flag prevents infinite recursion when `getEmbeddingFn` internally calls `execute()`.

### Changed

- Semantic cache now works with both `execute()` and `executeStream()`.

---

## [4.0.0] — 2025-10 — Semantic Cache

### Added

- **Semantic Cache**: `SemanticCache` class with:
  - Vanilla cosine similarity math (no external ML dependencies)
  - Configurable `threshold` (0.0–1.0, default: 0.95) and `ttlMs` (default: 24h)
  - FIFO eviction (max 500 entries)
  - `set(prompt, vector, response)` and `get(vector)` methods
- **`semanticCache` Option**: Pass `{ threshold, ttlMs, getEmbedding }` to `ApiKeyManagerOptions`.
- **`prompt` Option**: `execute()` and `executeStream()` now accept a `prompt` string for cache lookup.

---

## [3.0.0] — 2025-08 — Bulkhead, Error Classification, Provider Tags

### Added

- **Error Classification System**: `classifyError(error, finishReason?)` returns `ErrorClassification` with:
  - `type`: `QUOTA`, `AUTH`, `TRANSIENT`, `SAFETY`, `RECITATION`, `TIMEOUT`, `BAD_REQUEST`, `UNKNOWN`
  - `retryable`, `cooldownMs`, `markKeyFailed`, `markKeyDead` booleans
  - `Retry-After` header parsing for quota errors
- **Gemini-Specific Handling**: `SAFETY` and `RECITATION` finish reasons don't mark keys as failed.
- **Bulkhead/Concurrency Control**: Via cockatiel `BulkheadPolicy`:
  - `concurrency` option (max concurrent `execute()` calls)
  - `concurrencyQueueSize` option (FIFO queue for excess requests, default: 0 = reject)
  - `BulkheadRejectionError` thrown when queue is full
  - `bulkheadRejected` event emitted on rejection
- **Provider Tags**: `KeyState.provider` field. `getKeyByProvider(provider)` method. `provider` filter in `ExecuteOptions`.
- **Zod Validation**: `ApiKeyManagerOptionsSchema` for runtime options validation.

### Changed

- Constructor now accepts options object (`ApiKeyManagerOptions`) in addition to legacy positional args.
- `markFailed(key, classification)` replaces `markFailedLegacy(key, isQuota)` (legacy still available).
- Error patterns now use regex for faster matching.

---

## [2.0.0] — 2025-06 — Strategies & Latency

### Added

- **Load Balancing Strategies**:
  - `StandardStrategy`: Least failed → Least recently used (original behavior)
  - `WeightedStrategy`: Probabilistic selection based on key `weight` (0.0–1.0)
  - `LatencyStrategy`: Lowest average latency with LRU tie-break
- **Latency Tracking**: `KeyState.averageLatency`, `totalLatency`, `latencySamples`. Updated via `markSuccess(key, durationMs)`.
- **Key Weights**: `KeyState.weight` field (default: 1.0). Configurable per-key on construction.
- **`getKeyCount()`**: Returns number of non-dead keys.

### Changed

- `markSuccess()` now accepts an optional `durationMs` parameter for latency tracking.
- Key selection delegated to `LoadBalancingStrategy.next(candidates)`.

---

## [1.0.0] — 2025-04 — Initial Release

### Added

- **Circuit Breaker**: `CLOSED → OPEN → HALF_OPEN → DEAD` state machine.
- **Error Detection**: Automatic detection of 429 (Quota), 403 (Auth), 5xx (Transient) errors.
- **Exponential Backoff**: Configurable base/max backoff with jitter.
- **`execute()` Wrapper**: Single method for the full lifecycle.
- **Event Emitter**: `keyDead`, `circuitOpen`, `circuitHalfOpen`, `keyRecovered`, `fallback`, `allKeysExhausted`, `retry`, `executeSuccess`, `executeFailed`.
- **Fallback Function**: `fallbackFn` option called when all keys are exhausted.
- **Timeout Support**: `timeoutMs` option with `AbortController`.
- **Key Stats**: `getStats()` returns `{ total, healthy, cooling, dead }`.
- **Persistence Interface**: `storage` option with `getItem`/`setItem` contract.
- **State Persistence**: `saveState()` and `loadState()` with debounced writes.
- **Custom Errors**: `TimeoutError`, `AllKeysExhaustedError`.
- **Cooldown System**: Separate cooldowns for transient (1 min), quota (5 min), and Retry-After headers.

---

[5.5.0]: https://github.com/SplashCodeDex/ApiKeyManager/compare/v5.4.0...v5.5.0
[5.4.0]: https://github.com/SplashCodeDex/ApiKeyManager/compare/v5.3.0...v5.4.0
[5.3.0]: https://github.com/SplashCodeDex/ApiKeyManager/compare/v5.2.0...v5.3.0
[5.2.0]: https://github.com/SplashCodeDex/ApiKeyManager/compare/v5.1.0...v5.2.0
[5.1.0]: https://github.com/SplashCodeDex/ApiKeyManager/compare/v5.0.0...v5.1.0
[5.0.0]: https://github.com/SplashCodeDex/ApiKeyManager/compare/v4.1.0...v5.0.0
[4.1.0]: https://github.com/SplashCodeDex/ApiKeyManager/compare/v4.0.0...v4.1.0
[4.0.0]: https://github.com/SplashCodeDex/ApiKeyManager/compare/v3.0.0...v4.0.0
[3.0.0]: https://github.com/SplashCodeDex/ApiKeyManager/compare/v2.0.0...v3.0.0
[2.0.0]: https://github.com/SplashCodeDex/ApiKeyManager/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/SplashCodeDex/ApiKeyManager/releases/tag/v1.0.0