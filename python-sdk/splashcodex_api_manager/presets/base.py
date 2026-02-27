import os
import json
import tempfile
from typing import Dict, List, Optional, TypeVar, Type, Callable, Any, Coroutine, AsyncGenerator
from loguru import logger

from ..core.manager import ApiKeyManager
from ..core.strategies import LoadBalancingStrategy, LatencyStrategy
from ..core.types import ExecuteOptions
from ..persistence.file import FileStorage

T = TypeVar('T', bound='BasePreset')

class PresetOptions:
    def __init__(
        self,
        env_keys: List[str],
        provider: str = 'default',
        strategy: Optional[LoadBalancingStrategy] = None,
        concurrency: int = 20,
        health_check_interval_ms: int = 300000,
        health_check_fn: Optional[Callable[[str], Coroutine[Any, Any, bool]]] = None,
        semantic_cache: Optional[Dict[str, Any]] = None,
        fallback_fn: Optional[Callable] = None,
        state_file_path: Optional[str] = None
    ):
        self.env_keys = env_keys
        self.provider = provider
        self.strategy = strategy
        self.concurrency = concurrency
        self.health_check_interval_ms = health_check_interval_ms
        self.health_check_fn = health_check_fn
        self.semantic_cache = semantic_cache
        self.fallback_fn = fallback_fn
        self.state_file_path = state_file_path

class Result:
    def __init__(self, success: bool, data: Optional[Any] = None, error: Optional[Exception] = None):
        self.success = success
        self.data = data
        self.error = error

class BasePreset:
    _instances: Dict[str, 'BasePreset'] = {}

    def __init__(self, api_keys: List[str], options: PresetOptions):
        self.options = options
        provider = options.provider

        state_file = options.state_file_path
        if not state_file:
            state_file = os.path.join(tempfile.gettempdir(), f"codedex_{provider}_state.json")

        storage = FileStorage(file_path=state_file, clear_on_init=True)
        provider_keys = [{'key': k, 'weight': 1.0, 'provider': provider} for k in api_keys]

        self.manager = ApiKeyManager(
            initial_keys=provider_keys,
            storage=storage,
            strategy=options.strategy or LatencyStrategy(),
            fallback_fn=options.fallback_fn,
            concurrency=options.concurrency,
            semantic_cache=options.semantic_cache
        )

        self._wire_events()
        logger.info(f"[{provider}] ApiKeyManager initialized with {len(api_keys)} keys (Concurrency: {options.concurrency})")

    def _wire_events(self):
        tag = self.options.provider
        self.manager.on('keyDead', lambda k: logger.error(f"[{tag}] Key PERMANENTLY DEAD: ...{k[-4:]}"))
        self.manager.on('circuitOpen', lambda k: logger.warning(f"[{tag}] Circuit OPEN: ...{k[-4:]}"))
        self.manager.on('keyRecovered', lambda k: logger.info(f"[{tag}] Key RECOVERED: ...{k[-4:]}"))
        self.manager.on('retry', lambda k, attempt, delay: logger.info(f"[{tag}] Retry with ...{k[-4:]} (Attempt {attempt}, Delay {delay}ms)"))
        self.manager.on('fallback', lambda reason: logger.warning(f"[{tag}] Triggering FALLBACK: {reason}"))
        self.manager.on('allKeysExhausted', lambda: logger.error(f"[{tag}] ALL KEYS EXHAUSTED!"))
        self.manager.on('bulkheadRejected', lambda: logger.warning(f"[{tag}] Bulkhead rejected request"))

    @classmethod
    def _parse_keys_from_env(cls, env_keys: List[str]) -> List[str]:
        keys = []
        for env_name in env_keys:
            val = os.environ.get(env_name, "").strip()
            if not val:
                continue
            if val.startswith('['):
                try:
                    parsed = json.loads(val)
                    if isinstance(parsed, list):
                        keys.extend([str(k).strip() for k in parsed if isinstance(k, str) and str(k).strip()])
                        continue
                except json.JSONDecodeError:
                    pass
            keys.extend([k.strip() for k in val.split(',') if k.strip()])
        return list(dict.fromkeys(keys)) # Deduplicate

    @classmethod
    def create_instance(cls: Type[T], preset_class: Type[T], default_options: PresetOptions, overrides: Optional[Dict[str, Any]] = None) -> Result:
        provider = overrides.get('provider', default_options.provider) if overrides else default_options.provider

        if provider in cls._instances:
            return Result(True, data=cls._instances[provider])

        env_keys = overrides.get('env_keys', default_options.env_keys) if overrides else default_options.env_keys
        keys = cls._parse_keys_from_env(env_keys)

        if not keys:
            logger.warning(f"[{provider}] No API keys found in env vars: {', '.join(env_keys)}. AI features disabled.")

        opts = PresetOptions(
            env_keys=env_keys,
            provider=provider,
            strategy=overrides.get('strategy', default_options.strategy) if overrides else default_options.strategy,
            concurrency=overrides.get('concurrency', default_options.concurrency) if overrides else default_options.concurrency,
            health_check_interval_ms=overrides.get('health_check_interval_ms', default_options.health_check_interval_ms) if overrides else default_options.health_check_interval_ms,
            health_check_fn=overrides.get('health_check_fn', default_options.health_check_fn) if overrides else default_options.health_check_fn,
            semantic_cache=overrides.get('semantic_cache', default_options.semantic_cache) if overrides else default_options.semantic_cache,
            fallback_fn=overrides.get('fallback_fn', default_options.fallback_fn) if overrides else default_options.fallback_fn,
            state_file_path=overrides.get('state_file_path', default_options.state_file_path) if overrides else default_options.state_file_path
        )

        try:
            instance = preset_class(keys, opts)
            cls._instances[provider] = instance
            return Result(True, data=instance)
        except Exception as e:
            return Result(False, error=e)

    @classmethod
    def reset_instance(cls, provider: str):
        if provider in cls._instances:
            del cls._instances[provider]

    @classmethod
    def reset_all(cls):
        cls._instances.clear()

    async def execute(self, fn: Callable[[str], Coroutine[Any, Any, Any]], options: Optional[ExecuteOptions] = None) -> Any:
        options = options or ExecuteOptions()
        options.provider = self.options.provider
        return await self.manager.execute(fn, options)

    def get_key(self) -> Optional[str]:
        return self.manager.get_key_by_provider(self.options.provider)
