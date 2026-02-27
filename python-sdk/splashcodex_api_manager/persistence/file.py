import os
import json
import tempfile
from typing import Optional, Union, Dict, Any

class FileStorage:
    """
    File-Based Storage Adapter

    Persists API key state to a JSON file on disk.
    Survives process restarts so keys don't reset to CLOSED
    when an app reboots.
    """
    def __init__(self, file_path: Optional[str] = None, clear_on_init: bool = True):
        self.file_path = file_path or os.path.join(tempfile.gettempdir(), 'codedex_api_key_state.json')
        if clear_on_init is not False:
            self.clear()

    def get_item(self, key: str) -> Optional[str]:
        try:
            if os.path.exists(self.file_path):
                with open(self.file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    # If content is JSON strictly matching the object requested (state),
                    # Python SDK manager handles JSON string or dict.
                    # But the manager expects a dictionary natively if possible based on how we wrote it.
                    # In manager.py, load_state does:
                    # state_data = raw[k.key]
                    # If raw is a string, it will crash.
                    # Let's try to parse it here just in case.
                    try:
                        return json.loads(content)
                    except json.JSONDecodeError:
                        return content
        except Exception:
            pass
        return None

    def set_item(self, key: str, value: Union[str, Dict[str, Any]]) -> None:
        try:
            os.makedirs(os.path.dirname(self.file_path), exist_ok=True)
            with open(self.file_path, 'w', encoding='utf-8') as f:
                if isinstance(value, dict):
                     json.dump(value, f)
                else:
                     f.write(value)
        except Exception:
            pass

    def clear(self) -> None:
        try:
            if os.path.exists(self.file_path):
                os.remove(self.file_path)
        except Exception:
            pass

    def get_file_path(self) -> str:
        return self.file_path
