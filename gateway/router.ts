/**
 * AI Gateway Router — Unified Provider-Agnostic Endpoint
 *
 * Accepts a single request format from any frontend app,
 * picks the best healthy provider via MultiManager,
 * calls that provider's native SDK, and returns a normalized response.
 *
 * Endpoint: POST /v1/ai
 */
import type { ProviderDefinition } from './config';
import { MultiManager } from '../src/presets/multi';
import { log } from './middleware';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';

// ─── Unified Request Types ──────────────────────────────────────────────────

export interface UnifiedMessage {
    role: 'system' | 'user' | 'assistant' | 'model';
    content: string | UnifiedContentPart[];
}

export interface UnifiedContentPart {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string }; // data:image/jpeg;base64,...
}

export interface UnifiedTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface UnifiedRequest {
    type: 'chat' | 'generate';
    messages?: UnifiedMessage[];
    systemInstruction?: string;
    contents?: string;
    /** Base64-encoded image data (without the data:image/xxx;base64, prefix) */
    imageBase64?: string;
    /** MIME type of the image (e.g. "image/jpeg") */
    imageMimeType?: string;
    tools?: UnifiedTool[];
    responseFormat?: 'text' | 'json';
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    preferredProvider?: string;
    model?: string;
}

export interface UnifiedResponse {
    text: string;
    toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
    model: string;
    provider: string;
}

// ─── Provider Capabilities ──────────────────────────────────────────────────

type ProviderCap = { text: boolean; vision: boolean; tools: boolean; streaming: boolean };

const PROVIDER_CAPABILITIES: Record<string, ProviderCap> = {
    gemini: { text: true, vision: true, tools: true, streaming: true },
    openai: { text: true, vision: true, tools: true, streaming: true },
    anthropic: { text: true, vision: true, tools: true, streaming: true },
    groq: { text: true, vision: true, tools: true, streaming: true },
    nvidia: { text: true, vision: true, tools: true, streaming: true },
    mistral: { text: true, vision: false, tools: true, streaming: true },
    deepseek: { text: true, vision: false, tools: true, streaming: true },
    together: { text: true, vision: false, tools: true, streaming: true },
    cohere: { text: true, vision: false, tools: false, streaming: true },
};

function isVisionRequest(req: UnifiedRequest): boolean {
    if (req.imageBase64) return true;
    if (req.messages) {
        for (const msg of req.messages) {
            if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                    if (part.type === 'image_url') return true;
                }
            }
        }
    }
    return false;
}

function isToolsRequest(req: UnifiedRequest): boolean {
    return !!(req.tools && req.tools.length > 0);
}

function pickProvider(
    vault: MultiManager,
    req: UnifiedRequest,
    providerDefs: Map<string, ProviderDefinition>,
): { provider: string; model: string } {
    const available = vault.getProviders();

    if (req.preferredProvider && available.includes(req.preferredProvider)) {
        return {
            provider: req.preferredProvider,
            model: req.model || Object.keys(providerDefs.get(req.preferredProvider)?.models || {})[0] || 'default',
        };
    }

    let candidates = available.filter((p) => {
        const caps = PROVIDER_CAPABILITIES[p];
        if (!caps) return false;
        if (isVisionRequest(req) && !caps.vision) return false;
        if (isToolsRequest(req) && !caps.tools) return false;
        if (req.stream && !caps.streaming) return false;
        return caps.text;
    });

    if (req.model && candidates.length > 1) {
        const target = req.model;
        const modelProvider = [...providerDefs.entries()].find(
            ([, def]) => Object.keys(def.models).includes(target),
        );
        if (modelProvider && candidates.includes(modelProvider[0])) {
            return { provider: modelProvider[0], model: target };
        }
    }

    if (candidates.length === 0) {
        candidates = available.filter((p) => PROVIDER_CAPABILITIES[p]?.text);
    }

    if (candidates.length === 0) {
        throw new Error('No healthy providers available');
    }

    let best = candidates[0];
    let bestHealthy = 0;
    for (const p of candidates) {
        const stats = vault.getStats(p);
        const healthy = (stats?.healthy || 0);
        if (healthy > bestHealthy) {
            bestHealthy = healthy;
            best = p;
        }
    }

    const def = providerDefs.get(best);
    // Pick the last model as default (typically newest/best in config ordering)
    const modelKeys = def ? Object.keys(def.models) : [];
    const defaultModel = modelKeys.length > 0 ? modelKeys[modelKeys.length - 1] : 'default';
    return { provider: best, model: req.model || defaultModel };
}

// ─── Non-streaming SDK Callers ──────────────────────────────────────────────

