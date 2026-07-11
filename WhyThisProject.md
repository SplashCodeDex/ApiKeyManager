# Why This Project Exists

## The Problem

As a developer managing **35+ projects**, I faced a recurring nightmare:

- **Duplicate `.env` files everywhere** — every project has its own `.env`, but most share the same API keys (Gemini, OpenAI, Stripe, Redis, Supabase, etc.)
- **Key rotation is painful** — when a key expires or gets rotated, you must hunt through every project, find where that key was used, and update it individually
- **No central source of truth** — there's no way to know which projects use which keys without manually auditing each one
- **Quota exhaustion is silent** — a single project can burn through a shared API key's quota without the other 34 projects knowing until they all fail
- **Frontend key leaks** — API keys embedded in frontend code are exposed to the world. Backend keys need a different treatment.

## The Vision

I wanted a **centralized state for environment variables** that lives in `~/codedex/env/` (portable via Google Drive):

```
~/codedex/env/
  common.env       — DATABASE_URL, REDIS_URL, SUPABASE_URL, etc.
  llm.env          — GOOGLE_GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY
  stripe.env       — STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
  <custom>.env     — Any additional grouping of related secrets
```

All 35+ projects just call `loadCentralEnv()` once at their entry point, and they instantly have access to all shared secrets. No duplicate `.env` files. No forgotten keys. No outdated values.

## Beyond Just Loading: Key Intelligence

Loading keys from a central location solves the "where" problem but not the "how" problem. Real-world API keys face these issues:

| Problem | Without ApiKeyManager | With ApiKeyManager |
|---------|----------------------|-------------------|
| **429 Rate Limit** | App crashes. Developer manually switches keys. | Circuit breaker opens, next key auto-selected. Key auto-heals after cooldown. |
| **403 Invalid Key** | App keeps retrying the dead key. | Key marked DEAD permanently. Never used again. |
| **500 Server Error** | App gives up after one failure. | Exponential backoff with decorrelated jitter. Automatic retry with a different key. |
| **Key Quota Exhausted** | All 35 projects fail simultaneously. | Only projects hitting the exhausted key rotate. Others continue normally. |
| **Slow Key** | App suffers from high latency. | `LatencyStrategy` routes to the fastest key. Slow keys get deprioritized automatically. |
| **Process Restart** | All circuit breaker state lost. Keys retried while still rate-limited. | `FileStorage` persists state to disk. Cooled-down keys stay cooled-down across reboots. |

## The Three-Layer Architecture

### Layer 1: Central Env Loader

All API keys live in `~/codedex/env/`. Every project calls `loadCentralEnv()` once:

```typescript
import { loadCentralEnv } from '@splashcodex/api-key-manager/env';
loadCentralEnv();
```

**What it does:**
- Reads all `.env` files from `~/codedex/env/` (alphabetically sorted for determinism)
- Parses using `dotenv` (handles quotes, multiline, comments, escape sequences)
- Supports JSON arrays and comma-separated values for multiple keys
- Falls back to `~/.codedex/api_keys.json` if no env vars found
- Optional: preserve existing `process.env` values (project-local overrides)
- Custom directory paths via `CODEDEX_ENV_DIR` for team-shared locations

### Layer 2: ApiKeyManager (Presets)

Takes those keys and wraps them with production-grade resilience:

```typescript
import { GeminiManager } from '@splashcodex/api-key-manager/presets/gemini';

const gemini = GeminiManager.getInstance().data!;
const response = await gemini.execute(apiCall, { maxRetries: 3 });
```

**What it does automatically:**
- **Circuit Breaker**: `CLOSED → OPEN → HALF_OPEN → DEAD` state machine
- **Error Classification**: Auto-detects 429 (Quota), 403 (Auth), 5xx (Transient), Timeout, Safety blocks
- **Exponential Backoff**: Decorrelated jitter (statistically superior to simple random jitter)
- **Key Rotation**: On failure, automatically selects the next best key
- **Latency Tracking**: Rolling average latency per key — favors the fastest keys
- **Concurrency Control**: Bulkhead pattern limits concurrent calls per provider
- **Semantic Cache**: Cosine-similarity cache — identical prompts don't consume API credits
- **Health Checks**: Periodic testing of cooled-down keys to see if they've recovered
- **Persistence**: State survives restarts via atomic file writes

### Layer 3: API Gateway

A Fastify proxy server that all your apps call — zero API keys in client code:

```bash
npm run gateway
# All apps call http://localhost:9000/{provider}/... instead of provider APIs directly
```

**What it does:**
- **Transparent Proxy**: Strips `/{provider}` prefix, injects API key, forwards to real provider
- **Per-App Rate Limiting**: Via `x-app-id` header + `GATEWAY_RATE_LIMITS` env var
- **Audit Trail**: Every request logged to a ring buffer (10K entries), filterable by app/provider
- **Provider Extensibility**: Add any provider at runtime via `GATEWAY_EXTRA_PROVIDERS` JSON
- **SSE Resilience**: Mid-stream errors emit structured `event: error` — clients don't hang
- **Graceful Shutdown**: SIGTERM/SIGINT handlers cleanly close connections and persist state

## Real-World Flow

```
┌──────────────────────────────────────────────────────────┐
│ 1. YOU set up keys ONCE:                                  │
│    ~/codedex/env/llm.env → GOOGLE_GEMINI_API_KEY="k1,k2"  │
│                                                            │
│ 2. ANY project loads them with ONE line:                   │
│    import { loadCentralEnv } from '.../env';               │
│    loadCentralEnv();                                       │
│                                                            │
│ 3. GeminiManager auto-rotates on failures:                 │
│    gemini.execute(callGemini)                              │
│    → key k1 fails with 429                                 │
│    → circuit opens on k1 (5 min cooldown)                  │
│    → auto-rotates to k2                                    │
│    → k2 succeeds                                           │
│    → after 5 min, k1 auto-tested and recovered             │
│                                                            │
│ 4. OR use the Gateway for zero-key client code:             │
│    curl localhost:9000/gemini/v1beta/models/...            │
│    → gateway strips /gemini prefix                         │
│    → gateway selects best key via MultiManager             │
│    → gateway injects key, forwards to Google                │
│    → returns response, client never sees the key            │
└──────────────────────────────────────────────────────────┘
```

## Why Not Just Use `.env` Files Per Project?

Because that's the problem this project was born to solve:

1. **35 `.env` files to maintain** — one key change requires updating 35 files
2. **No key health awareness** — a `.env` file doesn't know that key #2 is currently rate-limited
3. **No rotation logic** — `.env` gives you one key. When it fails, you're down.
4. **No cross-project visibility** — Project A burns through the quota. Projects B-Z have no idea until they fail.
5. **No persistence** — Circuit breaker state is lost on restart. You'd hit the same rate-limited key again.

## The Result

A single, portable `~/codedex/env/` directory that:
- All projects read from (zero duplication)
- Provides intelligent key rotation with circuit breakers
- Offers a gateway for zero-key client architectures
- Survives restarts (persists state)
- Self-heals (health checks test cooled-down keys)
- Works with any LLM provider (Gemini, OpenAI, Anthropic + custom)
- Has a Python port for Python projects

---

*This project was inspired by the real pain of managing API keys across 35+ repositories. The LLM API key problem was the catalyst — being able to seamlessly switch between different providers and models without any project noticing unless it was required.*

*— CodeDeX*