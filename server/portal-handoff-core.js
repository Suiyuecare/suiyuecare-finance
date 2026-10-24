'use strict';

// Portal -> Finance single sign-on receiver. Dependency-free: Node 22 fetch
// and node:crypto only. The Portal proves who the person is; Finance alone
// decides whether that person may enter Finance.
const crypto = require('node:crypto');

const PORTAL_ORIGIN = 'https://login.suiyuecare.com';
const PORTAL_HOME = 'https://login.suiyuecare.com/portal/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTH_STORAGE_KEY = 'suiyuecare-finance-auth-v3';
const PORTAL_EMAIL_KEY = 'suiyuecare.finance.portalEmail';
const PORTAL_EMAIL_AT_KEY = 'suiyuecare.finance.portalEmailAt';
const PORTAL_OAUTH_PENDING_KEY = 'suiyuecare.finance.portalOauthPending';
const PORTAL_OAUTH_MODE_KEY = 'suiyuecare.finance.portalOauthMode';
const REQUEST_TIMEOUT_MS = 12000;

class HandoffError extends Error {
  constructor(code, status = 403, reason = 'none') {
    super(code);
    this.code = code;
    this.status = status;
    this.reason = reason;
  }
}

function verifyHandoff(payload, signature, secret, now = Math.floor(Date.now() / 1000)) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) throw new HandoffError('configuration', 503);
  if (typeof payload !== 'string' || payload.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(payload)
    || typeof signature !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
    throw new HandoffError('invalid', 403, 'shape');
  }
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new HandoffError('invalid', 403, 'signature');
  }
  let value;
  try {
    const raw = Buffer.from(payload, 'base64url');
    if (raw.toString('base64url') !== payload) throw new Error('non-canonical');
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    throw new HandoffError('invalid', 403, 'encoding');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.aud !== 'accounting' || value.source !== 'logging-portal'
    || typeof value.jti !== 'string' || !UUID.test(value.jti)
    || !Number.isSafeInteger(value.iat) || !Number.isSafeInteger(value.exp)
    || value.exp <= value.iat || value.exp - value.iat > 60
    || value.exp <= now || value.iat > now + 5 || value.iat < now - 65
    || typeof value.googleSubject !== 'string' || !value.googleSubject || value.googleSubject.length > 256
    || typeof value.email !== 'string' || value.email !== value.email.trim().toLowerCase()
    || value.email.length > 254 || !/^[^\s@]+@suiyuecare\.com$/.test(value.email)) {
    throw new HandoffError('invalid', 403, 'claims');
  }
  return {
    aud: 'accounting', source: 'logging-portal', jti: value.jti, iat: value.iat, exp: value.exp,
    email: value.email, googleSubject: value.googleSubject
  };
}

function resolveConfiguration(environment) {
  const url = String(environment.FINANCE_SUPABASE_URL || '').trim();
  const publicKey = String(environment.FINANCE_SUPABASE_ANON_KEY || '').trim();
  const serviceKey = String(environment.FINANCE_SUPABASE_SERVICE_ROLE_KEY || '').trim();
  let origin = '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && /^[a-z0-9]{20}\.supabase\.co$/.test(parsed.hostname)
      && !parsed.username && !parsed.password && (parsed.pathname === '/' || !parsed.pathname) && !parsed.search && !parsed.hash) {
      origin = parsed.origin;
    }
  } catch { /* fall through to the configuration failure */ }
  if (!origin || !publicKey || !serviceKey || /^sb_secret_/i.test(publicKey) || serviceKey === publicKey) {
    throw new HandoffError('configuration', 503);
  }
  return { origin, publicKey, serviceKey };
}

