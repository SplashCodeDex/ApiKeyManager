#!/usr/bin/env node
/**
 * SplashCodeX API Gateway — Programmatic & CLI Entry Point
 *
 * Starts the Fastify transparent proxy server. Can be used:
 *
 * @cli
 *   npx @splashcodex/api-key-manager gateway
 *   npx @splashcodex/api-key-manager gateway -- npm run dev
 *   npx @splashcodex/api-key-manager gateway -- npx vite --port 5173
 *
 * @programmatic
 *   const { startGateway } = require('@splashcodex/api-key-manager/bin/gateway');
 *   const { server, vault } = await startGateway({ port: 9000 });
 */

const { spawn } = require('child_process');

// ─── Parse CLI args ──────────────────────────────────────────────────────────
// Everything after '--' is the user's command to spawn.
const sepIndex = process.argv.indexOf('--');
const childArgs = sepIndex !== -1 ? process.argv.slice(sepIndex + 1) : null;

// ─── startGateway() ─────────────────────────────────────────────────────────

async function startGateway(options = {}) {
    const port = options.port || parseInt(process.env.GATEWAY_PORT || '9000', 10);
    const host = options.host || process.env.GATEWAY_HOST || '0.0.0.0';

    // Load centralized env from ~/codedex/env/ (if it exists)
    const { loadCentralEnv } = require('../dist/env/loader');
    const envResult = loadCentralEnv();
    if (envResult.loaded) {
        console.log(
            `\x1b[36m[env]\x1b[0m Loaded ${envResult.varsSet} vars from ${envResult.filesLoaded.join(', ')}`
        );
    }

    const { loadConfig } = require('../dist/gateway/config');
    const config = loadConfig();

    // ── Logger (must be loaded before MultiManager which uses it) ────────
    const { log } = require('../dist/gateway/middleware');

    // ── Initialize MultiManager ──────────────────────────────────────────
    const { MultiManager } = require('../dist/presets/multi');

    const providerConfigs = {};
    const providerMap = new Map();

    for (const p of config.providers) {
        providerConfigs[p.name] = { envKeys: p.envKeys };
        providerMap.set(p.name, p);
    }

    const managerResult = MultiManager.getInstance({
        providers: providerConfigs,
        healthCheckIntervalMs: options.healthCheckIntervalMs || 300_000,
        logger: {
            info: (msg) => log('info', 'gateway', msg),
            warn: (msg) => log('warn', 'gateway', msg),
            error: (msg) => log('error', 'gateway', msg),
        },
    });

    if (!managerResult.success) {
        console.error(
            '\x1b[31m[FATAL] Failed to initialize MultiManager:\x1b[0m',
            managerResult.error.message
        );
        console.error(
            '\x1b[33mMake sure your API keys are set in environment variables or ~/codedex/env/.\x1b[0m'
        );
        process.exit(1);
    }

    const vault = managerResult.data;

    // ── Rate Limiter ─────────────────────────────────────────────────────
    const { RateLimiter } = require('../dist/gateway/middleware');
    const rateLimiter = new RateLimiter(config.rateLimits);
    if (Object.keys(config.rateLimits).length > 0) {
        console.log(
            `\x1b[36m[gateway]\x1b[0m Per-app rate limits configured for: ${Object.keys(config.rateLimits).join(', ')}`
        );
    }

    // ── Audit Trail ──────────────────────────────────────────────────────
    const auditLog = [];
    const MAX_AUDIT_ENTRIES = 10_000;

    function recordAudit(entry) {
        auditLog.push(entry);
        if (auditLog.length > MAX_AUDIT_ENTRIES) {
            auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES);
        }
    }

    // ── Proxy helpers ────────────────────────────────────────────────────
    const {
        createProxyFn,
        createStreamProxyFn,
        isStreamRequest,
        sseErrorChunk,
        sseDoneChunk,
    } = require('../dist/gateway/proxy');

    const { getAppId, sendError } = require('../dist/gateway/middleware');

    // ── Fastify App ──────────────────────────────────────────────────────
    let Fastify, cors;
    try {
        Fastify = require('fastify');
        cors = require('@fastify/cors');
    } catch {
        console.error('\x1b[31m[FATAL]\x1b[0m fastify and @fastify/cors are required for the gateway.');
        console.error('\x1b[33m  Install them with: npm install fastify @fastify/cors\x1b[0m');
        process.exit(1);
    }

    const app = Fastify({ logger: false });
    await app.register(cors, { origin: true });

    // ── Transparent Reverse Proxy Route ──────────────────────────────────
    app.all('/:provider/*', async (request, reply) => {
        const appId = getAppId(request);
        const params = request.params;
        const provider = params.provider;

        const queryIndex = request.raw.url.indexOf('?');
        const queryString = queryIndex !== -1 ? request.raw.url.substring(queryIndex) : '';
        const path = '/' + params['*'] + queryString;

        const providerDef = providerMap.get(provider);
        if (!providerDef) {
            if (provider === 'v1' && (params['*'] === 'generate' || params['*'] === 'stream')) {
                return sendError(
                    reply,
                    400,
                    'The gateway has been upgraded to a transparent proxy. Please use /gemini/* or /openai/* directly with the official SDKs.'
                );
            }
            return sendError(
                reply,
                400,
                `Unknown provider "${provider}". Available: ${[...providerMap.keys()].join(', ')}`
            );
        }

        const proxyReq = {
            provider,
            path,
            method: request.method,
            headers: request.headers,
            body: request.body,
        };

        const isStream = isStreamRequest(provider, path, proxyReq.headers, request.body);

        // Rate limit check
        const rateResult = rateLimiter.check(appId);
        if (!rateResult.allowed) {
            log(
                'warn',
                appId,
                `⛔ Rate limited (reset in ${Math.ceil((rateResult.resetAt - Date.now()) / 1000)}s)`
            );
            return sendError(reply, 429, 'Rate limit exceeded. Please slow down.', {
                retryAfterMs: Math.max(0, rateResult.resetAt - Date.now()),
            });
        }

        const auditEntry = {
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
                const origin = request.headers.origin || '*';
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
                } catch (streamErr) {
                    log('error', appId, `✗ STREAM error: ${streamErr.message}`);
                    try {
                        reply.raw.write(sseErrorChunk(streamErr.message));
                        // Don't send [DONE] — it breaks Gemini SDK which tries to parse it as JSON
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

                for (const [k, v] of Object.entries(result.headers)) {
                    if (
                        k.toLowerCase() !== 'transfer-encoding' &&
                        k.toLowerCase() !== 'content-encoding'
                    ) {
                        reply.header(k, v);
                    }
                }

                reply.send(result.body);

                auditEntry.statusCode = result.statusCode;
                auditEntry.latencyMs = result.latencyMs;
                log('info', appId, `← ${result.provider} ${result.latencyMs}ms`);
            }
        } catch (err) {
            log('error', appId, `✗ ${err.message}`);
            auditEntry.error = err.message;
            auditEntry.statusCode = err.status || null;

            if (!reply.raw.headersSent) {
                return sendError(reply, err.status || 502, err.message);
            } else {
                try {
                    reply.raw.write(sseErrorChunk(err.message));
                    // Don't send [DONE] — it breaks Gemini SDK which tries to parse it as JSON
                } catch {
                    /* connection already closed */
                }
                reply.raw.end();
            }
        } finally {
            recordAudit(auditEntry);
        }
    });

    // ── GET /v1/health ──────────────────────────────────────────────────
    app.get('/v1/health', async (_request, reply) => {
        const stats = vault.getMultiStats();
        const providers = vault.getProviders();
        const health = {};
        for (const p of providers) {
            const s = stats[p];
            if (s) {
                health[p] = { total: s.total, healthy: s.healthy, cooling: s.cooling, dead: s.dead };
            }
        }
        return reply.send({ status: 'ok', uptime: process.uptime(), providers: health });
    });

    // ── GET /v1/providers ───────────────────────────────────────────────
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

    // ── GET /v1/audit ───────────────────────────────────────────────────
    app.get('/v1/audit', async (request, reply) => {
        const limit = Math.min(parseInt((request.query || {}).limit || '100', 10), 1000);
        const appFilter = (request.query || {}).app;
        const providerFilter = (request.query || {}).provider;

        let filtered = auditLog.slice(-limit).reverse();
        if (appFilter) filtered = filtered.filter((e) => e.appId === appFilter);
        if (providerFilter) filtered = filtered.filter((e) => e.provider === providerFilter);

        return reply.send({ count: filtered.length, total: auditLog.length, entries: filtered });
    });

    // ── GET /v1/rate-limits ─────────────────────────────────────────────
    app.get('/v1/rate-limits', async (_request, reply) => {
        const limits = rateLimiter.getLimits();
        const snapshot = rateLimiter.getSnapshot();
        return reply.send({ limits, usage: snapshot });
    });

    // ── Start Server ────────────────────────────────────────────────────
    try {
        await app.listen({ port, host });
    } catch (err) {
        if (err.code === 'EADDRINUSE') {
            console.error(`\x1b[31m[FATAL]\x1b[0m Port ${port} is already in use.`);
            console.error('\x1b[33m  Stop the existing process or set GATEWAY_PORT to a different port.\x1b[0m');
        } else {
            console.error('\x1b[31m[FATAL]\x1b[0m Failed to start server:', err.message);
        }
        process.exit(1);
    }

    const providers = vault.getProviders();
    console.log('');
    console.log('\x1b[92m ╔══════════════════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[92m ║     SplashCodeX API Gateway v5.5.1              ║\x1b[0m');
    console.log('\x1b[92m ╚══════════════════════════════════════════════════╝\x1b[0m');
    console.log('');
    console.log(`\x1b[36m   Server:     http://localhost:${port}\x1b[0m`);
    console.log(`\x1b[36m   Health:     http://localhost:${port}/v1/health\x1b[0m`);
    console.log(`\x1b[36m   Audit Log:  http://localhost:${port}/v1/audit\x1b[0m`);
    console.log('');

    for (const p of providers) {
        const stats = vault.getStats(p);
        const keyCount = stats?.total || 0;
        const models = providerMap.get(p)?.models || {};
        console.log(
            `   \x1b[33m${p}\x1b[0m — ${keyCount} key(s), models: ${Object.keys(models).join(', ')}`
        );
    }
    console.log('');

    // ── Return handle for programmatic use ──────────────────────────────
    return { server: app, vault, port, host };
}

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

