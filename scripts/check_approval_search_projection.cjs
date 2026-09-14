#!/usr/bin/env node
'use strict';
// Actual old/new PostgreSQL history functions; all people/documents are fictional.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createApprovalHistoryFixture } = require('./check_approval_history_page_first.cjs');
const root = path.resolve(__dirname, '..');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');
const migrationPath = 'supabase/migrations/20260914091205_finance_approval_search_projection_v1.sql';
const signature = 'public.finance_approval_participant_history_for_current_user(integer,integer,text,text)';
const tenant = '00000000-0000-0000-0000-000000000001';
const otherTenant = '00000000-0000-0000-0000-000000000002';
const authId = '00000000-0000-0000-0000-000000000011';
async function createApprovalSearchFixture(db, options = {}) {
  // install:false means the actual immediately preceding page-first RPC exists.
  // It does not mean an empty authority fixture or an invented replacement RPC.
  await createApprovalHistoryFixture(db, { install: true, forCanary: options.forCanary === true });
  await db.exec(`
    create table public.finance_department_units(tenant_id uuid,code text,name text);
    alter table public.expense_requests add column if not exists department_code text;
    alter table public.bills add column if not exists department_code text;
    alter table public.invoices add column if not exists department_code text;
  `);
  const columns = {
    expense_requests: { text: ['entity_id', 'applicant', 'type', 'type_label', 'status', 'debit_account', 'debit_account_name', 'credit_account', 'credit_account_name', 'payee', 'fee_bearer', 'petty_mode'], date: ['request_date', 'expected_pay_date'], timestamptz: ['created_at'], jsonb: ['files', 'actual_files'] },
    bills: { text: ['entity_id', 'entity_name', 'applicant', 'payer_name', 'note', 'status', 'approval_status', 'service_period', 'method', 'invoice_followup_status', 'invoice_followup_note'], date: ['due_date'], timestamptz: ['created_at', 'paid_at'] },
    invoices: { text: ['entity_id', 'entity_name', 'applicant', 'status', 'approval_status', 'invoice_identifier_type', 'invoice_item_type', 'payer_type', 'funding_source', 'service_period', 'contract_no', 'revenue_account_code', 'revenue_account_name', 'receipt_note'], date: ['invoice_date'], timestamptz: ['created_at', 'paid_at'], jsonb: ['receipt_files'] }
  };
  for (const [table, groups] of Object.entries(columns)) {
    await db.exec('alter table public.' + table + ' ' + Object.entries(groups).flatMap(([type, names]) => names.map(name => 'add column if not exists ' + name + ' ' + type)).join(',') + ';');
  }
  if (options.install !== false) await db.exec(read(migrationPath));
}
module.exports = { createApprovalSearchFixture };

