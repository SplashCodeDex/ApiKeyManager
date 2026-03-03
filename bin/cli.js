#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const command = args[0];

function printDocs() {
    console.log(`\x1b[92m🌟 @splashcodex/api-key-manager v5.0\x1b[0m`);
    console.log(`\x1b[96m📚 Documentation: https://www.npmjs.com/package/@splashcodex/ApiKeyManager\x1b[0m\n`);
    console.log(`\x1b[93m🚀 Commands:\x1b[0m`);
    console.log(`   npx @splashcodex/api-key-manager init   \x1b[90m# Scaffold a demo project in the current directory\x1b[0m`);
    console.log(`\n\x1b[95m💡 Tip: Need help? Run init to see it in action!\x1b[0m\n`);
}

function initProject() {
    const cwd = process.cwd();
    const envPath = path.join(cwd, '.env');
    const demoPath = path.join(cwd, 'demo.ts');

    console.log(`\n\x1b[96m🚀 Initializing @splashcodex/api-key-manager environment...\x1b[0m\n`);

    // Create .env
    if (!fs.existsSync(envPath)) {
        fs.writeFileSync(envPath, `GOOGLE_GEMINI_API_KEY="your_api_key_1,your_api_key_2"\nOPENAI_API_KEY="sk-..."\n`);
        console.log(`\x1b[92m[✔] Created .env file\x1b[0m`);
    } else {
        console.log(`\x1b[90m[-] .env already exists. Remember to add GOOGLE_GEMINI_API_KEY!\x1b[0m`);
    }

    // Create demo.ts
    if (!fs.existsSync(demoPath)) {
        const tsCode = `import 'dotenv/config';\nimport { GeminiManager } from '@splashcodex/api-key-manager/presets/gemini';\n\nasync function main() {\n    console.log("Initialize GeminiManager...");\n    // Automatically parse GOOGLE_GEMINI_API_KEY from env\n    const result = GeminiManager.getInstance();\n    if (!result.success) {\n        console.error("Failed to initialize:", result.error);\n        return;\n    }\n    \n    const gemini = result.data;\n    \n    console.log("Executing resilient request...");\n    // Automatically handles key rotation and 429 quota limits\n    try {\n        const response = await gemini.execute(async (key) => {\n            console.log(\`[Network] Sending request with key: \${key.substring(0, 8)}...\`);\n            // Replace with actual fetch: await fetch(..., { headers: { 'x-goog-api-key': key } })\n            return "Success: Simulated API Response!";\n        });\n        console.log("Result:", response);\n    } catch (e) {\n        console.error("All keys exhausted or network failed.", e.message);\n    }\n}\n\nmain();\n`;
        fs.writeFileSync(demoPath, tsCode);
        console.log(`\x1b[92m[✔] Created demo.ts\x1b[0m`);
    } else {
        console.log(`\x1b[90m[-] demo.ts already exists.\x1b[0m`);
    }

    console.log(`\n\x1b[93m🎉 Setup Complete!\x1b[0m`);
    console.log(`To run the demo:`);
    console.log(`\x1b[36m   npm install dotenv\x1b[0m`);
    console.log(`\x1b[36m   npx ts-node demo.ts\x1b[0m\n`);
}

if (command === 'init') {
    initProject();
} else {
    printDocs();
}
