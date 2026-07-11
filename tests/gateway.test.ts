/**
 * Gateway Unit/Integration Tests
 *
 * Covers: config parsing, proxy helpers, SSE detection, middleware rate limiter,
 * and Fastify endpoint smoke tests.
 */

import { loadConfig, GatewayConfig, ProviderDefinition } from '../gateway/config';
import {
    isStreamRequest,
    buildUpstreamUrl,
    buildUpstreamHeaders,
    sseErrorChunk,
    sseDoneChunk,
} from '../gateway/proxy';
import { RateLimiter, sendError, log } from '../gateway/middleware';

// ─── Config Parsing ──────────────────────────────────────────────────────────

describe('gateway/config', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    test('loadConfig returns default port and built-in providers', () => {
        delete process.env.GATEWAY_PORT;
        delete process.env.GATEWAY_HOST;

        const config = loadConfig();
        expect(config.port).toBe(9000);
        expect(config.host).toBe('0.0.0.0');
        expect(config.providers.length).toBeGreaterThanOrEqual(3);
        expect(config.providers.find((p) => p.name === 'gemini')).toBeDefined();
        expect(config.providers.find((p) => p.name === 'openai')).toBeDefined();
        expect(config.providers.find((p) => p.name === 'anthropic')).toBeDefined();
        expect(config.rateLimits).toEqual({});
    });

    test('loadConfig honors GATEWAY_PORT and GATEWAY_HOST', () => {
        process.env.GATEWAY_PORT = '8080';
        process.env.GATEWAY_HOST = '127.0.0.1';

        const config = loadConfig();
        expect(config.port).toBe(8080);
        expect(config.host).toBe('127.0.0.1');
    });

    test('GATEWAY_EXTRA_PROVIDERS merges additional providers', () => {
        process.env.GATEWAY_EXTRA_PROVIDERS = JSON.stringify([
            {
                name: 'deepseek',
                envKeys: ['DEEPSEEK_API_KEY'],
                baseUrl: 'https://api.deepseek.com',
                models: { 'deepseek-chat': '/v1/chat/completions' },
                authStyle: 'header',
                authKey: 'Authorization',
                authPrefix: 'Bearer ',
            },
        ]);

        const config = loadConfig();
        const deepseek = config.providers.find((p) => p.name === 'deepseek');
        expect(deepseek).toBeDefined();
        expect(deepseek!.baseUrl).toBe('https://api.deepseek.com');
        expect(deepseek!.authStyle).toBe('header');
    });

    test('GATEWAY_EXTRA_PROVIDERS overrides built-in when name conflicts', () => {
        process.env.GATEWAY_EXTRA_PROVIDERS = JSON.stringify([
            {
                name: 'gemini',
                envKeys: ['CUSTOM_GEMINI_KEY'],
                baseUrl: 'https://my-proxy.example.com',
                models: { 'my-model': '/v1/generate' },
                authStyle: 'header',
                authKey: 'Authorization',
                authPrefix: 'Bearer ',
            },
        ]);

        const config = loadConfig();
        const gemini = config.providers.find((p) => p.name === 'gemini');
        expect(gemini).toBeDefined();
        // Overridden: should use custom base URL, not Google's
        expect(gemini!.baseUrl).toBe('https://my-proxy.example.com');
        expect(gemini!.authStyle).toBe('header');
    });

    test('GATEWAY_EXTRA_PROVIDERS ignores non-array values', () => {
        process.env.GATEWAY_EXTRA_PROVIDERS = '"not an array"';
        const config = loadConfig();
        // Still has built-in providers, no crash
        expect(config.providers.length).toBeGreaterThanOrEqual(3);
    });

    test('GATEWAY_EXTRA_PROVIDERS skips invalid entries', () => {
        process.env.GATEWAY_EXTRA_PROVIDERS = JSON.stringify([
            { name: 'missing-fields' }, // no baseUrl, authStyle, authKey
            {
                name: 'valid',
                envKeys: ['KEY'],
                baseUrl: 'https://example.com',
                authStyle: 'header',
                authKey: 'x-key',
            },
        ]);

        const config = loadConfig();
        expect(config.providers.find((p) => p.name === 'missing-fields')).toBeUndefined();
        expect(config.providers.find((p) => p.name === 'valid')).toBeDefined();
    });

    test('GATEWAY_RATE_LIMITS parses per-app rate limits', () => {
        process.env.GATEWAY_RATE_LIMITS = JSON.stringify({
            'my-frontend': { requestsPerMin: 100 },
            'my-backend': { requestsPerMin: 500 },
        });

        const config = loadConfig();
        expect(config.rateLimits['my-frontend']).toEqual({ requestsPerMin: 100 });
        expect(config.rateLimits['my-backend']).toEqual({ requestsPerMin: 500 });
    });

    test('GATEWAY_RATE_LIMITS skips invalid entries', () => {
        process.env.GATEWAY_RATE_LIMITS = JSON.stringify({
            'bad-app': { noRequestsPerMin: 100 },
            'good-app': { requestsPerMin: 200 },
        });

        const config = loadConfig();
        expect(config.rateLimits['bad-app']).toBeUndefined();
        expect(config.rateLimits['good-app']).toEqual({ requestsPerMin: 200 });
    });
});

