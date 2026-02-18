import { ApiKeyManager, ApiKeyManagerStats } from '../src/index';

// Mock storage
const mockStorage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
};

describe('ApiKeyManager v4.1 Streaming Support', () => {

    test('should yield chunks from generator successfully', async () => {
        const manager = new ApiKeyManager(['key1'], mockStorage);

        const mockStreamFn = jest.fn(async function* (key) {
            yield 'Hello';
            yield ' ';
            yield 'World';
        });

        const chunks: string[] = [];
        const iterator = await manager.executeStream(mockStreamFn);

        for await (const chunk of iterator) {
            chunks.push(chunk as string);
        }

        expect(chunks.join('')).toBe('Hello World');
        expect(mockStreamFn).toHaveBeenCalledTimes(1);
    });

    test('should retry on INITIAL connection failure', async () => {
        const manager = new ApiKeyManager(['key1'], mockStorage);

        let attempts = 0;
        const mockStreamFn = jest.fn(async function* (key) {
            attempts++;
            if (attempts === 1) {
                // Initial failure (e.g. 503)
                throw { status: 503 };
            }
            yield 'Retry';
            yield 'Success';
        });

        const chunks: string[] = [];
        const iterator = await manager.executeStream(mockStreamFn, { maxRetries: 3 });

        for await (const chunk of iterator) {
            chunks.push(chunk as string);
        }

        expect(chunks.join('')).toBe('RetrySuccess');
        expect(mockStreamFn).toHaveBeenCalledTimes(2);
    });

    test('should cache stream result and replay as single chunk on HIT', async () => {
        const mockEmbedding = jest.fn().mockResolvedValue([1, 0, 0]);
        const manager = new ApiKeyManager(['key1'], {
            semanticCache: { threshold: 0.9, getEmbedding: mockEmbedding }
        });

        const mockStreamFn = jest.fn(async function* (key) {
            yield 'Part 1';
            yield 'Part 2';
        });

        // 1. First Call - Miss
        const chunks1: string[] = [];
        const iter1 = await manager.executeStream(mockStreamFn, { prompt: 'Stream Cache Test' });
        for await (const c of iter1) chunks1.push(c as string);

        expect(chunks1).toEqual(['Part 1', 'Part 2']);
        expect(mockStreamFn).toHaveBeenCalledTimes(1);

        // Expect Semantic Cache to yield the chunks INDIVIDUALLY (replaying the stream)
        const chunks2: string[] = [];
        const iter2 = await manager.executeStream(mockStreamFn, { prompt: 'Stream Cache Test' });
        for await (const c of iter2) chunks2.push(c as string);

        expect(chunks2).toEqual(['Part 1', 'Part 2']); // Length should be 2, same as original
        expect(mockStreamFn).toHaveBeenCalledTimes(1); // Should NOT call again
    });

});