async function runTests() {
  const db = new PGlite();
  let checks = 0;
  const check = (name, result = true) => { assert(result, name);checks++;console.log('PASS ' + name); };
  const call = async (query = null, limit = 50, offset = 0, environment = 'test') => (await db.query(
    'select ' + signature.split('(')[0] + '($1,$2,$3,$4) as payload', [limit, offset, query, environment]
  )).rows[0].payload;
  const records = payload => payload.items.map(item => item.record_id).sort();
  const normalizeAll = async values => (await db.query(`select value,private.finance_history_search_text_v1(value) normalized
    from unnest($1::text[]) with ordinality as input(value,n) order by n`, [values])).rows;
  const functionDefinitions = async () => (await db.query(`select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname='finance_approval_participant_history_for_current_user')
       or (n.nspname='private' and p.proname in ('finance_history_search_text_v1','finance_history_amount_text_v1','finance_history_document_search_v1'))
    order by n.nspname,p.proname`)).rows;
  const allPages = async (query = null, limit = 50) => {
    const first = await call(query, limit), pages = [first];
    for (let offset = limit; offset < first.total; offset += limit) pages.push(await call(query, limit, offset));
    return pages;
  };
  const rowFingerprint = async () => (await db.query(`select jsonb_build_object(
    'req',(select md5(coalesce(jsonb_agg(to_jsonb(r) order by id)::text,'')) from public.expense_requests r),
    'bill',(select md5(coalesce(jsonb_agg(to_jsonb(r) order by id)::text,'')) from public.bills r),
    'inv',(select md5(coalesce(jsonb_agg(to_jsonb(r) order by id)::text,'')) from public.invoices r),
    'steps',(select md5(coalesce(jsonb_agg(to_jsonb(r) order by id)::text,'')) from public.approval_step_actor_snapshots r),
    'people',(select md5(coalesce(jsonb_agg(to_jsonb(r) order by id)::text,'')) from public.finance_users r),
    'members',(select md5(coalesce(jsonb_agg(to_jsonb(r) order by finance_user_id)::text,'')) from public.tenant_members r)
  ) as value`)).rows[0].value;
  const catalog = async () => (await db.query(`select pg_get_userbyid(p.proowner) owner,p.prosecdef,p.provolatile,p.proconfig,
    has_function_privilege('anon',p.oid,'EXECUTE') anon,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
    has_function_privilege('service_role',p.oid,'EXECUTE') service_role,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute
    from pg_proc p where p.oid=$1::regprocedure`, [signature])).rows[0];
  async function add(table, id, amount, options = {}) {
    const { batch = null, sourceTenant = tenant, environment = 'test', participant = true, description = '一般文具費', total = amount, department = 'D1', payload = {}, snapshotTenant = sourceTenant, snapshotEnvironment = environment, acted = true } = options;
    if (table === 'expense_requests') await db.query('insert into public.expense_requests(id,no,tenant_id,data_environment,amount,description,department_code,form_payload) values($1,$1,$2,$3,$4,$5,$6,$7)', [id, sourceTenant, environment, amount, description, department, JSON.stringify(payload)]);
    else if (table === 'bills') await db.query('insert into public.bills(id,no,tenant_id,data_environment,amount,batch_id,item,department_code) values($1,$1,$2,$3,$4,$5,$6,$7)', [id, sourceTenant, environment, amount, batch, description, department]);
    else await db.query('insert into public.invoices(id,no,tenant_id,data_environment,amount,tax,total,batch_id,buyer,description,department_code) values($1,$1,$2,$3,$4,$5::numeric-$4::numeric,$5,$6,$7,$7,$8)', [id, sourceTenant, environment, amount, total, batch, description, department]);
    await db.query(`insert into public.approval_step_actor_snapshots(tenant_id,data_environment,record_type,record_id,record_no,step_index,step_title,step_status,workflow_status,role_key,resolved_user_id,acted_by_user_id,acted_by_name,acted_at_text,updated_at)
      values($1,$2,$3,$4,$4,0,'匿名覆核','approved','completed','ceo',$5,$6,$7,'2026-09-14T00:00:00Z','2026-09-14T00:00:00Z')`, [snapshotTenant, snapshotEnvironment, table, id, participant ? 'FICT-USER' : 'OTHER-USER', participant && acted ? 'FICT-USER' : null, participant && acted ? '匿名簽核人' : null]);
  }
  try {
    await createApprovalSearchFixture(db, { install: false });
    await db.query('insert into public.finance_department_units values($1,$2,$3),($4,$2,$5)', [tenant, 'D1', '萬華日間照顧課', otherTenant, '外法人不得出現部門']);
    await add('expense_requests', 'R-SELF', 1250, { description: '自費照顧 九月服務', payload: {
      purpose: '長照個案接送用途', accountingLines: [{ item: '復能活動文具', debitAccount: '6205', netAmount: 1200, taxAmount: 50, grossAmount: 1250, manualOverrideHistory: [{ note: 'auditsecretvalue', grossAmount: 98762 }] }],
      attachments: [{ name: '萬華自費明細.pdf', url: 'https://example.invalid/storage/pathsecretvalue', content: 'contentsecretvalue', data: 'datasecretvalue', base64: 'base64secretvalue', fileContent: 'filesecretvalue' }],
      storagePath: 'pathsecretvalue', accessToken: 'tokensecretvalue', metadata: { internal: 'metasecretvalue', note: 'metanotesecretvalue', amount: 98761 },
      ordinaryNested: { rows: [{ label: '巢狀商務備註', amount: 88.75 }], metadata: { note: 'deepmetasecretvalue' }, authorization: { label: 'authnestedsecretvalue' } }
    } });
    await add('expense_requests', 'R-DECIMAL', 12.5, { description: '小額支出' });
    await add('expense_requests', 'R-NEGATIVE', -12.5, { description: '負額調整' });
    await add('expense_requests', 'R-ZERO', 0, { description: '零金額申請' });
    await add('expense_requests', 'R-UNKNOWN', null, { description: '預算待補' });
    await db.exec("update public.expense_requests set estimated_amount=99.75 where id='R-UNKNOWN'");
    await add('expense_requests', 'R-ASSIGNED', 44, { description: '僅曾指派資料', acted: false });
    await add('expense_requests', 'R-SMALL', '0.0001', { description: '精細金額正數' });
    await add('expense_requests', 'R-SMALL-NEGATIVE', '-0.0001', { description: '精細金額負數' });
    await add('expense_requests', 'R-ESCAPES', 71.23, { description: '特殊字元 a"b a\\b 😀 ＣＡＲＥ 123ABC ＡＢＣ１２３', payload: { note: '全形搜尋　ＡＬＰＨＡ' } });
    for (const [suffix, text] of [['NEG', '-00012.50'], ['PLUS', '+00012.500'], ['FRACTION', '-000.500'], ['ZERO', '-0.00']]) {
      await add('expense_requests', 'R-TEXT-' + suffix, 71.23, { description: '純文字金額 ' + text });
    }
    await add('invoices', 'I-A', 1000, { total: 1050, batch: 'INVOICE-GROUP', description: '自費月結甲' });
    await add('invoices', 'I-B', 100, { total: 105, batch: 'INVOICE-GROUP', description: '自費月結乙', participant: false });
    await add('invoices', 'I-FALLBACK', 91.25, { total: null, description: '未給總額保留本金' });
    await add('invoices', 'I-ZERO-A', 1000, { total: 0, batch: 'ZERO-TOTAL-GROUP', description: '零總額合批甲' });
    await add('invoices', 'I-ZERO-B', 250, { total: 0, batch: 'ZERO-TOTAL-GROUP', description: '零總額合批乙', participant: false });
    await add('invoices', 'I-SUM-A', 1000, { total: 1050, batch: 'GROSS-SUM-GROUP', description: '含稅合計甲' });
    await add('invoices', 'I-SUM-B', 200, { total: 200, batch: 'GROSS-SUM-GROUP', description: '含稅合計乙', participant: false });
    await add('bills', 'B-A', 1000, { batch: 'BILL-GROUP', description: '照服員收費甲' });
    await add('bills', 'B-B', 250, { batch: 'BILL-GROUP', description: '照服員收費乙', participant: false });
    await add('bills', 'BD-A', '0.10', { batch: 'DECIMAL-GROUP', description: '零星合併甲' });
    await add('bills', 'BD-B', '0.20', { batch: 'DECIMAL-GROUP', description: '零星合併乙', participant: false });
    await add('bills', 'BN-A', '-3.30', { batch: 'NEGATIVE-GROUP', description: '退款合併甲' });
    await add('bills', 'BN-B', '0.30', { batch: 'NEGATIVE-GROUP', description: '退款合併乙', participant: false });
    await add('expense_requests', 'R-UNRELATED', 1250, { participant: false, description: '未參與的保密資料' });
    await add('expense_requests', 'R-OTHER-TENANT', 1250, { sourceTenant: otherTenant, description: '外法人獨有資料' });
    await add('expense_requests', 'R-PRODUCTION', 1250, { environment: 'production', description: '正式環境獨有資料' });
    await add('expense_requests', 'R-WRONG-SNAPSHOT-TENANT', 25, { snapshotTenant: otherTenant, description: '錯租戶快照' });
    await add('expense_requests', 'R-WRONG-SNAPSHOT-ENV', 25, { snapshotEnvironment: 'production', description: '錯環境快照' });
    for (const [table, batch] of [['invoices', 'INVOICE-GROUP'], ['bills', 'BILL-GROUP']]) {
      await add(table, table + '-FOREIGN-SIBLING', 9000, { sourceTenant: otherTenant, batch, description: '外法人同批資料' });
      await add(table, table + '-PROD-SIBLING', 8000, { environment: 'production', batch, description: '正式環境同批資料' });
    }
    await db.exec(`insert into public.expense_requests(id,no,tenant_id,amount,description,form_payload,department_code)
      select 'PAGE-'||lpad(n::text,4,'0'),'PAGE-'||lpad(n::text,4,'0'),'${tenant}',42,'跨頁查詢 自費活動',jsonb_build_object('nested',jsonb_build_array(jsonb_build_object('label','一般巢狀內容','grossAmount',42))),'D1' from generate_series(1,123) n;
      insert into public.approval_step_actor_snapshots(tenant_id,record_type,record_id,step_index,resolved_user_id,acted_by_user_id,acted_at_text,updated_at)
      select tenant_id,'expense_requests',id,0,'FICT-USER','FICT-USER','2026-09-14T02:00:00Z','2026-09-14T02:00:00Z' from public.expense_requests where id like 'PAGE-%';`);
    const oldDefinition = (await db.query('select pg_get_functiondef($1::regprocedure) value', [signature])).rows[0].value;
    const oldDefinitions = await functionDefinitions();
    const normalizationCases = [null, '', '自費照顧', '1,234,567', '1,23,456', '1234,567', '1,234,', ',1,234', '1,250元',
      'NT$ -1,234,567.500', 'NTD +1,250.00', '−1,250.50', '１２，５００．５０', '新臺幣　１，２５０元', 'TWD 000,001.00',
      'x1,250y', 'x,1,250y', '1,000 1,000 10,000 1,000', '1,250\t2,500\n3,750', '1,234, 5,678', '% _ + . -',
      Array.from({ length: 80 }, (_, n) => '自費第' + n + '項 NT$ ' + (n + 1) + ',250.50元 文具及接送費').join('；')];
    let randomState = 1450914;
    const random = maximum => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;return randomState % maximum; };
    const prefixes = ['', 'NT$ ', 'TWD ', '新臺幣', 'x', ',', '−', '+', '-'];
    const tokens = ['1,234,567', '1,23,456', '12,500.00', '1234,567', '1,250', '12.50', '0.00', '000,001', '１２，５００．５０'];
    const suffixes = ['', '元', ',56', 'x', '.00', '，備註', '\t', '\n'];
    for (let n = 0; n < 400; n++) normalizationCases.push(Array.from({ length: 1 + random(6) }, () => prefixes[random(prefixes.length)] + tokens[random(tokens.length)] + suffixes[random(suffixes.length)]).join(' '));
    const oldNormalized = await normalizeAll(normalizationCases);
    const oldAuthority = await catalog();
    const oldRelationNames = (await db.query("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p') order by n.nspname,c.relname")).rows;
    const beforeRows = await rowFingerprint();
    const oldPages = await allPages();
    const oldSearchCases = [null, '自費', '自費 九月', '自費 NT$ 1,250.00', '12.50', '-12.50', '12.00', '照服員收費 1250', '自費 1155', '零星合併 0.30', '退款合併 -3.00', '復能活動文具', '萬華自費明細.pdf', '不存在', '跨頁查詢'];
    const oldSearch = new Map();
    for (const query of oldSearchCases) oldSearch.set(query, await call(query));
    const oldSecondSearchPage = await call('跨頁查詢', 50, 50);
    const migration = read(migrationPath);
    await db.exec('begin;\n' + migration + '\nrollback;');
    assert.equal((await db.query('select pg_get_functiondef($1::regprocedure) value', [signature])).rows[0].value, oldDefinition);
    check('migration rollback restores the actual predecessor function');
    assert.deepEqual(await functionDefinitions(), oldDefinitions);check('migration rollback also restores every real normalization/search dependency');
    assert.equal((await db.query("select to_regprocedure('private.finance_history_search_fields_v1(jsonb)') value")).rows[0].value, null);
    check('rollback removes the new private projection helper');
    await db.exec('begin;\n' + migration + '\ncommit;');
    assert.deepEqual(await catalog(), oldAuthority);check('RPC owner, SECURITY DEFINER, stability, search_path and ACL are unchanged');
    assert.deepEqual((await db.query("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p') order by n.nspname,c.relname")).rows, oldRelationNames);check('migration does not add data tables');
    const helperAcl = (await db.query("select has_function_privilege('anon','private.finance_history_search_fields_v1(jsonb)','EXECUTE') a,has_function_privilege('authenticated','private.finance_history_search_fields_v1(jsonb)','EXECUTE') u,has_function_privilege('service_role','private.finance_history_search_fields_v1(jsonb)','EXECUTE') s")).rows[0];
    assert.deepEqual(helperAcl, { a: false, u: false, s: false });check('new transient projection helper is not exposed to API roles');
    assert.deepEqual(await allPages(), oldPages);check('every full source field, participant step, page count and ordering matches old RPC across all pages');
    for (const [query, expected] of oldSearch) { assert.deepEqual(await call(query), expected);check('old/new complete payload parity ' + JSON.stringify(query)); }
    assert.deepEqual(await call('跨頁查詢', 50, 50), oldSecondSearchPage);check('filtered second page preserves complete old payload');
    const keys = (await allPages('跨頁查詢')).flatMap(p => p.items.map(i => i.history_key));
    assert.equal(keys.length, 123);assert.equal(new Set(keys).size, 123);check('all 123 matched records remain reachable across page 1/2/3 without duplicates');
    const emptyPage = await call('跨頁查詢', 50, 1000);assert.equal(emptyPage.total, 123);assert.equal(emptyPage.items.length, 0);assert.equal(emptyPage.page.has_more, false);check('out-of-range page retains exact matching count');
    for (const query of ['自費 九月', '自費 NT$ 1,250.00', '九月 長照個案接送用途', '自費 １，２５０元', '巢狀商務備註 88.75', '萬華自費明細.pdf']) {
      assert.deepEqual(records(await call(query)), ['R-SELF']);check('business text, filename and multi-token amount query ' + query);
    }
    assert.equal((await call('萬華日間照顧課')).total, oldPages[0].total);check('department display name is searchable without rewriting source records');
    assert.equal((await call('外法人不得出現部門')).total, 0);check('same department code in another tenant cannot supply searchable name');
    assert.deepEqual(records(await call('照服員收費 1250')), ['B-A']);check('bill group total is searchable');
    assert.deepEqual(records(await call('自費 1155')), ['I-A']);check('invoice group total uses gross total including tax');
    assert.deepEqual(records(await call('零星合併 0.30')), ['BD-A']);check('decimal group sum 0.10 + 0.20 remains exactly searchable as 0.30');
    assert.deepEqual(records(await call('退款合併 -3.00')), ['BN-A']);assert.equal((await call('退款合併 3.00')).total, 0);check('negative decimal group sum retains sign and does not match positive amount');
    for (const [query, id] of [['自費 1050', 'I-A'], ['自費 105.00', 'I-A'], ['照服員收費 250', 'B-A']]) {
      const found = await call(query);assert.deepEqual(records(found), [id]);assert.equal(found.items[0].source_rows.length, 2);check('single-document amount returns the entire authorized group ' + query);
    }
    assert.deepEqual(records(await call('12.50')), ['R-DECIMAL']);check('decimal 12.50 does not match 1250 or negative 12.50');
    assert.deepEqual(records(await call('-12.50')), ['R-NEGATIVE']);check('negative decimal preserves sign');
    assert.equal((await call('12.00')).total, 0);check('decimal exact match does not use integer substring');
    assert.deepEqual(records(await call('零金額 0.00')), ['R-ZERO']);check('explicit zero is searchable');
    assert.deepEqual(records(await call('預算待補 99.75')), ['R-UNKNOWN']);assert.equal((await call('預算待補 0.00')).total, 0);check('known estimate is searchable and missing values do not invent zero');

    // Compare the current RPC with only its coarse prefilter removed. Both
    // execute the exact same projection, matcher, authority and hydration.
    // This catches false negatives even where legacy JSON search intentionally
    // differed (department labels or internal security metadata).
    const currentDefinition = (await db.query('select pg_get_functiondef($1::regprocedure) value', [signature])).rows[0].value;
    const prefilterStart = '  search_plain_terms as materialized (', prefilterEnd = '  search_fields as materialized (';
    const prefilterJoin = '    join search_candidate_keys candidate using(kind,record_type,group_key)';
    assert.equal(currentDefinition.split(prefilterStart).length, 2, 'Locate exactly one real prefilter start');
    assert.equal(currentDefinition.split(prefilterEnd).length, 2, 'Locate exactly one real field projection');
    assert.equal(currentDefinition.split(prefilterJoin).length, 2, 'Remove exactly one prefilter join');
    const start = currentDefinition.indexOf(prefilterStart), end = currentDefinition.indexOf(prefilterEnd, start);
    const prefilter = currentDefinition.slice(start, end);
    assert(prefilter.includes('search_coarse_groups as materialized (') && prefilter.includes('search_candidate_keys as materialized ('), 'All coarse-filter CTEs are removed together');
    const noPrefilterDefinition = (currentDefinition.slice(0, start) + currentDefinition.slice(end)).replace(prefilterJoin, '');
    const prefilterCases = [null, '', '自費', '月結甲 月結乙', '月結乙 萬華日間照顧課', '照服員收費甲 照服員收費乙',
      '1250', '0001250', '1155', '0.30', '-3.00', 'NT$1250', '自費 １，２５０元', 'a"b', 'a\\b', '😀', 'ＣＡＲＥ',
      '全形搜尋 ＡＬＰＨＡ', '123ABC', 'ＡＢＣ１２３', '特殊字元 71.23', '純文字金額 -00012.50', '純文字金額 +00012.500',
      '純文字金額 -000.500', '純文字金額 -0.00', '-00012.50', '+00012.500', '-000.500', '-0.00', '000.30',
      '純文字金額 −00012.50', '純文字金額 NT$ -00012.50', '精細金額 0.0001', '精細金額 -0.0001',
      '含稅合計 1250', '含稅合計 1050', '含稅合計 1000', '未給總額保留本金 91.25', '零總額合批 0.00',
      '零總額合批 1250', '12.00', '-12.50', '12.500', '50', '跨頁查詢', '不存在', 'metanotesecretvalue', '外法人獨有資料'];
    const unfilteredPayloads = new Map();
    try {
      await db.exec(noPrefilterDefinition);
      for (const query of prefilterCases) unfilteredPayloads.set(query, await call(query));
      unfilteredPayloads.set('second page', await call('跨頁查詢', 50, 50));
    } finally { await db.exec(currentDefinition); }
    for (const query of prefilterCases) {
      assert.deepEqual(await call(query), unfilteredPayloads.get(query), 'Coarse filter must not remove exact matches: ' + JSON.stringify(query));
      check('same-version prefilter on/off complete payload parity ' + JSON.stringify(query));
    }
    assert.deepEqual(await call('跨頁查詢', 50, 50), unfilteredPayloads.get('second page'));check('coarse filter preserves complete second page, total and has_more');
    for (const query of ['a"b', 'a\\b', '😀', 'ＣＡＲＥ', '全形搜尋 ＡＬＰＨＡ', '123ABC', 'ＡＢＣ１２３']) {
      assert.deepEqual(records(await call(query)), ['R-ESCAPES']);
    }
    check('JSON-escaped text, emoji and NFKC examples have actual positive matches');
    for (const [query, id] of [['月結甲 月結乙', 'I-A'], ['月結乙 萬華日間照顧課', 'I-A'], ['照服員收費甲 照服員收費乙', 'B-A'], ['含稅合計 1250', 'I-SUM-A']]) {
      const payload = await call(query);assert.deepEqual(records(payload), [id]);assert.equal(payload.items[0].source_rows.length, 2);
    }
    check('tokens spanning two batch members and department names retain both complete source documents');
    for (const [suffix, text] of [['NEG', '-00012.50'], ['PLUS', '+00012.500'], ['FRACTION', '-000.500'], ['ZERO', '-0.00']]) {
      assert.deepEqual(records(await call('純文字金額 ' + text)), ['R-TEXT-' + suffix]);
    }
    check('literal signed and leading-zero monetary text remains searchable without recanonicalizing the source');
    assert.deepEqual(records(await call('精細金額 0.0001')), ['R-SMALL']);
    assert.deepEqual(records(await call('精細金額 -0.0001')), ['R-SMALL-NEGATIVE']);
    check('small signed numeric amounts keep all decimal places through coarse filtering');
    assert.deepEqual(records(await call('未給總額保留本金 91.25')), ['I-FALLBACK']);
    assert.deepEqual(records(await call('零總額合批 0.00')), ['I-ZERO-A']);
    assert.equal((await call('零總額合批 1250')).total, 0);
    check('null invoice total falls back, but explicit zero group totals never become amount sums');
    assert.equal((await db.query('select pg_get_functiondef($1::regprocedure) value', [signature])).rows[0].value, currentDefinition);
    assert.deepEqual(await catalog(), oldAuthority);check('prefilter comparison restores the exact current RPC definition and privileges');
    for (const token of ['pathsecretvalue', 'contentsecretvalue', 'datasecretvalue', 'base64secretvalue', 'filesecretvalue', 'tokensecretvalue', 'metasecretvalue', 'metanotesecretvalue', 'deepmetasecretvalue', 'authnestedsecretvalue', 'auditsecretvalue', 'example.invalid/storage']) {
      assert.equal((await call(token)).total, 0);check('storage/binary/security material is not a search match: ' + token);
    }
    const whole = (await call('自費 九月')).items[0].source_row;
    assert.equal(whole.form_payload.attachments[0].url, 'https://example.invalid/storage/pathsecretvalue');assert.equal(whole.form_payload.attachments[0].base64, 'base64secretvalue');check('excluded searchable values remain intact in authorized full-document payload');
    for (const token of ['未參與的保密資料', '外法人獨有資料', '正式環境獨有資料', '錯租戶快照', '錯環境快照', '外法人同批資料', '正式環境同批資料']) {
      assert.equal((await call(token)).total, 0);check('scope excludes ' + token);
    }
    const sourceIds = (await allPages()).flatMap(p => p.items.flatMap(i => i.source_rows.map(r => r.id)));
    assert(!sourceIds.some(id => /FOREIGN-SIBLING|PROD-SIBLING|UNRELATED|OTHER-TENANT|PRODUCTION|WRONG-SNAPSHOT/.test(id)));check('hydration cannot leak foreign tenant/environment siblings or nonparticipant records');
    assert.deepEqual(records(await call('正式環境獨有資料', 50, 0, 'production')), ['R-PRODUCTION']);check('explicit production selection remains separate and retains its own authorized rows');
    const assigned = (await call('僅曾指派資料')).items[0];assert.notEqual(assigned.personally_acted, true);assert.equal(assigned.participation_label, '曾列入流程');check('assigned-only history is not relabelled a human approval');
    await db.exec('set role authenticated');assert.equal((await call('自費 九月')).total, 1);await db.exec('reset role');check('real authenticated database role can execute existing verified-member RPC');
    await db.exec('set role anon');await assert.rejects(() => call(), e => e.code === '42501');await db.exec('reset role');check('anon database role is denied');
    for (const [name, before, after] of [
      ['no authenticated identity', "set fixture.uid=''", `set fixture.uid='${authId}'`],
      ['unverified Google email', "set fixture.email=''", "set fixture.email='fiction@example.invalid'"],
      ['mismatched email binding', "set fixture.email='unrelated@example.invalid'", "set fixture.email='fiction@example.invalid'"],
      ['inactive Finance person', "update public.finance_users set active=false where id='FICT-USER'", "update public.finance_users set active=true where id='FICT-USER'"],
      ['inactive tenant membership', 'update public.tenant_members set active=false', 'update public.tenant_members set active=true']
    ]) { await db.exec(before);await assert.rejects(() => call(), e => e.code === '42501');await db.exec(after);check('actual authority rejects ' + name); }
    await db.query('insert into public.finance_users values($1,$2,$3,$4,true)', ['AMBIGUOUS-USER', otherTenant, authId, 'fiction@example.invalid']);
    await db.query('insert into public.tenant_members values($1,$2,$3,true)', [otherTenant, 'AMBIGUOUS-USER', authId]);
    await assert.rejects(() => call(), e => e.code === '42501');check('same identity bound to two tenants is rejected rather than guessed');
    await db.exec("delete from public.tenant_members where finance_user_id='AMBIGUOUS-USER';delete from public.finance_users where id='AMBIGUOUS-USER'");
    for (const args of [[null, 0, 0], [null, 51, 0], [null, 50, -1], [null, 50, 0, 'other'], ['x'.repeat(121)]]) { await assert.rejects(() => call(...args), e => e.code === '22023');check('existing RPC input boundary ' + JSON.stringify(args)); }
    await db.exec("set fixture.uid=''");
    for (const filename of ['finance_amount_search_postflight.sql', 'finance_approval_history_postflight.sql', 'finance_approval_search_postflight.sql']) {
      await db.exec(read('scripts/' + filename).replace(/^\\set ON_ERROR_STOP on\r?\n/, ''));
      check('actual read-only installation contract passes: ' + filename);
    }
    const beforeCanary = await rowFingerprint();
    const canaryResults = await db.exec(read('scripts/finance_approval_search_canary.sql'));
    const canary = canaryResults.flatMap(result => result.rows || []).find(row => row.approval_search_canary_result)?.approval_search_canary_result;
    assert.deepEqual(canary, { canary: 'readonly_approval_search_v1', ok: true, rolled_back: true, participant_scope_preserved: true });
    assert.deepEqual(await rowFingerprint(), beforeCanary);check('exact read-only release canary runs with absent identity and preserves every source row');
    await db.exec(`set fixture.uid='${authId}'`);
    assert.deepEqual(await rowFingerprint(), beforeRows);check('all read/search/authority probes leave exact source and participant rows unchanged');
    assert.deepEqual(await normalizeAll(normalizationCases), oldNormalized);check('actual old/new normalizers agree on ' + normalizationCases.length + ' seeded random, malformed grouping, long text, signs, decimal and NFKC inputs');

    // One bounded old/new search measurement, not dozens of giant-payload probes.
    await db.exec(`insert into public.expense_requests(id,no,tenant_id,amount,description,form_payload,department_code)
      select 'PERF-'||lpad(n::text,4,'0'),'PERF-'||lpad(n::text,4,'0'),'${tenant}',42,'效能樣本 自費活動',
      jsonb_build_object('attachments',jsonb_build_array(jsonb_build_object('name','虛構憑證.pdf','base64',repeat('z',19000))),
       'nested',jsonb_build_array(jsonb_build_object('label','普通巢狀數值','grossAmount',42))),'D1' from generate_series(1,550) n;
      insert into public.approval_step_actor_snapshots(tenant_id,record_type,record_id,step_index,resolved_user_id,acted_by_user_id,acted_at_text,updated_at)
      select tenant_id,'expense_requests',id,0,'FICT-USER','FICT-USER','2026-09-14T03:00:00Z','2026-09-14T03:00:00Z' from public.expense_requests where id like 'PERF-%';`);
    const newDefinitions = await functionDefinitions();
    await db.exec(oldDefinitions.map(p => p.definition).join(';\n'));
    const beforeStart = performance.now(), oldLarge = await call('效能樣本', 50, 50), beforeMs = performance.now() - beforeStart;
    await db.exec(newDefinitions.map(p => p.definition).join(';\n'));
    const afterStart = performance.now(), newLarge = await call('效能樣本', 50, 50), afterMs = performance.now() - afterStart;
    assert.deepEqual(newLarge, oldLarge);assert.equal(newLarge.total, 550);check('550 × 19KB attachment search keeps exact old/new complete second-page payload');
    console.log('BENCH ' + JSON.stringify({ documents: 550, attachmentBytesEach: 19000, beforeMs, afterMs, speedup: beforeMs / afterMs, note: 'Local PGlite synthetic measurement; not a production latency guarantee.' }));
    assert(afterMs < beforeMs, 'Projection should reduce the same large-attachment search workload');check('business projection reduces work on the same large-attachment fixture');
    console.log('Approval search projection: ' + checks + ' actual PostgreSQL checks passed.');
  } finally { await db.close(); }
}
if (require.main === module) runTests().catch(error => { console.error({ message: error.message, code: error.code, where: error.where, stack: error.stack });process.exitCode = 1; });
