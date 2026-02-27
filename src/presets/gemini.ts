/**
 * Gemini Preset — One-line Gemini API key management
 *
 * Pre-configured singleton with:
 * - Reads `GOOGLE_GEMINI_API_KEY` or `GEMINI_API_KEY` from env
 * - LatencyStrategy for optimal key selection
 * - File persistence (survives restarts)
 * - Health checks every 5 minutes
 * - Concurrency limit of 20
 *
 * @module presets/gemini
 *
 * @example
 * ```ts
 * import { GeminiManager } from '@splashcodex/api-key-manager/presets/gemini';
 *
 * // Initialize once (reads keys from process.env automatically)
 * const result = GeminiManager.getInstance();
 * if (!result.success) throw result.error;
 * const gemini = result.data;
 *
 * // Use the execute() wrapper for automatic key rotation + retries
 * const response = await gemini.execute(async (key) => {
 *   const genAI = new GoogleGenerativeAI(key);
 *   const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
 *   const res = await model.generateContent('Hello, world!');
 *   return res.response.text();
 * }, { maxRetries: 3, timeoutMs: 30000 });
 * ```
 */

import { BasePreset, PresetOptions, Result } from './base';

export class GeminiManager extends BasePreset {
    private static readonly PROVIDER = 'gemini';

    private constructor(keys: string[], options: PresetOptions) {
        super(keys, options);
    }

    /**
     * Default configuration for Gemini presets.
     */
    private static getDefaultOptions(): Partial<PresetOptions> {
        return {
            envKeys: ['GOOGLE_GEMINI_API_KEY', 'GEMINI_API_KEY'],
            provider: GeminiManager.PROVIDER,
            concurrency: 20,
            healthCheckIntervalMs: 300_000, // 5 minutes
        };
    }

    /**
     * Get or create the singleton GeminiManager instance.
     *
     * @param overrides - Optional configuration overrides
     * @returns Result<GeminiManager> — safely check `.success` before using `.data`
     *
     * @example
     * ```ts
     * const result = GeminiManager.getInstance();
     * if (result.success) {
     *   const gemini = result.data;
     *   const text = await gemini.execute(apiCall, { maxRetries: 3 });
     * }
     * ```
     */
    static getInstance(overrides?: Partial<PresetOptions>): Result<GeminiManager> {
        return BasePreset.createInstance(
            GeminiManager as unknown as new (keys: string[], options: PresetOptions) => GeminiManager,
            GeminiManager.getDefaultOptions(),
            overrides
        ) as Result<GeminiManager>;
    }

    /**
     * Reset the singleton instance. Primarily for testing.
     */
    static reset(): void {
        BasePreset.resetInstance(GeminiManager.PROVIDER);
    }
}

export { Result } from './base';
