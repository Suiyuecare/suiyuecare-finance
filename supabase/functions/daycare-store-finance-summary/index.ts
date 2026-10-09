import { createSummaryHandler } from './core.mjs';
import { createFinanceRpc } from './adapter.mjs';

const env = (name: string) => Deno.env.get(name) || '';
// Custom server-to-server auth; deploy only this function with --no-verify-jwt.
// No browser CORS, no end-user JWT forwarding, no financial payload logging.
Deno.serve(createSummaryHandler({ env, rpc: createFinanceRpc({ env }) }));
