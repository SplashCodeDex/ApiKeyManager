import { ApiKeyManager } from '../src/index';

describe('ApiKeyManagerOptions Validation', () => {
    it('should pass with valid options', () => {
        expect(() => {
            new ApiKeyManager(['key1'], {
                concurrency: 5,
                concurrencyQueueSize: 10,
                semanticCache: {
                    threshold: 0.9,
                    ttlMs: 60000,
                    getEmbedding: async (text: string) => [0.1, 0.2],
                },
            });
        }).not.toThrow();
    });

    it('should throw if concurrency is negative', () => {
        expect(() => {
            new ApiKeyManager(['key1'], { concurrency: -1 });
        }).toThrow(/expected number to be >0/);
    });

    it('should throw if concurrency is not an integer', () => {
        expect(() => {
            new ApiKeyManager(['key1'], { concurrency: 1.5 });
        }).toThrow(/expected int, received number/);
    });

    it('should throw if concurrencyQueueSize is negative', () => {
        expect(() => {
            new ApiKeyManager(['key1'], { concurrencyQueueSize: -5 });
        }).toThrow(/expected number to be >=0/);
    });

    it('should throw if semanticCache.threshold is out of bounds', () => {
        expect(() => {
            new ApiKeyManager(['key1'], {
                semanticCache: {
                    threshold: 1.5,
                    getEmbedding: async (t: string) => [],
                },
            });
        }).toThrow(/expected number to be <=1/);

        expect(() => {
            new ApiKeyManager(['key1'], {
                semanticCache: {
                    threshold: -0.1,
                    getEmbedding: async (t: string) => [],
                },
            });
        }).toThrow(/expected number to be >=0/);
    });

    it('should throw if getEmbedding is not a function', () => {
        expect(() => {
            new ApiKeyManager(['key1'], {
                semanticCache: {
                    getEmbedding: 'not-a-function' as any,
                },
            });
        }).toThrow(/Must be a function/);
    });
});
