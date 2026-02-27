from enum import Enum
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field

class CircuitState(str, Enum):
    CLOSED = 'CLOSED'
    OPEN = 'OPEN'
    HALF_OPEN = 'HALF_OPEN'
    DEAD = 'DEAD'

class ErrorType(str, Enum):
    QUOTA = 'QUOTA'
    TRANSIENT = 'TRANSIENT'
    AUTH = 'AUTH'
    BAD_REQUEST = 'BAD_REQUEST'
    SAFETY = 'SAFETY'
    RECITATION = 'RECITATION'
    TIMEOUT = 'TIMEOUT'
    UNKNOWN = 'UNKNOWN'

class ErrorClassification(BaseModel):
    type: ErrorType
    retryable: bool
    cooldownMs: int
    markKeyFailed: bool
    markKeyDead: bool

class KeyState(BaseModel):
    key: str
    failCount: int = Field(default=0)
    failedAt: Optional[int] = Field(default=None)
    isQuotaError: bool = Field(default=False)
    circuitState: CircuitState = Field(default=CircuitState.CLOSED)
    lastUsed: int = Field(default=0)
    successCount: int = Field(default=0)
    totalRequests: int = Field(default=0)
    halfOpenTestTime: Optional[int] = Field(default=None)
    customCooldown: Optional[int] = Field(default=None)
    weight: float = Field(default=1.0)
    averageLatency: float = Field(default=0.0)
    totalLatency: float = Field(default=0.0)
    latencySamples: int = Field(default=0)
    provider: str = Field(default='default')

    model_config = ConfigDict(validate_assignment=True)

class ApiKeyManagerStats(BaseModel):
    total: int
    healthy: int
    cooling: int
    dead: int

class ExecuteOptions(BaseModel):
    timeoutMs: Optional[int] = Field(default=None)
    maxRetries: int = Field(default=0)
    finishReason: Optional[str] = Field(default=None)
    provider: Optional[str] = Field(default=None)
    prompt: Optional[str] = Field(default=None)

class CacheEntry(BaseModel):
    vector: list[float]
    prompt: str
    response: dict | str | list
    timestamp: int
