"use strict";
/**
 * Redis-Based Storage Adapter
 *
 * Persists API key state to a Redis database.
 * Ideal for Serverless environments (Vercel, Cloudflare Workers) where local memory
 * or files are ephemeral, allowing cross-instance quota tracking.
 *
 * @module persistence/redis
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisStorage = void 0;
/**
 * Redis-based storage adapter for ApiKeyManager.
 * Note: Because Redis is asynchronous, you MUST call `await manager.init()` after instantiation.
 *
 * @example
 * ```ts
 * import { ApiKeyManager } from '@splashcodex/api-key-manager';
 * import { RedisStorage } from '@splashcodex/api-key-manager/persistence/redis';
 * import { Redis } from '@upstash/redis';
 *
 * const redisClient = new Redis({ url: '...', token: '...' });
 *
 * const manager = new ApiKeyManager(keys, {
 *   storage: new RedisStorage({ client: redisClient })
 * });
 *
 * await manager.init(); // Required for async storage!
 * ```
 */
var RedisStorage = /** @class */ (function () {
    function RedisStorage(options) {
        this.isAsync = true;
        if (!options.client) {
            throw new Error('[RedisStorage] A Redis client must be provided.');
        }
        this.client = options.client;
        this.keyPrefix = options.keyPrefix || 'apikey_manager:';
    }
    RedisStorage.prototype.resolveKey = function (key) {
        return this.keyPrefix + key;
    };
    RedisStorage.prototype.getItem = function (key) {
        return __awaiter(this, void 0, void 0, function () {
            var error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.client.get(this.resolveKey(key))];
                    case 1: return [2 /*return*/, _a.sent()];
                    case 2:
                        error_1 = _a.sent();
                        console.error('[RedisStorage] Failed to getItem:', error_1);
                        return [2 /*return*/, null]; // Fallback to blank state if Redis is unreachable
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    RedisStorage.prototype.setItem = function (key, value) {
        return __awaiter(this, void 0, void 0, function () {
            var error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.client.set(this.resolveKey(key), value)];
                    case 1:
                        _a.sent();
                        return [3 /*break*/, 3];
                    case 2:
                        error_2 = _a.sent();
                        console.error('[RedisStorage] Failed to setItem:', error_2);
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    return RedisStorage;
}());
exports.RedisStorage = RedisStorage;
