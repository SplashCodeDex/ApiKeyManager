import { loadCentralEnv, getCentralEnvVar, getDefaultEnvDir } from '../src/env';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_ENV_DIR = join(tmpdir(), 'codedex_env_test_' + process.pid);

beforeEach(() => {
    // Create a fresh test env directory
    if (existsSync(TEST_ENV_DIR)) rmSync(TEST_ENV_DIR, { recursive: true });
    mkdirSync(TEST_ENV_DIR, { recursive: true });
});

afterEach(() => {
    // Clean up
    if (existsSync(TEST_ENV_DIR)) rmSync(TEST_ENV_DIR, { recursive: true });

    // Remove any test vars we set
    delete process.env.TEST_CENTRAL_A;
    delete process.env.TEST_CENTRAL_B;
    delete process.env.TEST_CENTRAL_QUOTED;
    delete process.env.TEST_CENTRAL_EXPORT;
    delete process.env.TEST_CENTRAL_SINGLE;
    delete process.env.TEST_PRESERVE_ME;
    delete process.env.CODEDEX_ENV_DIR;
});

describe('loadCentralEnv', () => {
    test('loads all .env files from directory', () => {
        writeFileSync(join(TEST_ENV_DIR, 'common.env'), 'TEST_CENTRAL_A=hello\nTEST_CENTRAL_B=world\n');

        const result = loadCentralEnv({ envDir: TEST_ENV_DIR });

        expect(result.loaded).toBe(true);
        expect(result.filesLoaded).toEqual(['common.env']);
        expect(result.varsSet).toBe(2);
        expect(process.env.TEST_CENTRAL_A).toBe('hello');
        expect(process.env.TEST_CENTRAL_B).toBe('world');
    });

    test('handles quoted values', () => {
        writeFileSync(join(TEST_ENV_DIR, 'test.env'),
            'TEST_CENTRAL_QUOTED="hello world"\nTEST_CENTRAL_SINGLE=\'single quoted\'\n');

        loadCentralEnv({ envDir: TEST_ENV_DIR });

        expect(process.env.TEST_CENTRAL_QUOTED).toBe('hello world');
        expect(process.env.TEST_CENTRAL_SINGLE).toBe('single quoted');
    });

    test('handles export prefix', () => {
        writeFileSync(join(TEST_ENV_DIR, 'bash.env'), 'export TEST_CENTRAL_EXPORT=exported_val\n');

        loadCentralEnv({ envDir: TEST_ENV_DIR });

        expect(process.env.TEST_CENTRAL_EXPORT).toBe('exported_val');
    });

    test('skips comments and empty lines', () => {
        writeFileSync(join(TEST_ENV_DIR, 'comments.env'),
            '# This is a comment\n\nTEST_CENTRAL_A=value\n\n# Another comment\n');

        const result = loadCentralEnv({ envDir: TEST_ENV_DIR });

        expect(result.varsSet).toBe(1);
        expect(process.env.TEST_CENTRAL_A).toBe('value');
    });

    test('loads specific files only', () => {
        writeFileSync(join(TEST_ENV_DIR, 'llm.env'), 'TEST_CENTRAL_A=llm_val\n');
        writeFileSync(join(TEST_ENV_DIR, 'stripe.env'), 'TEST_CENTRAL_B=stripe_val\n');

        const result = loadCentralEnv({ envDir: TEST_ENV_DIR, files: ['llm.env'] });

        expect(result.filesLoaded).toEqual(['llm.env']);
        expect(process.env.TEST_CENTRAL_A).toBe('llm_val');
        expect(process.env.TEST_CENTRAL_B).toBeUndefined();
    });

    test('preserveExisting skips already-set vars', () => {
        process.env.TEST_PRESERVE_ME = 'original';
        writeFileSync(join(TEST_ENV_DIR, 'test.env'), 'TEST_PRESERVE_ME=overwritten\nTEST_CENTRAL_A=new\n');

        const result = loadCentralEnv({ envDir: TEST_ENV_DIR, preserveExisting: true });

        expect(process.env.TEST_PRESERVE_ME).toBe('original');
        expect(process.env.TEST_CENTRAL_A).toBe('new');
        expect(result.varsSkipped).toContain('TEST_PRESERVE_ME');
    });

    test('returns silently when directory missing (default)', () => {
        const result = loadCentralEnv({ envDir: '/nonexistent/path' });

        expect(result.loaded).toBe(false);
        expect(result.filesLoaded).toEqual([]);
    });

    test('throws when directory missing and silent=false', () => {
        expect(() => {
            loadCentralEnv({ envDir: '/nonexistent/path', silent: false });
        }).toThrow('Centralized env directory not found');
    });

    test('respects CODEDEX_ENV_DIR environment variable', () => {
        process.env.CODEDEX_ENV_DIR = TEST_ENV_DIR;
        writeFileSync(join(TEST_ENV_DIR, 'test.env'), 'TEST_CENTRAL_A=from_env_var\n');

        const result = loadCentralEnv();

        expect(result.envDir).toBe(TEST_ENV_DIR);
        expect(process.env.TEST_CENTRAL_A).toBe('from_env_var');
    });

    test('loads files in alphabetical order', () => {
        writeFileSync(join(TEST_ENV_DIR, 'z_last.env'), 'TEST_CENTRAL_A=last\n');
        writeFileSync(join(TEST_ENV_DIR, 'a_first.env'), 'TEST_CENTRAL_A=first\n');

        const result = loadCentralEnv({ envDir: TEST_ENV_DIR });

        // a_first.env loads first, z_last.env overwrites it
        expect(result.filesLoaded).toEqual(['a_first.env', 'z_last.env']);
        expect(process.env.TEST_CENTRAL_A).toBe('last');
    });
});

describe('getCentralEnvVar', () => {
    test('reads a single var without loading all', () => {
        writeFileSync(join(TEST_ENV_DIR, 'llm.env'), 'MY_KEY=secret123\nOTHER=val\n');

        const value = getCentralEnvVar('MY_KEY', { envDir: TEST_ENV_DIR });

        expect(value).toBe('secret123');
        // Should NOT have loaded OTHER into process.env
        expect(process.env.OTHER).toBeUndefined();
    });

    test('returns undefined for missing key', () => {
        writeFileSync(join(TEST_ENV_DIR, 'test.env'), 'EXISTING=yes\n');

        const value = getCentralEnvVar('NONEXISTENT', { envDir: TEST_ENV_DIR });

        expect(value).toBeUndefined();
    });
});

describe('getDefaultEnvDir', () => {
    test('returns ~/codedex/env/ by default', () => {
        delete process.env.CODEDEX_ENV_DIR;
        const dir = getDefaultEnvDir();
        expect(dir).toContain('codedex');
        expect(dir).toContain('env');
    });
});
