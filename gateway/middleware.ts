/**
 * Gateway Middleware — Logging, App Tracking, Error Formatting
 */

import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Extract app identifier from request headers.
 */
export function getAppId(request: FastifyRequest): string {
    return (request.headers['x-app-id'] as string) || 'unknown';
}

/**
 * Format a consistent error response.
 */
export function sendError(reply: FastifyReply, statusCode: number, message: string, details?: any) {
    return reply.status(statusCode).send({
        success: false,
        error: message,
        ...(details ? { details } : {}),
    });
}

/**
 * Colorized log prefix with timestamps.
 */
export function log(level: 'info' | 'warn' | 'error', appId: string, message: string) {
    const ts = new Date().toISOString();
    const colors: Record<string, string> = {
        info: '\x1b[36m',   // cyan
        warn: '\x1b[33m',   // yellow
        error: '\x1b[31m',  // red
    };
    const reset = '\x1b[0m';
    const prefix = `${colors[level]}[${ts}]${reset} \x1b[90m[${appId}]${reset}`;
    console[level](`${prefix} ${message}`);
}
