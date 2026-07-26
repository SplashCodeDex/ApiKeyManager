import { ApiKeyManager } from './src/index';
import { RedisStorage, RedisClient } from './src/persistence/redis';

// 1. Mock a Redis Client using an in-memory Map
class MockRedisClient implements RedisClient {
    private store = new Map<string, string>();

    async get(key: string): Promise<string | null> {
        console.log(`[MockRedis] GET ${key}`);
        return this.store.get(key) || null;
    }

    async set(key: string, value: string): Promise<any> {
        console.log(`[MockRedis] SET ${key} (length: ${value.length})`);
        this.store.set(key, value);
    }
}

async function runTest() {
    console.log('--- STARTING REDIS TEST ---\n');
    const mockRedis = new MockRedisClient();

    // --- INSTANCE A (The First Cold Start) ---
    console.log('1. Starting Gateway Instance A...');
    const managerA = new ApiKeyManager(['key_1', 'key_2'], {
        storage: new RedisStorage({ client: mockRedis })
    });
    await managerA.init();

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
    await new Promise(resolve => setTimeout(resolve, 600));

    // --- INSTANCE B (A New Cold Start) ---
    console.log('\n2. Starting Gateway Instance B (Simulating new serverless container)...');
    
    // Notice how instance B is completely new, but shares the same mockRedis
    const managerB = new ApiKeyManager(['key_1', 'key_2'], {
        storage: new RedisStorage({ client: mockRedis })
    });
    
    // It shouldn't know key_1 is dead yet
    console.log('Before init, Instance B Stats:', managerB.getStats());
    
    // Now we initialize (fetch from Redis)
    await managerB.init();
    
    console.log('After init, Instance B Stats:', managerB.getStats());
    
    // Verify
    const statsB = managerB.getStats();
    if (statsB.dead === 1) {
        console.log('\n✅ SUCCESS: Instance B correctly learned that key_1 was DEAD from Redis!');
    } else {
        console.log('\n❌ FAILED: Instance B did not load state from Redis.');
    }
}

runTest().catch(console.error);
