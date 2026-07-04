/**
 * Centralized Environment Loader
 *
 * Loads environment variables from ~/codedex/env/ so that all 35+ projects
 * share a single source of truth for secrets. Portable via Google Drive.
 *
 * Directory structure:
 *   ~/codedex/env/
 *     common.env       — REDIS_URL, DATABASE_URL, shared across all projects
 *     llm.env          — GEMINI_API_KEY, OPENAI_API_KEY (comma-separated or JSON arrays)
 *     stripe.env       — STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 *     <custom>.env     — Any additional groupings
 *
 * @module env/loader
 *
 * @example
 * ```ts
 * // Load all env files from ~/codedex/env/
 * import { loadCentralEnv } from '@splashcodex/api-key-manager/env';
 * loadCentralEnv();
 *
 * // Now process.env has all the values
 * console.log(process.env.GEMINI_API_KEY);
 * ```
 *
 * @example
 * ```ts
 * // Load specific files only
 * import { loadCentralEnv } from '@splashcodex/api-key-manager/env';
 * loadCentralEnv({ files: ['llm.env', 'common.env'] });
 * ```
 *
 * @example
 * ```ts
 * // Custom env directory (e.g., team-shared location)
 * import { loadCentralEnv } from '@splashcodex/api-key-manager/env';
 * loadCentralEnv({ envDir: '/shared/team/env' });
 * ```
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LoadCentralEnvOptions {
    /**
     * Path to the centralized env directory.
     * Defaults to ~/codedex/env/
     *
     * Can also be set via CODEDEX_ENV_DIR environment variable.
     */
    envDir?: string;

    /**
     * Specific .env files to load (e.g., ['llm.env', 'common.env']).
     * If omitted, loads ALL .env files in the directory.
     */
    files?: string[];

    /**
     * If true, central env values will NOT overwrite existing process.env values.
     * Useful when a project needs to override a shared value locally.
     * Default: false (central values take precedence over local .env)
     */
    preserveExisting?: boolean;

    /**
     * If true, silently continue when the env directory doesn't exist.
     * If false, throw an error.
     * Default: true (silent — for portability across dev environments)
     */
    silent?: boolean;
}

export interface LoadResult {
    /** Whether the env directory was found and loaded */
    loaded: boolean;
    /** Path to the env directory that was used */
    envDir: string;
    /** List of .env files that were loaded */
    filesLoaded: string[];
    /** Number of environment variables set */
    varsSet: number;
    /** Variables that were skipped because they already existed (when preserveExisting=true) */
    varsSkipped: string[];
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a .env file into key-value pairs.
 * Supports:
 *   KEY=value
 *   KEY="quoted value"
 *   KEY='single quoted'
 *   # comments
 *   empty lines
 *   export KEY=value (bash-style)
 */
function parseEnvFile(content: string): Map<string, string> {
    const vars = new Map<string, string>();

    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();

        // Skip empty lines and comments
        if (!line || line.startsWith('#')) continue;

        // Strip optional 'export ' prefix
        const stripped = line.startsWith('export ') ? line.slice(7) : line;

        // Find the first '=' that separates key from value
        const eqIndex = stripped.indexOf('=');
        if (eqIndex === -1) continue;

        const key = stripped.slice(0, eqIndex).trim();
        let value = stripped.slice(eqIndex + 1).trim();

        // Strip surrounding quotes
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        // Skip empty keys
        if (!key) continue;

        vars.set(key, value);
    }

    return vars;
}

// ─── Loader ──────────────────────────────────────────────────────────────────

/**
 * Default env directory path: ~/codedex/env/
 */
export function getDefaultEnvDir(): string {
    return process.env.CODEDEX_ENV_DIR || join(homedir(), 'codedex', 'env');
}

/**
 * Load environment variables from the centralized env directory into process.env.
 *
 * Call this once at the top of your app's entry point, before any code
 * that reads process.env.
 */
export function loadCentralEnv(options: LoadCentralEnvOptions = {}): LoadResult {
    const envDir = options.envDir || getDefaultEnvDir();
    const silent = options.silent !== false;
    const preserveExisting = options.preserveExisting === true;

    const result: LoadResult = {
        loaded: false,
        envDir,
        filesLoaded: [],
        varsSet: 0,
        varsSkipped: [],
    };

    // Check if directory exists
    if (!existsSync(envDir)) {
        if (!silent) {
            throw new Error(
                `Centralized env directory not found: ${envDir}\n` +
                `Create it with: mkdir -p ${envDir}\n` +
                `Or set CODEDEX_ENV_DIR to point to your env directory.`
            );
        }
        return result;
    }

    // Determine which files to load
    let filesToLoad: string[];
    if (options.files) {
        filesToLoad = options.files;
    } else {
        try {
            filesToLoad = readdirSync(envDir)
                .filter(f => f.endsWith('.env'))
                .sort(); // Alphabetical order for deterministic loading
        } catch {
            if (!silent) throw new Error(`Cannot read env directory: ${envDir}`);
            return result;
        }
    }

    // Load each file
    for (const fileName of filesToLoad) {
        const filePath = join(envDir, fileName);

        if (!existsSync(filePath)) {
            if (!silent) {
                throw new Error(`Env file not found: ${filePath}`);
            }
            continue;
        }

        try {
            const content = readFileSync(filePath, 'utf-8');
            const vars = parseEnvFile(content);

            for (const [key, value] of vars) {
                if (preserveExisting && process.env[key] !== undefined) {
                    result.varsSkipped.push(key);
                    continue;
                }
                process.env[key] = value;
                result.varsSet++;
            }

            result.filesLoaded.push(fileName);
        } catch (err) {
            if (!silent) throw err;
        }
    }

    result.loaded = result.filesLoaded.length > 0;
    return result;
}

/**
 * Read a single value from the centralized env without loading everything.
 * Useful for one-off lookups.
 */
export function getCentralEnvVar(key: string, options?: { envDir?: string }): string | undefined {
    const envDir = options?.envDir || getDefaultEnvDir();

    if (!existsSync(envDir)) return undefined;

    try {
        const files = readdirSync(envDir).filter(f => f.endsWith('.env')).sort();

        for (const fileName of files) {
            const content = readFileSync(join(envDir, fileName), 'utf-8');
            const vars = parseEnvFile(content);
            if (vars.has(key)) return vars.get(key);
        }
    } catch {
        // Silent fail
    }

    return undefined;
}
