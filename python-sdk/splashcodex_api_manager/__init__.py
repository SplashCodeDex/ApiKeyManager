"""
splashcodex-api-manager
=======================
Universal API Key Management Gateway with Provider Presets,
Built-in Persistence, and Multi-Provider Vault.

Quick Start
-----------
>>> import asyncio
>>> from splashcodex_api_manager.presets.gemini import GeminiManager
>>> from splashcodex_api_manager.core.types import ExecuteOptions
>>>
>>> async def main():
>>>     gemini = await GeminiManager.get_instance()
>>>     result = await gemini.execute(
>>>         lambda key: call_my_llm(key, "Hello"),
>>>         ExecuteOptions(maxRetries=3)
>>>     )
>>>     print(result)
>>>
>>> asyncio.run(main())

To view all features, run in your terminal:
$ splashcodex-api-manager
"""

from .core.manager import ApiKeyManager, SemanticCache
from .core.types import KeyState, ErrorClassification, ErrorType, ExecuteOptions, ApiKeyManagerStats, CircuitState
from .core.strategies import LatencyStrategy, WeightedStrategy

__all__ = [
    'ApiKeyManager',
    'SemanticCache',
    'KeyState',
    'ErrorClassification',
    'ErrorType',
    'ExecuteOptions',
    'ApiKeyManagerStats',
    'CircuitState',
    'LatencyStrategy',
    'WeightedStrategy'
]
