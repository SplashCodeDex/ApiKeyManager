/**
 * OpenAI Preset — One-line OpenAI API key management
 *
 * Pre-configured singleton with:
 * - Reads `OPENAI_API_KEY` from env
 * - LatencyStrategy for optimal key selection
 * - File persistence (survives restarts)
 * - Health checks every 5 minutes
 * - Concurrency limit of 20
 *
 * @module presets/openai
 *
 * @example
 * ```ts
 * import { OpenAIManager } from '@splashcodex/api-key-manager/presets/openai';
 *
 * const result = OpenAIManager.getInstance();
 * if (!result.success) throw result.error;
 * const openai = result.data;
 *
 * const response = await openai.execute(async (key) => {
 *   const client = new OpenAI({ apiKey: key });
 *   const completion = await client.chat.completions.create({
 *     model: 'gpt-4o',
 *     messages: [{ role: 'user', content: 'Hello!' }],
 *   });
 *   return completion.choices[0].message.content;
 * }, { maxRetries: 3, timeoutMs: 30000 });
 * ```
 */

import { BasePreset, PresetOptions, Result } from './base';

export class OpenAIManager extends BasePreset {
    private static readonly PROVIDER = 'openai';

    private constructor(keys: string[], options: PresetOptions) {
        super(keys, options);
    }

    private static getDefaultOptions(): Partial<PresetOptions> {
        return {
            envKeys: ['OPENAI_API_KEY'],
            provider: OpenAIManager.PROVIDER,
            concurrency: 20,
            healthCheckIntervalMs: 300_000,
        };
    }

    /**
     * Get or create the singleton OpenAIManager instance.
     *
     * @param overrides - Optional configuration overrides
     * @returns Result<OpenAIManager>
     */
    static getInstance(overrides?: Partial<PresetOptions>): Result<OpenAIManager> {
        return BasePreset.createInstance(
            OpenAIManager as unknown as new (keys: string[], options: PresetOptions) => OpenAIManager,
            OpenAIManager.getDefaultOptions(),
            overrides
        ) as Result<OpenAIManager>;
    }

    static reset(): void {
        BasePreset.resetInstance(OpenAIManager.PROVIDER);
    }
}

export { Result } from './base';
