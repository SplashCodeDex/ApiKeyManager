/**
 * Tests for v5.0 — Presets & Persistence
 *
 * Tests the "batteries included" preset pattern:
 * - GeminiManager singleton with env parsing
 * - OpenAIManager singleton
 * - MultiManager multi-provider vault
 * - FileStorage persistence
 * - MemoryStorage persistence
 * - Result<T> pattern
 * - Singleton lifecycle (getInstance, reset)
 */

import { GeminiManager } from '../src/presets/gemini';
import { OpenAIManager } from '../src/presets/openai';
import { MultiManager } from '../src/presets/multi';
import { BasePreset } from '../src/presets/base';
import { FileStorage } from '../src/persistence/file';
import { MemoryStorage } from '../src/persistence/memory';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Persistence Tests ──────────────────────────────────────────────────────

describe('MemoryStorage', () => {
    let storage: MemoryStorage;

    beforeEach(() => {
        storage = new MemoryStorage();
    });

    test('getItem returns null for unknown key', () => {
        expect(storage.getItem('unknown')).toBeNull();
    });

    test('setItem and getItem round-trip', () => {
        storage.setItem('test_key', '{"data": true}');
        expect(storage.getItem('test_key')).toBe('{"data": true}');
    });

    test('clear removes all entries', () => {
        storage.setItem('a', '1');
        storage.setItem('b', '2');
        expect(storage.size).toBe(2);
        storage.clear();
        expect(storage.size).toBe(0);
        expect(storage.getItem('a')).toBeNull();
    });
});

describe('FileStorage', () => {
    let stateFile: string;
    let storage: FileStorage;

    beforeEach(() => {
        stateFile = path.join(os.tmpdir(), `test_file_storage_${Date.now()}.json`);
        storage = new FileStorage({ filePath: stateFile, clearOnInit: true });
    });

    afterEach(() => {
        try { fs.unlinkSync(stateFile); } catch { /* already cleaned */ }
    });

    test('getItem returns null when no file exists', () => {
        expect(storage.getItem('key')).toBeNull();
    });

    test('setItem writes and getItem reads back', () => {
        const data = JSON.stringify({ test: true });
        storage.setItem('state', data);
        expect(storage.getItem('state')).toBe(data);
    });

    test('clear removes the state file', () => {
        storage.setItem('state', '{"x":1}');
        expect(fs.existsSync(stateFile)).toBe(true);
        storage.clear();
        expect(fs.existsSync(stateFile)).toBe(false);
    });

    test('getFilePath returns the configured path', () => {
        expect(storage.getFilePath()).toBe(stateFile);
    });

    test('survives file read errors gracefully', () => {
        // Point to a directory instead of a file — should return null, not throw
        const badStorage = new FileStorage({
            filePath: os.tmpdir(), // tmpdir is a directory, not a file
            clearOnInit: false,
        });
        expect(badStorage.getItem('key')).toBeNull();
    });
});

// ─── GeminiManager Preset Tests ─────────────────────────────────────────────

