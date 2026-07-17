/**
 * SplashCodeX API Gateway — Fastify Server
 *
 * Centralized proxy that routes all AI API requests through
 * a shared MultiManager key pool. All apps call this gateway
 * instead of calling Google/OpenAI directly.
 *
 * Usage:
 *   npm run gateway
 *   # or
 *   npx ts-node gateway/server.ts
 */

import { loadCentralEnv } from '../src/env';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { MultiManager } from '../src/presets/multi';
import { loadConfig, ProviderDefinition } from './config';
import {
    createProxyFn,
    createStreamProxyFn,
    isStreamRequest,
    sseErrorChunk,
    sseDoneChunk,
    TransparentProxyRequest,
} from './proxy';
import { getAppId, sendError, log, RateLimiter } from './middleware';

// ─── Load centralized env FIRST (before anything reads process.env) ─────────
const envResult = loadCentralEnv();
if (envResult.loaded) {
    console.log(`\x1b[36m[env]\x1b[0m Loaded ${envResult.varsSet} vars from ${envResult.filesLoaded.join(', ')}`);
}

const config = loadConfig();

// ─── Initialize MultiManager ────────────────────────────────────────────────

const providerConfigs: Record<string, { envKeys: string[] }> = {};
const providerMap = new Map<string, ProviderDefinition>();

for (const p of config.providers) {
    providerConfigs[p.name] = { envKeys: p.envKeys };
    providerMap.set(p.name, p);
}

const managerResult = MultiManager.getInstance({
    providers: providerConfigs,
    healthCheckIntervalMs: 300_000,
    logger: {
        info: (msg: string) => log('info', 'gateway', msg),
        warn: (msg: string) => log('warn', 'gateway', msg),
        error: (msg: string) => log('error', 'gateway', msg),
    },
});

if (!managerResult.success) {
    console.error('\x1b[31m[FATAL] Failed to initialize MultiManager:\x1b[0m', managerResult.error.message);
    console.error('\x1b[33mMake sure your API keys are set in environment variables.\x1b[0m');
    process.exit(1);
}

const vault = managerResult.data;

// ─── Rate Limiter (per-app sliding window) ───────────────────────────────────

const rateLimiter = new RateLimiter(config.rateLimits);
if (Object.keys(config.rateLimits).length > 0) {
    console.log(
        `\x1b[36m[gateway]\x1b[0m Per-app rate limits configured for: ${Object.keys(config.rateLimits).join(', ')}`,
    );
}

// ─── Audit Trail (in-memory ring buffer for recent requests) ─────────────────

interface AuditEntry {
    timestamp: string;
    appId: string;
    provider: string;
    method: string;
    path: string;
    isStream: boolean;
    statusCode: number | null;
    latencyMs: number | null;
    error: string | null;
}

const auditLog: AuditEntry[] = [];
const MAX_AUDIT_ENTRIES = 10_000;

function recordAudit(entry: AuditEntry): void {
    auditLog.push(entry);
    if (auditLog.length > MAX_AUDIT_ENTRIES) {
        auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES);
    }
}

// ─── Fastify App ─────────────────────────────────────────────────────────────

const app = Fastify({
    logger: false,
    // Explicit 100MB body limit — matches Fastify's default but makes it visible.
    // This is more than enough for compressed tithe book images (~2MB each, max 4 = ~8MB).
    // The limit applies to the entire request body, not individual files.
    bodyLimit: 100 * 1024 * 1024,
});

app.register(cors, { origin: true });

// ─── Transparent Reverse Proxy Route ──────────────────────────────────────────

