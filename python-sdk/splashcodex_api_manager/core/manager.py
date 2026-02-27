import asyncio
import copy
import re
import time
from typing import Any, Callable, Coroutine, Dict, List, Optional, Union, AsyncGenerator
from loguru import logger
from .types import KeyState, ErrorClassification, ErrorType, ApiKeyManagerStats, ExecuteOptions, CircuitState, CacheEntry
from .strategies import LoadBalancingStrategy, StandardStrategy

CONFIG = {
    'MAX_CONSECUTIVE_FAILURES': 5,
    'COOLDOWN_TRANSIENT': 60 * 1000,
    'COOLDOWN_QUOTA': 5 * 60 * 1000,
    'COOLDOWN_QUOTA_DAILY': 60 * 60 * 1000,
    'HALF_OPEN_TEST_DELAY': 60 * 1000,
    'MAX_BACKOFF': 64 * 1000,
    'BASE_BACKOFF': 1000,
}

ERROR_PATTERNS = {
    'isQuotaError': re.compile(r'429|quota|exhausted|resource.?exhausted|too.?many.?requests|rate.?limit', re.IGNORECASE),
    'isAuthError': re.compile(r'403|permission.?denied|invalid.?api.?key|unauthorized|unauthenticated', re.IGNORECASE),
    'isSafetyBlock': re.compile(r'safety|blocked|recitation|harmful', re.IGNORECASE),
    'isTransient': re.compile(r'500|502|503|504|internal|unavailable|deadline|timeout|overloaded', re.IGNORECASE),
    'isBadRequest': re.compile(r'400|invalid.?argument|failed.?precondition|malformed|not.?found|404', re.IGNORECASE),
}

class TimeoutError(Exception):
    def __init__(self, ms: int):
        super().__init__(f"Request timed out after {ms}ms")

class BulkheadRejectionError(Exception):
    def __init__(self):
        super().__init__("Bulkhead capacity exceeded — too many concurrent requests")

class AllKeysExhaustedError(Exception):
    def __init__(self):
        super().__init__("All API keys exhausted — no healthy keys available")

class SemanticCache:
    def __init__(self, threshold: float = 0.95, ttl_ms: int = 24 * 60 * 60 * 1000):
        self.entries: List[CacheEntry] = []
        self.threshold = threshold
        self.ttl_ms = ttl_ms

    def set(self, prompt: str, vector: List[float], response: Any):
        self.entries = [e for e in self.entries if e.prompt != prompt]
        self.entries.append(CacheEntry(
            vector=vector,
            prompt=prompt,
            response=response,
            timestamp=int(time.time() * 1000)
        ))
        if len(self.entries) > 500:
            self.entries.pop(0)

    def get(self, vector: List[float]) -> Any:
        now = int(time.time() * 1000)
        best_match = None
        highest_similarity = -1

        for i in range(len(self.entries) - 1, -1, -1):
            entry = self.entries[i]
            if now - entry.timestamp > self.ttl_ms:
                self.entries.pop(i)
                continue

            similarity = self._cosine_similarity(vector, entry.vector)
            if similarity >= self.threshold and similarity > highest_similarity:
                highest_similarity = similarity
                best_match = entry

        return best_match.response if best_match else None

    def _cosine_similarity(self, vec_a: List[float], vec_b: List[float]) -> float:
        if len(vec_a) != len(vec_b):
            return 0
        dot_product = sum(a * b for a, b in zip(vec_a, vec_b))
        norm_a = sum(a * a for a in vec_a)
        norm_b = sum(b * b for b in vec_b)
        denominator = (norm_a ** 0.5) * (norm_b ** 0.5)
        return dot_product / denominator if denominator else 0


