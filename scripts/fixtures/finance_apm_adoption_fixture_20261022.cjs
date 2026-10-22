'use strict';
// Isolated catalog reconstruction for adoption verification. The five recovered
// migration statements are stored as ledger evidence only; none is executed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const catalog = require('./finance_apm_adoption_catalog_20261022.json');
const root = path.resolve(__dirname, '../..');
const ident = value => '"' + value.replaceAll('"', '""') + '"';
const qualified = name => 'finance_apm_private.' + ident(name);
const signature = fn => ident(fn.schema) + '.' + ident(fn.name) + '(' + fn.argument_types + ')';

async function setupAdoptedApm(db) {
  // The caller installs the existing invoice fixture first, including the
  // actual voucher/ledger/HR composite types referenced by these signatures.
  await db.exec('create schema finance_apm_private authorization postgres; revoke all on schema finance_apm_private from public,anon,authenticated,service_role; grant usage on schema finance_apm_private to authenticated,service_role;');
  for (const table of catalog.tables) {
    const columns = table.columns.map(column => ident(column.name) + ' ' + column.type
      + (column.default ? ' default ' + column.default : '')
      + (column.not_null ? ' not null' : ''));
    await db.exec('create table ' + qualified(table.name) + '(' + columns.join(',') + ')');
  }
  // Foreign keys are added only after all six synthetic tables exist.
  for (const foreign of [false, true]) {
    for (const table of catalog.tables) {
      for (const constraint of table.constraints) {
        if (constraint.definition.startsWith('FOREIGN KEY') !== foreign) continue;
        await db.exec('alter table ' + qualified(table.name) + ' add constraint '
          + ident(constraint.name) + ' ' + constraint.definition);
      }
    }
  }
  for (const table of catalog.tables) {
    for (const definition of table.indexes) {
      // PRIMARY/UNIQUE constraints already created their indexes above.
      const name = definition.match(/^CREATE (?:UNIQUE )?INDEX (\S+) ON /)[1].replaceAll('"', '');
      const existing = (await db.query('select to_regclass($1) as oid', ['finance_apm_private.' + name])).rows[0].oid;
      if (!existing) await db.exec(definition);
    }
    await db.exec('alter table ' + qualified(table.name) + ' owner to postgres; alter table '
      + qualified(table.name) + ' enable row level security; alter table ' + qualified(table.name)
      + ' force row level security; revoke all on table ' + qualified(table.name)
      + ' from public,anon,authenticated,service_role;');
  }
  for (const fn of catalog.functions) {
    await db.exec(fn.definition);
    await db.exec('alter function ' + signature(fn) + ' owner to postgres; revoke all on function '
      + signature(fn) + ' from public,anon,authenticated,service_role;');
    for (const role of ['authenticated', 'service_role']) {
      if (fn[role + '_execute']) await db.exec('grant execute on function ' + signature(fn) + ' to ' + role);
    }
    const actual = (await db.query('select md5(prosrc) as hash from pg_proc where oid=$1::regprocedure', [signature(fn)])).rows[0];
    assert.equal(actual.hash, fn.source_md5, 'Final APM body must match live source: ' + signature(fn));
  }
  for (const trigger of catalog.triggers) await db.exec(trigger.definition);
  return { functions: catalog.functions.length, tables: catalog.tables.length, triggers: catalog.triggers.length, migrationReplay: false };
}

async function seedLedger(db) {
  await db.exec('alter table supabase_migrations.schema_migrations add column if not exists statements text[];');
  for (const migration of catalog.ledger) {
    const source = fs.readFileSync(path.join(root, 'supabase/migrations', migration.file), 'utf8');
    for (const [algorithm, field] of [['md5', 'statement_md5'], ['sha256', 'statement_sha256']]) {
      assert.equal(crypto.createHash(algorithm).update(source).digest('hex'), migration[field], 'Exact source bytes: ' + migration.file);
    }
    await db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3::text[]) '
      + 'on conflict(version) do update set name=excluded.name,statements=excluded.statements',
    [migration.version, migration.name, [source]]);
  }
}

module.exports = { setupAdoptedApm, seedLedger, catalog };
