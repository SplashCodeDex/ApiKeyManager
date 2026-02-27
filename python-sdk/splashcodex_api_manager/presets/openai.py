from typing import Dict, List, Optional, Any
from .base import BasePreset, PresetOptions, Result

class OpenAIManager(BasePreset):
    PROVIDER = 'openai'

    def __init__(self, keys: List[str], options: PresetOptions):
        super().__init__(keys, options)

    @staticmethod
    def _get_default_options() -> PresetOptions:
        return PresetOptions(
            env_keys=['OPENAI_API_KEY'],
            provider=OpenAIManager.PROVIDER,
            concurrency=20,
            health_check_interval_ms=300000
        )

    @classmethod
    def get_instance(cls, overrides: Optional[Dict[str, Any]] = None) -> Result:
        return cls.create_instance(cls, cls._get_default_options(), overrides)

    @classmethod
    def reset(cls):
        cls.reset_instance(cls.PROVIDER)
