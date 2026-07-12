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

import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync, CipherGCM, DecipherGCM } from 'crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

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
export class FileStorage {
    private filePath: string;
    private encryptionKey: Buffer | null = null;
    private algorithm: 'aes-256-gcm' | 'aes-256-cbc' = 'aes-256-gcm';

    constructor(options: FileStorageOptions = {}) {
        this.filePath = options.filePath || join(tmpdir(), 'codedex_api_key_state.json');

        // Resolve encryption key if configured
        if (options.encryption) {
            this.encryptionKey = this.resolveKey(options.encryption);
            this.algorithm = options.encryption.algorithm || 'aes-256-gcm';
        }

        if (options.clearOnInit !== false) {
            this.clear();
        }
    }

    getItem(_key: string): string | null {
        try {
            if (existsSync(this.filePath)) {
                const raw = readFileSync(this.filePath, 'utf-8');
                return this.decrypt(raw);
            }
        } catch {
            // Silently fail — state will be rebuilt from scratch
        }
        return null;
    }

    setItem(_key: string, value: string): void {
        const tmpPath = this.filePath + '.tmp';
        try {
            const dir = dirname(this.filePath);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            // Write to a temp file first, then atomically rename to the target.
            // renameSync() is a single syscall — the file is never in a
            // half-written state if the process crashes mid-write.
            const data = this.encrypt(value);
            writeFileSync(tmpPath, data, 'utf-8');
            renameSync(tmpPath, this.filePath);
        } catch {
            // Clean up temp file if rename failed
            try {
                if (existsSync(tmpPath)) unlinkSync(tmpPath);
            } catch {
                /* silent */
            }
            // Silently fail — state will be lost on restart
        }
    }

    /**
     * Delete the persisted state file.
     * Useful for clearing stale dead-key states from a previous session.
     */

    // ─── Encryption ────────────────────────────────────────────────────────

    private resolveKey(opts: EncryptionOptions): Buffer {
        if (opts.key) return Buffer.from(opts.key.padEnd(64, '0').slice(0, 64), 'hex');
        if (opts.keyDerivation) {
            const { password, salt, iterations, keyLength, digest } = opts.keyDerivation;
            return pbkdf2Sync(password, salt, iterations || 100_000, keyLength || 32, digest || 'sha256');
        }
        throw new Error('[FileStorage] encryption requires `key` or `keyDerivation`');
    }

    private encrypt(plaintext: string): string {
        if (!this.encryptionKey) return plaintext;
        const iv = randomBytes(12);
        const cipher = createCipheriv(this.algorithm, this.encryptionKey, iv);
        const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
        const tag = this.algorithm === 'aes-256-gcm' ? (cipher as CipherGCM).getAuthTag() : Buffer.alloc(0);
        return 'CODEDEX_ENC_V1:' + Buffer.concat([iv, tag, encrypted]).toString('base64');
    }

    private decrypt(data: string): string | null {
        if (!data.startsWith('CODEDEX_ENC_V1:')) return data;
        if (!this.encryptionKey) {
            console.error('[FileStorage] State file encrypted but no key configured.');
            return null;
        }
        try {
            const payload = Buffer.from(data.slice(15), 'base64'); // skip 'CODEDEX_ENC_V1:' prefix
            const iv = payload.subarray(0, 12);
            const tag = this.algorithm === 'aes-256-gcm' ? payload.subarray(12, 28) : undefined;
            const ct = tag ? payload.subarray(28) : payload.subarray(12);
            const decipher = createDecipheriv(this.algorithm, this.encryptionKey, iv);
            if (tag) (decipher as DecipherGCM).setAuthTag(tag);
            return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
        } catch (err) {
            console.error('[FileStorage] Decryption failed:', (err as Error).message);
            return null;
        }
    }

    isEncrypted(): boolean {
        return this.encryptionKey !== null;
    }

    clear(): void {
        try {
            if (existsSync(this.filePath)) {
                unlinkSync(this.filePath);
            }
        } catch {
            // Silently fail
        }
    }

    /** Get the path to the state file (for debugging/logging) */
    getFilePath(): string {
        return this.filePath;
    }
}
