/**
 * File-Based Storage Adapter
 *
 * Persists API key state to a JSON file on disk.
 * Survives process restarts so keys don't reset to CLOSED
 * when an app reboots.
 *
 * Extracted from the proven WhatsDeX adapter pattern.
 *
 * @module persistence/file
 */
export interface EncryptionOptions {
    /** 32-byte hex key (64 chars). Recommended: CODEDEX_ENCRYPTION_KEY env var. */
    key?: string;
    /** Derive a key from a password using PBKDF2. */
    keyDerivation?: {
        password: string;
        salt: string;
        iterations?: number;
        keyLength?: number;
        digest?: string;
    };
    /** Cipher algorithm. Default: 'aes-256-gcm' */
    algorithm?: 'aes-256-gcm' | 'aes-256-cbc';
}
export interface FileStorageOptions {
    /** Full path to the state file. Defaults to `os.tmpdir()/codedex_api_key_state.json` */
    filePath?: string;
    /** If true, clears any existing state file on construction (fresh start). Default: true */
    clearOnInit?: boolean;
    /** Optional AES-256-GCM encryption for zero-trust deployments. */
    encryption?: EncryptionOptions;
}
/**
 * File-based storage adapter for ApiKeyManager.
 *
 * @example
 * ```ts
 * import { ApiKeyManager } from '@splashcodex/api-key-manager';
 * import { FileStorage } from '@splashcodex/api-key-manager/persistence/file';
 *
 * const manager = new ApiKeyManager(keys, {
 *   storage: new FileStorage({ filePath: './state.json' })
 * });
 * ```
 */
export declare class FileStorage {
    private filePath;
    private encryptionKey;
    private algorithm;
    constructor(options?: FileStorageOptions);
    getItem(_key: string): string | null;
    setItem(_key: string, value: string): void;
    /**
     * Delete the persisted state file.
     * Useful for clearing stale dead-key states from a previous session.
     */
    private resolveKey;
    private encrypt;
    private decrypt;
    isEncrypted(): boolean;
    clear(): void;
    /** Get the path to the state file (for debugging/logging) */
    getFilePath(): string;
}
//# sourceMappingURL=file.d.ts.map