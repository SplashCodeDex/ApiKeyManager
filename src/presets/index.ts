/**
 * Presets — Batteries-included provider managers
 * @module presets
 */
export { BasePreset } from './base';
export type { PresetOptions, PresetLogger, Result } from './base';
export { GeminiManager } from './gemini';
export { OpenAIManager } from './openai';
export { AnthropicManager } from './anthropic';
export { MultiManager } from './multi';
export type { ProviderConfig, MultiManagerOptions } from './multi';
