/**
 * Proxy — Constructs and forwards real API calls to upstream providers.
 *
 * This module knows HOW to call each provider based on the ProviderDefinition.
 * It returns a callback function suitable for `MultiManager.execute(fn)`.
 */

import { ProviderDefinition } from './config';

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
 * Determines if a request should be treated as a streaming request.
 * Consolidated logic across all supported providers.
 */
export function isStreamRequest(
    providerName: string,
    path: string,
    headers: Record<string, string>,
    body?: any,
): boolean {
    // Gemini: alt=sse query parameter
    if (providerName === 'gemini' && path.includes('?alt=sse')) return true;

    // Gemini / OpenAI: 'stream: true' in the request body
    if (body && typeof body === 'object' && body.stream === true) return true;

    // Anthropic: server-sent events as a query param or by body property
    if (providerName === 'anthropic') {
        if (path.includes('?stream=true')) return true;
        if (body && typeof body === 'object' && (body.stream === true || body.stream === 'sse')) return true;
    }

    // Generic SSE detection by Accept / Cache-Control hints from downstream clients
    const acceptHeader = headers['accept'] || headers['Accept'] || '';
    if (acceptHeader.includes('text/event-stream')) return true;

    return false;
}

/**
 * Builds a URL and injects the API key according to provider auth style.
 */
export function buildUpstreamUrl(providerDef: ProviderDefinition, path: string, key: string): string {
    let url = `${providerDef.baseUrl}${path}`;
    if (providerDef.authStyle === 'query') {
        url += `${url.includes('?') ? '&' : '?'}${providerDef.authKey}=${encodeURIComponent(key)}`;
    }
    return url;
}

/**
 * Builds request headers, injecting the API key per provider auth style
 * and applying provider-specific required headers.
 */
export function buildUpstreamHeaders(
    providerDef: ProviderDefinition,
    incomingHeaders: Record<string, string>,
    key: string,
): Record<string, string> {
    const headers = sanitizeHeaders(incomingHeaders);

    if (providerDef.authStyle === 'header') {
        headers[providerDef.authKey] = `${providerDef.authPrefix || ''}${key}`;
    }
    // query-style keys go in the URL, not headers — already handled by buildUpstreamUrl

    // Anthropic requires a version header on all requests
    if (providerDef.name === 'anthropic' && !headers['anthropic-version']) {
        headers['anthropic-version'] = '2023-06-01';
    }

    return headers;
}

/**
 * Creates the callback function that MultiManager.execute() will call for a standard request.
 * This is where the magic happens — the key is injected by the manager.
 */
export function createProxyFn(
    providerDef: ProviderDefinition,
    req: TransparentProxyRequest,
): (key: string) => Promise<ProxyResponse> {
    return async (key: string): Promise<ProxyResponse> => {
        const url = buildUpstreamUrl(providerDef, req.path, key);
        const headers = buildUpstreamHeaders(providerDef, req.headers, key);

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
        res.headers.forEach((v, k) => {
            resHeaders[k] = v;
        });

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
        } catch {
            /* not JSON, return as raw text */
        }

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
    req: TransparentProxyRequest,
): (key: string) => AsyncGenerator<Uint8Array, void, unknown> {
    return async function* (key: string): AsyncGenerator<Uint8Array, void, unknown> {
        const url = buildUpstreamUrl(providerDef, req.path, key);
        const headers = buildUpstreamHeaders(providerDef, req.headers, key);

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

/**
 * Emits a structured SSE error event as raw Uint8Array bytes.
 * Used when an error occurs mid-stream (headers already sent) to signal
 * the client gracefully instead of leaving them hanging.
 */
export function sseErrorChunk(message: string): Uint8Array {
    const payload = `event: error\ndata: ${JSON.stringify({ error: message })}\n\n`;
    return new TextEncoder().encode(payload);
}

/**
 * Emits the SSE terminal "done" signal.
 */
export function sseDoneChunk(): Uint8Array {
    return new TextEncoder().encode('data: [DONE]\n\n');
}
