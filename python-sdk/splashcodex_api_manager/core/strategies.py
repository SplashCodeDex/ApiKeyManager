from abc import ABC, abstractmethod
import random
from typing import Optional
from .types import KeyState

class LoadBalancingStrategy(ABC):
    @abstractmethod
    def next(self, candidates: list[KeyState]) -> Optional[KeyState]:
        pass

class StandardStrategy(LoadBalancingStrategy):
    def next(self, candidates: list[KeyState]) -> Optional[KeyState]:
        if not candidates:
            return None

        candidates.sort(key=lambda k: (k.failCount, k.lastUsed))
        return candidates[0]

class WeightedStrategy(LoadBalancingStrategy):
    def next(self, candidates: list[KeyState]) -> Optional[KeyState]:
        if not candidates:
            return None

        total_weight = sum(k.weight for k in candidates)
        rand = random.uniform(0, total_weight)

        for key in candidates:
            rand -= key.weight
            if rand <= 0:
                return key

        return candidates[0]

class LatencyStrategy(LoadBalancingStrategy):
    def next(self, candidates: list[KeyState]) -> Optional[KeyState]:
        if not candidates:
            return None

        candidates.sort(key=lambda k: (k.averageLatency, k.lastUsed))
        return candidates[0]
