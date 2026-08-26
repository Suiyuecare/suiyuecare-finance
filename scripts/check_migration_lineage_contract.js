#!/usr/bin/env node
'use strict';

/**
 * Finance adopted-database migration lineage contract.
 *
 * This repository currently contains forward migrations for an existing
 * Finance production lineage. It does not contain a clean-slate baseline or
 * seed. This check makes that limitation explicit and prevents CI from
 * presenting an empty local reset as evidence of deployability.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations');
const FIRST_ADOPTED_MIGRATION = '20260820052216_repair_account_and_new_taipei_runtime.sql';
const CURRENT_RELEASE_MIGRATION = '20260826155840_expense_route_authority_v2.sql';

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    process.stdout.write(`PASS ${label}\n`);
  } else {
    failed += 1;
    process.stderr.write(`FAIL ${label}${detail ? `: ${detail}` : ''}\n`);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const config = read('supabase/config.toml');
const workflow = read('.github/workflows/stability-gate.yml');
const releaseGuide = read('docs/RELEASE_GATES.md');
const migrations = fs.readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

check('migration lineage is present', migrations.length > 0);
check('migration versions are canonical and strictly ordered',
  migrations.every((name, index) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)
    && (index === 0 || name.slice(0, 14) > migrations[index - 1].slice(0, 14))));
check('every migration in the adopted lineage is non-empty',
  migrations.every((name) => fs.statSync(path.join(MIGRATIONS_DIR, name)).size > 0),
  migrations.filter((name) => fs.statSync(path.join(MIGRATIONS_DIR, name)).size === 0).join(', '));

const first = migrations[0] || '';
const firstSql = first ? read(`supabase/migrations/${first}`) : '';
check('lineage begins with the declared production adoption migration', first === FIRST_ADOPTED_MIGRATION, first);
check('first migration proves it requires existing production master data',
  /Account\/org repair preflight expected 9 active users/.test(firstSql)
    && /from public\.finance_users/.test(firstSql)
    && !/create\s+table[\s\S]*?finance_users/i.test(firstSql));

check('Supabase config declares no clean-slate schema baseline',
  /\[db\.migrations\][\s\S]*?schema_paths\s*=\s*\[\s*\]/.test(config));
check('configured seed is absent and therefore cannot simulate production data',
  /\[db\.seed\][\s\S]*?sql_paths\s*=\s*\[\s*["']\.\/seed\.sql["']\s*\]/.test(config)
    && !fs.existsSync(path.join(ROOT, 'supabase/seed.sql')));
check('CI does not run a misleading empty-database reset',
  !/(?:supabase\s+(?:start|stop)|supabase\s+db\s+reset)/i.test(workflow));

const releaseIndex = migrations.indexOf(CURRENT_RELEASE_MIGRATION);
const releaseSql = releaseIndex >= 0 ? read(`supabase/migrations/${CURRENT_RELEASE_MIGRATION}`) : '';
check('current release migration is the final ordered migration',
  releaseIndex === migrations.length - 1, migrations[migrations.length - 1] || '(none)');
check('current release migration leaves transaction and ledger atomicity to the pinned CLI',
  !/^\s*(?:begin|commit|rollback)(?:\s+(?:work|transaction))?\s*;\s*$/im.test(releaseSql)
    && !/^\s*(?:(?:create(?:\s+unique)?\s+index|drop\s+index)\s+concurrently\b|reindex\b[^;]*\bconcurrently\b|vacuum\b|alter\s+system\b|cluster\b)/im.test(releaseSql)
    && /set local lock_timeout/.test(releaseSql)
    && /set local statement_timeout/.test(releaseSql));
check('current release migration contains fail-closed preflight and postflight',
  /do \$preflight\$/.test(releaseSql)
    && /do \$postflight\$/.test(releaseSql)
    && /notify pgrst, 'reload schema'/.test(releaseSql));

check('release guide requires controlled remote rehearsal before promotion',
  releaseGuide.includes('transaction-control')
    && releaseGuide.includes('pipeline-incompatible')
    && releaseGuide.includes('remote schema gate')
    && releaseGuide.includes('不能宣稱 clean-slate replay'));
check('release guide records the future baseline engineering requirement',
  releaseGuide.includes('squash baseline'));

process.stdout.write(`\nAdopted migration lineage: ${passed}/${passed + failed} passed.\n`);
if (failed) process.exit(1);
