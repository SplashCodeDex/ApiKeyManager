#!/usr/bin/env npx tsx
/**
 * @splashcodex/api-key-manager v5.0 — Mass Migration Script (V2)
 *
 * Safely migrates CodeDex repositories from local ApiKeyManager copies
 * to the centralized @splashcodex/api-key-manager v5 presets.
 *
 * Flags:
 *   --dry-run          Preview changes without writing anything
 *   --target=RepoName  Only process a single repository
 *   --skip-install     Skip running npm/pnpm/yarn install
 *   --no-backup        Don't create .bak files before deleting
 *
 * Usage:
 *   npx tsx scripts/migrate.ts --dry-run
 *   npx tsx scripts/migrate.ts --target=DeXdo-Plan_Your_Life --dry-run
 *   npx tsx scripts/migrate.ts --target=DeXdo-Plan_Your_Life
 *   npx tsx scripts/migrate.ts
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// ── Configuration ──────────────────────────────────────────────────────────

const BASE_DIR = 'W:\\CodeDeX';
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_INSTALL = process.argv.includes('--skip-install');
const NO_BACKUP = process.argv.includes('--no-backup');
const TARGET_ARG = process.argv.find(a => a.startsWith('--target='));
const TARGET_REPO = TARGET_ARG ? TARGET_ARG.split('=')[1] : null;

/**
 * Repos with PROPER adapters that should NOT be touched.
 * WhatsDeX already correctly imports @splashcodex/api-key-manager.
 * Its `backend/src/lib/apiKeyManager.ts` is a working adapter, not a stale copy.
 */
const SKIP_REPOS = new Set([
    'WhatsDeX',
    'TACTMS',                   // User will handle manually
    'codedex-api-manager',      // The library itself
]);

/**
 * Known duplicate filenames to target for deletion.
 * These are the identical 364-line v2.0 stale copies.
 */
const STALE_FILE_PATTERNS = [
    /^ApiKeyManager\.(ts|js)$/,  // src/services/ApiKeyManager.ts
];

/**
 * Files that are test files for the stale copy and should also be cleaned up.
 */
const STALE_TEST_PATTERNS = [
    /^ApiKeyManager\.test\.(ts|js)$/,
];

// ── Types ──────────────────────────────────────────────────────────────────

interface MigrationReport {
    repo: string;
    filesUpdated: string[];
    filesDeleted: string[];
    filesBackedUp: string[];
    installResult: 'success' | 'failed' | 'skipped' | 'no-package-json';
    errors: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function findFiles(
    dir: string,
    pattern: RegExp,
    excludeDirs = ['node_modules', 'dist', 'build', '.git', '.next', 'coverage', '__pycache__'],
    maxDepth = 8,
    currentDepth = 0
): string[] {
    if (currentDepth >= maxDepth) return [];
    let results: string[] = [];
    try {
        const list = fs.readdirSync(dir);
        for (const file of list) {
            const filePath = path.join(dir, file);
            let stat: fs.Stats;
            try { stat = fs.statSync(filePath); } catch { continue; }
            if (stat.isDirectory()) {
                if (!excludeDirs.includes(file)) {
                    results = results.concat(findFiles(filePath, pattern, excludeDirs, maxDepth, currentDepth + 1));
                }
            } else if (pattern.test(file)) {
                results.push(filePath);
            }
        }
    } catch { /* permission denied, etc */ }
    return results;
}

function determinePackageManager(repoPath: string): 'npm' | 'yarn' | 'pnpm' | 'bun' {
    if (fs.existsSync(path.join(repoPath, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(repoPath, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(repoPath, 'bun.lockb'))) return 'bun';
    return 'npm';
}

/**
 * Checks if a file is a stale v2.0 ApiKeyManager copy by looking for signature patterns.
 * This prevents accidentally deleting files that just happen to match the name.
 */
function isStaleApiKeyManagerCopy(filePath: string): boolean {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        // Signature markers of the stale v2.0 copy
        const markers = [
            'Universal ApiKeyManager v2.0',   // Header comment
            'export class ApiKeyManager',     // Class declaration
            'classifyError',                  // Key method
            'markFailed',                     // Key method
            'getKey',                         // Core rotation method
        ];
        const matchCount = markers.filter(m => content.includes(m)).length;
        return matchCount >= 3; // Must match at least 3 out of 5 markers
    } catch {
        return false;
    }
}

/**
 * Determines whether a source file actually imports from the local ApiKeyManager.
 * Returns the import style ('esm' | 'cjs' | null).
 */
function detectImportStyle(content: string): 'esm' | 'cjs' | null {
    // ES Module: import { ApiKeyManager } from '../services/ApiKeyManager'
    if (/import\s+\{[^}]*ApiKeyManager[^}]*\}\s+from\s+['"][^'"]*ApiKeyManager['"]/i.test(content)) {
        return 'esm';
    }
    // CommonJS: const { ApiKeyManager } = require('./ApiKeyManager')
    if (/(?:const|let|var)\s+\{[^}]*ApiKeyManager[^}]*\}\s*=\s*require\s*\(['"][^'"]*ApiKeyManager['"]\)/i.test(content)) {
        return 'cjs';
    }
    return null;
}

