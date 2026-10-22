'use strict';
// Actual Postgres catalog assertions in isolated PGlite; no network or live data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const invoice = require('./fixtures/finance_invoice_approval_fixture_20261021.cjs');
const fixture = require('./fixtures/finance_apm_adoption_fixture_20261022.cjs');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(__dirname, 'finance_apm_adoption_postflight.sql'), 'utf8');
const guard = source.replace(/^\\set ON_ERROR_STOP on\r?\n/, '');
const signature = fn => fn.schema + '.' + fn.name + '(' + fn.argument_types + ')';
const db = new PGlite({ extensions: { pgcrypto } });
const checks = [];
const expected = JSON.parse(source.match(/\$apm_catalog\$([\s\S]*?)\$apm_catalog\$::jsonb/)[1]);
const command = 'finance_apm_private.command(text,jsonb)';
const privateTable = 'finance_apm_private.metric_mappings';

async function rejectsDrift(label, mutation) {
  await db.exec('begin;');
  try {
    if (typeof mutation === 'function') await mutation(); else await db.exec(mutation);
    await assert.rejects(() => db.exec(guard), error => error.code === '55000' && /APM adoption/.test(error.message), label);
    checks.push(label);
  } finally { await db.exec('rollback;'); }
}

async function snapshot() {
  const { rows } = await db.query(`select jsonb_build_object(
    'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,md5(pg_get_functiondef(p.oid)),pg_get_userbyid(p.proowner),p.proacl::text) order by n.nspname,p.proname)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='finance_apm_private' or (n.nspname='public' and p.proname ~ '^finance_apm_')),
    'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text) order by c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='finance_apm_private' and c.relkind='r'),
    'ledger',(select jsonb_agg(jsonb_build_array(version,name,md5(statements::text)) order by version) from supabase_migrations.schema_migrations)
  ) as state`);
  return JSON.stringify(rows[0].state);
}

