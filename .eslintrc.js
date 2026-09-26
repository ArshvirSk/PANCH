module.exports = {
  env: {
    node: true,
    es2021: true,
  },
  // Build output (Next.js and CDK bundles) is generated code, not source.
  ignorePatterns: ['node_modules/', '**/.next/', 'web/out/', '**/cdk.out/', 'dist/', 'coverage/'],
  extends: [
    'eslint:recommended',
  ],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
  },
  rules: {
    'no-unused-vars': 'warn',
    'no-undef': 'off'
  }
};
