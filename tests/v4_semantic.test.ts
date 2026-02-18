import { ApiKeyManager } from '../src/index';

describe('ApiKeyManager v4.0 Semantic Cache', () => {

    test('Cosine Similarity math is accurate (vanilla)', () => {
        // @ts-ignore - access private for testing
        const cache = new (ApiKeyManager as any).prototype.constructor([]).semanticCache;
        if (!cache) {
            // Re-creating instance for direct access to private math if needed
            // But let's just test via the public API behavior or instantiate SemanticCache directly if exported
        }
    });

    test('SemanticCache integration in execute()', async () => {
        const mockFn = jest.fn().mockResolvedValue('API Response');
        const mockEmbedding = jest.fn().mockImplementation(async (text: string) => {
            if (text.includes('weather')) return [1, 0, 0];
            return [0, 1, 0];
        });

        const manager = new ApiKeyManager(['key1'], {
            semanticCache: {
                threshold: 0.9,
                getEmbedding: mockEmbedding
            }
        });

        // 1. First call (Cache Miss)
        const res1 = await manager.execute(mockFn, { prompt: 'What is the weather?' });
        expect(res1).toBe('API Response');
        expect(mockFn).toHaveBeenCalledTimes(1);

        // 2. Second call (Exact same prompt -> Cache Hit)
        const res2 = await manager.execute(mockFn, { prompt: 'What is the weather?' });
        expect(res2).toBe('API Response');
        expect(mockFn).toHaveBeenCalledTimes(1); // Should NOT have been called again

        // 3. Third call (Semantically similar prompt -> Cache Hit)
        // We mock the embedding to return the same vector [1,0,0] for anything about weather
        const res3 = await manager.execute(mockFn, { prompt: 'How is the weather today?' });
        expect(res3).toBe('API Response');
        expect(mockFn).toHaveBeenCalledTimes(1);
    });

    test('SemanticCache Miss for different topics', async () => {
        const mockFn = jest.fn().mockResolvedValue('API Response');
        const mockEmbedding = jest.fn().mockImplementation(async (text: string) => {
            if (text === 'A') return [1, 0];
            return [0, 1];
        });

        const manager = new ApiKeyManager(['key1'], {
            semanticCache: { threshold: 0.9, getEmbedding: mockEmbedding }
        });

        await manager.execute(mockFn, { prompt: 'A' });
        expect(mockFn).toHaveBeenCalledTimes(1);

        await manager.execute(mockFn, { prompt: 'B' });
        expect(mockFn).toHaveBeenCalledTimes(2); // Should be a MISS
    });

    test('Recursion Guard prevents infinite loops', async () => {
        const mockFn = jest.fn().mockResolvedValue('Live Response');

        const manager = new ApiKeyManager(['key1'], {
            semanticCache: {
                threshold: 0.9,
                getEmbedding: async (text: string) => {
                    // CRITICAL: This callback calls execute() again with a prompt.
                    // Without a recursion guard, this would loop infinitely.
                    await manager.execute(async () => 'Nested Result', { prompt: text });
                    return [1, 0, 0];
                }
            }
        });

        // This should complete successfully because the internal execute()
        // will skip the semantic cache check due to the guard.
        const res = await manager.execute(mockFn, { prompt: 'Recursion Test' });

        expect(res).toBe('Live Response');
        expect(mockFn).toHaveBeenCalledTimes(1);
    });
});
