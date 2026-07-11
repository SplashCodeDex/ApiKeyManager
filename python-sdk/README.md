# splashcodex-api-manager v5.0.2 — Ecosystem Edition (Python)

> Universal API Key Management Gateway with Provider Presets, Built-in Persistence, and Multi-Provider Vault.

[![PyPI version](https://img.shields.io/pypi/v/splashcodex-api-manager)](https://pypi.org/project/splashcodex-api-manager/)
[![Python Versions](https://img.shields.io/pypi/pyversions/splashcodex-api-manager)](https://pypi.org/project/splashcodex-api-manager/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

---

## Table of Contents

- [What's New in v5.0](#whats-new-in-v50)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Advanced Features](#advanced-features)
- [CLI Commands](#cli-commands)
- [Development \& Testing](#development--testing)
- [Differences from TypeScript Version](#differences-from-typescript-version)
- [License](#license)

---

## What's New in v5.0

- **Provider Presets** — One-line setup for `GeminiManager`, `OpenAIManager`, and `MultiManager`.
- **Automatic Env Parsing** — Reads `GOOGLE_GEMINI_API_KEY`, `OPENAI_API_KEY`, etc. (supports JSON arrays and comma-separated strings).
- **Built-in Persistence** — `FileStorage` (survives restarts) and `MemoryStorage` included.
- **Singleton Pattern** — Thread-safe singletons with async `get_instance()` and `Result<T>` pattern.
- **Multi-Provider Vault** — Manage multiple providers (`gemini`, `openai`, `anthropic`) from a single entry point.

---

## Features

- **Circuit Breaker** — Keys transition through `CLOSED → OPEN → HALF_OPEN → DEAD`
- **Error Classification** — Automatic detection of 429 (Quota), 403 (Auth), 5xx (Transient), Timeout
- **Pluggable Strategies** — `StandardStrategy`, `WeightedStrategy`, `LatencyStrategy`
- **`execute()` Wrapper** — Single async method: get key → call → classify error → retry → fallback
- **`executeStream()` Wrapper** — Async generator variant with initial-retry logic
- **Semantic Cache** — Cosine-similarity cache with pluggable embeddings
- **Event System** — Typed lifecycle hooks for monitoring & alerting
- **Concurrency Control** — Limit concurrent calls per manager
- **Health Checks** — Periodic testing of cooled-down keys
- **Fallback Function** — Called when all keys are exhausted

---

## Installation

```bash
pip install splashcodex-api-manager
# or using uv
uv add splashcodex-api-manager
```

Requires **Python 3.9+**.

### Dependencies

- **[pydantic](https://docs.pydantic.dev/) >= 2.0.0** — Data validation
- **[loguru](https://github.com/Delgan/loguru) >= 0.7.0** — Structured logging

Optional for development:
```bash
pip install splashcodex-api-manager[dev]  # includes pytest, pytest-asyncio
```

---

## Quick Start

### Auto-Scaffold

The fastest way to get started is to run the `init` command in your project directory:

```bash
splashcodex-api-manager init
# or
python -m splashcodex_api_manager init
```

This automatically creates a `.env` template and a `demo.py` file showing the Gemini Preset in action.

### Gemini Preset

Reads `GOOGLE_GEMINI_API_KEY` or `GEMINI_API_KEY` from the environment.

```python
import asyncio
from splashcodex_api_manager.presets.gemini import GeminiManager
from splashcodex_api_manager.core.types import ExecuteOptions

async def call_gemini(key, prompt):
    # Your arbitrary LLM call logic here
    # Example using google-genai:
    # from google import genai
    # client = genai.Client(api_key=key)
    # response = await client.aio.models.generate_content(
    #     model="gemini-2.0-flash",
    #     contents=prompt,
    # )
    # return response.text
    pass

async def main():
    gemini_result = await GeminiManager.get_instance()
    if not gemini_result.success:
        print(f"Failed: {gemini_result.error}")
        return

    gemini = gemini_result.data

    # The manager automatically handles key rotation on failure (429, 500)
    response = await gemini.execute(
        lambda key: call_gemini(key, "Hello!"),
        ExecuteOptions(maxRetries=3)
    )
    print(response)

asyncio.run(main())
```

### OpenAI Preset

```python
import asyncio
from splashcodex_api_manager.presets.openai import OpenAIManager
from splashcodex_api_manager.core.types import ExecuteOptions

async def main():
    openai_result = await OpenAIManager.get_instance()
    if not openai_result.success:
        print(f"Failed: {openai_result.error}")
        return

    openai = openai_result.data

    response = await openai.execute(
        lambda key: call_openai(key, "Hello!"),
        ExecuteOptions(maxRetries=3, timeoutMs=30000)
    )
    print(response)

asyncio.run(main())
```

### Multi-Provider Vault

Perfect for gateways or complex AI agents handling multiple models.

```python
import asyncio
from splashcodex_api_manager.presets.multi import MultiManager

async def main():
    vault_result = await MultiManager.get_instance({
        "providers": {
            "gemini": { "envKeys": ["GOOGLE_GEMINI_API_KEY"] },
            "openai": { "envKeys": ["OPENAI_API_KEY"] },
            "anthropic": { "envKeys": ["ANTHROPIC_API_KEY"] },
        }
    })

    if not vault_result.success:
        print(f"Failed: {vault_result.error}")
        return

    vault = vault_result.data

    # Route by provider explicitly
    res = await vault.execute(
        lambda key: call_gemini(key, "Hi"),
        provider="gemini"
    )

    # Get stats across all providers
    stats = vault.get_multi_stats()
    print(stats)

asyncio.run(main())
```

---

## API Reference

### Presets

| Class | Env Vars | Python Import |
|-------|----------|---------------|
| `GeminiManager` | `GOOGLE_GEMINI_API_KEY`, `GEMINI_API_KEY` | `...presets.gemini` |
| `OpenAIManager` | `OPENAI_API_KEY` | `...presets.openai` |
| `MultiManager` | Custom per-provider | `...presets.multi` |

All presets share these defaults:
- **Strategy**: `LatencyStrategy` (lowest-latency key with LRU tie-break)
- **Concurrency**: 20 concurrent requests
- **Persistence**: `FileStorage` — survives restarts (`clear_on_init=True` by default for presets)

### Persistence

| Class | Python Import | Description |
|-------|---------------|-------------|
| `FileStorage` | `...persistence.file` | Persists to a JSON file. Best for servers and CLI tools. |
| `MemoryStorage` | `...persistence.memory` | In-memory only. Best for serverless/short-lived processes. |

### Core `ApiKeyManager`

#### Constructor

```python
from splashcodex_api_manager.core.manager import ApiKeyManager
from splashcodex_api_manager.persistence.file import FileStorage
from splashcodex_api_manager.core.strategies import LatencyStrategy

manager = ApiKeyManager(
    initial_keys=["key1", "key2"],
    storage=FileStorage(file_path="./state.json", clear_on_init=False),
    strategy=LatencyStrategy(),
    fallback_fn=lambda: cached_response,  # Called when all keys exhausted
    concurrency=20,  # Max concurrent execute() calls
    semantic_cache={
        "threshold": 0.92,
        "ttlMs": 86400000,  # 24 hours
        "getEmbedding": my_embedding_function,
    },
)
```

#### Core Methods

| Method | Description |
|--------|-------------|
| `execute(fn, options?)` | Full lifecycle: get key → call → classify error → retry with backoff → fallback |
| `executeStream(fn, options?)` | Async generator variant with initial-retry logic |
| `get_key()` | Manual key selection (best healthy key). Returns `str \| None` |
| `get_key_by_provider(provider)` | Get a key filtered by provider tag |
| `get_stats()` | Pool health: `{ total, healthy, cooling, dead }` |
| `get_key_count()` | Number of non-dead keys |
| `mark_success(key, duration_ms?)` | Mark a key as healthy, update latency stats |
| `mark_failed(key, classification)` | Mark a key as failed, trigger circuit breaker |
| `classify_error(error, finish_reason?)` | Classify error into type |
| `set_health_check(fn)` | Set health check function `(key) -> bool` |
| `start_health_checks(interval_ms?)` | Start periodic health checks |
| `stop_health_checks()` | Stop health checks |
| `load_state(storage)` | Load persisted state from storage |
| `save_state(storage)` | Save current state to storage |

#### ExecuteOptions

```python
from splashcodex_api_manager.core.types import ExecuteOptions

options = ExecuteOptions(
    maxRetries=3,      # Max retry attempts (default: 0)
    timeoutMs=10000,   # Timeout per attempt in ms
    finishReason=None,  # For Gemini: SAFETY, RECITATION
    provider=None,     # Filter keys by provider tag
    prompt=None,       # For semantic cache lookup
)
```

#### Load Balancing Strategies

| Strategy | Description |
|----------|-------------|
| `StandardStrategy` | Least failed → Least recently used |
| `WeightedStrategy` | Probabilistic selection based on key weight (0.0–1.0) |
| `LatencyStrategy` | Lowest average latency with LRU tie-break (default for presets) |

---

## Advanced Features

### Circuit Breaker

Keys transition through states automatically:
- `CLOSED` → normal operation
- `OPEN` → on cooldown (too many failures or quota hit)
- `HALF_OPEN` → testing if key has recovered
- `DEAD` → permanently removed (403 auth error)

### Error Classification

| Error Type | HTTP Code | Retryable? | Effect on Key |
|------------|-----------|------------|---------------|
| `QUOTA` | 429 | Yes | Opens circuit, respects `Retry-After` |
| `AUTH` | 403 | No | Marks key **DEAD** |
| `TRANSIENT` | 500+ | Yes | Increments fail count, 1min cooldown |
| `TIMEOUT` | — | Yes | Increments fail count |
| `SAFETY` | — | No | No effect (not a key issue) |
| `RECITATION` | — | No | No effect (not a key issue) |
| `BAD_REQUEST` | 400 | No | No effect (fix your request) |

### Semantic Cache

```python
from splashcodex_api_manager.core.manager import ApiKeyManager

manager = ApiKeyManager(
    ["key1", "key2"],
    semantic_cache={
        "threshold": 0.92,
        "ttlMs": 24 * 60 * 60 * 1000,
        "getEmbedding": my_embedding_function,
    },
)

# First call — cache MISS
r1 = await manager.execute(api_fn, prompt="What is the weather?")

# Second call — cache HIT (semantically similar)
r2 = await manager.execute(api_fn, prompt="How is the weather today?")
# Returns cached response — zero API cost!
```

The cache uses vanilla cosine similarity math (no external ML dependencies). Max 500 entries (FIFO eviction).

### Persistence

State survives restarts — cooled-down keys stay cooled-down:

```python
from splashcodex_api_manager.core.manager import ApiKeyManager
from splashcodex_api_manager.persistence.file import FileStorage

manager = ApiKeyManager(["key1", "key2"])

# Load past failure history
storage = FileStorage(file_path="./api_state.json", clear_on_init=False)
await manager.load_state(storage)

# ... use the keys ...

# Save before exiting
await manager.save_state(storage)
```

### Event System

```python
from splashcodex_api_manager.core.manager import ApiKeyManager

manager = ApiKeyManager(["key1", "key2"])

manager.on('keyDead', lambda key: print(f"Key DEAD: ...{key[-4:]}"))
manager.on('circuitOpen', lambda key: print(f"Circuit OPEN: ...{key[-4:]}"))
manager.on('circuitHalfOpen', lambda key: print(f"Testing key: ...{key[-4:]}"))
manager.on('keyRecovered', lambda key: print(f"Key RECOVERED: ...{key[-4:]}"))
manager.on('fallback', lambda reason: print(f"FALLBACK: {reason}"))
manager.on('allKeysExhausted', lambda: print("ALL KEYS EXHAUSTED!"))
manager.on('retry', lambda key, attempt, delay: print(f"Retry ...{key[-4:]} (Attempt {attempt})"))
manager.on('executeSuccess', lambda key, duration: print(f"Success: {duration}ms"))
manager.on('executeFailed', lambda key, error: print(f"Failed: {error}"))
manager.on('bulkheadRejected', lambda: print("Bulkhead rejected!"))
```

---

## CLI Commands

```bash
# Show help and version
splashcodex-api-manager

# Scaffold .env + demo.py in current directory
splashcodex-api-manager init
# or
python -m splashcodex_api_manager init
```

The `init` command creates:
- `.env` — template with `GOOGLE_GEMINI_API_KEY` and `OPENAI_API_KEY`
- `demo.py` — working example showing Gemini Preset usage

---

## Development & Testing

```bash
# Install with dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Run specific test file
pytest tests/test_presets.py -v
```

### Test Suite

| Test File | What It Covers |
|-----------|---------------|
| `tests/test_manager.py` | Core ApiKeyManager: rotation, circuit breaker, timeout, exhaustion |
| `tests/test_presets.py` | Presets: GeminiManager, MultiManager initialization |

---

## Differences from TypeScript Version

The Python SDK tracks the TypeScript codebase closely but has some differences:

| Feature | TypeScript v5.4 | Python v5.0.2 |
|---------|----------------|---------------|
| Provider Presets | Gemini, OpenAI, Anthropic, Multi | Gemini, OpenAI, Multi |
| API Gateway (Fastify) | ✅ | ❌ (TypeScript-only) |
| Per-App Rate Limiting | ✅ | ❌ |
| `executeStream()` | ✅ | ✅ |
| Semantic Cache | ✅ | ✅ |
| Health Checks | ✅ | ✅ |
| CLI `setup`/`status` | ✅ | ❌ (init only) |
| Home dir config (`~/.codedex/api_keys.json`) | ✅ | ❌ |
| `AnthropicManager` preset | ✅ | ❌ (coming soon) |
| Centralized Env Loader (`~/codedex/env/`) | ✅ | ❌ (TypeScript-only) |

> **Note:** The Python SDK focuses on the core ApiKeyManager functionality. The API Gateway, centralized env loader, and per-app rate limiting are TypeScript-only features. For Python projects, use the core manager directly with `python-dotenv` to load environment variables.

---

## License

ISC

---

*See the main [README.md](../README.md) for the full project documentation and architecture overview.*