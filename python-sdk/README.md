# splashcodex-api-manager v5.0 — Ecosystem Edition (Python)

> Universal API Key Management Gateway with Provider Presets, Built-in Persistence, and Multi-Provider Vault.

[![PyPI version](https://img.shields.io/pypi/v/splashcodex-api-manager)](https://pypi.org/project/splashcodex-api-manager/)

## New in v5.0 (Ecosystem Edition)

- **Provider Presets** — One-line setup for `GeminiManager`, `OpenAIManager`, and `MultiManager`.
- **Automatic Env Parsing** — Reads `GOOGLE_GEMINI_API_KEY`, etc. (supports JSON arrays and comma-separated strings).
- **Built-in Persistence** — `FileStorage` (survives restarts) and `MemoryStorage` included.
- **Singleton Pattern** — Thread-safe singletons with async `get_instance()`.
- **Multi-Provider Vault** — Manage multiple providers (`gemini`, `openai`, `anthropic`) from a single entry point.

## Features

- **Circuit Breaker** — Keys transition through `CLOSED → OPEN → HALF_OPEN → DEAD`
- **Error Classification** — Automatic detection of 429 (Quota), 403 (Auth), 5xx (Transient), Timeout
- **Pluggable Strategies** — `StandardStrategy`, `WeightedStrategy`, `LatencyStrategy`
- **`execute()` Wrapper** — Single async method: get key → call → latency → retry → fallback

## Installation

```bash
pip install splashcodex-api-manager
# or using uv
uv add splashcodex-api-manager
```

## Quick Start (v5 Presets)

### Auto-Scaffold (New!)
The fastest way to get started is to run the `init` command in your project directory:
```bash
splashcodex-api-manager init
# or
python -m splashcodex_api_manager init
```
This will automatically create a `.env` template and a `demo.py` file showing the Gemini Preset in action.

### Gemini Preset
Reads `GOOGLE_GEMINI_API_KEY` or `GEMINI_API_KEY` from the environment.

```python
import asyncio
from splashcodex_api_manager.presets.gemini import GeminiManager
from splashcodex_api_manager.core.types import ExecuteOptions

async def call_gemini(key, prompt):
    # Your arbitrary LLM call logic here
    # Example using google-genai:
    # return await client.aio.models.generate_content(...)
    pass

async def main():
    gemini = await GeminiManager.get_instance()

    # The manager automatically handles key rotation on failure (429, 500)
    response = await gemini.execute(
        lambda key: call_gemini(key, "Hello!"),
        ExecuteOptions(maxRetries=3)
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
    vault = await MultiManager.get_instance({
        "providers": {
            "gemini": { "envKeys": ["GOOGLE_GEMINI_API_KEY"] },
            "openai": { "envKeys": ["OPENAI_API_KEY"] }
        }
    })

    # Route by provider explicitly
    res = await vault.execute(
        lambda key: call_gemini(key, "Hi"),
        provider="gemini"
    )

asyncio.run(main())
```

---

## v5.0 — Architecture & Persistence

### Built-in Persistence
State (cooling down keys, dead keys, usage counts) survives application restarts to prevent spamming exhausted keys.

```python
import asyncio
from splashcodex_api_manager.core.manager import ApiKeyManager
from splashcodex_api_manager.persistence.file import FileStorage

async def main():
    manager = ApiKeyManager(["key1", "key2"])

    # Load past failure history
    storage = FileStorage(file_path='./api_state.json')
    await manager.load_state(storage)

    # ... use the keys ...

    # Save before exiting
    await manager.save_state(storage)
```

## Execute Wrapper

Wraps the entire lifecycle into one async method. Automatically trips circuit breakers on persistent failures and seamlessly rotates to the next available key.

```python
from splashcodex_api_manager.core.types import ExecuteOptions

result = await manager.execute(
  fn=lambda key: httpx_call(key),
  options=ExecuteOptions(maxRetries=5, timeoutMs=10000)
)
```

## API Reference

### Presets

| Class | Env Vars | Description |
|-------|----------|-------------|
| `GeminiManager` | `GOOGLE_GEMINI_API_KEY`, `GEMINI_API_KEY` | Gemini-optimized asynchronous singleton |
| `OpenAIManager` | `OPENAI_API_KEY` | OpenAI-optimized asynchronous singleton |
| `MultiManager` | Custom | Thread-safe Vault for multiple provider pools |

### Persistence

| Class | Description |
|-------|-------------|
| `FileStorage` | Persists to a JSON file (recommended for servers and CLI tools) |
| `MemoryStorage` | In-memory only (best for serverless/short-lived processes) |

## License

ISC