describe('GeminiManager', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV };
        GeminiManager.reset();
        BasePreset.resetAll();
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
        GeminiManager.reset();
        BasePreset.resetAll();
    });

    test('getInstance returns success with env keys set', () => {
        process.env.GOOGLE_GEMINI_API_KEY = 'test-key-1';

        const result = GeminiManager.getInstance();
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toBeDefined();
            expect(result.data.getKeyCount()).toBe(1);
        }
    });

    test('getInstance handles JSON array of keys', () => {
        process.env.GOOGLE_GEMINI_API_KEY = '["key-a", "key-b", "key-c"]';

        const result = GeminiManager.getInstance();
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.getKeyCount()).toBe(3);
        }
    });

    test('getInstance handles comma-separated keys', () => {
        process.env.GOOGLE_GEMINI_API_KEY = 'key1,key2,key3';

        const result = GeminiManager.getInstance();
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.getKeyCount()).toBe(3);
        }
    });

    test('getInstance returns success with 0 keys (graceful degradation)', () => {
        // No env var set
        delete process.env.GOOGLE_GEMINI_API_KEY;
        delete process.env.GEMINI_API_KEY;

        const result = GeminiManager.getInstance();
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.getKeyCount()).toBe(0);
            expect(result.data.getKey()).toBeNull();
        }
    });

    test('getInstance returns singleton (same instance)', () => {
        process.env.GOOGLE_GEMINI_API_KEY = 'test-key';

        const r1 = GeminiManager.getInstance();
        const r2 = GeminiManager.getInstance();

        expect(r1.success).toBe(true);
        expect(r2.success).toBe(true);
        if (r1.success && r2.success) {
            expect(r1.data).toBe(r2.data); // Same reference
        }
    });

    test('reset clears the singleton', () => {
        process.env.GOOGLE_GEMINI_API_KEY = 'key-1';
        const r1 = GeminiManager.getInstance();

        GeminiManager.reset();

        process.env.GOOGLE_GEMINI_API_KEY = 'key-2';
        const r2 = GeminiManager.getInstance();

        expect(r1.success).toBe(true);
        expect(r2.success).toBe(true);
        if (r1.success && r2.success) {
            expect(r1.data).not.toBe(r2.data); // Different instance
        }
    });

    test('getStats returns correct structure', () => {
        process.env.GOOGLE_GEMINI_API_KEY = 'key1,key2';
        const result = GeminiManager.getInstance();
        expect(result.success).toBe(true);
        if (result.success) {
            const stats = result.data.getStats();
            expect(stats).toEqual({
                total: 2,
                healthy: 2,
                cooling: 0,
                dead: 0,
            });
        }
    });

    test('execute runs function with a key', async () => {
        process.env.GOOGLE_GEMINI_API_KEY = 'test-exec-key';
        const result = GeminiManager.getInstance();
        expect(result.success).toBe(true);
        if (!result.success) return;

        const gemini = result.data;
        const response = await gemini.execute(async (key) => {
            expect(key).toBe('test-exec-key');
            return 'Hello from Gemini!';
        });

        expect(response).toBe('Hello from Gemini!');
    });

    test('getManager exposes underlying ApiKeyManager', () => {
        process.env.GOOGLE_GEMINI_API_KEY = 'key-access';
        const result = GeminiManager.getInstance();
        expect(result.success).toBe(true);
        if (result.success) {
            const manager = result.data.getManager();
            expect(manager).toBeDefined();
            expect(typeof manager.execute).toBe('function');
            expect(typeof manager.getKey).toBe('function');
        }
    });

    test('deduplicates identical keys', () => {
        process.env.GOOGLE_GEMINI_API_KEY = 'same-key,same-key,same-key';
        const result = GeminiManager.getInstance();
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.getKeyCount()).toBe(1);
        }
    });

    test('reads from fallback GEMINI_API_KEY env var', () => {
        delete process.env.GOOGLE_GEMINI_API_KEY;
        process.env.GEMINI_API_KEY = 'fallback-key';

        const result = GeminiManager.getInstance();
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.getKeyCount()).toBe(1);
            expect(result.data.getKey()).toBe('fallback-key');
        }
    });
});

// ─── OpenAIManager Preset Tests ─────────────────────────────────────────────

describe('OpenAIManager', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV };
        OpenAIManager.reset();
        BasePreset.resetAll();
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
        OpenAIManager.reset();
        BasePreset.resetAll();
    });

    test('getInstance reads OPENAI_API_KEY', () => {
        process.env.OPENAI_API_KEY = 'sk-test-openai-key';

        const result = OpenAIManager.getInstance();
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.getKeyCount()).toBe(1);
            expect(result.data.getKey()).toBe('sk-test-openai-key');
        }
    });

    test('execute works with OpenAI key', async () => {
        process.env.OPENAI_API_KEY = 'sk-exec-test';
        const result = OpenAIManager.getInstance();
        expect(result.success).toBe(true);
        if (!result.success) return;

        const response = await result.data.execute(async (key) => {
            expect(key).toBe('sk-exec-test');
            return { model: 'gpt-4o', message: 'Hello!' };
        });

        expect(response).toEqual({ model: 'gpt-4o', message: 'Hello!' });
    });
});

// ─── MultiManager Tests ─────────────────────────────────────────────────────

