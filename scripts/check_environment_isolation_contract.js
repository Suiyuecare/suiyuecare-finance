#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  applyBuildEnvironment,
  resolveBuildConfig
} = require('./finance_build_environment');

const ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const failures = [];
let passed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    process.stdout.write(`PASS ${label}\n`);
  } else {
    failures.push(`${label}${detail ? `: ${detail}` : ''}`);
    process.stderr.write(`FAIL ${label}${detail ? `: ${detail}` : ''}\n`);
  }
}

function mustThrow(label, runner, pattern) {
  try {
    runner();
    check(label, false, 'expected fail-closed error');
  } catch (error) {
    check(label, pattern.test(String(error && error.message)), String(error && error.message));
  }
}

const source = fs.readFileSync(INDEX_PATH, 'utf8');
check('source index has build target placeholder', source.includes("'__FINANCE_BUILD_TARGET__'"));
check('source index has Supabase URL placeholder', source.includes("'__FINANCE_SUPABASE_URL__'"));
check('source index has Supabase public-key placeholder', source.includes("'__FINANCE_SUPABASE_ANON_KEY__'"));
check('source index has no literal Supabase project URL', !/https:\/\/[a-z0-9-]+\.supabase\.co/i.test(source));
check('source index has no literal Supabase browser key', !/var\s+SUPABASE_(?:ANON|PUBLISHABLE)_KEY\s*=\s*['"](?:eyJ|sb_)/i.test(source));
check('Supabase client requires production build and official host', source.includes('isFinanceProductionBuild()&&isProductionRuntime()'));
check('non-production builds explicitly enable demo-only login', source.includes("return FINANCE_BUILD_TARGET!=='production'"));
check('OAuth host handoff refuses non-production builds', source.includes('if(!isFinanceProductionBuild())return false;'));

const previewConfig = resolveBuildConfig({
  FINANCE_BUILD_TARGET: 'preview',
  FINANCE_SUPABASE_URL: 'https://should-be-ignored.supabase.co',
  FINANCE_SUPABASE_ANON_KEY: 'sb_publishable_should_be_ignored'
});
const preview = applyBuildEnvironment(source, previewConfig);
check('preview build is offline demo', previewConfig.runtimeMode === 'offline-demo');
check('preview build injects empty Supabase URL', /var\s+SUPABASE_URL="";/.test(preview));
check('preview build injects empty Supabase key', /var\s+SUPABASE_ANON_KEY="";/.test(preview));
check('preview build contains no Supabase project host', !/https:\/\/[a-z0-9-]+\.supabase\.co/i.test(preview));
check('preview build keeps local demo controls', preview.includes('DEMO_LOGIN_START') && preview.includes('quickLogin'));

const localConfig = resolveBuildConfig({});
const local = applyBuildEnvironment(source, localConfig);
check('unset local or CI target defaults safely to local', localConfig.target === 'local');
check('local build is offline demo', localConfig.runtimeMode === 'offline-demo');
check('local build contains no Supabase project host', !/https:\/\/[a-z0-9-]+\.supabase\.co/i.test(local));

mustThrow(
  'production build fails when public configuration is absent',
  () => resolveBuildConfig({ FINANCE_BUILD_TARGET: 'production' }),
  /requires FINANCE_SUPABASE_URL/
);
mustThrow(
  'Vercel production build fails when public configuration is absent',
  () => resolveBuildConfig({ VERCEL_ENV: 'production' }),
  /requires FINANCE_SUPABASE_URL/
);
mustThrow(
  'unknown build target fails closed',
  () => resolveBuildConfig({ FINANCE_BUILD_TARGET: 'staging' }),
  /unknown FINANCE_BUILD_TARGET/
);
mustThrow(
  'preview Vercel build cannot be overridden to production',
  () => resolveBuildConfig({
    VERCEL_ENV: 'preview',
    FINANCE_BUILD_TARGET: 'production',
    FINANCE_SUPABASE_URL: 'https://finance-contract.supabase.co',
    FINANCE_SUPABASE_ANON_KEY: 'sb_publishable_contract_test_only'
  }),
  /conflicts with VERCEL_ENV/
);
mustThrow(
  'browser build rejects Supabase secret keys',
  () => resolveBuildConfig({
    FINANCE_BUILD_TARGET: 'production',
    FINANCE_SUPABASE_URL: 'https://finance-contract.supabase.co',
    FINANCE_SUPABASE_ANON_KEY: 'sb_secret_contract_test_only'
  }),
  /secret or service-role/
);

const productionConfig = resolveBuildConfig({
  FINANCE_BUILD_TARGET: 'production',
  FINANCE_SUPABASE_URL: 'https://finance-contract.supabase.co',
  FINANCE_SUPABASE_ANON_KEY: 'sb_publishable_contract_test_only'
});
const production = applyBuildEnvironment(source, productionConfig);
check('production build injects explicit public URL', production.includes('var SUPABASE_URL="https://finance-contract.supabase.co";'));
check('production build injects only a publishable key', production.includes('var SUPABASE_ANON_KEY="sb_publishable_contract_test_only";'));
check('production build removes demo login controls', !production.includes('DEMO_LOGIN_START') && !production.includes('<div id="demo-login-panel"'));

process.stdout.write(`\nEnvironment isolation contract: ${passed} checks passed, ${failures.length} failed.\n`);
if (failures.length) process.exit(1);
