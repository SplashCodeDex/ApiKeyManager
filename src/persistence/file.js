"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileStorage = void 0;
var fs_1 = require("fs");
var path_1 = require("path");
var os_1 = require("os");
var crypto_1 = require("crypto");
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
var FileStorage = /** @class */ (function () {
    function FileStorage(options) {
        if (options === void 0) { options = {}; }
        this.encryptionKey = null;
        this.algorithm = 'aes-256-gcm';
        this.filePath = options.filePath || (0, path_1.join)((0, os_1.tmpdir)(), 'codedex_api_key_state.json');
        // Resolve encryption key if configured
        if (options.encryption) {
            this.encryptionKey = this.resolveKey(options.encryption);
            this.algorithm = options.encryption.algorithm || 'aes-256-gcm';
        }
        if (options.clearOnInit !== false) {
            this.clear();
        }
    }
    FileStorage.prototype.getItem = function (_key) {
        try {
            if ((0, fs_1.existsSync)(this.filePath)) {
                var raw = (0, fs_1.readFileSync)(this.filePath, 'utf-8');
                return this.decrypt(raw);
            }
        }
        catch (_a) {
            // Silently fail — state will be rebuilt from scratch
        }
        return null;
    };
    FileStorage.prototype.setItem = function (_key, value) {
        var tmpPath = this.filePath + '.tmp';
        try {
            var dir = (0, path_1.dirname)(this.filePath);
            if (!(0, fs_1.existsSync)(dir)) {
                (0, fs_1.mkdirSync)(dir, { recursive: true });
            }
            // Write to a temp file first, then atomically rename to the target.
            // renameSync() is a single syscall — the file is never in a
            // half-written state if the process crashes mid-write.
            var data = this.encrypt(value);
            (0, fs_1.writeFileSync)(tmpPath, data, 'utf-8');
            (0, fs_1.renameSync)(tmpPath, this.filePath);
        }
        catch (_a) {
            // Clean up temp file if rename failed
            try {
                if ((0, fs_1.existsSync)(tmpPath))
                    (0, fs_1.unlinkSync)(tmpPath);
            }
            catch (_b) {
                /* silent */
            }
            // Silently fail — state will be lost on restart
        }
    };
    /**
     * Delete the persisted state file.
     * Useful for clearing stale dead-key states from a previous session.
     */
    // ─── Encryption ────────────────────────────────────────────────────────
    FileStorage.prototype.resolveKey = function (opts) {
        if (opts.key)
            return Buffer.from(opts.key.padEnd(64, '0').slice(0, 64), 'hex');
        if (opts.keyDerivation) {
            var _a = opts.keyDerivation, password = _a.password, salt = _a.salt, iterations = _a.iterations, keyLength = _a.keyLength, digest = _a.digest;
            return (0, crypto_1.pbkdf2Sync)(password, salt, iterations || 100000, keyLength || 32, digest || 'sha256');
        }
        throw new Error('[FileStorage] encryption requires `key` or `keyDerivation`');
    };
    FileStorage.prototype.encrypt = function (plaintext) {
        if (!this.encryptionKey)
            return plaintext;
        var iv = (0, crypto_1.randomBytes)(12);
        var cipher = (0, crypto_1.createCipheriv)(this.algorithm, this.encryptionKey, iv);
        var encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
        var tag = this.algorithm === 'aes-256-gcm' ? cipher.getAuthTag() : Buffer.alloc(0);
        return 'CODEDEX_ENC_V1:' + Buffer.concat([iv, tag, encrypted]).toString('base64');
    };
    FileStorage.prototype.decrypt = function (data) {
        if (!data.startsWith('CODEDEX_ENC_V1:'))
            return data;
        if (!this.encryptionKey) {
            console.error('[FileStorage] State file encrypted but no key configured.');
            return null;
        }
        try {
            var payload = Buffer.from(data.slice(15), 'base64'); // skip 'CODEDEX_ENC_V1:' prefix
            var iv = payload.subarray(0, 12);
            var tag = this.algorithm === 'aes-256-gcm' ? payload.subarray(12, 28) : undefined;
            var ct = tag ? payload.subarray(28) : payload.subarray(12);
            var decipher = (0, crypto_1.createDecipheriv)(this.algorithm, this.encryptionKey, iv);
            if (tag)
                decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
        }
        catch (err) {
            console.error('[FileStorage] Decryption failed:', err.message);
            return null;
        }
    };
    FileStorage.prototype.isEncrypted = function () {
        return this.encryptionKey !== null;
    };
    FileStorage.prototype.clear = function () {
        try {
            if ((0, fs_1.existsSync)(this.filePath)) {
                (0, fs_1.unlinkSync)(this.filePath);
            }
        }
        catch (_a) {
            // Silently fail
        }
    };
    /** Get the path to the state file (for debugging/logging) */
    FileStorage.prototype.getFilePath = function () {
        return this.filePath;
    };
    return FileStorage;
}());
exports.FileStorage = FileStorage;
