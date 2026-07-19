/**
 * Gateway Configuration
 * Loads provider definitions and server settings from environment.
 *
 * Supports two provider sources:
 *   1. Built-in providers (gemini, openai, anthropic) — always loaded.
 *   2. External providers via GATEWAY_EXTRA_PROVIDERS env var (JSON array).
 *
 * Per-app rate limiting can be configured via GATEWAY_RATE_LIMITS env var
 * (JSON map of appId → { requestsPerMin: number }).
 */

export interface ProviderDefinition {
    name: string;
    envKeys: string[];
    baseUrl: string;
    /** Maps model aliases to actual API paths */
    models: Record<string, string>;
    /** How to inject the API key into the outgoing request */
    authStyle: 'header' | 'query';
    authKey: string; // e.g. 'x-goog-api-key' or 'Authorization'
    authPrefix?: string; // e.g. 'Bearer ' for OpenAI
}

export interface RateLimitConfig {
    /** Max requests per rolling 60-second window */
    requestsPerMin: number;
}

export interface AppRateLimits {
    [appId: string]: RateLimitConfig;
}

export interface GatewayConfig {
    port: number;
    host: string;
    providers: ProviderDefinition[];
    /** Per-app rate limits keyed by x-app-id value */
    rateLimits: AppRateLimits;
}

/**
 * Built-in provider definitions.
 */
const BUILTIN_PROVIDERS: ProviderDefinition[] = [
    {
        name: 'gemini',
        envKeys: ['GOOGLE_GEMINI_API_KEY', 'GEMINI_API_KEY'],
        baseUrl: 'https://generativelanguage.googleapis.com',
        models: {
            'gemini-2.5-flash': '/v1beta/models/gemini-2.5-flash:generateContent',
            'gemini-3.1-flash-lite': '/v1beta/models/gemini-3.1-flash-lite:generateContent',
            'gemini-3.5-flash': '/v1beta/models/gemini-3.5-flash:generateContent',
        },
        authStyle: 'query',
        authKey: 'key',
    },
    {
        name: 'openai',
        envKeys: ['OPENAI_API_KEY'],
        baseUrl: 'https://api.openai.com',
        models: {
            'gpt-4o': '/v1/chat/completions',
            'o4-mini': '/v1/chat/completions',
            'gpt-4o-mini': '/v1/chat/completions',
        },
        authStyle: 'header',
        authKey: 'Authorization',
        authPrefix: 'Bearer ',
    },
    {
        name: 'anthropic',
        envKeys: ['ANTHROPIC_API_KEY'],
        baseUrl: 'https://api.anthropic.com',
        models: {
            'claude-sonnet-5': '/v1/messages',
            'claude-haiku-4-5-20251001': '/v1/messages',
            'claude-opus-4-8': '/v1/messages',
            'claude-fable-5': '/v1/messages',
        },
        authStyle: 'header',
        authKey: 'x-api-key',
    },
    {
        name: 'groq',
        envKeys: ['GROQ_API_KEY'],
        baseUrl: 'https://api.groq.com/openai',
        models: {
            'llama-4-scout-17b-16e-instruct': '/v1/chat/completions',
            'meta-llama/llama-4-scout-17b-16e-instruct': '/v1/chat/completions',
            'llama-4-maverick-17b-128e-instruct': '/v1/chat/completions',
        },
        authStyle: 'header',
        authKey: 'Authorization',
        authPrefix: 'Bearer ',
    },
    {
        name: 'mistral',
        envKeys: ['MISTRAL_API_KEY'],
        baseUrl: 'https://api.mistral.ai',
        models: {
            'mistral-large-latest': '/v1/chat/completions',
            'codestral-latest': '/v1/chat/completions',
            'mistral-small-latest': '/v1/chat/completions',
        },
        authStyle: 'header',
        authKey: 'Authorization',
        authPrefix: 'Bearer ',
    },
    {
        name: 'deepseek',
        envKeys: ['DEEPSEEK_API_KEY'],
        baseUrl: 'https://api.deepseek.com',
        models: {
            'deepseek-reasoner': '/v1/chat/completions',
            'deepseek-chat': '/v1/chat/completions',
        },
        authStyle: 'header',
        authKey: 'Authorization',
        authPrefix: 'Bearer ',
    },
    {
        name: 'together',
        envKeys: ['TOGETHER_API_KEY'],
        baseUrl: 'https://api.together.xyz',
        models: {
            'meta-llama/Llama-3.3-70B-Instruct-Turbo': '/v1/chat/completions',
            'Qwen/Qwen2.5-72B-Instruct-Turbo': '/v1/chat/completions',
            'deepseek-ai/DeepSeek-V3': '/v1/chat/completions',
        },
        authStyle: 'header',
        authKey: 'Authorization',
        authPrefix: 'Bearer ',
    },
    {
        name: 'cohere',
        envKeys: ['COHERE_API_KEY'],
        baseUrl: 'https://api.cohere.com',
        models: {
            'command-r': '/v2/chat',
            'command-a-03-2025': '/v2/chat',
            'command-r-plus': '/v2/chat',
        },
        authStyle: 'header',
        authKey: 'Authorization',
        authPrefix: 'Bearer ',
    },
    {
        name: 'nvidia',
        envKeys: ['NVIDIA_API_KEY'],
        baseUrl: 'https://integrate.api.nvidia.com',
        models: {
            'meta/llama-3.3-70b-instruct': '/v1/chat/completions',
            'nvidia/llama-3.1-nemotron-70b-instruct': '/v1/chat/completions',
            'meta/llama-3.1-70b-instruct': '/v1/chat/completions',
            'google/diffusiongemma-26b-a4b-it': '/v1/chat/completions',
        },
        authStyle: 'header',
        authKey: 'Authorization',
        authPrefix: 'Bearer ',
    },
];