async function main() {
  try {
    assert.deepEqual(expected.ledger, fixture.catalog.ledger);
    assert.equal(expected.functions.length, 26);
    assert.equal(expected.tables.length, 6);
    assert.equal(expected.triggers.length, 8);
    assert.equal(fixture.catalog.functions.filter(fn => fn.authenticated_execute).length, 6);
    assert.equal(fixture.catalog.functions.filter(fn => fn.service_role_execute).length, 4);
    for (const fn of fixture.catalog.functions) {
      assert.equal(crypto.createHash('md5').update(fn.definition).digest('hex'), fn.definition_md5);
      assert.deepEqual(expected.functions.find(item => signature(item) === signature(fn)),
        Object.fromEntries(Object.entries(fn).filter(([key]) => key !== 'definition')));
    }
    for (const table of fixture.catalog.tables) {
      const pinned = expected.tables.find(item => item.name === table.name);
      for (const field of ['columns', 'constraints', 'indexes']) assert.deepEqual(pinned[field], table[field]);
    }
    checks.push('exact final catalog, function defaults and source fingerprints are pinned');
    await invoice.setup(db);
    assert.deepEqual(await fixture.setupAdoptedApm(db), { functions: 26, tables: 6, triggers: 8, migrationReplay: false });
    await fixture.seedLedger(db);
    const before = await snapshot();
    const result = await db.exec('begin read only;' + guard + 'rollback;');
    assert.equal(result.find(item => item.rows[0]?.result)?.rows[0].result, 'FINANCE_APM_ADOPTION_POSTFLIGHT_OK');
    assert.equal(await snapshot(), before);
    checks.push('valid installed catalog passes in READ ONLY without changing objects or ledger');

    const first = fixture.catalog.ledger[0].version;
    await rejectsDrift('missing reviewed ledger version rejects', `delete from supabase_migrations.schema_migrations where version='${first}'`);
    await rejectsDrift('wrong ledger name rejects', `update supabase_migrations.schema_migrations set name='unreviewed_name' where version='${first}'`);
    await rejectsDrift('extra statement rejects', `update supabase_migrations.schema_migrations set statements=statements||array['select 1;'] where version='${first}'`);
    await rejectsDrift('modified exact statement bytes reject', `update supabase_migrations.schema_migrations set statements[1]=statements[1]||E'\n' where version='${first}'`);
    await rejectsDrift('null statements reject', `update supabase_migrations.schema_migrations set statements=null where version='${first}'`);
    await rejectsDrift('unknown APM ledger version rejects', "insert into supabase_migrations.schema_migrations(version,name,statements) values('20990101000000','apm_unreviewed',array['select 1;'])");
    for (const fn of fixture.catalog.functions) {
      await rejectsDrift('changed final function body rejects: ' + signature(fn), fn.definition.replace('AS $function$', 'AS $function$\n-- isolated drift probe'));
    }
    await rejectsDrift('missing function rejects', 'drop function finance_apm_private.command_before_fresh_authorization(text,jsonb)');
    await rejectsDrift('unknown private function rejects', "create function finance_apm_private.unreviewed() returns text language sql as $$select 'x'::text$$");
    await rejectsDrift('unknown public wrapper rejects', "create function public.finance_apm_unreviewed() returns text language sql as $$select 'x'::text$$");
    await rejectsDrift('function owner drift rejects', 'alter function ' + command + ' owner to service_role');
    await rejectsDrift('function SECURITY INVOKER drift rejects', 'alter function ' + command + ' security invoker');
    await rejectsDrift('function SECURITY DEFINER drift rejects', 'alter function public.finance_apm_workbench(text) security definer');
    await rejectsDrift('function volatility drift rejects', 'alter function ' + command + ' stable');
    await rejectsDrift('function search_path drift rejects', 'alter function ' + command + ' set search_path to public');
    for (const role of ['public', 'anon', 'service_role']) {
      await rejectsDrift('unauthorized EXECUTE rejects: ' + role, 'grant execute on function ' + command + ' to ' + role);
    }
    await rejectsDrift('missing authorized EXECUTE rejects', 'revoke execute on function ' + command + ' from authenticated');
    await rejectsDrift('function EXECUTE grant option rejects', 'grant execute on function ' + command + ' to authenticated with grant option');
    const workbench = fixture.catalog.functions.find(fn => signature(fn) === 'public.finance_apm_workbench(text)');
    assert.match(workbench.definition, /DEFAULT/);
    await rejectsDrift('same body with changed API default rejects', workbench.definition.replace(/DEFAULT [^)]*/, "DEFAULT 'changed'::text"));
    await rejectsDrift('schema PUBLIC access rejects', 'grant usage on schema finance_apm_private to public');
    await rejectsDrift('schema CREATE authority rejects', 'grant create on schema finance_apm_private to authenticated');
    await rejectsDrift('schema owner drift rejects', 'alter schema finance_apm_private owner to service_role');
    for (const table of fixture.catalog.tables) {
      await rejectsDrift('RLS disabled rejects: ' + table.name, 'alter table finance_apm_private.' + table.name + ' disable row level security');
      await rejectsDrift('FORCE RLS disabled rejects: ' + table.name, 'alter table finance_apm_private.' + table.name + ' no force row level security');
    }
    await rejectsDrift('table owner drift rejects', 'alter table ' + privateTable + ' owner to service_role');
    await rejectsDrift('table direct access rejects', 'grant select on ' + privateTable + ' to authenticated');
    await rejectsDrift('column direct access rejects', 'grant select(id) on ' + privateTable + ' to authenticated');
    await rejectsDrift('new RLS policy rejects', 'create policy unreviewed on ' + privateTable + ' for select to authenticated using(true)');
    await rejectsDrift('unknown private table rejects', 'create table finance_apm_private.unreviewed(id integer)');
    await rejectsDrift('unknown private view rejects', 'create view finance_apm_private.unreviewed as select 1 as id');
    await rejectsDrift('missing duplicate reversal safeguard rejects', 'drop index finance_apm_private.apm_reversal_voucher_once');
    await rejectsDrift('missing receipt proposal foreign key rejects', 'alter table finance_apm_private.correction_receipts drop constraint correction_receipts_proposal_id_fkey');
    await rejectsDrift('missing quarter snapshot uniqueness rejects', 'alter table finance_apm_private.metric_snapshots drop constraint metric_snapshots_mapping_id_year_quarter_key');
    await rejectsDrift('nonunique replacement reversal index rejects', 'drop index finance_apm_private.apm_reversal_voucher_once; create index apm_reversal_voucher_once on finance_apm_private.correction_proposals(reversal_voucher_id)');
    await rejectsDrift('unvalidated foreign key rejects', 'alter table finance_apm_private.correction_receipts drop constraint correction_receipts_proposal_id_fkey; alter table finance_apm_private.correction_receipts add constraint correction_receipts_proposal_id_fkey foreign key(proposal_id) references finance_apm_private.correction_proposals(id) not valid');
    await rejectsDrift('new unreviewed column rejects', 'alter table ' + privateTable + ' add column unreviewed text');
    await rejectsDrift('missing column rejects', 'alter table ' + privateTable + ' drop column reference');
    await rejectsDrift('changed column type rejects', 'alter table ' + privateTable + ' alter column reference type varchar(500)');
    await rejectsDrift('changed default rejects', 'alter table ' + privateTable + ' alter column created_at set default now()');
    await rejectsDrift('changed nullability rejects', 'alter table ' + privateTable + ' alter column reference drop not null');
    await rejectsDrift('extra constraint rejects', 'alter table ' + privateTable + ' add constraint unreviewed check(length(reference)>0)');
    await rejectsDrift('extra index rejects', 'create index unreviewed on ' + privateTable + '(reference)');
    // Only this isolated database's catalog is modified to simulate interrupted
    // concurrent index work. Each probe is rolled back before the next case.
    for (const field of ['indisvalid', 'indisready', 'indislive']) {
      await rejectsDrift('unhealthy index rejects: ' + field, 'update pg_catalog.pg_index set ' + field + "=false where indexrelid='finance_apm_private.apm_reversal_voucher_once'::regclass");
    }
    for (const trigger of fixture.catalog.triggers) {
      await rejectsDrift('disabled trigger rejects: ' + trigger.table + '.' + trigger.name,
        'alter table ' + trigger.schema + '.' + trigger.table + ' disable trigger ' + trigger.name);
    }
    await rejectsDrift('missing voucher protection trigger rejects', 'drop trigger apm_receipt_voucher_guard on public.vouchers');
    await rejectsDrift('changed trigger function rejects', 'drop trigger apm_receipt_voucher_guard on public.vouchers; create trigger apm_receipt_voucher_guard before update or delete on public.vouchers for each row execute function finance_apm_private.immutable()');
    await rejectsDrift('extra trigger using private function rejects', 'create trigger unreviewed after update on public.vouchers for each row execute function finance_apm_private.immutable()');
    assert.equal(await snapshot(), before);
    await db.exec('begin read only;' + guard + 'rollback;');
    checks.push('all negative mutations rolled back; original valid catalog still passes');
    const report = { ok: true, engine: 'isolated PGlite PostgreSQL', production: false, migrationReplay: false,
      guardSha256: crypto.createHash('sha256').update(source).digest('hex'), checks };
    const output = process.env.FINANCE_APM_ADOPTION_OUTPUT;
    if (output) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); }
    console.log('APM adoption postflight runtime PASS: ' + checks.length + ' checks; read-only, no migration replay, no production access.');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
