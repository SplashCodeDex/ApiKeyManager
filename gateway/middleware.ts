/**
 * Gateway Middleware — Logging, App Tracking, Error Formatting, Rate Limiting
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { AppRateLimits, RateLimitConfig } from './config';

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
        info: '\x1b[36m', // cyan
        warn: '\x1b[33m', // yellow
        error: '\x1b[31m', // red
    };
    const reset = '\x1b[0m';
    const prefix = `${colors[level]}[${ts}]${reset} \x1b[90m[${appId}]${reset}`;
    console[level](`${prefix} ${message}`);
}

// ─── Rate Limiter (sliding window, per-app) ─────────────────────────────────

export interface RateLimitResult {
    allowed: boolean;
    /** Requests remaining in the current window */
    remaining: number;
    /** Reset timestamp (ms since epoch) when the window refills */
    resetAt: number;
}

export interface RateLimitSnapshot {
    [appId: string]: {
        requestsPerMin: number;
        used: number;
        remaining: number;
        resetInMs: number;
    };
}

/**
 * Simple sliding-window rate limiter.
 * Tracks request timestamps per appId and rejects when the
 * per-minute threshold is exceeded.
 */
export class RateLimiter {
    private windowMs = 60_000; // 1 minute
    private limits: AppRateLimits;
    /** Map of appId → array of request timestamps (ms) */
    private counters = new Map<string, number[]>();

    constructor(limits: AppRateLimits) {
        this.limits = limits;
    }

    /**
     * Check if an app is allowed to make a request.
     * If allowed, the request is automatically recorded.
     */
    check(appId: string): RateLimitResult {
        const cfg = this.limits[appId];
        // No limit configured → always allow
        if (!cfg) {
            return { allowed: true, remaining: Infinity, resetAt: 0 };
        }

        const now = Date.now();
        this.pruneWindow(appId, now);

        const timestamps = this.counters.get(appId) || [];
        const used = timestamps.length;

        if (used >= cfg.requestsPerMin) {
            // Find the oldest timestamp to calculate when the next slot opens
            const oldest = Math.min(...timestamps);
            const resetAt = oldest + this.windowMs;
            return { allowed: false, remaining: 0, resetAt };
        }

        // Record this request
        timestamps.push(now);
        this.counters.set(appId, timestamps);

        return {
            allowed: true,
            remaining: cfg.requestsPerMin - timestamps.length,
            resetAt: now + this.windowMs,
        };
    }

    /**
     * Get current rate limit usage snapshot for all tracked apps.
     */
    getSnapshot(): RateLimitSnapshot {
        const now = Date.now();
        const snapshot: RateLimitSnapshot = {};

        for (const [appId, cfg] of Object.entries(this.limits)) {
            this.pruneWindow(appId, now);
            const used = (this.counters.get(appId) || []).length;
            const oldest = used > 0 ? Math.min(...(this.counters.get(appId) || [])) : now;
            snapshot[appId] = {
                requestsPerMin: cfg.requestsPerMin,
                used,
                remaining: Math.max(0, cfg.requestsPerMin - used),
                resetInMs: used > 0 ? Math.max(0, oldest + this.windowMs - now) : 0,
            };
        }

        return snapshot;
    }

    /**
     * Get configured limits (so external code knows what's set).
     */
    getLimits(): AppRateLimits {
        return { ...this.limits };
    }

    /**
     * Remove timestamps older than the sliding window.
     */
    private pruneWindow(appId: string, now: number): void {
        const timestamps = this.counters.get(appId);
        if (!timestamps || timestamps.length === 0) return;

        const cutoff = now - this.windowMs;
        // Binary-search style: find first index >= cutoff
        let firstValid = 0;
        while (firstValid < timestamps.length && timestamps[firstValid] < cutoff) {
            firstValid++;
        }

        if (firstValid > 0) {
            const pruned = timestamps.slice(firstValid);
            if (pruned.length === 0) {
                this.counters.delete(appId);
            } else {
                this.counters.set(appId, pruned);
            }
        }
    }
}
