/**
 * Anthropic Preset — One-line Claude API key management
 *
 * Pre-configured singleton with:
 * - Reads `ANTHROPIC_API_KEY` from env
 * - LatencyStrategy for optimal key selection
 * - File persistence (survives restarts)
 * - Health checks every 5 minutes
 * - Concurrency limit of 20
 *
 * @module presets/anthropic
 *
 * @example
 * ```ts
 * import { AnthropicManager } from '@splashcodex/api-key-manager/presets/anthropic';
 *
 * const result = AnthropicManager.getInstance();
 * if (!result.success) throw result.error;
 * const claude = result.data;
 *
 * const response = await claude.execute(async (key) => {
 *   const res = await fetch('https://api.anthropic.com/v1/messages', {
 *     method: 'POST',
 *     headers: {
 *       'x-api-key': key,
 *       'anthropic-version': '2023-06-01',
 *       'content-type': 'application/json',
 *     },
 *     body: JSON.stringify({
 *       model: 'claude-sonnet-4-20250514',
 *       max_tokens: 1024,
 *       messages: [{ role: 'user', content: 'Hello!' }],
 *     }),
 *   });
 *   const data = await res.json();
 *   return data.content[0].text;
 * }, { maxRetries: 3, timeoutMs: 60000 });
 * ```
 */

import { BasePreset, PresetOptions, Result } from './base';

export class AnthropicManager extends BasePreset {
    private static readonly PROVIDER = 'anthropic';

    private constructor(keys: string[], options: PresetOptions) {
        super(keys, options);
    }

    private static getDefaultOptions(): Partial<PresetOptions> {
        return {
            envKeys: ['ANTHROPIC_API_KEY'],
            provider: AnthropicManager.PROVIDER,
            concurrency: 20,
            healthCheckIntervalMs: 300_000,
        };
    }

    /**
     * Get or create the singleton AnthropicManager instance.
     *
     * @param overrides - Optional configuration overrides
     * @returns Result<AnthropicManager>
     */
    static getInstance(overrides?: Partial<PresetOptions>): Result<AnthropicManager> {
        return BasePreset.createInstance(
            AnthropicManager as unknown as new (keys: string[], options: PresetOptions) => AnthropicManager,
            AnthropicManager.getDefaultOptions(),
            overrides
        ) as Result<AnthropicManager>;
    }

    static reset(): void {
        BasePreset.resetInstance(AnthropicManager.PROVIDER);
    }
}

export { Result } from './base';
