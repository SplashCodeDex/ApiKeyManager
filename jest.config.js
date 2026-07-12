module.exports = {
    // Use ts-jest in default CJS mode (matches tsconfig "module": "commonjs")
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.ts'],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/index.ts',
    ],
    coverageThreshold: {
        global: {
            branches: 60,
            functions: 70,
            lines: 70,
            statements: 70,
        },
    },
    transform: {
        // Transform TypeScript source files
        '^.+\\.tsx?$': 'ts-jest',
        // Transform ESM JS files from cockatiel and eventsource-parser
        '^.+\\.m?js$': ['ts-jest', { useESM: false }],
    },
    // cockatiel and eventsource-parser are pure-ESM packages — whitelist them.
    // The regex must match on both Windows (\\ separators) and POSIX (/ separators).
    transformIgnorePatterns: [
        '[/\\\\]node_modules[/\\\\](?!(cockatiel|eventsource-parser)[/\\\\])',
    ],
};
