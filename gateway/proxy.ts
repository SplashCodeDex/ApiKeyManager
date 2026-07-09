/**
 * Proxy — Constructs and forwards real API calls to upstream providers.
 *
 * This module knows HOW to call each provider based on the ProviderDefinition.
 * It returns a callback function suitable for `MultiManager.execute(fn)`.
 */

import { ProviderDefinition } from './config';
import { createParser, type ParsedEvent } from 'eventsource-parser';

export interface TransparentProxyRequest {
    provider: string;
    path: string; // e.g. "/v1beta/models/gemini-1.5-pro:generateContent"
    method: string;
    headers: Record<string, string>;
    body?: any; // The raw body from the client (parsed JSON or string)
}

export interface ProxyResponse {
    success: boolean;
    provider: string;
    statusCode: number;
    headers: Record<string, string>;
    body: any; // Raw JSON or text
    latencyMs: number;
}

/**
 * Filter headers from client to avoid overriding crucial fetch headers or causing conflicts.
 */
function sanitizeHeaders(incoming: Record<string, string>): Record<string, string> {
    const safe: Record<string, string> = {};
    const skip = ['host', 'connection', 'content-length', 'accept-encoding'];
    for (const [k, v] of Object.entries(incoming)) {
        if (!skip.includes(k.toLowerCase()) && typeof v === 'string') {
            safe[k] = v;
        }
    }
    return safe;
}

/**
 * Creates the callback function that MultiManager.execute() will call for a standard request.
 * This is where the magic happens — the key is injected by the manager.
 */
export function createProxyFn(
    providerDef: ProviderDefinition,
    req: TransparentProxyRequest
): (key: string) => Promise<ProxyResponse> {
    return async (key: string): Promise<ProxyResponse> => {
        // Build the transparent URL
        let url = `${providerDef.baseUrl}${req.path}`;
        const headers = sanitizeHeaders(req.headers);

        // Inject the API key
        if (providerDef.authStyle === 'query') {
            url += `${url.includes('?') ? '&' : '?'}${providerDef.authKey}=${key}`;
        } else {
            headers[providerDef.authKey] = `${providerDef.authPrefix || ''}${key}`;
        }

        // Anthropic requires a version header on all requests
        if (providerDef.name === 'anthropic' && !headers['anthropic-version']) {
            headers['anthropic-version'] = '2023-06-01';
        }

        const fetchOpts: RequestInit = {
            method: req.method,
            headers,
        };

        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
            fetchOpts.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        }

        const start = Date.now();
        const res = await fetch(url, fetchOpts);
        const latencyMs = Date.now() - start;

        const resHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => { resHeaders[k] = v; });

        if (!res.ok) {
            const errorBody = await res.text();
            const err = new Error(`${providerDef.name} API error (${res.status}): ${errorBody.substring(0, 200)}`);
            (err as any).status = res.status;
            (err as any).statusCode = res.status;
            throw err;
        }

        // Try to parse as JSON if possible, else return text
        const text = await res.text();
        let body = text;
        try {
            body = JSON.parse(text);
        } catch { }

        return {
            success: true,
            provider: providerDef.name,
            statusCode: res.status,
            headers: resHeaders,
            body,
            latencyMs,
        };
    };
}

/**
 * Creates a streaming proxy callback for SSE responses.
 * Transparently pipes the raw SSE Buffer chunks from the upstream provider.
 */
export function createStreamProxyFn(
    providerDef: ProviderDefinition,
    req: TransparentProxyRequest
): (key: string) => AsyncGenerator<Uint8Array, void, unknown> {
    return async function* (key: string): AsyncGenerator<Uint8Array, void, unknown> {
        let url = `${providerDef.baseUrl}${req.path}`;
        const headers = sanitizeHeaders(req.headers);

        if (providerDef.authStyle === 'query') {
            url += `${url.includes('?') ? '&' : '?'}${providerDef.authKey}=${key}`;
        } else {
            headers[providerDef.authKey] = `${providerDef.authPrefix || ''}${key}`;
        }

        if (providerDef.name === 'anthropic' && !headers['anthropic-version']) {
            headers['anthropic-version'] = '2023-06-01';
        }

        const fetchOpts: RequestInit = { method: req.method, headers };
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
            fetchOpts.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        }

        const res = await fetch(url, fetchOpts);

        if (!res.ok) {
            const errText = await res.text();
            const err = new Error(`${providerDef.name} stream error (${res.status}): ${errText.substring(0, 200)}`);
            (err as any).status = res.status;
            (err as any).statusCode = res.status;
            throw err;
        }

        if (!res.body) throw new Error('No response body for streaming');

        const reader = res.body.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                // Yield the raw Uint8Array chunk verbatim to the client
                yield value;
            }
        } finally {
            reader.releaseLock();
        }
    };
}
