import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createSummaryHandler, projectSummary, boundedText } from '../supabase/functions/daycare-store-finance-summary/core.mjs';
import { createFinanceRpc } from '../supabase/functions/daycare-store-finance-summary/adapter.mjs';

const requestId = '00000000-0000-4000-8000-000000000001';
const org = '00000000-0000-4000-8000-000000000002';
const branch = '00000000-0000-4000-8000-000000000003';
const binding = '00000000-0000-4000-8000-000000000004';
const token = '1234567890abcdef'.repeat(4); // Synthetic test token only.
const time = Date.parse('2026-09-12T00:00:00.000Z');
const config = { FINANCE_DAYCARE_SUMMARY_TOKEN: token, FINANCE_DAYCARE_SUMMARY_BINDING_ID: binding,
  FINANCE_DAYCARE_SUMMARY_TOKEN_EXPIRES_AT: '2026-09-13T00:00:00.000Z' };
const input = { request_id: requestId, organization_id: org, branch_id: branch, month: '2026-09' };
const summary = { status: 'ready', organization_id: org, branch_id: branch, month: '2026-09',
  binding_id: binding, entity_id: 'E6', department_code: 'J1101',
  scope_basis: 'department_direct_only', entity_name: '測試店', currency: 'TWD', basis: 'finance_pnl_ledger',
  income: '125.25', expenses: '-5.50', entry_count: 4, generated_at: '2026-09-12T00:00:00+00:00' };
