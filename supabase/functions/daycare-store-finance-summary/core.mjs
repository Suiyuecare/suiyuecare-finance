import { timingSafeEqual } from 'node:crypto';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MONTH = /^(20\d{2}|21\d{2}|2200)-(0[1-9]|1[0-2])$/;
const MONEY = /^-?(0|[1-9]\d{0,14})\.\d{2}$/;
const encoder = new TextEncoder();
const ERROR_CODES = new Set(['FINANCE_SCOPE_NOT_VERIFIED', 'FINANCE_SCOPE_INCOMPLETE', 'FINANCE_SUMMARY_LIMIT_EXCEEDED']);

export class SummaryError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
}

export function parseConfig(env) {
  const token = env('FINANCE_DAYCARE_SUMMARY_TOKEN') || '';
  const bindingId = env('FINANCE_DAYCARE_SUMMARY_BINDING_ID') || '';
  const expiresAt = env('FINANCE_DAYCARE_SUMMARY_TOKEN_EXPIRES_AT') || '';
  if (!/^[0-9a-f]{64}$/.test(token) || !UUID.test(bindingId)
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expiresAt)
      || !Number.isFinite(Date.parse(expiresAt))) throw new SummaryError('FINANCE_NOT_CONFIGURED');
  return Object.freeze({ token, bindingId, expiresAt });
}

function tokenMatches(expected, supplied) {
  if (!/^[0-9a-f]{64}$/.test(supplied)) return false;
  return timingSafeEqual(encoder.encode(expected), encoder.encode(supplied));
}

export async function boundedText(body, limit, signal) {
  if (!body) throw new SummaryError('INVALID_REQUEST', 400);
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new SummaryError('FINANCE_TIMEOUT', 504);
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new SummaryError('FINANCE_TIMEOUT', 504);
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new SummaryError('PAYLOAD_TOO_LARGE', 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
}

function requestBody(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new SummaryError('INVALID_REQUEST', 400); }
  if (!value || Array.isArray(value) || typeof value !== 'object'
      || Object.keys(value).sort().join(',') !== 'branch_id,month,organization_id,request_id'
      || typeof value.request_id !== 'string' || !UUID.test(value.request_id)
      || typeof value.organization_id !== 'string' || !UUID.test(value.organization_id)
      || typeof value.branch_id !== 'string' || !UUID.test(value.branch_id)
      || typeof value.month !== 'string' || !MONTH.test(value.month)) throw new SummaryError('INVALID_REQUEST', 400);
  return value;
}

export function projectSummary(raw, input, bindingId, now = Date.now()) {
  if (raw?.status === 'unavailable' && ERROR_CODES.has(raw.error_code)) throw new SummaryError(raw.error_code);
  if (!raw || raw.status !== 'ready' || raw.organization_id !== input.organization_id
      || raw.branch_id !== input.branch_id || raw.month !== input.month
      || !UUID.test(bindingId || '') || raw.binding_id !== bindingId
      || typeof raw.entity_id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(raw.entity_id)
      || typeof raw.department_code !== 'string' || !/^[A-Z][0-9]{4}$/.test(raw.department_code)
      || raw.scope_basis !== 'department_direct_only'
      || typeof raw.entity_name !== 'string' || !raw.entity_name.trim() || raw.entity_name.length > 200
      || /[\u0000-\u001f\u007f]/.test(raw.entity_name)
      || raw.currency !== 'TWD' || raw.basis !== 'finance_pnl_ledger'
      || typeof raw.income !== 'string' || !MONEY.test(raw.income)
      || typeof raw.expenses !== 'string' || !MONEY.test(raw.expenses)
      || !Number.isSafeInteger(raw.entry_count) || raw.entry_count < 0 || raw.entry_count > 1000000
      || (raw.entry_count === 0 && (Number(raw.income) !== 0 || Number(raw.expenses) !== 0))
      || typeof raw.generated_at !== 'string' || !Number.isFinite(Date.parse(raw.generated_at))
      || Math.abs(Date.parse(raw.generated_at) - now) > 60000) throw new SummaryError('FINANCE_RESPONSE_INVALID');
  return { request_id: input.request_id, status: 'ready', organization_id: input.organization_id,
    branch_id: input.branch_id, month: input.month, binding_id: bindingId,
    entity_id: raw.entity_id, department_code: raw.department_code,
    entity_name: raw.entity_name, currency: 'TWD', basis: 'finance_pnl_ledger',
    scope_basis: 'department_direct_only', income: raw.income, expenses: raw.expenses,
    entry_count: raw.entry_count, generated_at: new Date(raw.generated_at).toISOString() };
}

function json(value, status) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  } });
}

// Per-isolate overload protection only; not a global billing/rate-limit claim.
export function createSummaryHandler({ env, rpc, now = () => Date.now(), randomUUID = () => crypto.randomUUID() }) {
  let inFlight = 0;
  let windowStart = 0;
  let requests = 0;
  return async function handle(request) {
    let requestId = randomUUID();
    let acquired = false;
    try {
      if (request.method !== 'POST') throw new SummaryError('METHOD_NOT_ALLOWED', 405);
      const url = new URL(request.url);
      // Node/Undici server fetch adds sec-fetch-mode:cors itself. Allow that
      // lone header; browser site/destination/user context remains disallowed.
      if (url.search || request.headers.has('origin')
          || [...request.headers.keys()].some(name => name.startsWith('sec-fetch-')
            && (name !== 'sec-fetch-mode' || request.headers.get(name) !== 'cors'))) throw new SummaryError('FORBIDDEN', 403);
      const config = parseConfig(env);
      if (Date.parse(config.expiresAt) <= now()) throw new SummaryError('FINANCE_CREDENTIAL_EXPIRED');
      const auth = request.headers.get('authorization') || '';
      if (!auth.startsWith('Bearer ') || !tokenMatches(config.token, auth.slice(7))) throw new SummaryError('UNAUTHORIZED', 401);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')) throw new SummaryError('INVALID_CONTENT_TYPE', 415);
      if (request.headers.has('content-encoding')) throw new SummaryError('INVALID_CONTENT_TYPE', 415);
      const declared = request.headers.get('content-length');
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > 4096)) throw new SummaryError('PAYLOAD_TOO_LARGE', 413);
      if (now() - windowStart >= 60000) { windowStart = now(); requests = 0; }
      if (inFlight >= 2 || requests >= 30) throw new SummaryError('RATE_LIMITED', 429);
      inFlight++; requests++; acquired = true;
      const signal = AbortSignal.timeout(8000);
      let input;
      try { input = requestBody(await boundedText(request.body, 4096, signal)); }
      catch (error) { if (error instanceof SummaryError) throw error; throw new SummaryError('INVALID_REQUEST', 400); }
      requestId = input.request_id;
      const raw = await rpc({ p_binding_id: config.bindingId, p_organization_id: input.organization_id,
        p_branch_id: input.branch_id, p_month: input.month }, signal);
      return json(projectSummary(raw, input, config.bindingId, now()), 200);
    } catch (error) {
      const safe = error instanceof SummaryError ? error : new SummaryError('FINANCE_UNAVAILABLE');
      return json({ request_id: requestId, status: 'unavailable', error: { code: safe.code } }, safe.status);
    } finally { if (acquired) inFlight--; }
  };
}
