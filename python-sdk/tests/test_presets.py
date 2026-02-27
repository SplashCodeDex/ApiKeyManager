import os
import pytest
from splashcodex_api_manager.presets.gemini import GeminiManager
from splashcodex_api_manager.presets.multi import MultiManager

def test_gemini_preset_initialization(monkeypatch):
    monkeypatch.setenv("GOOGLE_GEMINI_API_KEY", "mock-gemini-key")
    GeminiManager.reset()

    result = GeminiManager.get_instance()
    assert result.success is True
    manager = result.data
    assert manager.get_key() == "mock-gemini-key"

def test_multi_preset_initialization(monkeypatch):
    monkeypatch.setenv("GOOGLE_GEMINI_API_KEY", "mock-gemini-key")
    monkeypatch.setenv("OPENAI_API_KEY", "mock-openai-key")
    MultiManager.reset()

    result = MultiManager.get_instance({
        'providers': {
            'gemini': {'env_keys': ['GOOGLE_GEMINI_API_KEY']},
            'openai': {'env_keys': ['OPENAI_API_KEY']}
        }
    })
    assert result.success is True
    manager = result.data

    assert manager.get_key('gemini') == "mock-gemini-key"
    assert manager.get_key('openai') == "mock-openai-key"
    assert manager.get_key('unknown') is None