// ─── Proxy Helpers ───────────────────────────────────────────────────────────

describe('gateway/proxy — helpers', () => {
    // ── buildUpstreamUrl ────────────────────────────────────────────────────

    test('buildUpstreamUrl injects query auth for gemini', () => {
        const def: ProviderDefinition = {
            name: 'gemini',
            envKeys: [],
            baseUrl: 'https://generativelanguage.googleapis.com',
            models: {},
            authStyle: 'query',
            authKey: 'key',
        };

        const url = buildUpstreamUrl(
            def,
            '/v1beta/models/gemini-2.0-flash:generateContent',
            'test-key-abc',
        );

        expect(url).toContain('?key=test-key-abc');
        expect(url).toContain('https://generativelanguage.googleapis.com');
    });

    test('buildUpstreamUrl does NOT put key in URL for header auth', () => {
        const def: ProviderDefinition = {
            name: 'openai',
            envKeys: [],
            baseUrl: 'https://api.openai.com',
            models: {},
            authStyle: 'header',
            authKey: 'Authorization',
            authPrefix: 'Bearer ',
        };

        const url = buildUpstreamUrl(def, '/v1/chat/completions', 'sk-test');
        expect(url).toBe('https://api.openai.com/v1/chat/completions');
        expect(url).not.toContain('sk-test');
    });

    // ── buildUpstreamHeaders ────────────────────────────────────────────────

    test('buildUpstreamHeaders injects Bearer auth for OpenAI', () => {
        const def: ProviderDefinition = {
            name: 'openai',
            envKeys: [],
            baseUrl: 'https://api.openai.com',
            models: {},
            authStyle: 'header',
            authKey: 'Authorization',
            authPrefix: 'Bearer ',
        };

        const headers = buildUpstreamHeaders(def, { 'content-type': 'application/json' }, 'sk-test');
        expect(headers['Authorization']).toBe('Bearer sk-test');
        expect(headers['content-type']).toBe('application/json');
    });

    test('buildUpstreamHeaders injects x-api-key for Anthropic', () => {
        const def: ProviderDefinition = {
            name: 'anthropic',
            envKeys: [],
            baseUrl: 'https://api.anthropic.com',
            models: {},
            authStyle: 'header',
            authKey: 'x-api-key',
        };

        const headers = buildUpstreamHeaders(def, {}, 'ant-key');
        expect(headers['x-api-key']).toBe('ant-key');
        expect(headers['anthropic-version']).toBe('2023-06-01');
    });

    test('buildUpstreamHeaders preserves existing anthropic-version', () => {
        const def: ProviderDefinition = {
            name: 'anthropic',
            envKeys: [],
            baseUrl: 'https://api.anthropic.com',
            models: {},
            authStyle: 'header',
            authKey: 'x-api-key',
        };

        const headers = buildUpstreamHeaders(def, { 'anthropic-version': '2024-01-01' }, 'ant-key');
        expect(headers['anthropic-version']).toBe('2024-01-01'); // not overwritten
    });

    test('buildUpstreamHeaders does not put key in headers for query auth', () => {
        const def: ProviderDefinition = {
            name: 'gemini',
            envKeys: [],
            baseUrl: 'https://generativelanguage.googleapis.com',
            models: {},
            authStyle: 'query',
            authKey: 'key',
        };

        const headers = buildUpstreamHeaders(def, {}, 'test-key');
        expect(headers['key']).toBeUndefined();
    });

    test('buildUpstreamHeaders sanitizes dangerous headers', () => {
        const def: ProviderDefinition = {
            name: 'openai',
            envKeys: [],
            baseUrl: 'https://api.openai.com',
            models: {},
            authStyle: 'header',
            authKey: 'Authorization',
            authPrefix: 'Bearer ',
        };

        const headers = buildUpstreamHeaders(
            def,
            { host: 'evil.com', connection: 'keep-alive', 'content-length': '0' },
            'sk-test',
        );
        expect(headers['host']).toBeUndefined();
        expect(headers['connection']).toBeUndefined();
        expect(headers['content-length']).toBeUndefined();
    });

    // ── isStreamRequest ──────────────────────────────────────────────────────

    test('isStreamRequest: gemini with alt=sse', () => {
        expect(isStreamRequest('gemini', '/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse', {}, undefined))
            .toBe(true);
    });

    test('isStreamRequest: gemini without alt=sse', () => {
        expect(isStreamRequest('gemini', '/v1beta/models/gemini-2.0-flash:generateContent', {}, undefined))
            .toBe(false);
    });

    test('isStreamRequest: body.stream === true (OpenAI style)', () => {
        expect(isStreamRequest('openai', '/v1/chat/completions', {}, { stream: true }))
            .toBe(true);
    });

    test('isStreamRequest: body.stream === false', () => {
        expect(isStreamRequest('openai', '/v1/chat/completions', {}, { stream: false }))
            .toBe(false);
    });

    test('isStreamRequest: anthropic with stream=true query', () => {
        expect(isStreamRequest('anthropic', '/v1/messages?stream=true', {}, {}))
            .toBe(true);
    });

    test('isStreamRequest: anthropic with body.stream === true', () => {
        expect(isStreamRequest('anthropic', '/v1/messages', {}, { stream: true }))
            .toBe(true);
    });

    test('isStreamRequest: anthropic with body.stream === "sse"', () => {
        expect(isStreamRequest('anthropic', '/v1/messages', {}, { stream: 'sse' }))
            .toBe(true);
    });

    test('isStreamRequest: generic SSE by Accept header', () => {
        expect(isStreamRequest('openai', '/v1/chat/completions', { accept: 'text/event-stream' }, undefined))
            .toBe(true);
    });

    test('isStreamRequest: no stream signals at all', () => {
        expect(isStreamRequest('gemini', '/v1beta/models/gemini-2.0-flash:generateContent', {}, { prompt: 'hello' }))
            .toBe(false);
    });

    // ── SSE Helpers ─────────────────────────────────────────────────────────

    test('sseErrorChunk produces valid SSE event', () => {
        const chunk = sseErrorChunk('Something broke');
        const text = new TextDecoder().decode(chunk);
        expect(text).toContain('event: error');
        expect(text).toContain('Something broke');
        expect(text).toMatch(/\n\n$/); // ends with double newline
    });

    test('sseDoneChunk produces [DONE] marker', () => {
        const chunk = sseDoneChunk();
        const text = new TextDecoder().decode(chunk);
        expect(text).toBe('data: [DONE]\n\n');
    });
});

