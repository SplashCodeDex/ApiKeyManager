from typing import Optional, Protocol, runtime_checkable

@runtime_checkable
class StorageAdapter(Protocol):
    def get_item(self, key: str) -> Optional[str]:
        ...

    def set_item(self, key: str, value: str) -> None:
        ...