class ApiKeyManager:
    def __init__(
            self,
            initial_keys: Union[List[str], List[Dict[str, Any]]],
            storage: Any = None,
            strategy: LoadBalancingStrategy = None,
            fallback_fn: Callable = None,
            concurrency: int = float('inf'),
            semantic_cache: Dict[str, Any] = None
    ):
        self.storage_key = 'api_rotation_state_v2'
        self.storage = storage
        self.strategy = strategy or StandardStrategy()
        self.fallback_fn = fallback_fn
        self.max_concurrency = concurrency
        self.active_calls = 0

        self.semantic_cache = None
        self.get_embedding_fn = None
        self._is_resolving_embedding = False

        if semantic_cache:
            self.semantic_cache = SemanticCache(
                threshold=semantic_cache.get('threshold', 0.95),
                ttl_ms=semantic_cache.get('ttlMs', 24 * 60 * 60 * 1000)
            )
            self.get_embedding_fn = semantic_cache.get('getEmbedding')

        input_keys = []
        if initial_keys and isinstance(initial_keys[0], str):
            for k in initial_keys:
                input_keys.extend([{'key': s.strip(), 'weight': 1.0, 'provider': 'default'} for s in k.split(',')])
        else:
            input_keys = initial_keys

        unique_map = {}
        for k in input_keys:
            key_str = k.get('key', '')
            if key_str:
                unique_map[key_str] = {'weight': k.get('weight', 1.0), 'provider': k.get('provider', 'default')}

        self.keys: List[KeyState] = [
            KeyState(key=k, weight=v['weight'], provider=v['provider'])
            for k, v in unique_map.items()
        ]

        if self.storage:
            self.load_state()

        self._callbacks = {}

    def on(self, event: str, callback: Callable):
        if event not in self._callbacks:
            self._callbacks[event] = []
        self._callbacks[event].append(callback)

    def _emit(self, event: str, *args, **kwargs):
        if event in self._callbacks:
            for cb in self._callbacks[event]:
                try:
                    cb(*args, **kwargs)
                except Exception as e:
                    logger.error(f"Error in event listener for {event}: {e}")

    def classify_error(self, error: Any, finish_reason: str = None) -> ErrorClassification:
        error_str = str(error)
        status = getattr(error, 'status_code', getattr(error, 'status', None))

        # Try to extract from httpx exception
        if hasattr(error, 'response') and error.response:
            status = error.response.status_code

        if finish_reason == 'SAFETY':
             return ErrorClassification(type=ErrorType.SAFETY, retryable=False, cooldownMs=0, markKeyFailed=False, markKeyDead=False)
        if finish_reason == 'RECITATION':
             return ErrorClassification(type=ErrorType.RECITATION, retryable=False, cooldownMs=0, markKeyFailed=False, markKeyDead=False)

        if isinstance(error, TimeoutError) or 'timeout' in error_str.lower():
             return ErrorClassification(type=ErrorType.TIMEOUT, retryable=True, cooldownMs=CONFIG['COOLDOWN_TRANSIENT'], markKeyFailed=True, markKeyDead=False)

        if status == 403 or ERROR_PATTERNS['isAuthError'].search(error_str):
             return ErrorClassification(type=ErrorType.AUTH, retryable=False, cooldownMs=999999999, markKeyFailed=True, markKeyDead=True)

        if status == 429 or ERROR_PATTERNS['isQuotaError'].search(error_str):
             return ErrorClassification(type=ErrorType.QUOTA, retryable=True, cooldownMs=CONFIG['COOLDOWN_QUOTA'], markKeyFailed=True, markKeyDead=False)

        if status == 400 or ERROR_PATTERNS['isBadRequest'].search(error_str):
             return ErrorClassification(type=ErrorType.BAD_REQUEST, retryable=False, cooldownMs=0, markKeyFailed=False, markKeyDead=False)

        if status in [500, 502, 503, 504] or ERROR_PATTERNS['isTransient'].search(error_str):
             return ErrorClassification(type=ErrorType.TRANSIENT, retryable=True, cooldownMs=CONFIG['COOLDOWN_TRANSIENT'], markKeyFailed=True, markKeyDead=False)

        return ErrorClassification(type=ErrorType.UNKNOWN, retryable=True, cooldownMs=CONFIG['COOLDOWN_TRANSIENT'], markKeyFailed=True, markKeyDead=False)

    def _is_on_cooldown(self, k: KeyState) -> bool:
        if k.circuitState == CircuitState.DEAD:
            return True

        now = int(time.time() * 1000)

        if k.circuitState == CircuitState.OPEN:
            if k.halfOpenTestTime and now >= k.halfOpenTestTime:
                k.circuitState = CircuitState.HALF_OPEN
                self._emit('circuitHalfOpen', k.key)
                return False
            return True

        if k.failedAt:
            if k.customCooldown and now - k.failedAt < k.customCooldown:
                return True
            cooldown = CONFIG['COOLDOWN_QUOTA'] if k.isQuotaError else CONFIG['COOLDOWN_TRANSIENT']
            if now - k.failedAt < cooldown:
                return True

        return False

    def get_key(self) -> Optional[str]:
        candidates = [k for k in self.keys if k.circuitState != CircuitState.DEAD and not self._is_on_cooldown(k)]

        if not candidates:
            non_dead = [k for k in self.keys if k.circuitState != CircuitState.DEAD]
            if not non_dead:
                self._emit('allKeysExhausted')
                return None
            non_dead.sort(key=lambda x: x.failedAt or 0)
            return non_dead[0].key

        selected = self.strategy.next(candidates)
        if selected:
            selected.lastUsed = int(time.time() * 1000)
            self.save_state()
            return selected.key
        return None

    def get_key_by_provider(self, provider: str) -> Optional[str]:
        candidates = [k for k in self.keys if k.provider == provider and k.circuitState != CircuitState.DEAD and not self._is_on_cooldown(k)]
        if not candidates:
            return None

        selected = self.strategy.next(candidates)
        if selected:
            selected.lastUsed = int(time.time() * 1000)
            self.save_state()
            return selected.key
        return None

    def mark_success(self, key: str, duration_ms: Optional[int] = None):
        k = next((x for x in self.keys if x.key == key), None)
        if not k:
            return

        was_recovering = k.circuitState not in [CircuitState.CLOSED, CircuitState.DEAD]
        if was_recovering:
            logger.info(f"[Key Recovered] ...{key[-4:]}")
            self._emit('keyRecovered', key)

        k.circuitState = CircuitState.CLOSED
        k.failCount = 0
        k.failedAt = None
        k.isQuotaError = False
        k.customCooldown = None
        k.successCount += 1
        k.totalRequests += 1

        if duration_ms is not None:
            k.totalLatency += duration_ms
            k.latencySamples += 1
            k.averageLatency = k.totalLatency / k.latencySamples

        self.save_state()

    def mark_failed(self, key: str, classification: ErrorClassification):
        k = next((x for x in self.keys if x.key == key), None)
        if not k or k.circuitState == CircuitState.DEAD:
            return
        if not classification.markKeyFailed:
            return

        k.failedAt = int(time.time() * 1000)
        k.failCount += 1
        k.totalRequests += 1
        k.isQuotaError = classification.type == ErrorType.QUOTA
        k.customCooldown = classification.cooldownMs if classification.cooldownMs else None

        if classification.markKeyDead:
            k.circuitState = CircuitState.DEAD
            logger.error(f"[Key DEAD] ...{key[-4:]} - Permanently removed")
            self._emit('keyDead', key)
        else:
            if k.circuitState == CircuitState.HALF_OPEN:
                k.circuitState = CircuitState.OPEN
                k.halfOpenTestTime = int(time.time() * 1000) + CONFIG['HALF_OPEN_TEST_DELAY']
                self._emit('circuitOpen', key)
            elif k.failCount >= CONFIG['MAX_CONSECUTIVE_FAILURES'] or classification.type == ErrorType.QUOTA:
                k.circuitState = CircuitState.OPEN
                k.halfOpenTestTime = int(time.time() * 1000) + (classification.cooldownMs or CONFIG['HALF_OPEN_TEST_DELAY'])
                self._emit('circuitOpen', key)

        self.save_state()

    def calculate_backoff(self, attempt: int) -> float:
        import random
        exponential = CONFIG['BASE_BACKOFF'] * (2 ** attempt)
        capped = min(exponential, CONFIG['MAX_BACKOFF'])
        jitter = random.uniform(0, 1000)
        return capped + jitter

    async def execute(self, fn: Callable[[str], Coroutine[Any, Any, Any]], options: Optional[ExecuteOptions] = None) -> Any:
        options = options or ExecuteOptions()

        prompt = options.prompt
        provider = options.provider

        current_prompt_vector = None
        if self.semantic_cache and self.get_embedding_fn and prompt and not self._is_resolving_embedding:
            try:
                self._is_resolving_embedding = True
                current_prompt_vector = await self.get_embedding_fn(prompt)
                cached = self.semantic_cache.get(current_prompt_vector)
                if cached is not None:
                    logger.info(f"[Semantic Cache HIT] for prompt: \"{prompt[:30]}...\"")
                    self._emit('executeSuccess', 'CACHE_HIT', 0)
                    return cached
            except Exception as e:
                logger.warning(f"[Semantic Cache Check Failed] Proceeding to live API: {e}")
            finally:
                self._is_resolving_embedding = False

        if self.active_calls >= self.max_concurrency:
            self._emit('bulkheadRejected')
            raise BulkheadRejectionError()

        self.active_calls += 1
        try:
            result = await self._execute_with_retry(fn, options)

            if self.semantic_cache and prompt and current_prompt_vector:
                self.semantic_cache.set(prompt, current_prompt_vector, result)

            return result
        finally:
            self.active_calls -= 1

    async def _execute_with_retry(self, fn: Callable[[str], Coroutine[Any, Any, Any]], options: ExecuteOptions) -> Any:
        last_error = None

        for attempt in range(options.maxRetries + 1):
            key = self.get_key_by_provider(options.provider) if options.provider else self.get_key()

            if not key:
                if self.fallback_fn:
                    self._emit('fallback', 'all keys exhausted')
                    if asyncio.iscoroutinefunction(self.fallback_fn):
                         return await self.fallback_fn()
                    return self.fallback_fn()
                raise AllKeysExhaustedError()

            try:
                start = int(time.time() * 1000)

                if options.timeoutMs:
                    result = await asyncio.wait_for(fn(key), timeout=options.timeoutMs / 1000.0)
                else:
                    result = await fn(key)

                duration = int(time.time() * 1000) - start
                self.mark_success(key, duration)
                self._emit('executeSuccess', key, duration)
                return result

            except Exception as e:
                last_error = e
                if isinstance(e, asyncio.TimeoutError):
                     e = TimeoutError(options.timeoutMs)

                classification = self.classify_error(e, options.finishReason)
                self.mark_failed(key, classification)
                self._emit('executeFailed', key, e)

                if not classification.retryable or attempt >= options.maxRetries:
                    if self.fallback_fn and attempt >= options.maxRetries:
                        self._emit('fallback', 'max retries exceeded')
                        if asyncio.iscoroutinefunction(self.fallback_fn):
                             return await self.fallback_fn()
                        return self.fallback_fn()
                    raise e

                delay = self.calculate_backoff(attempt)
                self._emit('retry', key, attempt + 1, delay)
                await asyncio.sleep(delay / 1000.0)

        raise last_error

    def save_state(self):
        if not self.storage:
            return
        state = {k.key: k.model_dump() for k in self.keys}
        if asyncio.iscoroutinefunction(self.storage.set_item):
             # We must schedule this task if it is async to not block
             asyncio.create_task(self.storage.set_item(self.storage_key, state))
        else:
             self.storage.set_item(self.storage_key, state)

    def load_state(self):
        if not self.storage:
            return

        def apply_state(raw):
            if not raw: return
            for k in self.keys:
                 if k.key in raw:
                      state_data = raw[k.key]
                      # Update attributes from loaded state
                      for key_attr, val in state_data.items():
                           if hasattr(k, key_attr):
                                setattr(k, key_attr, val)

        if asyncio.iscoroutinefunction(self.storage.get_item):
             # we cannot safely await in constructor, so we must warn
             logger.warning("Async storage get_item used but constructor is sync. State will load in background.")
             async def _load():
                  raw = await self.storage.get_item(self.storage_key)
                  apply_state(raw)
             asyncio.create_task(_load())
        else:
             raw = self.storage.get_item(self.storage_key)
             apply_state(raw)
