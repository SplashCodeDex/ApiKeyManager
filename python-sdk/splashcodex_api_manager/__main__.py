import sys
import os
import textwrap

def print_usage():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    print('\033[92m* splashcodex-api-manager v5.0\033[0m')
    print('\033[96m  Documentation: https://pypi.org/project/splashcodex-api-manager/\033[0m\n')
    print('\033[93m  Commands:\033[0m')
    print('   splashcodex-api-manager init    \033[90m# Scaffold a demo project in the current directory\033[0m')
    print('\n\033[95m  Tip: Need help? Run init to see it in action!\033[0m\n')

def init_project():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    cwd = os.getcwd()
    env_path = os.path.join(cwd, '.env')
    demo_path = os.path.join(cwd, 'demo.py')

    print('\n\033[96m>> Initializing splashcodex-api-manager environment...\033[0m\n')

    # Create .env
    if not os.path.exists(env_path):
        with open(env_path, 'w') as f:
            f.write('GOOGLE_GEMINI_API_KEY="your_api_key_1,your_api_key_2"\nOPENAI_API_KEY="sk-..."\n')
        print('\033[92m[OK] Created .env file\033[0m')
    else:
        print('\033[90m[-] .env already exists. Remember to add GOOGLE_GEMINI_API_KEY!\033[0m')

    # Create demo.py
    if not os.path.exists(demo_path):
        py_code = textwrap.dedent("""\
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
        """)
        with open(demo_path, 'w') as f:
            f.write(py_code)
        print('\033[92m[OK] Created demo.py\033[0m')
    else:
        print('\033[90m[-] demo.py already exists.\033[0m')

    print('\n\033[93m>> Setup Complete!\033[0m')
    print('To run the demo:')
    print('\033[36m   pip install python-dotenv\033[0m')
    print('\033[36m   python demo.py\033[0m\n')

def main():
    args = sys.argv[1:]
    if args and args[0] == 'init':
        init_project()
    else:
        print_usage()

if __name__ == '__main__':
    main()
