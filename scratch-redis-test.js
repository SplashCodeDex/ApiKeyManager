"use strict";
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
var index_1 = require("./src/index");
var redis_1 = require("./src/persistence/redis");
// 1. Mock a Redis Client using an in-memory Map
var MockRedisClient = /** @class */ (function () {
    function MockRedisClient() {
        this.store = new Map();
    }
    MockRedisClient.prototype.get = function (key) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                console.log("[MockRedis] GET ".concat(key));
                return [2 /*return*/, this.store.get(key) || null];
            });
        });
    };
    MockRedisClient.prototype.set = function (key, value) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                console.log("[MockRedis] SET ".concat(key, " (length: ").concat(value.length, ")"));
                this.store.set(key, value);
                return [2 /*return*/];
            });
        });
    };
    return MockRedisClient;
}());
function runTest() {
    return __awaiter(this, void 0, void 0, function () {
        var mockRedis, managerA, managerB, statsB;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('--- STARTING REDIS TEST ---\n');
                    mockRedis = new MockRedisClient();
                    // --- INSTANCE A (The First Cold Start) ---
                    console.log('1. Starting Gateway Instance A...');
                    managerA = new index_1.ApiKeyManager(['key_1', 'key_2'], {
                        storage: new redis_1.RedisStorage({ client: mockRedis })
                    });
                    return [4 /*yield*/, managerA.init()];
                case 1:
                    _a.sent();
                    console.log('Instance A state loaded. Faking a Quota Error on key_1...');
                    managerA.markFailed('key_1', {
                        type: 'QUOTA',
                        retryable: false,
                        cooldownMs: 60000,
                        markKeyFailed: true,
                        markKeyDead: true // Permanently dead for testing
                    });
                    console.log('Instance A Stats:', managerA.getStats());
                    // Wait a brief moment to allow the debounced _flushState to fire
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 600); })];
                case 2:
                    // Wait a brief moment to allow the debounced _flushState to fire
                    _a.sent();
                    // --- INSTANCE B (A New Cold Start) ---
                    console.log('\n2. Starting Gateway Instance B (Simulating new serverless container)...');
                    managerB = new index_1.ApiKeyManager(['key_1', 'key_2'], {
                        storage: new redis_1.RedisStorage({ client: mockRedis })
                    });
                    // It shouldn't know key_1 is dead yet
                    console.log('Before init, Instance B Stats:', managerB.getStats());
                    // Now we initialize (fetch from Redis)
                    return [4 /*yield*/, managerB.init()];
                case 3:
                    // Now we initialize (fetch from Redis)
                    _a.sent();
                    console.log('After init, Instance B Stats:', managerB.getStats());
                    statsB = managerB.getStats();
                    if (statsB.dead === 1) {
                        console.log('\n✅ SUCCESS: Instance B correctly learned that key_1 was DEAD from Redis!');
                    }
                    else {
                        console.log('\n❌ FAILED: Instance B did not load state from Redis.');
                    }
                    return [2 /*return*/];
            }
        });
    });
}
runTest().catch(console.error);