app.all('/:provider/*', async (request, reply) => {
    const appId = getAppId(request);
    const params = request.params as { provider: string; '*': string };
    const provider = params.provider;

    // Reconstruct the upstream path and query string
    const queryIndex = request.raw.url.indexOf('?');
    const queryString = queryIndex !== -1 ? request.raw.url.substring(queryIndex) : '';
    const path = '/' + params['*'] + queryString;

    const providerDef = providerMap.get(provider);
    if (!providerDef) {
        // Fallback for unmatched routes — inform about transparent proxy upgrade
        if (provider === 'v1' && (params['*'] === 'generate' || params['*'] === 'stream')) {
            return sendError(
                reply,
                400,
                'The gateway has been upgraded to a transparent proxy. Please use /gemini/* or /openai/* directly with the official SDKs.',
            );
        }
        return sendError(
            reply,
            400,
            `Unknown provider "${provider}". Available: ${[...providerMap.keys()].join(', ')}`,
        );
    }

    const proxyReq: TransparentProxyRequest = {
        provider,
        path,
        method: request.method,
        headers: request.headers as Record<string, string>,
        body: request.body,
    };

    const isStream = isStreamRequest(provider, path, proxyReq.headers, request.body);

    // ── Rate limit check ──────────────────────────────────────────────────
    const rateResult = rateLimiter.check(appId);
    if (!rateResult.allowed) {
        log('warn', appId, `⛔ Rate limited (reset in ${Math.ceil((rateResult.resetAt - Date.now()) / 1000)}s)`);
        return sendError(reply, 429, 'Rate limit exceeded. Please slow down.', {
            retryAfterMs: Math.max(0, rateResult.resetAt - Date.now()),
        });
    }

    const auditEntry: AuditEntry = {
        timestamp: new Date().toISOString(),
        appId,
        provider,
        method: request.method,
        path,
        isStream,
        statusCode: null,
        latencyMs: null,
        error: null,
    };

    const startTime = Date.now();

    try {
        if (isStream) {
            log('info', appId, `→ STREAM ${provider} ${path}`);
            // CORS headers must be set manually here because reply.raw.writeHead()
            // bypasses Fastify's @fastify/cors plugin which only hooks into reply.header()
            const origin = (request.headers as Record<string, string>).origin || '*';
            reply.raw.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                'Access-Control-Allow-Origin': origin,
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Id, x-goog-api-key',
                'Access-Control-Allow-Credentials': 'true',
                'Access-Control-Expose-Headers': '*',
            });

            const streamFn = createStreamProxyFn(providerDef, proxyReq);
            const stream = vault.executeStream(streamFn, {
                provider,
                maxRetries: 3,
                timeoutMs: 60_000,
            });

            try {
                for await (const chunk of stream) {
                    reply.raw.write(chunk);
                }

                // Don't emit sseDoneChunk() here — the upstream provider already
                // sends its own termination markers (e.g. OpenAI sends [DONE]).
                // Adding an extra [DONE] breaks providers like Gemini whose SDK
                // tries to parse it as JSON.
                reply.raw.end();

                auditEntry.statusCode = 200;
                auditEntry.latencyMs = Date.now() - startTime;
                log('info', appId, `← STREAM complete ${auditEntry.latencyMs}ms`);
            } catch (streamErr: any) {
                // Headers already sent — emit structured SSE error so the client doesn't hang
                log('error', appId, `✗ STREAM error: ${streamErr.message}`);
                try {
                    reply.raw.write(sseErrorChunk(streamErr.message));
                    // Don't send sseDoneChunk — it breaks Gemini SDK which tries to parse [DONE] as JSON
                } catch {
                    /* connection may already be closed */
                }
                reply.raw.end();

                auditEntry.error = streamErr.message;
            }
        } else {
            log('info', appId, `→ ${provider} ${request.method} ${path}`);

            const proxyFn = createProxyFn(providerDef, proxyReq);
            const result = await vault.execute(proxyFn, {
                provider,
                maxRetries: 3,
                timeoutMs: 60_000,
            });

            reply.status(result.statusCode);

            // Forward safe headers
            for (const [k, v] of Object.entries(result.headers)) {
                if (k.toLowerCase() !== 'transfer-encoding' && k.toLowerCase() !== 'content-encoding') {
                    reply.header(k, v);
                }
            }

            reply.send(result.body);

            auditEntry.statusCode = result.statusCode;
            auditEntry.latencyMs = result.latencyMs;
            log('info', appId, `← ${result.provider} ${result.latencyMs}ms`);
        }
    } catch (err: any) {
        log('error', appId, `✗ ${err.message}`);
        auditEntry.error = err.message;
        auditEntry.statusCode = err.status || null;

        if (!reply.raw.headersSent) {
            return sendError(reply, err.status || 502, err.message);
        } else {
            // Headers already sent (streaming race) — emit SSE error and close
            try {
                reply.raw.write(sseErrorChunk(err.message));
                // Don't send sseDoneChunk — it breaks Gemini SDK which tries to parse [DONE] as JSON
            } catch {
                /* connection already closed */
            }
            reply.raw.end();
        }
    } finally {
        recordAudit(auditEntry);
    }
});