// ── Core Migration Logic ───────────────────────────────────────────────────

function processRepo(repoPath: string, staleFiles: string[]): MigrationReport {
    const repoName = path.basename(repoPath);
    const report: MigrationReport = {
        repo: repoName,
        filesUpdated: [],
        filesDeleted: [],
        filesBackedUp: [],
        installResult: 'skipped',
        errors: [],
    };

    console.log(`\n📦 Processing: ${repoName}`);

    // ── Step 1: Find source files that import from the stale ApiKeyManager ──

    const sourceFiles = findFiles(repoPath, /\.(ts|tsx|js|jsx)$/);

    for (const filePath of sourceFiles) {
        // Skip the stale file itself and test files for it
        const baseName = path.basename(filePath);
        if (STALE_FILE_PATTERNS.some(p => p.test(baseName))) continue;
        if (STALE_TEST_PATTERNS.some(p => p.test(baseName))) continue;

        let content: string;
        try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }

        const importStyle = detectImportStyle(content);
        if (!importStyle) continue; // This file doesn't import ApiKeyManager

        const originalContent = content;

        // ── Replace import statement only (not comments or JSDoc) ──
        if (importStyle === 'esm') {
            content = content.replace(
                /import\s+\{[^}]*ApiKeyManager[^}]*\}\s+from\s+['"][^'"]*ApiKeyManager['"];?/gi,
                "import { GeminiManager } from '@splashcodex/api-key-manager/presets/gemini';"
            );
        } else if (importStyle === 'cjs') {
            content = content.replace(
                /(?:const|let|var)\s+\{[^}]*ApiKeyManager[^}]*\}\s*=\s*require\s*\(['"][^'"]*ApiKeyManager['"]\);?/gi,
                "const { GeminiManager } = require('@splashcodex/api-key-manager/presets/gemini');"
            );
        }

        // ── Replace usage patterns (only in code, not in comments) ──
        // Process line-by-line to skip comment lines
        const lines = content.split('\n');
        const updatedLines = lines.map(line => {
            const trimmed = line.trimStart();

            // Skip comment lines entirely
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
                return line;
            }

            // Replace getInstance() calls
            let updated = line.replace(
                /ApiKeyManager\.getInstance\(\)/g,
                'GeminiManager.getInstance().data!'
            );
            updated = updated.replace(
                /ApiKeyManager\.getInstance\([^)]+\)/g,
                'GeminiManager.getInstance().data!'
            );

            // Replace type annotations: `: ApiKeyManager` -> `: GeminiManager`
            updated = updated.replace(
                /:\s*ApiKeyManager\b/g,
                ': GeminiManager'
            );

            // Replace `new ApiKeyManager` -> `GeminiManager.getInstance().data!`
            updated = updated.replace(
                /new\s+ApiKeyManager\([^)]*\)/g,
                'GeminiManager.getInstance().data!'
            );

            // Replace standalone variable references in non-comment code
            // Only when it's clearly a class/type reference, not a string
            updated = updated.replace(
                /\bApiKeyManager\b(?!\s*['"`])/g,
                'GeminiManager'
            );

            return updated;
        });
        content = updatedLines.join('\n');

        if (content !== originalContent) {
            const relPath = path.relative(repoPath, filePath);
            console.log(`    📝 Updating: ${relPath}`);
            report.filesUpdated.push(relPath);
            if (!DRY_RUN) {
                fs.writeFileSync(filePath, content, 'utf-8');
            }
        }
    }

    // ── Step 2: Delete stale files (with backup) ──

    for (const staleFile of staleFiles) {
        if (!isStaleApiKeyManagerCopy(staleFile)) {
            const relPath = path.relative(repoPath, staleFile);
            console.log(`    ⚠️  SKIPPED (not a stale copy): ${relPath}`);
            report.errors.push(`Skipped ${relPath} — doesn't match stale v2.0 signature`);
            continue;
        }

        const relPath = path.relative(repoPath, staleFile);

        // Backup
        if (!NO_BACKUP && !DRY_RUN) {
            const bakPath = staleFile + '.bak';
            fs.copyFileSync(staleFile, bakPath);
            report.filesBackedUp.push(relPath + '.bak');
            console.log(`    💾 Backed up: ${relPath} → ${relPath}.bak`);
        }

        // Delete
        console.log(`    🗑️  Deleting: ${relPath}`);
        report.filesDeleted.push(relPath);
        if (!DRY_RUN) {
            fs.unlinkSync(staleFile);
        }
    }

    // ── Step 3: Also clean up test files for the stale copy ──

    const testFiles = findFiles(repoPath, /ApiKeyManager\.test\.(ts|js)$/);
    for (const testFile of testFiles) {
        const relPath = path.relative(repoPath, testFile);

        if (!NO_BACKUP && !DRY_RUN) {
            const bakPath = testFile + '.bak';
            fs.copyFileSync(testFile, bakPath);
            report.filesBackedUp.push(relPath + '.bak');
        }

        console.log(`    🗑️  Deleting stale test: ${relPath}`);
        report.filesDeleted.push(relPath);
        if (!DRY_RUN) {
            fs.unlinkSync(testFile);
        }
    }

    // ── Step 4: Install the library (if there were modifications) ──

    if (report.filesUpdated.length > 0 || report.filesDeleted.length > 0) {
        const pkgPath = path.join(repoPath, 'package.json');
        if (!fs.existsSync(pkgPath)) {
            console.log(`    ⚠️  No package.json — skipping install`);
            report.installResult = 'no-package-json';
        } else if (SKIP_INSTALL || DRY_RUN) {
            console.log(`    ⏭️  Install skipped (${DRY_RUN ? 'dry-run' : '--skip-install'})`);
            report.installResult = 'skipped';
        } else {
            const pm = determinePackageManager(repoPath);
            const installCmd = {
                npm: 'npm install @splashcodex/api-key-manager@latest --save',
                yarn: 'yarn add @splashcodex/api-key-manager@latest',
                pnpm: 'pnpm add @splashcodex/api-key-manager@latest',
                bun: 'bun add @splashcodex/api-key-manager@latest',
            }[pm];

            console.log(`    📦 Running: ${installCmd}`);
            try {
                execSync(installCmd, { cwd: repoPath, stdio: 'pipe', timeout: 120_000 });
                report.installResult = 'success';
                console.log(`    ✅ Installed successfully`);
            } catch (e: any) {
                report.installResult = 'failed';
                const msg = e.stderr?.toString()?.slice(0, 200) || e.message;
                report.errors.push(`Install failed: ${msg}`);
                console.log(`    ❌ Install failed (continuing): ${msg.slice(0, 100)}`);
            }
        }
    }

    return report;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  @splashcodex/api-key-manager v5 Migration V2   ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log(`Mode:   ${DRY_RUN ? '🔍 DRY RUN' : '🔴 LIVE EXECUTION'}`);
    console.log(`Target: ${TARGET_REPO || 'ALL repositories'}`);
    console.log(`Install: ${SKIP_INSTALL ? 'Skipped' : 'Enabled'}`);
    console.log(`Backup: ${NO_BACKUP ? 'Disabled' : 'Enabled'}`);
    console.log('');

    const reports: MigrationReport[] = [];

    // Enumerate repos
    let repos: string[];
    try {
        repos = fs.readdirSync(BASE_DIR).filter(f => {
            try { return fs.statSync(path.join(BASE_DIR, f)).isDirectory(); } catch { return false; }
        });
    } catch (e) {
        console.error(`Fatal: Cannot read ${BASE_DIR}`);
        process.exit(1);
    }

    // Filter by target
    if (TARGET_REPO) {
        repos = repos.filter(r => r === TARGET_REPO);
        if (repos.length === 0) {
            console.error(`Error: Repository "${TARGET_REPO}" not found in ${BASE_DIR}`);
            process.exit(1);
        }
    }

    for (const repo of repos) {
        // Skip list
        if (SKIP_REPOS.has(repo) || repo === 'node_modules' || repo.startsWith('.') || repo === 'New folder') {
            continue;
        }

        const repoPath = path.join(BASE_DIR, repo);

        // Find stale ApiKeyManager copies
        const staleFiles = findFiles(repoPath, /^ApiKeyManager\.(ts|js)$/i)
            .filter(f => !f.includes('node_modules') && !f.includes('dist') && !f.includes('.test.'));

        if (staleFiles.length > 0) {
            const report = processRepo(repoPath, staleFiles);
            reports.push(report);
        }
    }

    // ── Summary Report ──

    console.log('\n\n═══════════════════════════════════════════');
    console.log('               MIGRATION REPORT');
    console.log('═══════════════════════════════════════════\n');

    let totalUpdated = 0;
    let totalDeleted = 0;
    let totalErrors = 0;

    for (const r of reports) {
        const status = r.errors.length > 0 ? '⚠️' : '✅';
        console.log(`${status} ${r.repo}`);
        console.log(`   Files updated: ${r.filesUpdated.length}  |  Files deleted: ${r.filesDeleted.length}  |  Install: ${r.installResult}`);
        if (r.errors.length > 0) {
            r.errors.forEach(e => console.log(`   ❗ ${e}`));
        }
        totalUpdated += r.filesUpdated.length;
        totalDeleted += r.filesDeleted.length;
        totalErrors += r.errors.length;
    }

    console.log('\n───────────────────────────────────────────');
    console.log(`Repos processed: ${reports.length}`);
    console.log(`Files updated:   ${totalUpdated}`);
    console.log(`Files deleted:   ${totalDeleted}`);
    console.log(`Errors:          ${totalErrors}`);
    console.log(`Skipped repos:   ${[...SKIP_REPOS].join(', ')}`);

    if (DRY_RUN) {
        console.log('\n🔍 This was a DRY RUN. No files were modified.');
        console.log('   Run without --dry-run to apply changes.');
    }

    // Write report to file
    const reportPath = path.join(__dirname, '..', `migration_report_${DRY_RUN ? 'dryrun' : 'live'}_${Date.now()}.json`);
    if (!DRY_RUN) {
        fs.writeFileSync(reportPath, JSON.stringify(reports, null, 2));
        console.log(`\n📄 Full report saved to: ${reportPath}`);
    }
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
