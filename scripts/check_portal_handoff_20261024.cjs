'use strict';
// Portal -> Finance handoff route. All identities, keys and HTTP are fictional
// and intercepted; no network, Auth project or employee session is touched.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHandoffHandler, verifyHandoff } = require('../server/portal-handoff-core.js');

const root = path.resolve(__dirname, '..');
const secret = 'f'.repeat(48);
const now = 1_792_856_800;
const userId = '11111111-1111-4111-8111-111111111111';
const email = 'fictional.member@suiyuecare.com';
const projectUrl = 'https://abcdefghijklmnopqrst.supabase.co';
const environment = {
  FINANCE_PORTAL_SIGNING_SECRET: secret,
  FINANCE_SUPABASE_URL: projectUrl,
  FINANCE_SUPABASE_ANON_KEY: 'sb_publishable_fictionalpublishablekey',
  FINANCE_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fictionalservicekey'
};
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

function sign(claims, key = secret) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return { payload, signature: crypto.createHmac('sha256', key).update(payload).digest('base64url') };
}
function claims(overrides = {}) {
  return {
    email, iat: now, exp: now + 60, jti: '22222222-2222-4222-8222-222222222222',
    aud: 'accounting', source: 'logging-portal', googleSubject: 'fictional-google-subject', ...overrides
  };
}
const session = {
  access_token: 'fictional-access-token', refresh_token: 'fictional-refresh-token', token_type: 'bearer',
  expires_in: 3600, expires_at: now + 3600,
  user: { id: userId, email, app_metadata: { provider: 'google', providers: ['google'] },
    identities: [{ provider: 'google', identity_data: { email, email_verified: true, sub: 'fictional-google-subject' } }] }
};

function upstream(overrides = {}) {
  const calls = [];
  const responses = {
    '/rest/v1/rpc/finance_portal_handoff_consume': [200, { userId, authEmail: email }],
    '/auth/v1/admin/generate_link': [200, { id: userId, hashed_token: 'fictional-hashed-token', verification_type: 'magiclink' }],
    '/auth/v1/verify': [200, session],
    '/rest/v1/rpc/portal_session_status': [200, { active: true, userId }],
    '/rest/v1/rpc/finance_portal_handoff_finalize': [200, true],
    '/auth/v1/logout': [204, null],
    ...overrides
  };
  const fetchImplementation = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, projectUrl, 'only the configured Finance project is called');
    assert.equal(init.redirect, 'error');
    calls.push({ path: url.pathname, search: url.search, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const [status, body] = responses[url.pathname] || [404, null];
    return new Response(body === null ? null : JSON.stringify(body), { status });
  };
  return { calls, fetchImplementation };
}

function recorder() {
  const headers = {};
  return { statusCode: 0, body: '', headers, setHeader(k, v) { headers[k.toLowerCase()] = String(v); }, end(value = '') { this.body = String(value); } };
}

async function invoke({ body = sign(claims()), origin = 'https://login.suiyuecare.com', method = 'POST', env = environment, responses } = {}) {
  const { calls, fetchImplementation } = upstream(responses);
  const records = [];
  const handler = createHandoffHandler({
    environment: env, fetchImplementation, now: () => now,
    randomBytes: (n) => Buffer.alloc(n, 7), diagnostics: (record) => records.push(record)
  });
  const res = recorder();
  await handler({ method, headers: origin ? { origin, 'content-type': 'application/x-www-form-urlencoded' } : {}, body }, res);
  return { res, calls, records };
}

function runSessionDocument(html) {
  const script = html.match(/<script nonce="([^"]+)">([\s\S]*?)<\/script>/);
  assert.ok(script, 'session page carries one nonce script');
  const store = new Map();
  const replaced = [];
  vm.runInNewContext(script[2], {
    localStorage: { setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    location: { replace: (to) => replaced.push(to) },
    document: { querySelector: () => ({ textContent: '' }) }
  }, { timeout: 1000 });
  return { nonce: script[1], store, replaced };
}

