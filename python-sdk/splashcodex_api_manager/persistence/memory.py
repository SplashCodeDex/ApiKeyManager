from typing import Optional, Dict

class MemoryStorage:
    """
    In-Memory Storage Adapter

    Simple key-value storage that lives only for the process lifetime.
    Useful for testing, serverless functions, or when persistence isn't needed.
    """
    def __init__(self):
        self._store: Dict[str, str] = {}

    def get_item(self, key: str) -> Optional[str]:
        return self._store.get(key)

    def set_item(self, key: str, value: str) -> None:
        self._store[key] = value

    def clear(self) -> None:
        self._store.clear()

    @property
    def size(self) -> int:
        return len(self._store)
