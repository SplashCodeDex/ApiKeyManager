import asyncio
import pytest
import time
from unittest.mock import AsyncMock

from splashcodex_api_manager.core.manager import ApiKeyManager, TimeoutError, AllKeysExhaustedError
from splashcodex_api_manager.core.types import ErrorClassification, ErrorType, ExecuteOptions, CircuitState
from splashcodex_api_manager.persistence.memory import MemoryStorage

class MockError(Exception):
    def __init__(self, status):
        self.status_code = status

@pytest.fixture
def manager():
    keys = [{'key': f'key-{i}', 'weight': 1.0, 'provider': 'default'} for i in range(1, 4)]
    storage = MemoryStorage()
    return ApiKeyManager(keys, storage=storage, concurrency=5)

@pytest.mark.asyncio
async def test_successful_execution(manager):
    mock_fn = AsyncMock(return_value="Success")
    result = await manager.execute(mock_fn)
    assert result == "Success"
    mock_fn.assert_called_once_with('key-1')
    assert manager.keys[0].successCount == 1
    assert manager.keys[0].totalRequests == 1

@pytest.mark.asyncio
async def test_rotation_on_429(manager):
    call_count = 0
    async def mock_fn(key):
        nonlocal call_count
        call_count += 1
        if key == 'key-1':
            raise MockError(429)
        return "Success"

    result = await manager.execute(mock_fn, ExecuteOptions(maxRetries=3))
    assert result == "Success"
    assert call_count == 2
    assert manager.keys[0].failCount == 1  # key-1 failed
    assert manager.keys[0].circuitState == CircuitState.OPEN  # Quota errors open circuit immediately
    assert manager.keys[1].successCount == 1 # key-2 succeeded


@pytest.mark.asyncio
async def test_circuit_breaker_on_403(manager):
    async def mock_fn(key):
        raise MockError(403)

    with pytest.raises(MockError):
        await manager.execute(mock_fn, ExecuteOptions(maxRetries=0))

    assert manager.keys[0].circuitState == CircuitState.DEAD

@pytest.mark.asyncio
async def test_all_keys_exhausted():
    manager = ApiKeyManager(
        initial_keys=["key-1"],
        storage=MemoryStorage(),
    )
    async def mock_fn(key):
        raise MockError(403) # Makes it DEAD

    with pytest.raises(MockError):
         await manager.execute(mock_fn, ExecuteOptions(maxRetries=0))

    with pytest.raises(AllKeysExhaustedError):
         await manager.execute(mock_fn, ExecuteOptions(maxRetries=0))

@pytest.mark.asyncio
async def test_timeout():
    manager = ApiKeyManager(["key-1"])
    async def mock_fn(key):
        await asyncio.sleep(0.5)
        return "Done"

    with pytest.raises(TimeoutError):
        await manager.execute(mock_fn, ExecuteOptions(timeoutMs=100, maxRetries=0))
