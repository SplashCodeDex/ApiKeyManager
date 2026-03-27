/**
 * Proxy — Constructs and forwards real API calls to upstream providers.
 *
 * This module knows HOW to call each provider based on the ProviderDefinition.
 * It returns a callback function suitable for `MultiManager.execute(fn)`.
 */

import { ProviderDefinition } from './config';

export interface ProxyRequest {
    provider: string;
    model: string;
    prompt: string;
    systemInstruction?: string;
    temperature?: number;
    maxTokens?: number;
}

export interface ProxyResponse {
    success: boolean;
    provider: string;
    model: string;
    result: string;
    latencyMs: number;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
}

/**
 * Build the upstream request body based on the provider format.
 */
function buildRequestBody(provider: ProviderDefinition, req: ProxyRequest): any {
    if (provider.name === 'gemini') {
        const body: any = {
            contents: [{ parts: [{ text: req.prompt }] }],
            generationConfig: {} as any,
        };
        if (req.systemInstruction) {
            body.systemInstruction = { parts: [{ text: req.systemInstruction }] };
        }
        if (req.temperature !== undefined) {
            body.generationConfig.temperature = req.temperature;
        }
        if (req.maxTokens !== undefined) {
            body.generationConfig.maxOutputTokens = req.maxTokens;
        }
        return body;
    }

    if (provider.name === 'openai') {
        const messages: any[] = [];
        if (req.systemInstruction) {
            messages.push({ role: 'system', content: req.systemInstruction });
        }
        messages.push({ role: 'user', content: req.prompt });

        const body: any = {
            model: req.model,
            messages,
        };
        if (req.temperature !== undefined) body.temperature = req.temperature;
        if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
        return body;
    }

    if (provider.name === 'anthropic') {
        const body: any = {
            model: req.model,
            max_tokens: req.maxTokens || 1024,
            messages: [{ role: 'user', content: req.prompt }],
        };
        if (req.systemInstruction) {
            body.system = req.systemInstruction;
        }
        if (req.temperature !== undefined) body.temperature = req.temperature;
        return body;
    }

    // Generic fallback
    return { prompt: req.prompt };
}

/**
 * Parse the upstream response into a standardized ProxyResponse.
 */
function parseResponse(provider: ProviderDefinition, data: any, req: ProxyRequest, latencyMs: number): ProxyResponse {
    if (provider.name === 'gemini') {
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return {
            success: true,
            provider: provider.name,
            model: req.model,
            result: text,
            latencyMs,
            usage: {
                promptTokens: data?.usageMetadata?.promptTokenCount,
                completionTokens: data?.usageMetadata?.candidatesTokenCount,
                totalTokens: data?.usageMetadata?.totalTokenCount,
            },
        };
    }

    if (provider.name === 'openai') {
        const text = data?.choices?.[0]?.message?.content || '';
        return {
            success: true,
            provider: provider.name,
            model: req.model,
            result: text,
            latencyMs,
            usage: {
                promptTokens: data?.usage?.prompt_tokens,
                completionTokens: data?.usage?.completion_tokens,
                totalTokens: data?.usage?.total_tokens,
            },
        };
    }

    if (provider.name === 'anthropic') {
        const text = data?.content?.[0]?.text || '';
        return {
            success: true,
            provider: provider.name,
            model: req.model,
            result: text,
            latencyMs,
            usage: {
                promptTokens: data?.usage?.input_tokens,
                completionTokens: data?.usage?.output_tokens,
                totalTokens: (data?.usage?.input_tokens || 0) + (data?.usage?.output_tokens || 0),
            },
        };
    }

    return { success: true, provider: provider.name, model: req.model, result: JSON.stringify(data), latencyMs };
}

/**
 * Creates the callback function that MultiManager.execute() will call.
 * This is where the magic happens — the key is injected by the manager.
 */
export function createProxyFn(
    providerDef: ProviderDefinition,
    req: ProxyRequest
): (key: string) => Promise<ProxyResponse> {
    return async (key: string): Promise<ProxyResponse> => {
        const modelPath = providerDef.models[req.model];
        if (!modelPath) {
            throw Object.assign(new Error(`Unknown model "${req.model}" for provider "${providerDef.name}". Available: ${Object.keys(providerDef.models).join(', ')}`), { status: 400 });
        }

        // Build the URL
        let url = `${providerDef.baseUrl}${modelPath}`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };

        // Inject the API key
        if (providerDef.authStyle === 'query') {
            url += `${url.includes('?') ? '&' : '?'}${providerDef.authKey}=${key}`;
        } else {
            headers[providerDef.authKey] = `${providerDef.authPrefix || ''}${key}`;
        }

        // Anthropic requires a version header on all requests
        if (providerDef.name === 'anthropic') {
            headers['anthropic-version'] = '2023-06-01';
        }

        const body = buildRequestBody(providerDef, req);
        const start = Date.now();

        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        const latencyMs = Date.now() - start;

        if (!res.ok) {
            const errorBody = await res.text();
            const err = new Error(`${providerDef.name} API error (${res.status}): ${errorBody.substring(0, 200)}`);
            (err as any).status = res.status;
            (err as any).statusCode = res.status;
            throw err;
        }

        const data = await res.json();
        return parseResponse(providerDef, data, req, latencyMs);
    };
}

/**
 * Creates a streaming proxy callback for SSE responses.
 */
export function createStreamProxyFn(
    providerDef: ProviderDefinition,
    req: ProxyRequest
): (key: string) => AsyncGenerator<string, void, unknown> {
    return async function* (key: string): AsyncGenerator<string, void, unknown> {
        const modelPath = providerDef.models[req.model];
        if (!modelPath) {
            throw Object.assign(new Error(`Unknown model "${req.model}"`), { status: 400 });
        }

        let url: string;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };

        if (providerDef.name === 'gemini') {
            // Gemini uses a different endpoint for streaming
            const streamPath = modelPath.replace(':generateContent', ':streamGenerateContent');
            url = `${providerDef.baseUrl}${streamPath}?alt=sse&${providerDef.authKey}=${key}`;
        } else {
            url = `${providerDef.baseUrl}${modelPath}`;
            headers[providerDef.authKey] = `${providerDef.authPrefix || ''}${key}`;
        }

        // Anthropic requires a version header
        if (providerDef.name === 'anthropic') {
            headers['anthropic-version'] = '2023-06-01';
        }

        const body = buildRequestBody(providerDef, req);
        if (providerDef.name === 'openai') {
            body.stream = true;
        }
        if (providerDef.name === 'anthropic') {
            body.stream = true;
        }

        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });

        if (!res.ok) {
            const errText = await res.text();
            const err = new Error(`${providerDef.name} stream error (${res.status}): ${errText.substring(0, 200)}`);
            (err as any).status = res.status;
            (err as any).statusCode = res.status;
            throw err;
        }

        if (!res.body) throw new Error('No response body for streaming');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        if (data === '[DONE]') return;

                        try {
                            const parsed = JSON.parse(data);
                            let text = '';
                            if (providerDef.name === 'gemini') {
                                text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                            } else if (providerDef.name === 'openai') {
                                text = parsed?.choices?.[0]?.delta?.content || '';
                            } else if (providerDef.name === 'anthropic') {
                                // Anthropic streams content_block_delta events
                                if (parsed?.type === 'content_block_delta') {
                                    text = parsed?.delta?.text || '';
                                }
                            }
                            if (text) yield text;
                        } catch {
                            // Skip malformed JSON chunks
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    };
}
