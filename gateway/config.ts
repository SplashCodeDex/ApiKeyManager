/**
 * Gateway Configuration
 * Loads provider definitions and server settings from environment.
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

export interface GatewayConfig {
    port: number;
    host: string;
    providers: ProviderDefinition[];
}

/**
 * Built-in provider definitions.
 */
const PROVIDERS: ProviderDefinition[] = [
    {
        name: 'gemini',
        envKeys: ['GOOGLE_GEMINI_API_KEY', 'GEMINI_API_KEY'],
        baseUrl: 'https://generativelanguage.googleapis.com',
        models: {
            'gemini-2.0-flash': '/v1beta/models/gemini-2.0-flash:generateContent',
            'gemini-2.0-flash-lite': '/v1beta/models/gemini-2.0-flash-lite:generateContent',
            'gemini-2.5-flash': '/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent',
            'gemini-2.5-pro': '/v1beta/models/gemini-2.5-pro-preview-05-06:generateContent',
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
            'gpt-4o-mini': '/v1/chat/completions',
            'gpt-4-turbo': '/v1/chat/completions',
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
            'claude-sonnet-4-20250514': '/v1/messages',
            'claude-haiku-4-5-20251001': '/v1/messages',
            'claude-opus-4-6': '/v1/messages',
        },
        authStyle: 'header',
        authKey: 'x-api-key',
    },
];

export function loadConfig(): GatewayConfig {
    const port = parseInt(process.env.GATEWAY_PORT || '9000', 10);
    const host = process.env.GATEWAY_HOST || '0.0.0.0';

    return { port, host, providers: PROVIDERS };
}
