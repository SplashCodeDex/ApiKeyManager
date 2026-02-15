
import { ApiKeyManager, KeyState, StandardStrategy, WeightedStrategy, LatencyStrategy } from '../src/index';

// Mock storage
const mockStorage = {
    getItem: () => null,
    setItem: () => { }
};

describe('ApiKeyManager v2.0 Strategies', () => {

    describe('StandardStrategy', () => {
        it('should pick the pristine key over a failed one', () => {
            const manager = new ApiKeyManager(['key1', 'key2'], mockStorage);
            // key1 fails
            manager.markFailed('key1', { type: 'TRANSIENT', retryable: true, cooldownMs: 1000, markKeyFailed: true, markKeyDead: false });

            const key = manager.getKey();
            expect(key).toBe('key2');
        });

        it('should pick the least recently used key among equals', () => {
            const manager = new ApiKeyManager(['key1', 'key2'], mockStorage);
            // Use key1
            const k1 = manager.getKey();
            expect(k1).toBe('key1'); // First one

            // Now key1 has lastUsed = now. key2 has lastUsed = 0.
            const k2 = manager.getKey();
            expect(k2).toBe('key2');
        });
    });

    describe('WeightedStrategy', () => {
        it('should respect weights (deterministic check)', () => {
            // key1 has 0 weight, key2 has 1 weight. key2 must be picked.
            const manager = new ApiKeyManager(
                [{ key: 'key1', weight: 0 }, { key: 'key2', weight: 1 }],
                mockStorage,
                new WeightedStrategy()
            );

            const key = manager.getKey();
            expect(key).toBe('key2');
        });

        it('should fallback if high weight key is dead', () => {
            const manager = new ApiKeyManager(
                [{ key: 'key1', weight: 0 }, { key: 'key2', weight: 1 }],
                mockStorage,
                new WeightedStrategy()
            );

            // Kill key2
            manager.markFailed('key2', { type: 'AUTH', retryable: false, cooldownMs: 0, markKeyFailed: true, markKeyDead: true });

            const key = manager.getKey();
            expect(key).toBe('key1');
        });
    });

    describe('LatencyStrategy', () => {
        it('should pick the lowest latency key', () => {
            const manager = new ApiKeyManager(['key1', 'key2'], mockStorage, new LatencyStrategy());

            // key1 took 100ms
            manager.markSuccess('key1', 100);
            // key2 took 50ms (faster)
            manager.markSuccess('key2', 50);

            // key2 should be picked
            const key = manager.getKey();
            expect(key).toBe('key2');
        });

        it('should prefer untried (latency 0) keys over slow keys', () => {
            const manager = new ApiKeyManager(['key1', 'key2'], mockStorage, new LatencyStrategy());

            // key1 is slow
            manager.markSuccess('key1', 5000);

            // key2 is unused (0 latency)
            const key = manager.getKey();
            expect(key).toBe('key2');
        });
    });
});
