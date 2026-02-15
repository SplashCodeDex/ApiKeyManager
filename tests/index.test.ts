import { ApiKeyManager } from '../src/index';

const mockStorage = {
    store: {} as Record<string, string>,
    getItem: (key: string) => mockStorage.store[key] || null,
    setItem: (key: string, value: string) => { mockStorage.store[key] = value; },
    clear: () => { mockStorage.store = {}; }
};

describe('ApiKeyManager v1.x (Legacy Compatibility)', () => {

    beforeEach(() => mockStorage.clear());

    test('should initialize with correct key count', () => {
        const manager = new ApiKeyManager(['key1', 'key2', 'key3'], mockStorage);
        expect(manager.getKeyCount()).toBe(3);
    });

    test('should rotate away from 429 key', () => {
        const manager = new ApiKeyManager(['key1', 'key2', 'key3'], mockStorage);
        const k1 = manager.getKey()!;
        manager.markFailed(k1, manager.classifyError({ status: 429, message: 'Too Many Requests' }));
        const k2 = manager.getKey()!;
        expect(k2).not.toBe(k1);
    });

    test('should mark 403 key as DEAD', () => {
        const manager = new ApiKeyManager(['key1', 'key2'], mockStorage);
        const k1 = manager.getKey()!;
        manager.markFailed(k1, manager.classifyError({ status: 403, message: 'Permission Denied' }));
        expect(manager.getStats().dead).toBe(1);
    });

    test('should parse Retry-After header', () => {
        const manager = new ApiKeyManager(['key1'], mockStorage);
        const classification = manager.classifyError({ status: 429, headers: { 'retry-after': '2' } });
        expect(classification.cooldownMs).toBe(2000);
    });

    test('should handle comma-separated keys (backward compat)', () => {
        const manager = new ApiKeyManager(['key1,key2, key3'], mockStorage);
        expect(manager.getKeyCount()).toBe(3);
    });

    test('markSuccess should reset circuit state', () => {
        const manager = new ApiKeyManager(['key1'], mockStorage);
        manager.markFailed('key1', manager.classifyError({ status: 429 }));
        manager.markSuccess('key1');
        const keys = manager._getKeys();
        expect(keys[0].circuitState).toBe('CLOSED');
        expect(keys[0].failCount).toBe(0);
    });
});