// Opaque sb_secret keys authenticate through apikey alone; legacy JWT keys
// additionally require the Authorization header.
function keyHeaders(key, bearer = '') {
  const headers = { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  else if (!key.startsWith('sb_secret_') && !key.startsWith('sb_publishable_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function upstreamCode(body) {
  const code = body && (body.code || body.error_code || body.error);
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(code) ? code : 'none';
}

function sessionDocument(session, email, nonce, issuedAtMs) {
  // No credential enters a URL, log, referrer, browser history or the Portal.
  const escape = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const stored = escape(JSON.stringify(session));
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>進入會計系統</title><body><p role="status">正在進入會計系統…</p><script nonce="${nonce}">try{localStorage.setItem(${escape(AUTH_STORAGE_KEY)},${stored});localStorage.setItem(${escape(PORTAL_EMAIL_KEY)},${escape(email)});localStorage.setItem(${escape(PORTAL_EMAIL_AT_KEY)},${escape(String(issuedAtMs))});localStorage.removeItem(${escape(PORTAL_OAUTH_PENDING_KEY)});localStorage.removeItem(${escape(PORTAL_OAUTH_MODE_KEY)});location.replace('/');}catch(e){document.querySelector('[role=status]').textContent='瀏覽器儲存功能無法使用，請開啟儲存權限後重試。';}</script></body></html>`;
}

const failureDocument = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登入未完成</title><body><h1>登入未完成</h1><p>登入連結已失效、帳號未開通或服務暫時無法使用。請回模組頁重新進入；仍無法使用時請聯絡會計課。</p><a href="${PORTAL_HOME}">回模組頁</a></body></html>`;

function createHandoffHandler({
  environment = process.env,
  fetchImplementation = (...args) => fetch(...args),
  now = () => Math.floor(Date.now() / 1000),
  randomBytes = (size) => crypto.randomBytes(size),
  diagnostics = (record) => console.warn('finance-handoff-rejected', JSON.stringify(record))
} = {}) {
  return async function handler(req, res) {
    const nonce = randomBytes(24).toString('base64');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.statusCode = 405;
      res.end();
      return;
    }
    let stage = 'origin';
    let upstream = 'none';
    let mintedToken = '';
    let config = null;
    const call = async (path, init) => {
      const response = await fetchImplementation(`${config.origin}${path}`, {
        ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      const body = await response.json().catch(() => null);
      return { status: response.status, ok: response.ok, body };
    };
    try {
      if (req.headers?.origin !== PORTAL_ORIGIN) throw new HandoffError('origin');
      stage = 'body';
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
      const body = typeof rawBody === 'string' ? Object.fromEntries(new URLSearchParams(rawBody)) : rawBody;
      stage = 'assertion';
      const claims = verifyHandoff(body?.payload, body?.signature, environment.FINANCE_PORTAL_SIGNING_SECRET, now());
      stage = 'configuration';
      config = resolveConfiguration(environment);
      stage = 'consume';
      const target = await call('/rest/v1/rpc/finance_portal_handoff_consume', {
        method: 'POST', headers: keyHeaders(config.serviceKey), body: JSON.stringify({ payload: claims })
      });
      upstream = upstreamCode(target.body);
      // A rejected backend credential or a missing RPC is a service failure,
      // not an employee permission denial. Both paths stay closed.
      if (target.status === 401 || target.status === 404 || target.status >= 500) throw new HandoffError('configuration', 503);
      const userId = target.body?.userId;
      const authEmail = target.body?.authEmail;
      if (!target.ok || typeof userId !== 'string' || !UUID.test(userId)
        || typeof authEmail !== 'string' || !authEmail || authEmail.length > 254) {
        throw new HandoffError('permission');
      }
      stage = 'exchange-link';
      const link = await call('/auth/v1/admin/generate_link', {
        method: 'POST', headers: keyHeaders(config.serviceKey), body: JSON.stringify({ type: 'magiclink', email: authEmail })
      });
      upstream = upstreamCode(link.body);
      const linkUserId = link.body?.id || link.body?.user?.id;
      const hashedToken = link.body?.hashed_token || link.body?.properties?.hashed_token;
      if (!link.ok || linkUserId !== userId || typeof hashedToken !== 'string' || !hashedToken) {
        throw new HandoffError('exchange', 503);
      }
      stage = 'exchange-otp';
      const verified = await call('/auth/v1/verify', {
        method: 'POST', headers: keyHeaders(config.publicKey), body: JSON.stringify({ type: 'magiclink', token_hash: hashedToken })
      });
      upstream = upstreamCode(verified.body);
      const session = verified.body;
      if (typeof session?.access_token === 'string' && session.access_token) mintedToken = session.access_token;
      if (!verified.ok || !mintedToken || typeof session.refresh_token !== 'string' || !session.refresh_token
        || session.user?.id !== userId) {
        throw new HandoffError('exchange', 503);
      }
      if (!Number.isSafeInteger(session.expires_at)) {
        if (!Number.isSafeInteger(session.expires_in)) throw new HandoffError('exchange', 503);
        session.expires_at = now() + session.expires_in;
      }
      stage = 'authorization';
      // Recheck through the Finance browser identity path and the handoff
      // receipt, so a revocation during the exchange cannot open Finance.
      const alive = await call('/rest/v1/rpc/portal_session_status', {
        method: 'POST', headers: keyHeaders(config.publicKey, mintedToken), body: '{}'
      });
      const finalized = await call('/rest/v1/rpc/finance_portal_handoff_finalize', {
        method: 'POST', headers: keyHeaders(config.serviceKey), body: JSON.stringify({ payload: { jti: claims.jti, userId } })
      });
      upstream = upstreamCode(alive.ok ? finalized.body : alive.body);
      if (!alive.ok || alive.body?.active !== true || alive.body?.userId !== userId || !finalized.ok || finalized.body !== true) {
        throw new HandoffError('permission');
      }
      mintedToken = '';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.statusCode = 200;
      res.end(sessionDocument(session, claims.email, nonce, now() * 1000));
    } catch (error) {
      if (mintedToken && config) {
        // Never leave an unconfirmed Finance session behind.
        try {
          await call('/auth/v1/logout?scope=local', { method: 'POST', headers: keyHeaders(config.publicKey, mintedToken) });
        } catch { /* The session is never delivered to the browser. */ }
      }
      const status = error instanceof HandoffError ? error.status : 503;
      // Fixed categories only: never log an assertion, signature, identity,
      // URL, authorization header, upstream message or credential.
      const record = {
        stage, status,
        code: error instanceof HandoffError ? error.code : 'service',
        reason: error instanceof HandoffError ? error.reason : 'none',
        originMatched: req.headers?.origin === PORTAL_ORIGIN,
        signingConfigured: typeof environment.FINANCE_PORTAL_SIGNING_SECRET === 'string'
          && Buffer.byteLength(environment.FINANCE_PORTAL_SIGNING_SECRET, 'utf8') >= 32,
        upstreamCode: upstream
      };
      try { diagnostics(record); } catch { /* Diagnostics never change denial behavior. */ }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.statusCode = status;
      res.end(failureDocument);
    }
  };
}

module.exports = { HandoffError, createHandoffHandler, sessionDocument, verifyHandoff };
