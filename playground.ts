import { ApiKeyManager } from './dist/index';

async function run() {
    console.log("🚀 Initializing ApiKeyManager...");
    
    // Test that the validation logic allows valid options
    const manager = new ApiKeyManager(['test-key-1', 'test-key-2'], {
        concurrency: 2,
        concurrencyQueueSize: 5
    });
    
    console.log("✅ Initialized successfully.");
    console.log("📊 Stats:", manager.getStats());

    // Make some parallel requests to verify the bulkhead / queueing works
    console.log("\n⚡ Triggering 3 parallel requests (Concurrency is 2, so 1 should queue)...");
    
    const start = Date.now();
    const tasks = [1, 2, 3].map(async (id) => {
        return manager.execute(async (key) => {
            console.log(`[Request ${id}] Running with key: ${key}`);
            // Simulate work for 200ms
            await new Promise(resolve => setTimeout(resolve, 200));
            return `Result ${id}`;
        });
    });

    const results = await Promise.all(tasks);
    console.log("🏁 All requests completed in", Date.now() - start, "ms");
    console.log("📝 Results:", results);
    console.log("📊 Final Stats:", manager.getStats());
}

run().catch(console.error);
