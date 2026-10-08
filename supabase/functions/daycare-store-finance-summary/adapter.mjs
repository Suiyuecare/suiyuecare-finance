import { SummaryError, boundedText } from './core.mjs';

export function createFinanceRpc({ env, fetchImpl = fetch }) {
  return async function rpc(payload, signal) {
    const base = env('SUPABASE_URL') || '';
    // Restrict credentials to this runtime's canonical Supabase REST endpoint.
    if (!/^https:\/\/[a-z]{20}\.supabase\.co\/?$/.test(base)) throw new SummaryError('FINANCE_NOT_CONFIGURED');
    let key = env('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!key) {
      try { key = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}').default || ''; }
      catch { throw new SummaryError('FINANCE_NOT_CONFIGURED'); }
    }
    if (typeof key !== 'string' || !key || /\s/.test(key)) throw new SummaryError('FINANCE_NOT_CONFIGURED');
    const headers = { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
    try {
      const response = await fetchImpl(`${base.replace(/\/$/, '')}/rest/v1/rpc/finance_daycare_store_summary_v1`, {
        method: 'POST', headers, body: JSON.stringify(payload), signal, redirect: 'error',
      });
      if (!response.ok) throw new SummaryError('FINANCE_UNAVAILABLE');
      if (!(response.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) throw new SummaryError('FINANCE_RESPONSE_INVALID');
      const text = await boundedText(response.body, 16384, signal);
      try { return JSON.parse(text); } catch { throw new SummaryError('FINANCE_RESPONSE_INVALID'); }
    } catch (error) {
      if (signal.aborted) throw new SummaryError('FINANCE_TIMEOUT', 504);
      if (error instanceof SummaryError && ['FINANCE_UNAVAILABLE', 'FINANCE_RESPONSE_INVALID'].includes(error.code)) throw error;
      // An absent/oversized/malformed backend body is a backend failure, never
      // a 400/413 accusation against an already validated daycare request.
      if (error instanceof SummaryError) throw new SummaryError('FINANCE_RESPONSE_INVALID');
      throw new SummaryError('FINANCE_UNAVAILABLE');
    }
  };
}