/**
 * Parse GATEWAY_EXTRA_PROVIDERS env var to allow users to define
 * additional or override providers at runtime without modifying code.
 *
 * Format: JSON array of ProviderDefinition objects.
 *
 * @example
 *   export GATEWAY_EXTRA_PROVIDERS='[{"name":"deepseek","envKeys":["DEEPSEEK_API_KEY"],"baseUrl":"https://api.deepseek.com","models":{"deepseek-chat":"/v1/chat/completions"},"authStyle":"header","authKey":"Authorization","authPrefix":"Bearer "}]'
 */
function parseExtraProviders(): ProviderDefinition[] {
    const raw = process.env.GATEWAY_EXTRA_PROVIDERS;
    if (!raw || !raw.trim()) return [];

    try {
        const parsed = JSON.parse(raw.trim());
        if (!Array.isArray(parsed)) {
            console.warn('\x1b[33m[config] GATEWAY_EXTRA_PROVIDERS must be a JSON array — ignoring\x1b[0m');
            return [];
        }
        // Validate each entry has required fields
        const valid: ProviderDefinition[] = [];
        for (const entry of parsed) {
            if (!entry.name || !entry.baseUrl || !entry.authStyle || !entry.authKey) {
                console.warn(`\x1b[33m[config] Skipping invalid provider entry: ${JSON.stringify(entry)}\x1b[0m`);
                continue;
            }
            valid.push({
                name: entry.name,
                envKeys: entry.envKeys || [],
                baseUrl: entry.baseUrl,
                models: entry.models || {},
                authStyle: entry.authStyle,
                authKey: entry.authKey,
                authPrefix: entry.authPrefix,
            });
        }
        return valid;
    } catch (err) {
        console.warn(`\x1b[33m[config] Failed to parse GATEWAY_EXTRA_PROVIDERS: ${(err as Error).message}\x1b[0m`);
        return [];
    }
}

/**
 * Parse GATEWAY_RATE_LIMITS env var for per-app rate limiting.
 *
 * Format: JSON object mapping appId → { requestsPerMin: number }
 *
 * @example
 *   export GATEWAY_RATE_LIMITS='{"my-frontend":{"requestsPerMin":100},"my-backend":{"requestsPerMin":500}}'
 */
function parseRateLimits(): AppRateLimits {
    const raw = process.env.GATEWAY_RATE_LIMITS;
    if (!raw || !raw.trim()) return {};

    try {
        const parsed = JSON.parse(raw.trim());
        if (typeof parsed !== 'object' || Array.isArray(parsed) || !parsed) {
            console.warn('\x1b[33m[config] GATEWAY_RATE_LIMITS must be a JSON object — ignoring\x1b[0m');
            return {};
        }
        const limits: AppRateLimits = {};
        for (const [appId, cfg] of Object.entries(parsed)) {
            if (cfg && typeof cfg === 'object' && typeof (cfg as any).requestsPerMin === 'number') {
                limits[appId] = { requestsPerMin: (cfg as any).requestsPerMin };
            } else {
                console.warn(`\x1b[33m[config] Skipping invalid rate limit entry for "${appId}"\x1b[0m`);
            }
        }
        return limits;
    } catch (err) {
        console.warn(`\x1b[33m[config] Failed to parse GATEWAY_RATE_LIMITS: ${(err as Error).message}\x1b[0m`);
        return {};
    }
}

export function loadConfig(): GatewayConfig {
    const port = parseInt(process.env.GATEWAY_PORT || '9000', 10);
    const host = process.env.GATEWAY_HOST || '0.0.0.0';

    // Merge built-in + extra providers. Extra providers take precedence
    // in case of name conflicts (they appear first in the merged list).
    const extra = parseExtraProviders();
    const mergedNames = new Set<string>();
    const providers: ProviderDefinition[] = [];

    // Extra providers first (overrides)
    for (const p of extra) {
        providers.push(p);
        mergedNames.add(p.name);
    }
    // Built-in providers if not overridden
    for (const p of BUILTIN_PROVIDERS) {
        if (!mergedNames.has(p.name)) {
            providers.push(p);
        }
    }

    return { port, host, providers, rateLimits: parseRateLimits() };
}
