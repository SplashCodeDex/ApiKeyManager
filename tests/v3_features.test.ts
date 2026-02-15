import { ApiKeyManager, TimeoutError, BulkheadRejectionError, AllKeysExhaustedError, WeightedStrategy, LatencyStrategy } from '../src/index';

// Mock storage
const mockStorage = {
    store: {} as Record<string, string>,
    getItem: (key: string) => mockStorage.store[key] || null,
    setItem: (key: string, value: string) => { mockStorage.store[key] = value; },
    clear: () => { mockStorage.store = {}; }
};

describe('ApiKeyManager v3.0 Features', () => {

    beforeEach(() => mockStorage.clear());

    // ─── Event Emitter ───────────────────────────────────────────────────────

    describe('Event Emitter', () => {

        it('should emit "keyDead" when a key is killed by 403', (done) => {
            const manager = new ApiKeyManager(['key1', 'key2'], mockStorage);
            manager.on('keyDead', (key: string) => {
                expect(key).toBe('key1');
                done();
            });
            manager.markFailed('key1', manager.classifyError({ status: 403 }));
        });

        it('should emit "circuitOpen" when a key hits quota', (done) => {
            const manager = new ApiKeyManager(['key1', 'key2'], mockStorage);
            manager.on('circuitOpen', (key: string) => {
                expect(key).toBe('key1');
                done();
            });
            manager.markFailed('key1', manager.classifyError({ status: 429 }));
        });

        it('should emit "keyRecovered" when a failed key succeeds', (done) => {
            const manager = new ApiKeyManager(['key1'], mockStorage);
            manager.on('keyRecovered', (key: string) => {
                expect(key).toBe('key1');
                done();
            });
            // Put key1 into OPEN state
            manager.markFailed('key1', manager.classifyError({ status: 429 }));
            // Now recover it
            manager.markSuccess('key1');
        });

        it('should emit "allKeysExhausted" when all keys are dead', () => {
            const manager = new ApiKeyManager(['key1'], mockStorage);
            let exhaustedCalled = false;
            manager.on('allKeysExhausted', () => { exhaustedCalled = true; });

            manager.markFailed('key1', { type: 'AUTH', retryable: false, cooldownMs: 0, markKeyFailed: true, markKeyDead: true });
            manager.getKey(); // Should trigger allKeysExhausted
            expect(exhaustedCalled).toBe(true);
        });
    });

    // ─── Fallback Function ───────────────────────────────────────────────────

    describe('Fallback Function', () => {

        it('should invoke fallbackFn in execute() when all keys are dead', async () => {
            const manager = new ApiKeyManager(['key1'], {
                storage: mockStorage,
                fallbackFn: () => 'fallback_result'
            });

            // Kill key1
            manager.markFailed('key1', { type: 'AUTH', retryable: false, cooldownMs: 0, markKeyFailed: true, markKeyDead: true });

            const result = await manager.execute(async () => 'should_not_reach');
            expect(result).toBe('fallback_result');
        });

        it('should emit "fallback" event when fallback is used', async () => {
            let fallbackReason = '';
            const manager = new ApiKeyManager(['key1'], {
                storage: mockStorage,
                fallbackFn: () => 'ok'
            });
            manager.on('fallback', (reason: string) => { fallbackReason = reason; });

            manager.markFailed('key1', { type: 'AUTH', retryable: false, cooldownMs: 0, markKeyFailed: true, markKeyDead: true });
            await manager.execute(async () => 'x');

            expect(fallbackReason).toBe('all keys exhausted');
        });

        it('should throw AllKeysExhaustedError if no fallback and all keys dead', async () => {
            const manager = new ApiKeyManager(['key1'], mockStorage);
            manager.markFailed('key1', { type: 'AUTH', retryable: false, cooldownMs: 0, markKeyFailed: true, markKeyDead: true });

            await expect(manager.execute(async () => 'x')).rejects.toThrow(AllKeysExhaustedError);
        });
    });

    // ─── execute() Wrapper ───────────────────────────────────────────────────

    describe('execute() Wrapper', () => {

        it('should execute function and track latency on success', async () => {
            const manager = new ApiKeyManager(['key1'], mockStorage);
            let emittedDuration = 0;
            manager.on('executeSuccess', (_key: string, dur: number) => { emittedDuration = dur; });

            const result = await manager.execute(async (_key) => {
                await new Promise(r => setTimeout(r, 50)); // ~50ms work
                return 'done';
            });

            expect(result).toBe('done');
            expect(emittedDuration).toBeGreaterThanOrEqual(40);
            const keys = manager._getKeys();
            expect(keys[0].successCount).toBe(1);
            expect(keys[0].averageLatency).toBeGreaterThan(0);
        });

        it('should retry on transient error with maxRetries', async () => {
            const manager = new ApiKeyManager(['key1', 'key2'], mockStorage);
            let attempts = 0;

            const result = await manager.execute(async (_key) => {
                attempts++;
                if (attempts < 3) throw { status: 500, message: 'Internal Error' };
                return 'success_after_retries';
            }, { maxRetries: 3 });

            expect(result).toBe('success_after_retries');
            expect(attempts).toBe(3);
        }, 30000);

        it('should emit "retry" event with attempt info', async () => {
            const manager = new ApiKeyManager(['key1', 'key2'], mockStorage);
            const retryEvents: { attempt: number }[] = [];
            manager.on('retry', (_key: string, attempt: number) => {
                retryEvents.push({ attempt });
            });

            let callCount = 0;
            await manager.execute(async () => {
                callCount++;
                if (callCount < 2) throw { status: 503, message: 'Unavailable' };
                return 'ok';
            }, { maxRetries: 2 });

            expect(retryEvents.length).toBeGreaterThanOrEqual(1);
            expect(retryEvents[0].attempt).toBe(1);
        }, 30000);

        it('should throw on non-retryable error even with retries', async () => {
            const manager = new ApiKeyManager(['key1'], mockStorage);

            await expect(manager.execute(async () => {
                throw { status: 400, message: 'Bad Request' };
            }, { maxRetries: 3 })).rejects.toMatchObject({ status: 400 });
        });
    });

    // ─── Timeout ─────────────────────────────────────────────────────────────

    describe('Request Timeout', () => {

        it('should throw TimeoutError when request exceeds timeoutMs', async () => {
            const manager = new ApiKeyManager(['key1'], mockStorage);

            await expect(manager.execute(async () => {
                await new Promise(r => setTimeout(r, 2000)); // Slow!
                return 'too late';
            }, { timeoutMs: 100 })).rejects.toThrow(TimeoutError);
        }, 10000);

        it('should classify TimeoutError as TIMEOUT type', () => {
            const manager = new ApiKeyManager(['key1'], mockStorage);
            const classification = manager.classifyError(new TimeoutError(5000));
            expect(classification.type).toBe('TIMEOUT');
            expect(classification.retryable).toBe(true);
        });
    });

    // ─── Provider Tagging ────────────────────────────────────────────────────

    describe('Provider Tagging', () => {

        it('should filter keys by provider', () => {
            const manager = new ApiKeyManager([
                { key: 'openai-1', weight: 1, provider: 'openai' },
                { key: 'gemini-1', weight: 1, provider: 'gemini' },
                { key: 'gemini-2', weight: 1, provider: 'gemini' },
            ], mockStorage);

            const key = manager.getKeyByProvider('gemini');
            expect(key).toMatch(/^gemini-/);
        });

        it('should return null if provider has no healthy keys', () => {
            const manager = new ApiKeyManager([
                { key: 'openai-1', weight: 1, provider: 'openai' },
            ], mockStorage);

            const key = manager.getKeyByProvider('anthropic');
            expect(key).toBeNull();
        });

        it('should default provider to "default" for string keys', () => {
            const manager = new ApiKeyManager(['key1'], mockStorage);
            const keys = manager._getKeys();
            expect(keys[0].provider).toBe('default');
        });
    });

    // ─── Bulkhead / Concurrency ──────────────────────────────────────────────

    describe('Bulkhead', () => {

        it('should reject when concurrency limit is reached', async () => {
            const manager = new ApiKeyManager(['key1', 'key2', 'key3', 'key4'], {
                storage: mockStorage,
                concurrency: 1
            });

            // Start a long request
            const longPromise = manager.execute(async () => {
                await new Promise(r => setTimeout(r, 500));
                return 'long';
            });

            // Second call should be rejected immediately
            await expect(manager.execute(async () => 'short')).rejects.toThrow(BulkheadRejectionError);

            await longPromise; // Cleanup
        }, 10000);

        it('should allow requests after previous completes', async () => {
            const manager = new ApiKeyManager(['key1', 'key2'], {
                storage: mockStorage,
                concurrency: 1
            });

            const r1 = await manager.execute(async () => 'first');
            expect(r1).toBe('first');

            const r2 = await manager.execute(async () => 'second');
            expect(r2).toBe('second');
        });
    });

    // ─── Health Check ────────────────────────────────────────────────────────

    describe('Health Check', () => {

        it('should recover a key via health check', async () => {
            const manager = new ApiKeyManager(['key1'], mockStorage);

            // Put key in OPEN state
            manager.markFailed('key1', manager.classifyError({ status: 429 }));
            expect(manager._getKeys()[0].circuitState).toBe('OPEN');

            // Set health check that returns true
            manager.setHealthCheck(async () => true);

            let recovered = false;
            manager.on('healthCheckPassed', () => { recovered = true; });

            // Manually trigger health check
            await (manager as any)._runHealthChecks();

            expect(recovered).toBe(true);
            expect(manager._getKeys()[0].circuitState).toBe('CLOSED');
        });

        it('should emit healthCheckFailed on check failure', async () => {
            const manager = new ApiKeyManager(['key1'], mockStorage);
            manager.markFailed('key1', manager.classifyError({ status: 500 }));
            // Fail a few more times to enter OPEN state
            for (let i = 0; i < 5; i++) {
                manager.markFailed('key1', manager.classifyError({ status: 500 }));
            }

            let failedKey = '';
            manager.on('healthCheckFailed', (key: string) => { failedKey = key; });
            manager.setHealthCheck(async () => { throw new Error('down'); });

            await (manager as any)._runHealthChecks();
            expect(failedKey).toBe('key1');
        });
    });

    // ─── Backward Compatibility ──────────────────────────────────────────────

    describe('Backward Compatibility', () => {

        it('should work with legacy positional constructor (v1/v2)', () => {
            // This is the EXACT v1/v2 signature
            const manager = new ApiKeyManager(['key1', 'key2'], mockStorage);
            expect(manager.getKeyCount()).toBe(2);
            const key = manager.getKey();
            expect(key).toBeTruthy();
            manager.markSuccess(key!);
        });

        it('should work with v3 options object constructor', () => {
            const manager = new ApiKeyManager(['key1', 'key2'], {
                storage: mockStorage,
                strategy: new WeightedStrategy()
            });
            expect(manager.getKeyCount()).toBe(2);
        });

        it('should handle markFailedLegacy unchanged', () => {
            const manager = new ApiKeyManager(['key1'], mockStorage);
            manager.markFailedLegacy('key1', true);
            const keys = manager._getKeys();
            expect(keys[0].isQuotaError).toBe(true);
        });
    });
});
