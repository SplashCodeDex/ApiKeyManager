#!/usr/bin/env node
/**
 * SplashCodeX API Gateway — Programmatic & CLI Entry Point
 *
 * Thin wrapper around the compiled TypeScript factory function.
 * All route definitions, middleware, and server logic live in
 * gateway/server.ts (compiled to dist/gateway/gateway/server.js).
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
    // Delegate all server building to the compiled TypeScript factory
    const { buildGatewayApp } = require('../dist/gateway/gateway/server');

    const { server, vault, config } = await buildGatewayApp({
        port: options.port || parseInt(process.env.GATEWAY_PORT || '9000', 10),
        host: options.host || process.env.GATEWAY_HOST || '0.0.0.0',
        healthCheckIntervalMs: options.healthCheckIntervalMs,
    });

    // ── Start Server ────────────────────────────────────────────────────
    try {
        await server.listen({ port: config.port, host: config.host });
    } catch (err) {
        if (err.code === 'EADDRINUSE') {
            console.error(`\x1b[31m[FATAL]\x1b[0m Port ${config.port} is already in use.`);
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
    console.log(`\x1b[36m   Server:     http://localhost:${config.port}\x1b[0m`);
    console.log(`\x1b[36m   Health:     http://localhost:${config.port}/v1/health\x1b[0m`);
    console.log(`\x1b[36m   Audit Log:  http://localhost:${config.port}/v1/audit\x1b[0m`);
    console.log(`\x1b[36m   Unified AI: http://localhost:${config.port}/v1/ai\x1b[0m`);
    console.log('');

    for (const p of providers) {
        const stats = vault.getStats(p);
        const def = config.providers.find((x) => x.name === p);
        const keyCount = stats?.total || 0;
        const models = def?.models || {};
        console.log(
            `   \x1b[33m${p}\x1b[0m — ${keyCount} key(s), models: ${Object.keys(models).join(', ')}`
        );
    }
    console.log('');

    // ── Return handle for programmatic use ──────────────────────────────
    return { server, vault, port: config.port, host: config.host };
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