(async () => {
  // Success: exact call order, sealed storage keys and no lingering secrets.
  {
    const { res, calls, records } = await invoke({ body: new URLSearchParams(sign(claims())).toString() });
    eq(res.statusCode, 200);
    eq(calls.map((c) => c.path), ['/rest/v1/rpc/finance_portal_handoff_consume', '/auth/v1/admin/generate_link', '/auth/v1/verify',
      '/rest/v1/rpc/portal_session_status', '/rest/v1/rpc/finance_portal_handoff_finalize']);
    eq(calls[0].body, { payload: claims() }, 'only verified claims reach the consume RPC');
    eq(calls[1].body, { type: 'magiclink', email }, 'magic link uses the Auth email returned by Finance');
    eq(calls[2].body, { type: 'magiclink', token_hash: 'fictional-hashed-token' });
    eq(calls[0].headers.Authorization, undefined, 'opaque secret keys authenticate through apikey only');
    eq(calls[0].headers.apikey, environment.FINANCE_SUPABASE_SERVICE_ROLE_KEY);
    eq(calls[2].headers.apikey, environment.FINANCE_SUPABASE_ANON_KEY, 'the OTP exchange never uses the service key');
    eq(calls[3].headers.Authorization, 'Bearer fictional-access-token', 'session status runs as the new Finance session');
    eq(calls[4].body, { payload: { jti: claims().jti, userId } });
    eq(records, []);
    eq(res.headers['cache-control'], 'no-store, max-age=0');
    eq(res.headers['referrer-policy'], 'no-referrer');
    const page = runSessionDocument(res.body);
    ok(res.headers['content-security-policy'].includes(`'nonce-${page.nonce}'`), 'CSP allows only this page script');
    eq(JSON.parse(page.store.get('suiyuecare-finance-auth-v3')), session, 'complete supabase-js session is stored');
    eq(page.store.get('suiyuecare.finance.portalEmail'), email, 'stale portal account hints are replaced by this person');
    eq(page.store.get('suiyuecare.finance.portalEmailAt'), String(now * 1000));
    eq(page.replaced, ['/']);
    ok(!res.body.includes(secret) && !res.body.includes('sb_secret_'), 'no secret reaches the browser');
  }

  // A legacy JWT service key also sends Authorization; Buffer bodies parse.
  {
    const legacy = { ...environment, FINANCE_SUPABASE_SERVICE_ROLE_KEY: 'eyJfictional.legacy.service' };
    const { res, calls } = await invoke({ env: legacy, body: Buffer.from(new URLSearchParams(sign(claims())).toString()) });
    eq(res.statusCode, 200);
    eq(calls[0].headers.Authorization, 'Bearer eyJfictional.legacy.service');
  }

  // HTML context cannot be broken by session contents.
  {
    const hostile = { ...session, user: { ...session.user, user_metadata: { name: '</script><script>alert(1)</script>&' } } };
    const { res } = await invoke({ responses: { '/auth/v1/verify': [200, hostile] } });
    eq(res.statusCode, 200);
    eq((res.body.match(/<\/script>/g) || []).length, 1, 'only the page script closes');
    eq(JSON.parse(runSessionDocument(res.body).store.get('suiyuecare-finance-auth-v3')).user.user_metadata.name, hostile.user.user_metadata.name);
  }

  // Requests rejected before any upstream call.
  for (const [label, options, status] of [
    ['wrong method', { method: 'GET' }, 405],
    ['missing origin', { origin: '' }, 403],
    ['foreign origin', { origin: 'https://suiyuecare-website.vercel.app' }, 403],
    ['wrong secret', { body: sign(claims(), 'x'.repeat(48)) }, 403],
    ['wrong audience', { body: sign(claims({ aud: 'hr' })) }, 403],
    ['wrong source', { body: sign(claims({ source: 'other' })) }, 403],
    ['expired', { body: sign(claims({ iat: now - 120, exp: now - 60 })) }, 403],
    ['long lived', { body: sign(claims({ exp: now + 61 })) }, 403],
    ['future', { body: sign(claims({ iat: now + 30, exp: now + 60 })) }, 403],
    ['foreign domain', { body: sign(claims({ email: 'someone@example.com' })) }, 403],
    ['uppercase email', { body: sign(claims({ email: email.toUpperCase() })) }, 403],
    ['missing Google subject', { body: sign(claims({ googleSubject: '' })) }, 403],
    ['bad jti', { body: sign(claims({ jti: 'not-a-uuid' })) }, 403],
    ['tampered payload', { body: { ...sign(claims()), payload: sign(claims({ email: 'other@suiyuecare.com' })).payload } }, 403],
    ['missing secret', { env: { ...environment, FINANCE_PORTAL_SIGNING_SECRET: 'short' } }, 503],
    ['missing service key', { env: { ...environment, FINANCE_SUPABASE_SERVICE_ROLE_KEY: '' } }, 503],
    ['secret key used as browser key', { env: { ...environment, FINANCE_SUPABASE_ANON_KEY: 'sb_secret_wrong' } }, 503],
    ['non-project URL', { env: { ...environment, FINANCE_SUPABASE_URL: 'https://evil.example' } }, 503]
  ]) {
    const { res, calls, records } = await invoke(options);
    eq(res.statusCode, status, label);
    eq(calls.length, 0, `${label}: no upstream call`);
    if (status !== 405) {
      ok(res.body.includes('登入未完成') && !res.body.includes('<script'), `${label}: fixed failure page`);
      const logged = JSON.stringify(records);
      ok(!logged.includes(email) && !logged.includes(secret) && !logged.includes('payload'), `${label}: no identity or secret logged`);
    }
  }

  // Finance denies (inactive, unbound, replay, revoked): no session is minted.
  for (const status of [400, 403]) {
    const { res, calls } = await invoke({ responses: { '/rest/v1/rpc/finance_portal_handoff_consume': [status, { code: '42501', message: 'FINANCE_PORTAL_HANDOFF_REPLAY' }] } });
    eq(res.statusCode, 403);
    eq(calls.map((c) => c.path), ['/rest/v1/rpc/finance_portal_handoff_consume']);
  }
  for (const status of [401, 404, 500]) {
    const { res } = await invoke({ responses: { '/rest/v1/rpc/finance_portal_handoff_consume': [status, null] } });
    eq(res.statusCode, 503, `consume ${status} is a service failure`);
  }

  // A link for another user is never exchanged.
  {
    const { res, calls } = await invoke({ responses: { '/auth/v1/admin/generate_link': [200, { id: '33333333-3333-4333-8333-333333333333', hashed_token: 'x' }] } });
    eq(res.statusCode, 503);
    eq(calls.some((c) => c.path === '/auth/v1/verify'), false);
  }

  // Any failure after a session exists revokes that session locally.
  for (const [label, responses, status] of [
    ['verify returned another user', { '/auth/v1/verify': [200, { ...session, user: { id: '33333333-3333-4333-8333-333333333333' } }] }, 503],
    ['session is not a Finance identity', { '/rest/v1/rpc/portal_session_status': [400, { code: '42501' }] }, 403],
    ['session status for another user', { '/rest/v1/rpc/portal_session_status': [200, { active: true, userId: '33333333-3333-4333-8333-333333333333' }] }, 403],
    ['logout during exchange', { '/rest/v1/rpc/finance_portal_handoff_finalize': [200, false] }, 403]
  ]) {
    const { res, calls } = await invoke({ responses });
    eq(res.statusCode, status, label);
    const logout = calls.find((c) => c.path === '/auth/v1/logout');
    ok(logout && logout.search === '?scope=local' && logout.headers.Authorization === 'Bearer fictional-access-token', `${label}: minted session revoked`);
    ok(!res.body.includes('fictional-access-token'), `${label}: no session delivered`);
  }

  // Missing expires_at is derived; missing both is rejected.
  {
    const { expires_at: _drop, ...noAt } = session;
    const { res } = await invoke({ responses: { '/auth/v1/verify': [200, noAt] } });
    eq(JSON.parse(runSessionDocument(res.body).store.get('suiyuecare-finance-auth-v3')).expires_at, now + 3600);
    const { expires_in: _alsoDrop, ...neither } = noAt;
    eq((await invoke({ responses: { '/auth/v1/verify': [200, neither] } })).res.statusCode, 503);
  }

  // Pure verifier is strict about canonical encoding.
  assert.throws(() => verifyHandoff(sign(claims()).payload + '=', sign(claims()).signature, secret, now), /invalid/); checks++;
  eq(verifyHandoff(sign(claims()).payload, sign(claims()).signature, secret, now).email, email);

  // Deployment contract: route wrapper, no browser exposure of server keys.
  const route = fs.readFileSync(path.join(root, 'api/auth/handoff.js'), 'utf8');
  ok(route.includes("require('../../server/portal-handoff-core.js').createHandoffHandler()"), 'route uses the reviewed handler');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  ok(!html.includes('FINANCE_SUPABASE_SERVICE_ROLE_KEY') && !html.includes('FINANCE_PORTAL_SIGNING_SECRET'), 'server secrets never enter index.html');
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  ok(vercel.headers.some((rule) => rule.source === '/api/(.*)' && rule.headers.some((h) => h.key === 'Cache-Control' && /no-store/.test(h.value))), 'API responses are never cached');

  console.log(JSON.stringify({ verified: true, checks, networkUsed: false, productionTouched: false }));
})().catch((error) => { console.error(error); process.exit(1); });
