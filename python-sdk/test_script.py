import asyncio
import os
from loguru import logger
from splashcodex_api_manager.presets.gemini import GeminiManager
from splashcodex_api_manager.core.types import ExecuteOptions

logger.add("test_output.log", format="{time} {level} {message}", level="DEBUG")

class MockError(Exception):
    def __init__(self, status):
        self.status = status

async def mock_llm_call(key):
    logger.debug(f"Simulating LLM call with key: {key}")
    await asyncio.sleep(0.1) # Simulate network latency
    if key == "key-2":
        import random
        if random.random() < 0.5:
            logger.warning("Simulating 429 Too Many Requests on key-2")
            raise MockError(429)

    return f"Response successfully generated using {key}"

async def main():
    # Set up environment variables
    os.environ["GOOGLE_GEMINI_API_KEY"] = "key-1,key-2,key-3"

    manager_result = GeminiManager.get_instance()
    if not manager_result.success:
        logger.error(f"Failed to initialize: {manager_result.error}")
        return

    manager = manager_result.data

    async def run_task(task_id):
        try:
            result = await manager.execute(mock_llm_call, ExecuteOptions(maxRetries=3))
            logger.success(f"Task {task_id} completed: {result}")
        except Exception as e:
            logger.error(f"Task {task_id} failed: {e}")

    logger.info("Starting 10 concurrent requests...")
    tasks = [run_task(i) for i in range(10)]
    await asyncio.gather(*tasks)

    logger.info("Requests completed. Manager State:")
    for keyObj in manager.manager.keys:
        logger.info(f"Key: {keyObj.key} | Uses: {keyObj.totalRequests} | Fails: {keyObj.failCount} | State: {keyObj.circuitState.value}")

if __name__ == "__main__":
    asyncio.run(main())
