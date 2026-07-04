#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const command = args[0];

const ENV_DIR = path.join(os.homedir(), 'codedex', 'env');

function printDocs() {
    console.log(`\x1b[92m@splashcodex/api-key-manager v5.1\x1b[0m`);
    console.log(`\x1b[96mDocs: https://www.npmjs.com/package/@splashcodex/ApiKeyManager\x1b[0m\n`);
    console.log(`\x1b[93mCommands:\x1b[0m`);
    console.log(`   npx @splashcodex/api-key-manager init    \x1b[90m# Scaffold demo + central env directory\x1b[0m`);
    console.log(`   npx @splashcodex/api-key-manager setup   \x1b[90m# Create ~/codedex/env/ with template files\x1b[0m`);
    console.log(`   npx @splashcodex/api-key-manager status  \x1b[90m# Show which env files are loaded\x1b[0m`);
    console.log('');
}

function setupEnvDir() {
    console.log(`\n\x1b[96mSetting up centralized env directory...\x1b[0m\n`);

    if (!fs.existsSync(ENV_DIR)) {
        fs.mkdirSync(ENV_DIR, { recursive: true });
        console.log(`\x1b[92m[+] Created ${ENV_DIR}\x1b[0m`);
    } else {
        console.log(`\x1b[90m[-] ${ENV_DIR} already exists\x1b[0m`);
    }

    const templates = {
        'common.env': [
            '# Common environment variables shared across all projects',
            '# DATABASE_URL="postgresql://user:pass@localhost:5432/mydb"',
            '# REDIS_URL="redis://localhost:6379"',
            '# SUPABASE_URL="https://your-project.supabase.co"',
            '# SUPABASE_ANON_KEY="your-anon-key"',
            '',
        ].join('\n'),
        'llm.env': [
            '# LLM API keys — supports comma-separated or JSON arrays',
            '# GOOGLE_GEMINI_API_KEY="key1,key2,key3"',
            '# OPENAI_API_KEY="sk-..."',
            '# ANTHROPIC_API_KEY="sk-ant-..."',
            '',
        ].join('\n'),
        'stripe.env': [
            '# Stripe payment keys',
            '# STRIPE_SECRET_KEY="sk_test_..."',
            '# STRIPE_WEBHOOK_SECRET="whsec_..."',
            '',
        ].join('\n'),
    };

    for (const [name, content] of Object.entries(templates)) {
        const filePath = path.join(ENV_DIR, name);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, content);
            console.log(`\x1b[92m[+] Created ${name}\x1b[0m`);
        } else {
            console.log(`\x1b[90m[-] ${name} already exists\x1b[0m`);
        }
    }

    console.log(`\n\x1b[93mNext steps:\x1b[0m`);
    console.log(`  1. Add your real keys to the files in ${ENV_DIR}`);
    console.log(`  2. Back up the folder to Google Drive for portability`);
    console.log(`  3. In your projects, add at the entry point:`);
    console.log(`\x1b[36m     import { loadCentralEnv } from '@splashcodex/api-key-manager/env';\x1b[0m`);
    console.log(`\x1b[36m     loadCentralEnv();\x1b[0m\n`);
}

function showStatus() {
    console.log(`\n\x1b[96mCentralized env status\x1b[0m\n`);
    console.log(`  Directory: ${ENV_DIR}`);

    if (!fs.existsSync(ENV_DIR)) {
        console.log(`  \x1b[31mNot found.\x1b[0m Run: npx @splashcodex/api-key-manager setup\n`);
        return;
    }

    const files = fs.readdirSync(ENV_DIR).filter(f => f.endsWith('.env')).sort();
    if (files.length === 0) {
        console.log(`  \x1b[33mNo .env files found.\x1b[0m\n`);
        return;
    }

    let totalVars = 0;
    for (const file of files) {
        const content = fs.readFileSync(path.join(ENV_DIR, file), 'utf-8');
        const vars = content.split('\n')
            .filter(l => l.trim() && !l.trim().startsWith('#'))
            .filter(l => l.includes('='));
        totalVars += vars.length;

        const icon = vars.length > 0 ? '\x1b[92m' : '\x1b[90m';
        console.log(`  ${icon}${file}\x1b[0m — ${vars.length} variable(s)`);
        for (const v of vars) {
            const key = v.split('=')[0].trim();
            console.log(`    \x1b[90m${key}\x1b[0m`);
        }
    }

    console.log(`\n  Total: ${files.length} file(s), ${totalVars} variable(s)\n`);
}

function initProject() {
    const cwd = process.cwd();
    const demoPath = path.join(cwd, 'demo.ts');

    console.log(`\n\x1b[96mInitializing @splashcodex/api-key-manager...\x1b[0m\n`);

    // Ensure central env directory exists
    setupEnvDir();

    // Create demo.ts
    if (!fs.existsSync(demoPath)) {
        const tsCode = `/**
 * Demo: @splashcodex/api-key-manager v5.1
 *
 * Shows the two-layer pattern:
 *   Layer 1: loadCentralEnv() loads keys from ~/codedex/env/
 *   Layer 2: GeminiManager handles rotation, retries, circuit breaking
 */
import { loadCentralEnv } from '@splashcodex/api-key-manager/env';
import { GeminiManager } from '@splashcodex/api-key-manager/presets/gemini';

// Layer 1: Load centralized environment
const envResult = loadCentralEnv();
console.log(\`Loaded \${envResult.varsSet} env vars from \${envResult.filesLoaded.length} files\`);

async function main() {
    // Layer 2: Initialize key manager (reads from process.env)
    const result = GeminiManager.getInstance();
    if (!result.success) {
        console.error("Failed:", result.error.message);
        console.error("Add your Gemini key to ~/codedex/env/llm.env");
        return;
    }

    const gemini = result.data;
    console.log(\`GeminiManager ready: \${gemini.getKeyCount()} key(s)\`);

    try {
        const response = await gemini.execute(async (key) => {
            console.log(\`Using key: \${key.substring(0, 8)}...\`);
            // Replace with actual API call
            return "Simulated API Response";
        }, { maxRetries: 3, timeoutMs: 30000 });
        console.log("Result:", response);
    } catch (e: any) {
        console.error("Failed:", e.message);
    }
}

main();
`;
        fs.writeFileSync(demoPath, tsCode);
        console.log(`\x1b[92m[+] Created demo.ts\x1b[0m`);
    } else {
        console.log(`\x1b[90m[-] demo.ts already exists\x1b[0m`);
    }

    console.log(`\n\x1b[93mTo run the demo:\x1b[0m`);
    console.log(`\x1b[36m   npx ts-node demo.ts\x1b[0m\n`);
}

switch (command) {
    case 'init':
        initProject();
        break;
    case 'setup':
        setupEnvDir();
        break;
    case 'status':
        showStatus();
        break;
    default:
        printDocs();
}