describe('MultiManager', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV };
        MultiManager.reset();
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
        MultiManager.reset();
    });

    test('getInstance initializes multiple providers', () => {
        process.env.GOOGLE_GEMINI_API_KEY = 'gem-key-1,gem-key-2';
        process.env.OPENAI_API_KEY = 'sk-openai-1';

        const result = MultiManager.getInstance({
            providers: {
                gemini: { envKeys: ['GOOGLE_GEMINI_API_KEY'] },
                openai: { envKeys: ['OPENAI_API_KEY'] },
            },
        });

        expect(result.success).toBe(true);
        if (result.success) {
            const vault = result.data;
            expect(vault.getProviders()).toEqual(['gemini', 'openai']);

            const geminiStats = vault.getStats('gemini');
            expect(geminiStats?.total).toBe(2);

            const openaiStats = vault.getStats('openai');
            expect(openaiStats?.total).toBe(1);
        }
    });

    test('execute routes to correct provider', async () => {
        process.env.GOOGLE_GEMINI_API_KEY = 'gem-route-key';
        process.env.OPENAI_API_KEY = 'sk-route-key';

        const result = MultiManager.getInstance({
            providers: {
                gemini: { envKeys: ['GOOGLE_GEMINI_API_KEY'] },
                openai: { envKeys: ['OPENAI_API_KEY'] },
            },
        });

        expect(result.success).toBe(true);
        if (!result.success) return;

        const vault = result.data;

        // Execute with Gemini provider
        const geminiResult = await vault.execute(async (key) => {
            expect(key).toBe('gem-route-key');
            return 'gemini-response';
        }, { provider: 'gemini' });
        expect(geminiResult).toBe('gemini-response');

        // Execute with OpenAI provider
        const openaiResult = await vault.execute(async (key) => {
            expect(key).toBe('sk-route-key');
            return 'openai-response';
        }, { provider: 'openai' });
        expect(openaiResult).toBe('openai-response');
    });

    test('execute throws for unknown provider', async () => {
        process.env.GOOGLE_GEMINI_API_KEY = 'key';

        const result = MultiManager.getInstance({
            providers: {
                gemini: { envKeys: ['GOOGLE_GEMINI_API_KEY'] },
            },
        });

        expect(result.success).toBe(true);
        if (!result.success) return;

        await expect(
            result.data.execute(async () => 'x', { provider: 'anthropic' })
        ).rejects.toThrow('Unknown provider "anthropic"');
    });

    test('getMultiStats returns stats for all providers', () => {
        process.env.GOOGLE_GEMINI_API_KEY = 'g1,g2';
        process.env.OPENAI_API_KEY = 'o1';

        const result = MultiManager.getInstance({
            providers: {
                gemini: { envKeys: ['GOOGLE_GEMINI_API_KEY'] },
                openai: { envKeys: ['OPENAI_API_KEY'] },
            },
        });

        expect(result.success).toBe(true);
        if (!result.success) return;

        const stats = result.data.getMultiStats();
        expect(stats.gemini.total).toBe(2);
        expect(stats.openai.total).toBe(1);
    });

    test('getKey returns key from specific provider', () => {
        process.env.GOOGLE_GEMINI_API_KEY = 'gem-direct';

        const result = MultiManager.getInstance({
            providers: {
                gemini: { envKeys: ['GOOGLE_GEMINI_API_KEY'] },
            },
        });

        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.data.getKey('gemini')).toBe('gem-direct');
        expect(result.data.getKey('nonexistent')).toBeNull();
    });

    test('singleton returns same instance', () => {
        process.env.GOOGLE_GEMINI_API_KEY = 'key';

        const r1 = MultiManager.getInstance({
            providers: { gemini: { envKeys: ['GOOGLE_GEMINI_API_KEY'] } },
        });
        const r2 = MultiManager.getInstance({
            providers: { gemini: { envKeys: ['GOOGLE_GEMINI_API_KEY'] } },
        });

        expect(r1.success).toBe(true);
        expect(r2.success).toBe(true);
        if (r1.success && r2.success) {
            expect(r1.data).toBe(r2.data);
        }
    });
});

// ─── Integration: Presets use FileStorage ───────────────────────────────────

describe('Preset + FileStorage Integration', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV };
        GeminiManager.reset();
        BasePreset.resetAll();
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
        GeminiManager.reset();
        BasePreset.resetAll();
    });

    test('GeminiManager creates a state file in tmpdir', async () => {
        process.env.GOOGLE_GEMINI_API_KEY = 'persist-test-key';
        const result = GeminiManager.getInstance();
        expect(result.success).toBe(true);
        if (!result.success) return;

        // Execute a call to trigger state save
        await result.data.execute(async (key) => 'ok');

        // Verify state file exists
        const stateFile = path.join(os.tmpdir(), 'codedex_gemini_state.json');
        expect(fs.existsSync(stateFile)).toBe(true);

        // Clean up
        try { fs.unlinkSync(stateFile); } catch { /* ok */ }
    });
});
