import os
import tempfile
from typing import Dict, List, Optional, Any, Callable, Coroutine
from loguru import logger

from ..core.manager import ApiKeyManager
from ..core.strategies import LatencyStrategy, LoadBalancingStrategy
from ..core.types import ExecuteOptions
from ..persistence.file import FileStorage
from .base import BasePreset, Result

class MultiManager:
    _instance: Optional['MultiManager'] = None

    def __init__(self, options: Dict[str, Any]):
        self.managers: Dict[str, ApiKeyManager] = {}

        providers = options.get('providers', {})
        for provider_name, config in providers.items():
            env_keys = config.get('env_keys', [])
            keys = BasePreset._parse_keys_from_env(env_keys)

            if not keys:
                logger.warning(f"[MultiManager:{provider_name}] No API keys found in: {', '.join(env_keys)}")

            state_file = os.path.join(tempfile.gettempdir(), f"codedex_multi_{provider_name}_state.json")
            storage = FileStorage(file_path=state_file, clear_on_init=True)

            provider_keys = [{'key': k, 'weight': 1.0, 'provider': provider_name} for k in keys]

            manager = ApiKeyManager(
                initial_keys=provider_keys,
                storage=storage,
                strategy=config.get('strategy', LatencyStrategy()),
                concurrency=config.get('concurrency', 20),
                semantic_cache=config.get('semantic_cache')
            )

            manager.on('keyDead', lambda k, p=provider_name: logger.error(f"[MultiManager:{p}] Key DEAD: ...{k[-4:]}"))
            manager.on('circuitOpen', lambda k, p=provider_name: logger.warning(f"[MultiManager:{p}] Circuit OPEN: ...{k[-4:]}"))
            manager.on('keyRecovered', lambda k, p=provider_name: logger.info(f"[MultiManager:{p}] Key RECOVERED: ...{k[-4:]}"))
            manager.on('allKeysExhausted', lambda p=provider_name: logger.error(f"[MultiManager:{p}] ALL KEYS EXHAUSTED"))

            self.managers[provider_name] = manager
            logger.info(f"[MultiManager:{provider_name}] Initialized with {len(keys)} keys")

    @classmethod
    def get_instance(cls, options: Dict[str, Any]) -> Result:
        if cls._instance:
            return Result(True, data=cls._instance)
        try:
            cls._instance = MultiManager(options)
            return Result(True, data=cls._instance)
        except Exception as e:
            return Result(False, error=e)

    @classmethod
    def reset(cls):
        cls._instance = None

    async def execute(self, fn: Callable[[str], Coroutine[Any, Any, Any]], options: ExecuteOptions) -> Any:
        provider = getattr(options, 'provider', None)
        if not provider or provider not in self.managers:
            raise ValueError(f"[MultiManager] Unknown provider '{provider}'. Available: {list(self.managers.keys())}")

        manager = self.managers[provider]
        return await manager.execute(fn, options)

    def get_key(self, provider: str) -> Optional[str]:
        if provider not in self.managers:
            return None
        return self.managers[provider].get_key_by_provider(provider)