let child = null;

async function shutdown(signal) {
    console.log(`\n\x1b[33m[gateway] Received ${signal}. Shutting down gracefully...\x1b[0m`);

    if (child) {
        console.log('\x1b[33m[gateway] Terminating child process...\x1b[0m');
        child.kill('SIGTERM');
        // Give the child 5 seconds to exit, then force kill
        setTimeout(() => {
            if (child && !child.killed) {
                child.kill('SIGKILL');
            }
        }, 5000);
    }

    try {
        // Server and vault are closed by the process exit
        console.log('\x1b[32m[gateway] Shutdown complete.\x1b[0m');
    } catch (err) {
        console.error('\x1b[31m[gateway] Error during shutdown:\x1b[0m', err);
    }
    process.exit(0);
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

// ─── Run ─────────────────────────────────────────────────────────────────────

if (require.main === module) {
    // Called as CLI entry point
    startGateway()
        .then(({ server, vault }) => {
            // If the user passed a command after '--', spawn it
            if (childArgs && childArgs.length > 0) {
                console.log(
                    `\x1b[36m[gateway]\x1b[0m Spawning: \x1b[90m${childArgs.join(' ')}\x1b[0m\n`
                );
                child = spawn(childArgs[0], childArgs.slice(1), {
                    stdio: 'inherit',
                    shell: process.platform === 'win32',
                });

                child.on('exit', (code, sig) => {
                    if (code !== null) {
                        console.log(`\n\x1b[36m[gateway]\x1b[0m Child process exited with code ${code}`);
                    } else if (sig) {
                        console.log(`\n\x1b[36m[gateway]\x1b[0m Child process killed by signal ${sig}`);
                    }
                    // Graceful shutdown
                    vault.destroy();
                    server.close().then(() => process.exit(code || 0));
                });

                child.on('error', (err) => {
                    console.error(
                        `\x1b[31m[gateway]\x1b[0m Failed to spawn child process: ${err.message}`
                    );
                    vault.destroy();
                    server.close().then(() => process.exit(1));
                });
            }
        })
        .catch((err) => {
            console.error('\x1b[31m[FATAL]\x1b[0m', err);
            process.exit(1);
        });
} else {
    // Required as a module — export startGateway
    module.exports = { startGateway };
}