async function callGemini(
    key: string,
    providerDef: ProviderDefinition,
    req: UnifiedRequest,
): Promise<{ text: string; model: string }> {
    const client = new GoogleGenAI({ apiKey: key, httpOptions: { baseUrl: providerDef.baseUrl } });
    const model = req.model || Object.keys(providerDef.models)[0] || 'gemini-2.5-flash';

    if (req.type === 'generate') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let contents: any;
        if (req.imageBase64) {
            contents = [{
                parts: [
                    { text: req.contents || '' },
                    { inlineData: { data: req.imageBase64, mimeType: req.imageMimeType || 'image/jpeg' } }
                ]
            }];
        } else {
            contents = req.contents || req.messages?.map(m => ({
                role: m.role === 'assistant' ? 'model' : m.role,
                parts: typeof m.content === 'string' ? [{ text: m.content }] : m.content,
            })) || '';
        }

        const result = await client.models.generateContent({
            model,
            contents,
            config: {
                systemInstruction: req.systemInstruction,
                temperature: req.temperature,
                maxOutputTokens: req.maxTokens,
                responseMimeType: req.responseFormat === 'json' ? 'application/json' : undefined,
                tools: req.tools?.length ? [{
                    functionDeclarations: req.tools.map(t => ({
                        name: t.function.name,
                        description: t.function.description,
                        parameters: t.function.parameters,
                    }))
                }] : undefined,
            },
        });
        return { text: result.text || '', model };
    } else {
        const chat = client.chats.create({
            model,
            config: {
                systemInstruction: req.systemInstruction,
                temperature: req.temperature,
                maxOutputTokens: req.maxTokens,
                responseMimeType: req.responseFormat === 'json' ? 'application/json' : undefined,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tools: req.tools?.length ? [{
                    functionDeclarations: req.tools.map(t => ({
                        name: t.function.name, description: t.function.description, parameters: t.function.parameters,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    }))
                }] as any : undefined,
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            history: (req.messages?.slice(0, -1).map(m => ({
                role: m.role === 'assistant' ? 'model' : m.role,
                parts: typeof m.content === 'string' ? [{ text: m.content }] : m.content,
            })) || []) as any,
        });
        const lastMsg = req.messages?.[req.messages.length - 1];
        const messageText = typeof lastMsg?.content === 'string' ? lastMsg.content : '';
        const result = await chat.sendMessage({ message: messageText });
        return { text: result.text || '', model };
    }
}

async function callOpenAI(
    key: string, providerDef: ProviderDefinition, req: UnifiedRequest,
): Promise<{ text: string; model: string }> {
    const client = new OpenAI({
        apiKey: key,
        baseURL: providerDef.baseUrl === 'https://api.openai.com' ? undefined : `${providerDef.baseUrl}/v1`,
    });
    const model = req.model || Object.keys(providerDef.models)[0] || 'gpt-4o-mini';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [];
    if (req.systemInstruction) messages.push({ role: 'system', content: req.systemInstruction });
    if (req.messages) {
        for (const msg of req.messages) {
            if (Array.isArray(msg.content)) {
                const parts = msg.content.map((p) => {
                    if (p.type === 'image_url') return { type: 'image_url', image_url: { url: p.image_url!.url, detail: 'auto' } };
                    return { type: 'text', text: p.text || '' };
                });
                if (msg.role === 'system') messages.push({ role: 'user', content: parts });
                else messages.push({ role: msg.role, content: parts });
            } else {
                messages.push({ role: msg.role, content: msg.content || '' });
            }
        }
    } else if (req.contents) {
        if (req.imageBase64) {
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text: req.contents },
                    { type: 'image_url', image_url: { url: `data:${req.imageMimeType || 'image/jpeg'};base64,${req.imageBase64}`, detail: 'auto' } }
                ]
            });
        } else {
            messages.push({ role: 'user', content: req.contents });
        }
    }
    const result = await client.chat.completions.create({
        model, messages, temperature: req.temperature ?? 0.7, max_tokens: req.maxTokens,
        tools: req.tools?.map(t => ({ type: 'function' as const, function: t.function })),
        response_format: req.responseFormat === 'json' ? { type: 'json_object' } : undefined,
    });
    return { text: result.choices?.[0]?.message?.content || '', model: result.model || model };
}

