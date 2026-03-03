import asyncio
import os
# If leveraging the .env file locally:
# from dotenv import load_dotenv
# load_dotenv()

from splashcodex_api_manager.presets.gemini import GeminiManager
from splashcodex_api_manager.core.types import ExecuteOptions

async def main():
    print("Initialize GeminiManager...")
    gemini = await GeminiManager.get_instance()

    print("Executing resilient request...")
    try:
        # Automatically handles key rotation on failure (e.g. 429 quota limits)
        response = await gemini.execute(
            lambda key: simulate_api_call(key),
            ExecuteOptions(maxRetries=3)
        )
        print(f"Result: {response}")
    except Exception as e:
        print(f"FAILED: {e}")

def simulate_api_call(key):
    print(f"[Network] Sending request with key: {key[:8]}...")
    # Put your favorite LLM client call here, like google-genai!
    return "Success: Simulated API Response!"

if __name__ == '__main__':
    asyncio.run(main())