const base = 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/functions/v1/daycare-store-finance-summary';
function request(body = input, headers = {}, url = base) {
  return new Request(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
function handler(overrides = {}) {
  const calls = [];
  const handle = createSummaryHandler({ env: name => config[name], now: () => time, randomUUID: () => requestId,
    rpc: async payload => { calls.push(payload); return summary; }, ...overrides });
  return { handle, calls };
}

test('valid request returns only immutable contract projection; token and entity never enter request RPC params', async () => {
  const { handle, calls } = handler();
  const response = await handle(request());
  assert.equal(response.status, 200);
  const output = await response.json();
  assert.deepEqual(output, { ...summary, request_id: requestId, generated_at: '2026-09-12T00:00:00.000Z' });
  assert.deepEqual(calls, [{ p_binding_id: binding, p_organization_id: org, p_branch_id: branch, p_month: '2026-09' }]);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

for (const [name, custom, status] of [
  ['no authorization', { authorization: '' }, 401], ['wrong token', { authorization: `Bearer ${'b'.repeat(64)}` }, 401],
  ['wrong length', { authorization: 'Bearer short' }, 401], ['browser Origin', { origin: 'https://daycare.invalid' }, 403],
  ['browser metadata', { 'sec-fetch-site': 'same-origin' }, 403], ['compressed', { 'content-encoding': 'gzip' }, 415],
  ['wrong MIME', { 'content-type': 'text/plain' }, 415], ['large declared body', { 'content-length': '5000' }, 413],
]) test(`reject ${name} before database`, async () => {
  const { handle, calls } = handler();
  assert.equal((await handle(request(input, custom))).status, status);
  assert.equal(calls.length, 0);
});

for (const [name, body] of [
  ['extra entity', { ...input, entity_id: 'OTHER' }], ['invalid month', { ...input, month: '2026-13' }],
  ['old month', { ...input, month: '1999-12' }], ['late month', { ...input, month: '2201-01' }],
  ['coerced month', { ...input, month: ['2026-09'] }], ['missing branch', { ...input, branch_id: undefined }],
  ['nonobject', []], ['null', null],
]) test(`reject ${name} body`, async () => {
  const { handle, calls } = handler();
  assert.equal((await handle(request(body))).status, 400); assert.equal(calls.length, 0);
});

test('all query strings and methods other than POST rejected', async () => {
  const { handle, calls } = handler();
  assert.equal((await handle(request(input, {}, `${base}?token=not-a-secret`))).status, 403);
  assert.equal((await handle(new Request(base, { method: 'OPTIONS' }))).status, 405);
  assert.equal(calls.length, 0);
});
test('actual streamed size checked independent of missing content-length', async () => {
  const { handle, calls } = handler();
  assert.equal((await handle(request({ ...input, extra: 'x'.repeat(4096) }))).status, 413);
  assert.equal(calls.length, 0);
});
test('invalid UTF8 rejected without raw content', async () => {
  const { handle } = handler();
  const response = await handle(new Request(base, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: new Uint8Array([255]) }));
  assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'INVALID_REQUEST');
});
test('expired or missing configuration fails closed', async () => {
  for (const env of [() => '', name => name === 'FINANCE_DAYCARE_SUMMARY_TOKEN_EXPIRES_AT' ? '2026-09-11T00:00:00.000Z' : config[name]]) {
    const { handle, calls } = handler({ env }); assert.equal((await handle(request())).status, 503); assert.equal(calls.length, 0);
  }
});
for (const [field, value] of Object.entries({ organization_id: branch, branch_id: org, month: '2026-08',
  binding_id: branch, department_code: 'E6', scope_basis: 'verified_whole_entity',
  income: 123, expenses: '1e5', entry_count: -1, basis: 'posted_ledger', currency: 'USD', entity_name: 'bad\nname',
  generated_at: '2026-09-10T00:00:00Z' })) test(`invalid or cross-scope response ${field} blocked`, () => {
  assert.throws(() => projectSummary({ ...summary, [field]: value }, input, binding, time));
});
test('legacy whole-entity response cannot impersonate the approved department', () => {
  assert.throws(() => projectSummary({ ...summary, scope_basis: 'verified_whole_entity' }, input, binding, time));
  assert.throws(() => projectSummary({ ...summary, department_code: undefined }, input, binding, time));
  assert.throws(() => projectSummary({ ...summary, binding_id: undefined }, input, binding, time));
});
test('negative corrections/real zeros preserved, unknown payload fields never forwarded', () => {
  const output = projectSummary({ ...summary, income: '-0.25', expenses: '0.00', private_details: 'must not escape' }, input, binding, time);
  assert.equal(output.income, '-0.25'); assert.equal(output.expenses, '0.00'); assert.equal(output.private_details, undefined);
});
test('raw downstream exceptions and bodies not reflected', async () => {
  const { handle } = handler({ rpc: async () => { throw new Error('secret and personal data'); } });
  const response = await handle(request());
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /secret|personal/);
});
test('per-isolate concurrency boundary and release', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const { handle } = handler({ rpc: async () => { await waiting; return summary; } });
  const one = handle(request()), two = handle(request());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await handle(request())).status, 429);
  release(); assert.equal((await one).status, 200); assert.equal((await two).status, 200);
  assert.equal((await handle(request())).status, 200);
});
test('per-isolate rate bound at 30 per minute', async () => {
  const { handle } = handler();
  for (let n = 0; n < 30; n++) assert.equal((await handle(request())).status, 200);
  assert.equal((await handle(request())).status, 429);
});
test('body read abort enforced', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => boundedText(new Response('x').body, 100, controller.signal), { code: 'FINANCE_TIMEOUT' });
});
test('RPC adapter posts exactly one bounded call to fixed project and sanitizes output', async () => {
  let call;
  const rpc = createFinanceRpc({ env: name => ({ SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-jwt' })[name],
    fetchImpl: async (...args) => { call = args; return Response.json(summary); } });
  assert.deepEqual(await rpc({ p_month: '2026-09' }, new AbortController().signal), summary);
  assert.equal(call[0], 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/rest/v1/rpc/finance_daycare_store_summary_v1');
  assert.equal(call[1].redirect, 'error'); assert.equal(call[1].headers.Authorization, 'Bearer synthetic-jwt');
  assert.deepEqual(JSON.parse(call[1].body), { p_month: '2026-09' });
});
test('actual Node fetch automatic sec-fetch-mode:cors works through loopback HTTP into handler', async () => {
  const { handle, calls } = handler();
  let observedMode;
  const server = createServer(async (incoming, outgoing) => {
    observedMode = incoming.headers['sec-fetch-mode'];
    const response = await handle(new Request(`http://127.0.0.1${incoming.url}`, {
      method: incoming.method, headers: incoming.headers, body: incoming, duplex: 'half',
    }));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(await response.text());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/functions/v1/daycare-store-finance-summary`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
    assert.equal(observedMode, 'cors'); assert.equal(response.status, 200);
    assert.equal((await response.json()).request_id, requestId); assert.equal(calls.length, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('opaque keys only use apikey; unsafe configured origin rejected before fetch', async () => {
  let calls = 0;
  for (const url of ['http://example.com', 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co@evil.invalid', 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co?x=1']) {
    const rpc = createFinanceRpc({ env: name => name === 'SUPABASE_URL' ? url : 'test', fetchImpl: () => { calls++; } });
    await assert.rejects(() => rpc({}, new AbortController().signal));
  }
  assert.equal(calls, 0);
  const rpc = createFinanceRpc({ env: name => ({ SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co', SUPABASE_SECRET_KEYS: '{"default":"sb_secret_synthetic"}' })[name],
    fetchImpl: async (_, options) => { assert.equal(options.headers.Authorization, undefined); return Response.json(summary); } });
  await rpc({}, new AbortController().signal);
});
test('upstream oversized response or private error text is never forwarded', async () => {
  for (const response of [new Response('secret', { status: 500 }), Response.json({ private_data: 'x'.repeat(16385) }), new Response('private data'), new Response(null, { headers: { 'content-type': 'application/json' } })]) {
    const rpc = createFinanceRpc({ env: name => ({ SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic' })[name], fetchImpl: async () => response });
    await assert.rejects(() => rpc({}, new AbortController().signal), error => error.status === 503 && !/secret|private/.test(error.message));
  }
});