async function callAnthropic(
    key: string, providerDef: ProviderDefinition, req: UnifiedRequest,
): Promise<{ text: string; model: string }> {
    const client = new Anthropic({ apiKey: key });
    const model = req.model || Object.keys(providerDef.models)[0] || 'claude-sonnet-4-20250514';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [];
    if (req.messages) {
        for (const msg of req.messages) {
            if (msg.role === 'system') continue;
            if (Array.isArray(msg.content)) {
                const blocks = msg.content.map((p) => {
                    if (p.type === 'image_url' && p.image_url?.url) {
                        const parts = p.image_url.url.split(',');
                        const mt = (parts[0]?.match(/data:(.*?);/)?.[1] || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
                        return { type: 'image' as const, source: { type: 'base64' as const, media_type: mt, data: parts[1] || '' } };
                    }
                    return { type: 'text' as const, text: p.text || '' };
                });
                messages.push({ role: msg.role, content: blocks });
            } else {
                messages.push({ role: msg.role, content: msg.content || '' });
            }
        }
    } else if (req.contents) {
        if (req.imageBase64) {
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text: req.contents },
                    { type: 'image', source: { type: 'base64' as const, media_type: (req.imageMimeType || 'image/jpeg') as any, data: req.imageBase64 } }
                ]
            });
        } else {
            messages.push({ role: 'user', content: req.contents });
        }
    }
    const result = await client.messages.create({
        model, messages, system: req.systemInstruction, max_tokens: req.maxTokens || 4096, temperature: req.temperature,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: req.tools?.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters as any })),
    });
    const textBlock = result.content.find((c) => c.type === 'text');
    return { text: textBlock?.type === 'text' ? textBlock.text : '', model: result.model };
}

async function callGroq(
    key: string, _providerDef: ProviderDefinition, req: UnifiedRequest,
): Promise<{ text: string; model: string }> {
    const client = new Groq({ apiKey: key });
    const model = req.model || 'llama-3.3-70b-versatile';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [];
    if (req.systemInstruction) messages.push({ role: 'system', content: req.systemInstruction });
    if (req.messages) {
        for (const msg of req.messages) {
            if (msg.role === 'model') messages.push({ role: 'assistant', content: typeof msg.content === 'string' ? msg.content : '' });
            else if (msg.role === 'system' || msg.role === 'user' || msg.role === 'assistant')
                messages.push({ role: msg.role, content: typeof msg.content === 'string' ? msg.content : '' });
        }
    } else if (req.contents) messages.push({ role: 'user', content: req.contents });

    const result = await client.chat.completions.create({
        model, messages, temperature: req.temperature ?? 0.7, max_tokens: req.maxTokens,
        tools: req.tools?.map(t => ({ type: 'function' as const, function: t.function })),
        response_format: req.responseFormat === 'json' ? { type: 'json_object' } : undefined,
    });
    return { text: result.choices?.[0]?.message?.content || '', model };
}

// ─── Non-streaming Router ───────────────────────────────────────────────────

export async function handleUnifiedRequest(
    vault: MultiManager,
    providerDefs: Map<string, ProviderDefinition>,
    req: UnifiedRequest,
): Promise<UnifiedResponse> {
    const { provider, model } = pickProvider(vault, req, providerDefs);
    const providerDef = providerDefs.get(provider);
    if (!providerDef) throw new Error(`Provider definition not found: ${provider}`);

    log('info', 'router', `→ ${provider}/${model} (${req.type})`);

    let result: { text: string; model: string };

    switch (provider) {
        case 'gemini':
            result = await vault.execute((key) => callGemini(key, providerDef, req), { provider, maxRetries: 3, timeoutMs: 60_000 });
            break;
        case 'openai': case 'nvidia': case 'mistral': case 'deepseek': case 'together':
            result = await vault.execute((key) => callOpenAI(key, providerDef, req), { provider, maxRetries: 3, timeoutMs: 60_000 });
            break;
        case 'anthropic':
            result = await vault.execute((key) => callAnthropic(key, providerDef, req), { provider, maxRetries: 3, timeoutMs: 60_000 });
            break;
        case 'groq':
            result = await vault.execute((key) => callGroq(key, providerDef, req), { provider, maxRetries: 3, timeoutMs: 60_000 });
            break;
        default:
            result = await vault.execute((key) => callOpenAI(key, providerDef, req), { provider, maxRetries: 3, timeoutMs: 60_000 });
    }

    log('info', 'router', `← ${provider}/${result.model} done`);

    return { text: result.text, model: result.model, provider };
}

// ─── Streaming SDK Callers ──────────────────────────────────────────────────