// ─── Rate Limiter ────────────────────────────────────────────────────────────

describe('gateway/middleware — RateLimiter', () => {
    test('allows requests when no limits are configured', () => {
        const limiter = new RateLimiter({});
        const result = limiter.check('any-app');
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(Infinity);
    });

    test('allows requests within the limit', () => {
        const limiter = new RateLimiter({ 'my-app': { requestsPerMin: 5 } });
        for (let i = 0; i < 5; i++) {
            const result = limiter.check('my-app');
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(5 - i - 1);
        }
    });

    test('blocks requests exceeding the limit', () => {
        const limiter = new RateLimiter({ 'my-app': { requestsPerMin: 3 } });

        // Use up all 3 slots
        limiter.check('my-app');
        limiter.check('my-app');
        limiter.check('my-app');

        // 4th request should be rejected
        const blocked = limiter.check('my-app');
        expect(blocked.allowed).toBe(false);
        expect(blocked.remaining).toBe(0);
        expect(blocked.resetAt).toBeGreaterThan(Date.now());
    });

    test('getSnapshot returns per-app usage data', () => {
        const limiter = new RateLimiter({
            'app-a': { requestsPerMin: 10 },
            'app-b': { requestsPerMin: 20 },
        });

        limiter.check('app-a');
        limiter.check('app-a');
        limiter.check('app-a');

        limiter.check('app-b');

        const snapshot = limiter.getSnapshot();
        expect(snapshot['app-a'].used).toBe(3);
        expect(snapshot['app-a'].remaining).toBe(7);
        expect(snapshot['app-b'].used).toBe(1);
        expect(snapshot['app-b'].remaining).toBe(19);
    });

    test('getLimits returns configured limits', () => {
        const limits = {
            'my-app': { requestsPerMin: 42 },
        };
        const limiter = new RateLimiter(limits);
        expect(limiter.getLimits()).toEqual({ 'my-app': { requestsPerMin: 42 } });
    });

    test('different apps have independent limits', () => {
        const limiter = new RateLimiter({
            'app-a': { requestsPerMin: 2 },
            'app-b': { requestsPerMin: 100 },
        });

        // Exhaust app-a
        limiter.check('app-a');
        limiter.check('app-a');
        expect(limiter.check('app-a').allowed).toBe(false);

        // app-b still fine
        expect(limiter.check('app-b').allowed).toBe(true);
    });
});

// ─── Middleware Utilities ────────────────────────────────────────────────────

describe('gateway/middleware — utilities', () => {
    test('log does not throw', () => {
        // log writes to console, just ensure no exceptions
        expect(() => log('info', 'test-app', 'test message')).not.toThrow();
        expect(() => log('warn', 'test-app', 'warning message')).not.toThrow();
        expect(() => log('error', 'test-app', 'error message')).not.toThrow();
    });

    test('sendError formats a consistent error response', () => {
        const mockReply = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
        };

        sendError(mockReply as any, 400, 'Bad request');
        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(mockReply.send).toHaveBeenCalledWith({
            success: false,
            error: 'Bad request',
        });
    });

    test('sendError includes details when provided', () => {
        const mockReply = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
        };

        sendError(mockReply as any, 429, 'Rate limited', { retryAfterMs: 5000 });
        expect(mockReply.send).toHaveBeenCalledWith({
            success: false,
            error: 'Rate limited',
            details: { retryAfterMs: 5000 },
        });
    });
});