import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const require = createRequire(import.meta.url);
const scripts = new URL('.', import.meta.url);
const realActorFiles = fs.readdirSync(scripts).filter(name => /^finance_.*canary\.sql$/.test(name)).map(name => ({name, source: fs.readFileSync(new URL(name, scripts), 'utf8')})).filter(row => row.source.includes('v_canary_session_id'));
const pattern = /v_canary_session_id := null;\s*if pg_catalog\.to_regprocedure\('public\.finance_auth_session_active\(\)'\) is not null then[\s\S]*?end if;\s*end if;\s*perform\s+(?:pg_catalog\.)?set_config\(\s*'request.jwt.claims',\s*(?:pg_catalog\.)?jsonb_build_object\([\s\S]*?\)::text,\s*true\s*\);/g;
let checks = 0;
const pass = message => {checks++; console.log('PASS '+message);};
assert.equal(realActorFiles.length, 11);
const cases = realActorFiles.flatMap(({name, source}) => [...source.matchAll(pattern)].map(match => ({name, sql: match[0], subject: match[0].match(/using ([a-zA-Z_0-9.]+);/)[1]})));
assert.equal(cases.length, 24);
for (const {name, source} of realActorFiles) {
  assert.doesNotMatch(source, /(?:insert\s+into|update|delete\s+from)\s+auth\.sessions|lock\s+table\s+auth\.sessions|from\s+auth\.sessions[^;\n]*for\s+update/i, name+' may only read genuine sessions');
  for (const match of source.matchAll(/jsonb_build_object\(\s*'sub',[\s\S]*?\)::text/g)) assert.match(match[0], /'session_id',\s*v_canary_session_id/);
}
pass('all 24 genuine-actor claims include a session; no Auth session mutation or lock');