async function* callGeminiStream(
    key: string,
    providerDef: ProviderDefinition,
    req: UnifiedRequest,
): AsyncGenerator<string> {
    const client = new GoogleGenAI({ apiKey: key, httpOptions: { baseUrl: providerDef.baseUrl } });
    const model = req.model || Object.keys(providerDef.models)[0] || 'gemini-2.5-flash';

    const chat = client.chats.create({
        model,
        config: {
            systemInstruction: req.systemInstruction,
            temperature: req.temperature,
            maxOutputTokens: req.maxTokens,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tools: req.tools?.length ? [{
                functionDeclarations: req.tools.map(t => ({
                    name: t.function.name, description: t.function.description, parameters: t.function.parameters,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                }))
            }] as any : undefined,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        history: (req.messages?.slice(0, -1).map(m => ({
            role: m.role === 'assistant' ? 'model' : m.role,
            parts: typeof m.content === 'string' ? [{ text: m.content }] : m.content,
        })) || []) as any,
    });

    const lastMsg = req.messages?.[req.messages.length - 1];
    const messageText = typeof lastMsg?.content === 'string' ? lastMsg.content : '';
    const stream = await chat.sendMessageStream({ message: messageText });

    for await (const chunk of stream) {
        const chunkData: Record<string, unknown> = {};
        if (chunk.text) chunkData.text = chunk.text;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((chunk as any).functionCalls?.length) chunkData.functionCalls = (chunk as any).functionCalls;
        yield `data: ${JSON.stringify(chunkData)}\n\n`;
    }
    yield 'data: [DONE]\n\n';
}

async function* callOpenAIStream(
    key: string, providerDef: ProviderDefinition, req: UnifiedRequest,
): AsyncGenerator<string> {
    const client = new OpenAI({
        apiKey: key,
        baseURL: providerDef.baseUrl === 'https://api.openai.com' ? undefined : `${providerDef.baseUrl}/v1`,
    });
    const model = req.model || Object.keys(providerDef.models)[0] || 'gpt-4o-mini';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [];
    if (req.systemInstruction) messages.push({ role: 'system', content: req.systemInstruction });
    if (req.messages) {
        for (const msg of req.messages) {
            if (typeof msg.content === 'string')
                messages.push({ role: msg.role === 'model' ? 'assistant' : msg.role, content: msg.content });
        }
    } else if (req.contents) messages.push({ role: 'user', content: req.contents });

    const stream = await client.chat.completions.create({
        model, messages, temperature: req.temperature ?? 0.7, max_tokens: req.maxTokens, stream: true,
        tools: req.tools?.map(t => ({ type: 'function' as const, function: t.function })),
    });

    for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) yield `data: ${JSON.stringify({ text: delta.content })}\n\n`;
        if (delta?.tool_calls) yield `data: ${JSON.stringify({ functionCalls: delta.tool_calls })}\n\n`;
    }
    yield 'data: [DONE]\n\n';
}

async function* callGroqStream(key: string, req: UnifiedRequest): AsyncGenerator<string> {
    const client = new Groq({ apiKey: key });
    const model = req.model || 'llama-3.3-70b-versatile';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [];
    if (req.systemInstruction) messages.push({ role: 'system', content: req.systemInstruction });
    if (req.messages) {
        for (const msg of req.messages) {
            if (typeof msg.content === 'string')
                messages.push({ role: msg.role === 'model' ? 'assistant' : msg.role, content: msg.content });
        }
    } else if (req.contents) messages.push({ role: 'user', content: req.contents });

    const stream = await client.chat.completions.create({
        model, messages, temperature: req.temperature ?? 0.7, max_tokens: req.maxTokens, stream: true,
    });
    for await (const chunk of stream) {
        const c = chunk.choices?.[0]?.delta?.content;
        if (c) yield `data: ${JSON.stringify({ text: c })}\n\n`;
    }
    yield 'data: [DONE]\n\n';
}

// ─── Streaming Router ───────────────────────────────────────────────────────

export async function* handleUnifiedStream(
    vault: MultiManager,
    providerDefs: Map<string, ProviderDefinition>,
    req: UnifiedRequest,
): AsyncGenerator<string, void, unknown> {
    const { provider, model } = pickProvider(vault, req, providerDefs);
    const providerDef = providerDefs.get(provider);
    if (!providerDef) throw new Error(`Provider definition not found: ${provider}`);

    log('info', 'router', `→ STREAM ${provider}/${model}`);

    switch (provider) {
        case 'gemini':
            yield* vault.executeStream((key) => callGeminiStream(key, providerDef, req), { provider, maxRetries: 3, timeoutMs: 120_000 });
            break;
        case 'openai': case 'nvidia': case 'mistral': case 'deepseek': case 'together':
            yield* vault.executeStream((key) => callOpenAIStream(key, providerDef, req), { provider, maxRetries: 3, timeoutMs: 120_000 });
            break;
        case 'groq':
            yield* vault.executeStream((key) => callGroqStream(key, req), { provider, maxRetries: 3, timeoutMs: 120_000 });
            break;
        default:
            yield* vault.executeStream((key) => callOpenAIStream(key, providerDef, req), { provider, maxRetries: 3, timeoutMs: 120_000 });
    }

    log('info', 'router', `← STREAM ${provider}/${model} done`);
}