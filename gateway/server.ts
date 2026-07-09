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
import { createProxyFn, createStreamProxyFn, TransparentProxyRequest } from './proxy';
import { getAppId, sendError, log } from './middleware';

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

// ─── Fastify App ─────────────────────────────────────────────────────────────

const app = Fastify({ logger: false });

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
        // Fallback for missing provider or unmatched route
        if (provider === 'v1' && (params['*'] === 'generate' || params['*'] === 'stream')) {
            return sendError(reply, 400, 'The gateway has been upgraded to a transparent proxy. Please use /gemini/* or /openai/* directly with the official SDKs.');
        }
        return sendError(reply, 400, `Unknown provider "${provider}". Available: ${[...providerMap.keys()].join(', ')}`);
    }

    const proxyReq: TransparentProxyRequest = {
        provider,
        path,
        method: request.method,
        headers: request.headers as Record<string, string>,
        body: request.body,
    };

    const isStream = path.includes('?alt=sse') || (request.body && (request.body as any).stream === true);

    try {
        if (isStream) {
            log('info', appId, `→ STREAM ${provider} ${path}`);
            reply.raw.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });

            const streamFn = createStreamProxyFn(providerDef, proxyReq);
            const stream = vault.executeStream(streamFn, {
                provider,
                maxRetries: 3,
                timeoutMs: 60_000,
            });

            for await (const chunk of stream) {
                reply.raw.write(chunk);
            }

            reply.raw.end();
            log('info', appId, `← STREAM complete`);
        } else {
            log('info', appId, `→ ${provider} ${path}`);
            
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
            log('info', appId, `← ${result.provider} ${result.latencyMs}ms`);
        }
    } catch (err: any) {
        log('error', appId, `✗ ${err.message}`);
        if (!reply.raw.headersSent) {
            return sendError(reply, err.status || 502, err.message);
        } else {
            reply.raw.end();
        }
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