// ─── GET /v1/health ──────────────────────────────────────────────────────────

app.get('/v1/health', async (_request, reply) => {
    const stats = vault.getMultiStats();
    const providers = vault.getProviders();

    const health: Record<string, any> = {};
    for (const p of providers) {
        const s = stats[p];
        if (s) {
            health[p] = {
                total: s.total,
                healthy: s.healthy,
                cooling: s.cooling,
                dead: s.dead,
            };
        }
    }

    return reply.send({ status: 'ok', uptime: process.uptime(), providers: health });
});

// ─── GET /v1/providers ───────────────────────────────────────────────────────

app.get('/v1/providers', async (_request, reply) => {
    const providers = vault.getProviders();
    const details = providers.map((name) => {
        const def = providerMap.get(name);
        return {
            name,
            models: def ? Object.keys(def.models) : [],
            keyCount: vault.getStats(name)?.total || 0,
        };
    });
    return reply.send({ providers: details });
});

// ─── GET /v1/audit ───────────────────────────────────────────────────────────

app.get('/v1/audit', async (request, reply) => {
    const limit = Math.min(parseInt((request.query as any)?.limit || '100', 10), 1000);
    const appFilter = (request.query as any)?.app as string | undefined;
    const providerFilter = (request.query as any)?.provider as string | undefined;

    let filtered = auditLog.slice(-limit).reverse();
    if (appFilter) {
        filtered = filtered.filter((e) => e.appId === appFilter);
    }
    if (providerFilter) {
        filtered = filtered.filter((e) => e.provider === providerFilter);
    }

    return reply.send({ count: filtered.length, total: auditLog.length, entries: filtered });
});

// ─── GET /v1/rate-limits ─────────────────────────────────────────────────────

app.get('/v1/rate-limits', async (_request, reply) => {
    const limits = rateLimiter.getLimits();
    const snapshot = rateLimiter.getSnapshot();
    return reply.send({ limits, usage: snapshot });
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

async function shutdown(signal: string) {
    console.log(`\n\x1b[33m[gateway] Received ${signal}. Shutting down gracefully...\x1b[0m`);
    try {
        vault.destroy();
        await app.close();
        console.log('\x1b[32m[gateway] Server closed cleanly.\x1b[0m');
    } catch (err) {
        console.error('\x1b[31m[gateway] Error during shutdown:\x1b[0m', err);
    } finally {
        process.exit(0);
    }
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

// ─── Start Server ────────────────────────────────────────────────────────────

async function start() {
    try {
        await app.listen({ port: config.port, host: config.host });

        console.log('');
        console.log('\x1b[92m ╔══════════════════════════════════════════════════╗\x1b[0m');
        console.log('\x1b[92m ║     SplashCodeX API Gateway v1.0                ║\x1b[0m');
        console.log('\x1b[92m ╚══════════════════════════════════════════════════╝\x1b[0m');
        console.log('');
        console.log(`\x1b[36m   Server:     http://localhost:${config.port}\x1b[0m`);
        console.log(`\x1b[36m   Health:     http://localhost:${config.port}/v1/health\x1b[0m`);
        console.log(`\x1b[36m   Providers:  http://localhost:${config.port}/v1/providers\x1b[0m`);
        console.log(`\x1b[36m   Audit Log:  http://localhost:${config.port}/v1/audit\x1b[0m`);
        console.log(`\x1b[36m   Rate Limit: http://localhost:${config.port}/v1/rate-limits\x1b[0m`);
        console.log('');

        const providers = vault.getProviders();
        for (const p of providers) {
            const stats = vault.getStats(p);
            const keyCount = stats?.total || 0;
            const models = providerMap.get(p)?.models || {};
            console.log(`   \x1b[33m${p}\x1b[0m — ${keyCount} key(s), models: ${Object.keys(models).join(', ')}`);
        }

        console.log('');
        console.log('\x1b[90m   Press Ctrl+C to stop\x1b[0m');
        console.log('');
    } catch (err) {
        console.error('\x1b[31m[FATAL]\x1b[0m', err);
        process.exit(1);
    }
}

start();