const db = new PGlite();
const uid = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const older = '33333333-3333-4333-8333-333333333333';
const current = '44444444-4444-4444-8444-444444444444';
const foreign = '55555555-5555-4555-8555-555555555555';
const expired = '66666666-6666-4666-8666-666666666666';
try {
  await db.exec(`create schema auth;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;`);
  const run = async ({sql, subject}) => {
    const scalar = !subject.includes('.');
    const declaration = scalar ? `${subject} uuid := '${uid}';` : `${subject.split('.')[0]} record;`;
    // Claims retain the actual source block; only synthetic fixture variables
    // replace its separate verified employee object in this isolated database.
    const fill = scalar ? '' : `select '${uid}'::uuid auth_user_id,'fixture@example.invalid'::text email into ${subject.split('.')[0]};`;
    let source = sql;
    for (const email of ['v_applicant_email', 'v_supervisor_email', 'v_xu_applicant_email']) source = source.replaceAll(email, "'fixture@example.invalid'");
    await db.exec('begin');
    try {
      await db.exec(`do $case$ declare v_canary_session_id uuid;${declaration} begin ${fill}${source} end;$case$;`);
      const claims = (await db.query("select auth.jwt() claims")).rows[0].claims;
      if (claims.session_id) assert.equal((await db.query('select public.finance_auth_session_active() active')).rows[0].active, true);
      await db.exec('rollback');
      return claims;
    } catch (error) {await db.exec('rollback'); throw error;}
  };
  for (const item of cases) assert.equal((await run(item)).session_id, null);
  pass('actual 24 blocks remain compatible with legacy phases without session helper/table');
  await db.exec('create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz,created_at timestamptz,updated_at timestamptz);');
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260927180201_finance_portal_session_logout.sql', import.meta.url), 'utf8');
  const sessionHelper = migration.slice(migration.indexOf('create function public.finance_auth_session_active()'), migration.indexOf('revoke all on function public.finance_auth_session_active()'));
  await db.exec(sessionHelper);
  await db.query(`insert into auth.sessions values($1,$2,null,now()-interval '1 hour',now()),($3,$2,now()+interval '1 hour',now(),now()),($4,$5,null,now()+interval '1 day',now()),($6,$2,now()-interval '1 second',now()+interval '2 days',now())`, [older, uid, current, foreign, other, expired]);
  const fingerprint = async () => (await db.query('select jsonb_agg(to_jsonb(s) order by id) rows from auth.sessions s')).rows[0].rows;
  const before = await fingerprint();
  await db.exec(`create table public.finance_users(id text,tenant_id uuid,active boolean,auth_user_id uuid);insert into public.finance_users values('first-no-session','${uid}',true,'77777777-7777-4777-8777-777777777777'),('next-active','${uid}',true,'${uid}'),('foreign-tenant','${other}',true,'${other}');`);
  for (const {name, source} of realActorFiles.filter(row => row.name !== 'finance_production_authenticated_canary.sql')) {
    const map = source.match(/if pg_catalog\.to_regprocedure\('public\.finance_auth_session_active\(\)'\) is not null then\s*execute 'select coalesce\(array_agg\(distinct s.user_id\)[\s\S]*?end if;/)?.[0];
    assert.ok(map, name+' candidate map must be scoped to tenant and active sessions');
    const tenantName = map.match(/using ([a-z_]+);/)[1];
    assert.match(source, /where \(v_canary_active_session_users is null or u\.auth_user_id=any\(v_canary_active_session_users\)\) and u\.tenant_id=/);
    await db.exec(`do $map$ declare ${tenantName} uuid := '${uid}';v_canary_active_session_users uuid[];picked text;begin ${map} select u.id into picked from public.finance_users u where (v_canary_active_session_users is null or u.auth_user_id=any(v_canary_active_session_users)) and u.tenant_id=${tenantName} and u.active order by u.id limit 1;if picked is distinct from 'next-active' then raise exception 'Candidate did not skip expired/missing/foreign tenant session';end if;end;$map$;`);
  }
  assert.deepEqual(await fingerprint(), before);
  pass('all 10 dynamic candidate maps skip missing-session first candidate and exclude foreign tenant without changing sessions');
  for (const item of cases) {
    const claims = await run(item);
    assert.equal(claims.session_id, current, item.name+' chooses latest unexpired session of exact UID');
    assert.equal(claims.sub, uid);
  }
  assert.deepEqual(await fingerprint(), before);
  pass('actual 24 blocks select exact UID latest active session; helper authorizes and table remains identical');
  await db.query('delete from auth.sessions where id=$1', [current]);
  for (const item of cases) assert.equal((await run(item)).session_id, older);
  pass('revoked latest session is never reused; existing older active session selected');
  await db.query('delete from auth.sessions where id=$1', [older]);
  for (const item of cases) await assert.rejects(() => run(item), /requires an existing active session/);
  assert.equal((await db.query('select count(*)::int n from auth.sessions')).rows[0].n, 2);
  pass('missing/expired actor sessions fail closed for all blocks; foreign sessions cannot substitute');
} finally {await db.close();}

const synthetic = new PGlite();
try {
  const {createStatementSourceCanaryFixture} = require('./check_statement_source_canary.cjs');
  await createStatementSourceCanaryFixture(synthetic);
  await synthetic.exec(`create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz,created_at timestamptz,updated_at timestamptz);create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;`);
  const source = fs.readFileSync(new URL('finance_statement_source_canary.sql', scripts), 'utf8');
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260927180201_finance_portal_session_logout.sql', import.meta.url), 'utf8');
  await synthetic.exec(migration.slice(migration.indexOf('create function public.finance_auth_session_active()'), migration.indexOf('revoke all on function public.finance_auth_session_active()')));
  // Preserve the real fixture identity implementation and enforce the actual
  // new helper around it; no mocked success or guard bypass is introduced.
  await synthetic.exec(`alter function public.current_finance_user() rename to fixture_legacy_current_finance_user;create function public.current_finance_user() returns public.finance_users language sql stable security definer set search_path='' as $$select public.fixture_legacy_current_finance_user() where public.finance_auth_session_active()$$;`);
  await synthetic.exec(source);
  assert.equal((await synthetic.query('select count(*)::int n from auth.sessions')).rows[0].n, 0);
  assert.equal((await synthetic.query('select count(*)::int n from auth.users')).rows[0].n, 0);
  pass('complete real statement canary passes new session fence with isolated synthetic session, then fully rolls back');
  const noSession = source.replace(/execute 'insert into auth\.sessions\([^\n]+\n\s*using sid,uid;/, 'null;');
  await assert.rejects(() => synthetic.exec(noSession), /Synthetic employee did not resolve/);
  await synthetic.exec('rollback');
  assert.equal((await synthetic.query('select count(*)::int n from auth.sessions')).rows[0].n, 0);
  pass('synthetic statement canary fails without matching fixture session; failure also rolls back');
} finally {await synthetic.close();}

// Validate every actual final SQL result against the release parser. This is
// output-contract coverage only; the protected workflow still executes each
// complete canary, including its role, rollback and business assertions.
const outputDb = new PGlite();
const outputDir = fs.mkdtempSync(join(tmpdir(), 'finance-canary-output-contracts-'));
try {
  const guard = require('./finance_production_release_guard.js');
  const guardSource = fs.readFileSync(new URL('finance_production_release_guard.js', scripts), 'utf8');
  const domains = new Map([...guardSource.matchAll(/(\w+):\{marker:'[^']+',result:\{canary:'([^']+)'/g)].map(match => [match[2], match[1]]));
  const identityOnceContract = Object.freeze({
    filename: 'finance_personal_history_identity_once_canary.sql',
    marker: 'personal_history_identity_once_canary_result',
    domain: 'personal_history_identity_once',
    result: {
      canary: 'readonly_personal_history_identity_once_v1',
      ok: true,
      rolled_back: true,
      identity_scope_preserved: true,
      permission_guard_preserved: true,
      live_latency_proven: false
    }
  });
  assert.equal(domains.get(identityOnceContract.result.canary), identityOnceContract.domain);
  const billHistoryContract=Object.freeze({
    filename:'finance_personal_bill_batch_history_canary.sql',
    marker:'personal_bill_batch_history_canary_result',
    domain:'personal_bill_batch_history',
    result:{canary:'readonly_personal_bill_batch_history_v1',ok:true,rolled_back:true,
      identity_scope_preserved:true,permission_guard_preserved:true,live_latency_proven:false}
  });
  assert.equal(domains.get(billHistoryContract.result.canary),billHistoryContract.domain);
  const invoiceBulkContract=Object.freeze({
    filename:'finance_invoice_batch_bulk_canary.sql',
    marker:'invoice_batch_bulk_canary_result',
    domain:'invoice_batch_bulk',
    result:{canary:'readonly_invoice_batch_bulk_v1',ok:true,rolled_back:true,
      identity_scope_preserved:true,live_latency_proven:false}
  });
  assert.equal(domains.get(invoiceBulkContract.result.canary),invoiceBulkContract.domain);
  const billApprovalBulkContract=Object.freeze({
    filename:'finance_bill_approval_bulk_canary.sql',
    marker:'bill_approval_bulk_canary_result',
    domain:'bill_approval_bulk',
    result:{canary:'readonly_bill_approval_bulk_v1',ok:true,rolled_back:true,
      identity_scope_preserved:true,live_latency_proven:false}
  });
  assert.equal(domains.get(billApprovalBulkContract.result.canary),billApprovalBulkContract.domain);
  const invoiceApprovalBulkContract=Object.freeze({
    filename:'finance_invoice_approval_bulk_canary.sql',
    marker:'invoice_approval_bulk_canary_result',
    domain:'invoice_approval_bulk',
    result:{canary:'readonly_invoice_approval_bulk_v1',ok:true,rolled_back:true,
      identity_scope_preserved:true,live_latency_proven:false}
  });
  assert.equal(domains.get(invoiceApprovalBulkContract.result.canary),invoiceApprovalBulkContract.domain);
  let invoiceApprovalBulkVerified=0;
  const bankFeeClassificationContract=Object.freeze({
    filename:'finance_bank_fee_classification_canary.sql',
    marker:'bank_fee_classification_canary_result',
    domain:'bank_fee_classification',
    result:{canary:'readonly_bank_fee_classification_v1',ok:true,rolled_back:true,
      staff_identity_used:false,business_mutation_performed:false}
  });
  assert.equal(domains.get(bankFeeClassificationContract.result.canary),bankFeeClassificationContract.domain);
  let bankFeeClassificationVerified=0;
  const megaRemittanceContract=Object.freeze({
    filename:'finance_mega_remittance_canary.sql',
    marker:'mega_remittance_canary_result',
    domain:'mega_remittance',
    result:{canary:'readonly_mega_remittance_v1',ok:true,rolled_back:true,
      staff_identity_used:false,business_mutation_performed:false}
  });
  assert.equal(domains.get(megaRemittanceContract.result.canary),megaRemittanceContract.domain);
  let megaRemittanceVerified=0;
  const remittanceHistoryContract=Object.freeze({
    filename:'finance_remittance_history_canary.sql',
    marker:'remittance_history_canary_result',
    domain:'remittance_history',
    result:{canary:'readonly_remittance_history_v1',ok:true,rolled_back:true,
      staff_identity_used:false,business_mutation_performed:false}
  });
  assert.equal(domains.get(remittanceHistoryContract.result.canary),remittanceHistoryContract.domain);
  let remittanceHistoryVerified=0;
  const boundaryCanaryContracts=Object.freeze([
    {filename:'finance_remittance_boundary_canary.sql',marker:'remittance_boundary_canary_result',domain:'remittance_boundary',sqlMarker:'FINANCE_REMITTANCE_BOUNDARY_CANARY_ROLLED_BACK',result:{canary:'readonly_remittance_boundary_v1',ok:true,rolled_back:true,staff_identity_used:false,business_mutation_performed:false}},
    {filename:'finance_org_google_repair_snapshot_canary.sql',marker:'org_google_repair_snapshot_canary_result',domain:'org_google_repair_snapshot',sqlMarker:'FINANCE_ORG_GOOGLE_REPAIR_SNAPSHOT_CANARY_ROLLED_BACK',result:{canary:'readonly_org_google_repair_snapshot_v1',ok:true,rolled_back:true,staff_identity_used:false,business_mutation_performed:false}}
  ]);
  for(const contract of boundaryCanaryContracts)assert.equal(domains.get(contract.result.canary),contract.domain);
  const boundaryCanariesVerified=new Map(boundaryCanaryContracts.map(c=>[c.domain,0]));
  const verifiedSessionTasksContract=Object.freeze({
    filename:'finance_approval_tasks_verified_session_canary.sql',
    marker:'approval_tasks_verified_session_canary_result',
    domain:'approval_tasks_verified_session',
    result:{canary:'readonly_approval_tasks_verified_session_v1',ok:true,rolled_back:true,
      staff_identity_used:false,business_mutation_performed:false}
  });
  assert.equal(domains.get(verifiedSessionTasksContract.result.canary),verifiedSessionTasksContract.domain);
  let verifiedSessionTasksVerified=0;
  let billApprovalBulkVerified=0;
  let invoiceBulkVerified=0;
  let verified = 0,boundedVerified=0;
  let identityOnceVerified = 0;
  let billHistoryVerified=0;
  for (const name of fs.readdirSync(scripts).filter(name => /^finance_.*canary\.sql$/.test(name))) {
    // The separate human-accounting gate does not use these release parsers.
    if (name === 'finance_production_human_accounting_canary.sql' || name === 'finance_human_accounting_float_canary.sql') continue;
    const source = fs.readFileSync(new URL(name, scripts), 'utf8');
    const select = source.match(/(?:^|\n)(select\s+(?:'[^']+'\s+as\s+marker\s*,\s*)?(?:pg_catalog\.)?jsonb_build_object\([\s\S]*?\)\s+as\s+\w+\s*;)\s*$/i)?.[1];
    assert.ok(select, name+' final output must be explicitly verified');
    const file = join(outputDir, name+'.json');
    const actualResults = await outputDb.exec(select);
    fs.writeFileSync(file, JSON.stringify(actualResults));
    if (name === 'finance_production_authenticated_canary.sql') guard.verifyAuthenticatedCanary(file);
    else if (name === 'finance_finalize_accounting_lines_canary.sql') guard.verifyFinalizeCanary(file);
    else if (name === 'finance_utility_tax_canary.sql') guard.verifyUtilityCanary(file);
    else {
      const canary = select.match(/'canary'\s*,\s*'([^']+)'/)?.[1];
      assert.ok(domains.has(canary), name+' must have a protected report domain');
      guard.verifyReportsCanary(file, domains.get(canary));
    }
    if (name === identityOnceContract.filename) {
      const rows = actualResults.flatMap(result => result.rows || []);
      assert.equal(rows.length, 1, 'identity-once final SQL must emit exactly one result row');
      assert.deepEqual(rows[0][identityOnceContract.marker], identityOnceContract.result,
        'actual SQL must preserve exact identity, permission, rollback and unproven-live-latency flags');
      const negative = join(outputDir, 'identity-once-negative.json');
      const verifyNegative = payload => {
        fs.writeFileSync(negative, JSON.stringify(payload));
        assert.throws(() => guard.verifyReportsCanary(negative, identityOnceContract.domain));
      };
      for (const flag of ['ok', 'rolled_back', 'identity_scope_preserved', 'permission_guard_preserved', 'live_latency_proven']) {
        verifyNegative([{[identityOnceContract.marker]: {
          ...identityOnceContract.result,
          [flag]: !identityOnceContract.result[flag]
        }}]);
      }
      verifyNegative([{[identityOnceContract.marker]: {...identityOnceContract.result, canary: 'wrong-canary'}}]);
      verifyNegative([{wrong_marker: identityOnceContract.result}]);
      verifyNegative([
        {[identityOnceContract.marker]: identityOnceContract.result},
        {[identityOnceContract.marker]: identityOnceContract.result}
      ]);
      identityOnceVerified++;
      pass('identity-once actual final SQL has the exact new marker/domain and rejects five altered flags, wrong canary, wrong marker and duplicate results');
    }
    if(name===billHistoryContract.filename){
      const rows=actualResults.flatMap(result=>result.rows||[]);
      assert.equal(rows.length,1,'bill batch final SQL must emit exactly one result row');
      assert.deepEqual(rows[0][billHistoryContract.marker],billHistoryContract.result,
        'actual bill batch SQL must preserve exact identity, permission, rollback and unproven-live-latency flags');
      const negative=join(outputDir,'bill-history-negative.json');
      const verifyNegative=payload=>{
        fs.writeFileSync(negative,JSON.stringify(payload));
        assert.throws(()=>guard.verifyReportsCanary(negative,billHistoryContract.domain));
      };
      for(const flag of ['ok','rolled_back','identity_scope_preserved','permission_guard_preserved','live_latency_proven'])
        verifyNegative([{[billHistoryContract.marker]:{...billHistoryContract.result,[flag]:!billHistoryContract.result[flag]}}]);
      verifyNegative([{[billHistoryContract.marker]:{...billHistoryContract.result,canary:'wrong-canary'}}]);
      verifyNegative([{wrong_marker:billHistoryContract.result}]);
      verifyNegative([{[billHistoryContract.marker]:billHistoryContract.result},{[billHistoryContract.marker]:billHistoryContract.result}]);
      billHistoryVerified++;
      pass('bill batch actual final SQL has its exact reviewed marker/domain and rejects five altered flags, wrong canary, wrong marker and duplicate results');
    }
    if(name===invoiceBulkContract.filename){
      const rows=actualResults.flatMap(result=>result.rows||[]);
      assert.equal(rows.length,1,'invoice bulk final SQL must emit exactly one result row');
      assert.equal(rows[0].marker,'FINANCE_INVOICE_BATCH_BULK_CANARY_ROLLED_BACK');
      assert.deepEqual(rows[0][invoiceBulkContract.marker],invoiceBulkContract.result,
        'actual invoice bulk SQL must preserve exact identity, rollback and unproven-live-latency flags');
      const negative=join(outputDir,'invoice-bulk-negative.json');
      const verifyNegative=payload=>{
        fs.writeFileSync(negative,JSON.stringify(payload));
        assert.throws(()=>guard.verifyReportsCanary(negative,invoiceBulkContract.domain));
      };
      for(const flag of ['ok','rolled_back','identity_scope_preserved','live_latency_proven'])
        verifyNegative([{[invoiceBulkContract.marker]:{...invoiceBulkContract.result,[flag]:!invoiceBulkContract.result[flag]}}]);
      verifyNegative([{[invoiceBulkContract.marker]:{...invoiceBulkContract.result,canary:'wrong-canary'}}]);
      verifyNegative([{wrong_marker:invoiceBulkContract.result}]);
      verifyNegative([{[invoiceBulkContract.marker]:invoiceBulkContract.result},{[invoiceBulkContract.marker]:invoiceBulkContract.result}]);
      invoiceBulkVerified++;
      pass('invoice bulk actual final SQL has its exact reviewed marker/domain and rejects altered flags, wrong canary, wrong marker and duplicate results');
    }
    if(name===billApprovalBulkContract.filename){
      const rows=actualResults.flatMap(result=>result.rows||[]);
      assert.equal(rows.length,1,'bill approval bulk final SQL must emit exactly one result row');
      assert.equal(rows[0].marker,'FINANCE_BILL_APPROVAL_BULK_CANARY_ROLLED_BACK');
      assert.deepEqual(rows[0][billApprovalBulkContract.marker],billApprovalBulkContract.result,
        'actual bill approval bulk SQL must preserve exact identity, rollback and unproven-live-latency flags');
      const negative=join(outputDir,'bill-approval-bulk-negative.json');
      const verifyNegative=payload=>{
        fs.writeFileSync(negative,JSON.stringify(payload));
        assert.throws(()=>guard.verifyReportsCanary(negative,billApprovalBulkContract.domain));
      };
      for(const flag of ['ok','rolled_back','identity_scope_preserved','live_latency_proven'])
        verifyNegative([{[billApprovalBulkContract.marker]:{...billApprovalBulkContract.result,[flag]:!billApprovalBulkContract.result[flag]}}]);
      verifyNegative([{[billApprovalBulkContract.marker]:{...billApprovalBulkContract.result,canary:'wrong-canary'}}]);
      verifyNegative([{wrong_marker:billApprovalBulkContract.result}]);
      verifyNegative([{[billApprovalBulkContract.marker]:billApprovalBulkContract.result},{[billApprovalBulkContract.marker]:billApprovalBulkContract.result}]);
      billApprovalBulkVerified++;
      pass('bill approval bulk actual final SQL has its exact reviewed marker/domain and rejects altered flags, wrong canary, wrong marker and duplicate results');
    }
    if(name===invoiceApprovalBulkContract.filename){
      const rows=actualResults.flatMap(result=>result.rows||[]);
      assert.equal(rows.length,1,'invoice approval bulk final SQL must emit exactly one result row');
      assert.equal(rows[0].marker,'FINANCE_INVOICE_APPROVAL_BULK_CANARY_ROLLED_BACK');
      assert.deepEqual(rows[0][invoiceApprovalBulkContract.marker],invoiceApprovalBulkContract.result,
        'actual invoice approval bulk SQL preserves exact identity, rollback and unproven-live-latency flags');
      assert.match(source,/begin isolation level repeatable read read only;/);
      assert.match(source,/auth\.uid\(\) is not null then raise exception 'Invoice approval canary requires no staff identity'/);
      assert.match(source,/perform public\.finance_invoice_act_active_step_v2\(array\['__readonly_invoice_approval_canary__'\],'approve','__readonly_invoice_approval_canary__',null,'\[\]',null,'\{\}','\{\}','production'\);\s*exception when insufficient_privilege then denied:=true;/);
      assert.match(source,/if not denied then raise exception 'Anonymous invoice approval was not denied' using errcode='23514';end if;/);
      assert.match(source,/-- FINANCE_AUTHENTICATED_CANARY_CORE_END\s*rollback;\s*-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN/);
      assert.match(source,/current_setting\('transaction_read_only'\)='on' then raise exception 'Invoice approval canary remains open'/);
      assert.doesNotMatch(source,/set_config\s*\(\s*'request\.jwt\.|set\s+(?:local\s+)?role\s+(?:authenticated|service_role)|(?:insert\s+into|update|delete\s+from|truncate\s+(?:table\s+)?)\s*(?:auth\.|public\.|private\.)/i,
        'invoice approval canary must not impersonate staff or mutate identity/business rows');
      const negative=join(outputDir,'invoice-approval-bulk-negative.json');
      const verifyNegative=payload=>{
        fs.writeFileSync(negative,JSON.stringify(payload));
        assert.throws(()=>guard.verifyReportsCanary(negative,invoiceApprovalBulkContract.domain));
      };
      for(const flag of ['ok','rolled_back','identity_scope_preserved','live_latency_proven']){
        verifyNegative([{[invoiceApprovalBulkContract.marker]:{...invoiceApprovalBulkContract.result,[flag]:!invoiceApprovalBulkContract.result[flag]}}]);
        const missing={...invoiceApprovalBulkContract.result};delete missing[flag];
        verifyNegative([{[invoiceApprovalBulkContract.marker]:missing}]);
        verifyNegative([{[invoiceApprovalBulkContract.marker]:{...invoiceApprovalBulkContract.result,[flag]:String(invoiceApprovalBulkContract.result[flag])}}]);
      }
      verifyNegative([{[invoiceApprovalBulkContract.marker]:{...invoiceApprovalBulkContract.result,canary:'wrong-canary'}}]);
      verifyNegative([{wrong_marker:invoiceApprovalBulkContract.result}]);
      verifyNegative([{[invoiceApprovalBulkContract.marker]:invoiceApprovalBulkContract.result},{[invoiceApprovalBulkContract.marker]:invoiceApprovalBulkContract.result}]);
      for(const other of [billApprovalBulkContract.domain,invoiceBulkContract.domain])
        assert.throws(()=>guard.verifyReportsCanary(file,other),'invoice approval result cannot satisfy another protected domain');
      invoiceApprovalBulkVerified++;
      pass('invoice approval bulk actual SQL preserves anonymous/read-only/rollback safeguards and rejects changed, missing or mistyped flags, wrong canary/marker/domain and duplicates');
    }
    if(name===bankFeeClassificationContract.filename){
      const rows=actualResults.flatMap(result=>result.rows||[]);
      assert.equal(rows.length,1,'bank fee classification final SQL must emit exactly one result row');
      assert.equal(rows[0].marker,'FINANCE_BANK_FEE_CLASSIFICATION_CANARY_ROLLED_BACK');
      assert.deepEqual(rows[0][bankFeeClassificationContract.marker],bankFeeClassificationContract.result,
        'actual bank fee SQL must preserve rollback and must not claim a staff identity or business action');
      assert.match(source,/begin isolation level repeatable read read only;/);
      assert.match(source,/auth\.uid\(\) is not null then raise exception/);
      assert.match(source,/public\.finance_expense_resubmit_applicant_revision\(/);
      assert.match(source,/foreach action in array array\['resubmit','cancel'\]/);
      assert.doesNotMatch(source,/set_config\s*\(\s*'request\.jwt\.claims'|(?:insert\s+into|update|delete\s+from)\s+(?:auth\.|public\.)/i,
        'new bank fee canary must not impersonate an employee or mutate identity/business rows');
      const negative=join(outputDir,'bank-fee-classification-negative.json');
      const verifyNegative=payload=>{
        fs.writeFileSync(negative,JSON.stringify(payload));
        assert.throws(()=>guard.verifyReportsCanary(negative,bankFeeClassificationContract.domain));
      };
      for(const flag of ['ok','rolled_back','staff_identity_used','business_mutation_performed']){
        verifyNegative([{[bankFeeClassificationContract.marker]:{...bankFeeClassificationContract.result,[flag]:!bankFeeClassificationContract.result[flag]}}]);
        const missing={...bankFeeClassificationContract.result};delete missing[flag];
        verifyNegative([{[bankFeeClassificationContract.marker]:missing}]);
      }
      verifyNegative([{[bankFeeClassificationContract.marker]:{...bankFeeClassificationContract.result,canary:'wrong-canary'}}]);
      verifyNegative([{wrong_marker:bankFeeClassificationContract.result}]);
      verifyNegative([{[bankFeeClassificationContract.marker]:bankFeeClassificationContract.result},{[bankFeeClassificationContract.marker]:bankFeeClassificationContract.result}]);
      bankFeeClassificationVerified++;
      pass('bank fee classification actual final SQL preserves exact anonymous/read-only/rollback flags and rejects changed or missing flags, wrong canary/marker and duplicates');
    }
    if(name===megaRemittanceContract.filename){
      const rows=actualResults.flatMap(result=>result.rows||[]);
      assert.equal(rows.length,1,'Mega remittance final SQL must emit exactly one result row');
      assert.equal(rows[0].marker,'FINANCE_MEGA_REMITTANCE_CANARY_ROLLED_BACK');
      assert.deepEqual(rows[0][megaRemittanceContract.marker],megaRemittanceContract.result,
        'actual Mega SQL must preserve rollback and must not claim a staff identity or business action');
      assert.match(source,/begin isolation level repeatable read read only;/);
      assert.match(source,/auth\.uid\(\) is not null then raise exception/);
      // The canary may only clear JWT identity, never populate a staff subject.
      const jwtSettings=[...source.matchAll(/set_config\(\s*'(request\.jwt\.[^']+)'\s*,\s*'([^']*)'\s*,\s*true\s*\)/g)].map(match=>[match[1],match[2]]);
      assert.deepEqual(jwtSettings,[['request.jwt.claim.sub',''],['request.jwt.claims','{}']]);
      assert.match(source,/execute 'set local role authenticated';/);
      assert.match(source,/execute 'reset role';/);
      assert.match(source,/perform public\.finance_mega_remittance_snapshot_v1\('anonymous-mega-canary','test'\);\s*exception when insufficient_privilege then denied:=true;/);
      assert.match(source,/perform public\.finance_mega_remittance_supplement_save_v1\('anonymous-mega-canary','test','anonymous-digest','\[\]'::jsonb\);\s*exception when insufficient_privilege then denied:=true;/);
      for(const action of ['read','save'])assert.match(source,new RegExp("if not denied then raise exception 'Mega remittance "+action+" accepted anonymous identity' using errcode='42501';end if;"));
      assert.match(source,/-- FINANCE_AUTHENTICATED_CANARY_CORE_END\s*rollback;\s*-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN/);
      assert.match(source,/current_setting\('transaction_read_only'\)='on' then raise exception 'Mega remittance canary remains open'/);
      assert.doesNotMatch(source,/(?:insert\s+into|update|delete\s+from|truncate\s+(?:table\s+)?)\s*(?:auth\.|public\.|private\.)/i,
        'Mega canary must not mutate identity, business or private supplement rows');
      const negative=join(outputDir,'mega-remittance-negative.json');
      const verifyNegative=payload=>{
        fs.writeFileSync(negative,JSON.stringify(payload));
        assert.throws(()=>guard.verifyReportsCanary(negative,megaRemittanceContract.domain));
      };
      for(const flag of ['ok','rolled_back','staff_identity_used','business_mutation_performed']){
        verifyNegative([{[megaRemittanceContract.marker]:{...megaRemittanceContract.result,[flag]:!megaRemittanceContract.result[flag]}}]);
        const missing={...megaRemittanceContract.result};delete missing[flag];
        verifyNegative([{[megaRemittanceContract.marker]:missing}]);
        verifyNegative([{[megaRemittanceContract.marker]:{...megaRemittanceContract.result,[flag]:String(megaRemittanceContract.result[flag])}}]);
      }
      verifyNegative([{[megaRemittanceContract.marker]:{...megaRemittanceContract.result,canary:'wrong-canary'}}]);
      verifyNegative([{wrong_marker:megaRemittanceContract.result}]);
      verifyNegative([{[megaRemittanceContract.marker]:megaRemittanceContract.result},{[megaRemittanceContract.marker]:megaRemittanceContract.result}]);
      assert.throws(()=>guard.verifyReportsCanary(file,bankFeeClassificationContract.domain),'Mega result cannot satisfy another protected domain');
      megaRemittanceVerified++;
      pass('Mega actual final SQL preserves anonymous/read-only/rollback safeguards and rejects changed, missing or mistyped flags, wrong canary/marker/domain and duplicates');
    }
    if(name===remittanceHistoryContract.filename){
      const rows=actualResults.flatMap(result=>result.rows||[]);
      assert.equal(rows.length,1,'Remittance history final SQL must emit exactly one result row');
      assert.equal(rows[0].marker,'FINANCE_REMITTANCE_HISTORY_CANARY_ROLLED_BACK');
      assert.deepEqual(rows[0][remittanceHistoryContract.marker],remittanceHistoryContract.result,
        'actual History SQL must preserve rollback and must not claim a staff identity or business action');
      assert.match(source,/begin isolation level repeatable read read only;/);
      assert.match(source,/auth\.uid\(\) is not null then raise exception/);
      // The canary may only clear JWT identity, never populate a staff subject.
      const jwtSettings=[...source.matchAll(/set_config\(\s*'(request\.jwt\.[^']+)'\s*,\s*'([^']*)'\s*,\s*true\s*\)/g)].map(match=>[match[1],match[2]]);
      assert.deepEqual(jwtSettings,[['request.jwt.claim.sub',''],['request.jwt.claims','{}']]);
      assert.match(source,/execute 'set local role authenticated';/);
      assert.match(source,/execute 'reset role';/);
      assert.match(source,/perform public\.finance_remittance_export_snapshot_v1\('anonymous-mega-canary','test'\);\s*exception when insufficient_privilege then denied:=true;/);
      assert.match(source,/perform public\.finance_remittance_export_supplement_save_v1\('anonymous-mega-canary','test','anonymous-digest','\[\]'::jsonb\);\s*exception when insufficient_privilege then denied:=true;/);
      for(const action of ['read','save'])assert.match(source,new RegExp("if not denied then raise exception 'Remittance history "+action+" accepted anonymous identity' using errcode='42501';end if;"));
      assert.match(source,/-- FINANCE_AUTHENTICATED_CANARY_CORE_END\s*rollback;\s*-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN/);
      assert.match(source,/current_setting\('transaction_read_only'\)='on' then raise exception 'Remittance history canary remains open'/);
      assert.doesNotMatch(source,/(?:insert\s+into|update|delete\s+from|truncate\s+(?:table\s+)?)\s*(?:auth\.|public\.|private\.)/i,
        'History canary must not mutate identity, business or private supplement rows');
      const negative=join(outputDir,'remittance-history-negative.json');
      const verifyNegative=payload=>{
        fs.writeFileSync(negative,JSON.stringify(payload));
        assert.throws(()=>guard.verifyReportsCanary(negative,remittanceHistoryContract.domain));
      };
      for(const flag of ['ok','rolled_back','staff_identity_used','business_mutation_performed']){
        verifyNegative([{[remittanceHistoryContract.marker]:{...remittanceHistoryContract.result,[flag]:!remittanceHistoryContract.result[flag]}}]);
        const missing={...remittanceHistoryContract.result};delete missing[flag];
        verifyNegative([{[remittanceHistoryContract.marker]:missing}]);
        verifyNegative([{[remittanceHistoryContract.marker]:{...remittanceHistoryContract.result,[flag]:String(remittanceHistoryContract.result[flag])}}]);
      }
      verifyNegative([{[remittanceHistoryContract.marker]:{...remittanceHistoryContract.result,canary:'wrong-canary'}}]);
      verifyNegative([{wrong_marker:remittanceHistoryContract.result}]);
      verifyNegative([{[remittanceHistoryContract.marker]:remittanceHistoryContract.result},{[remittanceHistoryContract.marker]:remittanceHistoryContract.result}]);
      assert.throws(()=>guard.verifyReportsCanary(file,bankFeeClassificationContract.domain),'History result cannot satisfy another protected domain');
      remittanceHistoryVerified++;
      pass('History actual final SQL preserves anonymous/read-only/rollback safeguards and rejects changed, missing or mistyped flags, wrong canary/marker/domain and duplicates');
    }
    const boundaryContract=boundaryCanaryContracts.find(c=>c.filename===name);
    if(boundaryContract){
      const rows=actualResults.flatMap(result=>result.rows||[]);
      assert.deepEqual(rows,[{marker:boundaryContract.sqlMarker,[boundaryContract.marker]:boundaryContract.result}],
        name+' must emit exactly its reviewed marker and no-identity/no-business-mutation flags');
      assert.match(source,/begin isolation level repeatable read read only;/);
      assert.match(source,/-- FINANCE_AUTHENTICATED_CANARY_CORE_END\s*rollback;\s*-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN/);
      assert.match(source,/current_setting\('transaction_read_only'\)='on' then raise exception/);
      assert.doesNotMatch(source,/(?:insert\s+into|update|delete\s+from|truncate\s+(?:table\s+)?)\s*(?:auth\.|public\.|private\.)/i,
        name+' must not mutate identity, business, private recipients or organization versions');
      if(boundaryContract.domain==='remittance_boundary'){
        const jwtSettings=[...source.matchAll(/set_config\(\s*'(request\.jwt\.[^']+)'\s*,\s*'([^']*)'\s*,\s*true\s*\)/g)].map(m=>[m[1],m[2]]);
        assert.deepEqual(jwtSettings,[['request.jwt.claim.sub',''],['request.jwt.claims','{}']]);
        assert.match(source,/foreach role_name in array array\['anon','authenticated'\]/);
        assert.match(source,/auth\.uid\(\) is not null then raise exception/);
        assert.match(source,/begin execute call_sql;exception when insufficient_privilege then denied:=true;end;/);
        assert.match(source,/if not denied then raise exception 'Remittance boundary accepted no-identity caller/);
        for(const fn of ['finance_mega_remittance_snapshot_v1','finance_mega_remittance_supplement_save_v1','finance_remittance_export_snapshot_v1','finance_remittance_export_supplement_save_v1']){
          assert.match(source,new RegExp('select public\\.'+fn+"\\('anonymous-boundary-canary','test'"));
        }
      }else{
        assert.doesNotMatch(source,/set_config\s*\(\s*'request\.jwt\.|set\s+(?:local\s+)?role\s+(?:authenticated|service_role)/i,
          'Organization catalog canary does not assume a staff identity');
        assert.doesNotMatch(source,/(?:perform|select|execute)\s+private\.finance_org_publish_runtime_v2\s*\(/i,
          'Organization canary inspects publication privilege without publishing');
        for(const role of ['authenticated','anon','service_role'])assert.match(source,new RegExp("has_function_privilege\\('"+role+"','private\\.finance_org_publish_runtime_v2\\(uuid,text,text\\)','EXECUTE'\\)"));
      }
      const negative=join(outputDir,boundaryContract.domain+'-negative.json');
      const verifyNegative=payload=>{fs.writeFileSync(negative,JSON.stringify(payload));assert.throws(()=>guard.verifyReportsCanary(negative,boundaryContract.domain));};
      for(const flag of ['ok','rolled_back','staff_identity_used','business_mutation_performed']){
        verifyNegative([{[boundaryContract.marker]:{...boundaryContract.result,[flag]:!boundaryContract.result[flag]}}]);
        const missing={...boundaryContract.result};delete missing[flag];verifyNegative([{[boundaryContract.marker]:missing}]);
        verifyNegative([{[boundaryContract.marker]:{...boundaryContract.result,[flag]:String(boundaryContract.result[flag])}}]);
      }
      verifyNegative([{[boundaryContract.marker]:{...boundaryContract.result,canary:'wrong-canary'}}]);
      verifyNegative([{wrong_marker:boundaryContract.result}]);
      verifyNegative([{[boundaryContract.marker]:boundaryContract.result},{[boundaryContract.marker]:boundaryContract.result}]);
      for(const other of [remittanceHistoryContract.domain,...boundaryCanaryContracts.filter(c=>c!==boundaryContract).map(c=>c.domain)])assert.throws(()=>guard.verifyReportsCanary(file,other),name+' cannot satisfy another protected domain');
      boundaryCanariesVerified.set(boundaryContract.domain,boundaryCanariesVerified.get(boundaryContract.domain)+1);
      pass(boundaryContract.domain+' actual SQL preserves read-only rollback/no-identity/no-mutation safeguards and rejects changed, missing, mistyped flags, wrong marker/domain and duplicates');
    }
    if(name===verifiedSessionTasksContract.filename){
      const rows=actualResults.flatMap(result=>result.rows||[]);
      assert.equal(rows.length,1,'verified-session tasks final SQL must emit exactly one result row');
      assert.equal(rows[0].marker,'FINANCE_APPROVAL_TASKS_VERIFIED_SESSION_CANARY_ROLLED_BACK');
      assert.deepEqual(rows[0][verifiedSessionTasksContract.marker],verifiedSessionTasksContract.result,
        'actual task SQL must preserve rollback and must not claim a staff identity or business action');
      assert.match(source,/begin isolation level repeatable read read only;/);
      assert.match(source,/auth\.uid\(\) is not null then raise exception/);
      assert.match(source,/public\.finance_approval_tasks_for_current_user\('pending'\)/);
      assert.match(source,/public\.finance_approval_tasks_for_current_user\(null\)/);
      assert.doesNotMatch(source,/set_config\s*\(\s*'request\.jwt\.claims'|(?:insert\s+into|update|delete\s+from)\s+(?:auth\.|public\.)/i,
        'new task canary must not impersonate an employee or mutate identity/business rows');
      const negative=join(outputDir,'verified-session-tasks-negative.json');
      const verifyNegative=payload=>{
        fs.writeFileSync(negative,JSON.stringify(payload));
        assert.throws(()=>guard.verifyReportsCanary(negative,verifiedSessionTasksContract.domain));
      };
      for(const flag of ['ok','rolled_back','staff_identity_used','business_mutation_performed']){
        verifyNegative([{[verifiedSessionTasksContract.marker]:{...verifiedSessionTasksContract.result,[flag]:!verifiedSessionTasksContract.result[flag]}}]);
        const missing={...verifiedSessionTasksContract.result};delete missing[flag];
        verifyNegative([{[verifiedSessionTasksContract.marker]:missing}]);
      }
      verifyNegative([{[verifiedSessionTasksContract.marker]:{...verifiedSessionTasksContract.result,canary:'wrong-canary'}}]);
      verifyNegative([{wrong_marker:verifiedSessionTasksContract.result}]);
      verifyNegative([{[verifiedSessionTasksContract.marker]:verifiedSessionTasksContract.result},{[verifiedSessionTasksContract.marker]:verifiedSessionTasksContract.result}]);
      verifiedSessionTasksVerified++;
      pass('verified-session tasks actual final SQL preserves exact anonymous/read-only/rollback flags and rejects changed or missing flags, wrong canary/marker and duplicates');
    }
    if(name==='finance_bounded_global_logout_canary.sql'){
      const rows=actualResults.flatMap(result=>result.rows||[]);
      assert.equal(rows.length,1,'bounded logout canary must emit exactly one complete marker');
      assert.deepEqual(rows[0].bounded_global_logout_canary_result,{canary:'readonly_bounded_global_logout_v2',ok:true,rolled_back:true,privacy_preserved:true,real_sessions_revoked:false});
      boundedVerified++;
      pass('bounded logout exact final SQL preserves rollback/privacy and never claims real session revocation');
    }
    verified++;
  }
  assert.equal(identityOnceVerified, 1, 'the reviewed identity-once file must be explicitly covered exactly once');
  assert.equal(billHistoryVerified,1,'the reviewed bill batch file must be explicitly covered exactly once');
  assert.equal(invoiceBulkVerified,1,'the reviewed invoice bulk file must be explicitly covered exactly once');
  assert.equal(billApprovalBulkVerified,1,'the reviewed bill approval bulk file must be explicitly covered exactly once');
  assert.equal(invoiceApprovalBulkVerified,1,'the reviewed invoice approval bulk file must be explicitly covered exactly once');
  assert.equal(verifiedSessionTasksVerified,1,'the reviewed verified-session tasks file must be explicitly covered exactly once');
  assert.equal(bankFeeClassificationVerified,1,'the reviewed bank fee classification file must be explicitly covered exactly once');
  assert.equal(megaRemittanceVerified,1,'the reviewed Mega remittance file must be explicitly covered exactly once');
  assert.equal(remittanceHistoryVerified,1,'the reviewed Remittance history file must be explicitly covered exactly once');
  for(const [domain,count] of boundaryCanariesVerified)assert.equal(count,1,domain+' complete final SQL is covered exactly once');
  assert.equal(verified-[...boundaryCanariesVerified.values()].reduce((a,b)=>a+b,0)-identityOnceVerified-billHistoryVerified-invoiceBulkVerified-billApprovalBulkVerified-invoiceApprovalBulkVerified-boundedVerified-verifiedSessionTasksVerified-bankFeeClassificationVerified-megaRemittanceVerified-remittanceHistoryVerified,39,'all original protected authenticated/report/finalize/utility/permission/bill-batch/invoice-batch final SQL results remain covered');
  assert.equal(boundedVerified,1,'bounded logout exact final SQL is covered once');
  assert.equal(verified,51,'the 39 original results plus the exact reviewed identity-once, bill batch, invoice bulk, bounded logout, bill approval bulk, invoice approval bulk, verified-session tasks, bank fee classification, Mega remittance, remittance history, remittance boundary and org Google repair results are covered');
  // Versioned canaries deliberately retain their old filenames for archived
  // phases, so they are outside the generic *canary.sql discovery above.
  const attachmentSuccessor=fs.readFileSync(new URL('finance_audit_security_canary_20261015.sql',scripts),'utf8');
  const attachmentSelect=attachmentSuccessor.match(/(?:^|\n)(select\s+(?:pg_catalog\.)?jsonb_build_object\([\s\S]*?\)\s+as\s+\w+\s*;)\s*$/i)?.[1];
  assert.ok(attachmentSelect,'versioned attachment audit successor has an explicit final result');
  const attachmentResults=await outputDb.exec(attachmentSelect);
  const attachmentRows=attachmentResults.flatMap(result=>result.rows||[]);
  const attachmentExpected={canary:'readonly_audit_security_v1',ok:true,rolled_back:true,identity_scope_preserved:true,attachment_scope_preserved:true};
  assert.deepEqual(attachmentRows,[{audit_security_canary_result:attachmentExpected}]);
  const attachmentFile=join(outputDir,'attachment-successor.json');
  fs.writeFileSync(attachmentFile,JSON.stringify(attachmentResults));
  guard.verifyReportsCanary(attachmentFile,'audit_security');
  const rejectAttachmentResult=rows=>{
    fs.writeFileSync(attachmentFile,JSON.stringify(rows));
    assert.throws(()=>guard.verifyReportsCanary(attachmentFile,'audit_security'));
  };
  for(const flag of ['ok','rolled_back','identity_scope_preserved','attachment_scope_preserved'])
    rejectAttachmentResult([{audit_security_canary_result:{...attachmentExpected,[flag]:false}}]);
  rejectAttachmentResult([{audit_security_canary_result:{...attachmentExpected,canary:'wrong-canary'}}]);
  rejectAttachmentResult([{wrong_marker:attachmentExpected}]);
  rejectAttachmentResult([...attachmentRows,...attachmentRows]);
  pass('versioned bill-attachment audit successor final SQL retains exact authority/rollback flags and rejects altered flags, wrong canary/marker and duplicates');
  pass('all 39 original final SQL results and reviewed identity-once, bill batch, invoice bulk, bounded logout, bill approval bulk, invoice approval bulk, verified-session tasks, bank fee classification, Mega remittance, remittance history, remittance boundary and org Google repair results satisfy their protected release parsers');
} finally {fs.rmSync(outputDir,{recursive:true,force:true});await outputDb.close();}
console.log(`OK: ${checks} canary active-session checks`);
