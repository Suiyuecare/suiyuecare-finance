import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  MAX_WORKER_BODY_BYTES,
  SyncContractError,
  buildPushEnvelope,
  classifyEdocResponse,
  constantTimeTextEqual,
  hmacHex,
  retryAfterSeconds,
  safeErrorCode,
  sha256Hex,
} from "./worker-core.mjs";

type ClaimedEvent = {
  event_id: string;
  event_type: "member.changed" | "company.changed" | "organization.published";
  tenant_id: string;
  aggregate_id: string;
  source_revision: number;
  occurred_at: string;
  attempt_count: number;
  max_attempts: number;
};

type ProcessResult = {
  event_id: string;
  status: string;
  outcome?: string;
  error_code?: string;
};

const DEFAULT_EDOC_SYNC_URL = "https://edoc.suiyuecare.com/api/internal/finance-member-sync";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function env(name: string) {
  return Deno.env.get(name) || "";
}

function financeAdminKey() {
  const legacy = env("SUPABASE_SERVICE_ROLE_KEY").trim();
  if (legacy) return legacy;
  try {
    const named = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}");
    return String(named.default || "").trim();
  } catch {
    return "";
  }
}

function financeHeaders(key: string) {
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  // Opaque sb_secret keys authenticate through the apikey header. Legacy JWT
  // service-role keys additionally require the Authorization header.
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function financeRpc(name: string, payload: Record<string, unknown>) {
  const baseUrl = env("SUPABASE_URL").replace(/\/$/, "");
  const key = financeAdminKey();
  if (!baseUrl || !key) throw new SyncContractError("finance_backend_not_configured");
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: financeHeaders(key),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new SyncContractError(`finance_rpc_${name}_http_${response.status}`, {
      httpStatus: response.status,
    });
  }
  try {
    return await response.json();
  } catch {
    throw new SyncContractError(`finance_rpc_${name}_not_json`, {
      httpStatus: response.status,
    });
  }
}

async function readBoundedText(response: Response, maxBytes = 64 * 1024) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SyncContractError("edoc_response_too_large", {
        httpStatus: response.status,
      });
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(output);
}

async function readWorkerBody(request: Request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_WORKER_BODY_BYTES) {
    throw new SyncContractError("worker_body_too_large");
  }
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_WORKER_BODY_BYTES) {
      await reader.cancel();
      throw new SyncContractError("worker_body_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return parsed && !Array.isArray(parsed) && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new SyncContractError("invalid_worker_body");
  }
}

function edocSyncUrl() {
  const configured = env("EDOC_FINANCE_SYNC_URL").trim() || DEFAULT_EDOC_SYNC_URL;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new SyncContractError("edoc_sync_url_invalid");
  }
  const hostAllowed = url.hostname === "edoc.suiyuecare.com"
    || url.hostname.endsWith(".vercel.app");
  if (
    url.protocol !== "https:"
    || !hostAllowed
    || url.pathname.replace(/\/$/, "") !== "/api/internal/finance-member-sync"
    || url.search
    || url.username
    || url.password
    || url.hash
  ) {
    throw new SyncContractError("edoc_sync_url_invalid");
  }
  return url.toString();
}

async function claimEvents(limit: number, workerId: string) {
  const result = await financeRpc("finance_edoc_sync_claim_v1", {
    p_limit: limit,
    p_worker_id: workerId,
    p_stale_seconds: 900,
  });
  if (!Array.isArray(result)) throw new SyncContractError("finance_claim_invalid");
  return result as ClaimedEvent[];
}

async function loadSnapshot(event: ClaimedEvent) {
  if (event.event_type === "member.changed") {
    return financeRpc("finance_edoc_member_sync_snapshot_v1", {
      p_tenant_id: event.tenant_id,
      p_finance_user_id: event.aggregate_id,
      p_expected_revision: event.source_revision,
    });
  }
  if (event.event_type === "company.changed") {
    return financeRpc("finance_edoc_company_sync_snapshot_v1", {
      p_tenant_id: event.tenant_id,
      p_entity_id: event.aggregate_id,
      p_expected_revision: event.source_revision,
    });
  }
  if (event.event_type === "organization.published") {
    return financeRpc("finance_edoc_organization_sync_snapshot_v2", {
      p_tenant_id: event.tenant_id,
      p_expected_revision: event.source_revision,
    });
  }
  throw new SyncContractError("unsupported_event_type");
}

async function completeEvent(
  event: ClaimedEvent,
  workerId: string,
  outcome: "applied" | "stale" | "replayed" | "superseded",
  httpStatus: number | null,
  responseDigest: string | null,
) {
  const completed = await financeRpc("finance_edoc_sync_complete_v1", {
    p_event_id: event.event_id,
    p_worker_id: workerId,
    p_outcome: outcome,
    p_http_status: httpStatus,
    p_response_digest: responseDigest,
  });
  if (completed !== true) throw new SyncContractError("outbox_claim_lost");
}

async function failEvent(
  event: ClaimedEvent,
  workerId: string,
  error: unknown,
) {
  const errorCode = safeErrorCode(error);
  const httpStatus = error instanceof SyncContractError ? error.httpStatus : null;
  const retrySeconds = error instanceof SyncContractError
    ? retryAfterSeconds(error.retryAfterSeconds)
    : null;
  const failed = await financeRpc("finance_edoc_sync_fail_v1", {
    p_event_id: event.event_id,
    p_worker_id: workerId,
    p_error_code: errorCode,
    p_http_status: httpStatus,
    p_retry_after_seconds: retrySeconds,
  });
  return { failed: failed === true, errorCode };
}

async function pushEvent(event: ClaimedEvent, snapshot: Record<string, unknown>) {
  const secret = env("FINANCE_EDOC_BRIDGE_SECRET");
  const { rawBody } = buildPushEnvelope(event, snapshot);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const signature = await hmacHex(secret, timestamp, nonce, rawBody);

  let response: Response;
  try {
    response = await fetch(edocSyncUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-finance-timestamp": timestamp,
        "x-finance-nonce": nonce,
        "x-finance-signature": signature,
      },
      body: rawBody,
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new SyncContractError("edoc_network_failure");
  }

  const retryHeader = retryAfterSeconds(response.headers.get("retry-after"));
  let responseBody: string;
  try {
    responseBody = await readBoundedText(response);
  } catch (error) {
    if (error instanceof SyncContractError && retryHeader) {
      error.retryAfterSeconds = retryHeader;
    }
    throw error;
  }

  try {
    const outcome = classifyEdocResponse(response.status, responseBody);
    return {
      outcome,
      httpStatus: response.status,
      responseDigest: await sha256Hex(responseBody),
    } as const;
  } catch (error) {
    if (error instanceof SyncContractError && retryHeader) {
      error.retryAfterSeconds = retryHeader;
    }
    throw error;
  }
}

async function processEvent(event: ClaimedEvent, workerId: string): Promise<ProcessResult> {
  try {
    const snapshot = await loadSnapshot(event) as Record<string, unknown>;
    if (snapshot && snapshot.ok === false && snapshot.error === "source_revision_superseded") {
      await completeEvent(event, workerId, "superseded", null, null);
      return { event_id: event.event_id, status: "completed", outcome: "superseded" };
    }
    const delivered = await pushEvent(event, snapshot);
    await completeEvent(
      event,
      workerId,
      delivered.outcome,
      delivered.httpStatus,
      delivered.responseDigest,
    );
    return { event_id: event.event_id, status: "completed", outcome: delivered.outcome };
  } catch (error) {
    if (safeErrorCode(error) === "outbox_claim_lost") {
      return { event_id: event.event_id, status: "claim_lost", error_code: "outbox_claim_lost" };
    }
    try {
      const failed = await failEvent(event, workerId, error);
      return {
        event_id: event.event_id,
        status: failed.failed ? "retry_scheduled" : "claim_lost",
        error_code: failed.errorCode,
      };
    } catch (failureError) {
      return {
        event_id: event.event_id,
        status: "worker_error",
        error_code: safeErrorCode(failureError),
      };
    }
  }
}

async function processWithConcurrency(events: ClaimedEvent[], workerId: string, concurrency = 5) {
  const queue = [...events];
  const results: ProcessResult[] = [];
  async function run() {
    while (queue.length) {
      const event = queue.shift();
      if (!event) return;
      results.push(await processEvent(event, workerId));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(concurrency, 1), events.length || 1) }, () => run()),
  );
  return results;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const dedicatedWorkerSecret = env("FINANCE_EDOC_SYNC_WORKER_SECRET");
  const authorized = await constantTimeTextEqual(
    dedicatedWorkerSecret.trim() ? dedicatedWorkerSecret : env("FINANCE_NOTIFICATION_WORKER_SECRET"),
    request.headers.get("x-finance-sync-worker-secret") || "",
  );
  if (!authorized) return json({ ok: false, error: "unauthorized" }, 401);

  try {
    const body = await readWorkerBody(request) as Record<string, unknown>;
    const requestedLimit = Number(body.limit || 20);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 50)
      : 20;
    const workerId = String(body.worker_id || `edge-${crypto.randomUUID()}`)
      .replace(/[^A-Za-z0-9_.:-]+/g, "_")
      .slice(0, 100) || `edge-${crypto.randomUUID()}`;
    const events = await claimEvents(limit, workerId);
    const results = await processWithConcurrency(events, workerId);
    const workerErrors = results.filter((result) => result.status === "worker_error").length;

    // No names, email addresses, company details, or payload text are logged.
    console.log("Finance -> eDoc sync batch", {
      workerId,
      claimed: events.length,
      completed: results.filter((result) => result.status === "completed").length,
      retryScheduled: results.filter((result) => result.status === "retry_scheduled").length,
      workerErrors,
    });

    return json(
      { ok: workerErrors === 0, worker_id: workerId, count: results.length, results },
      workerErrors === 0 ? 200 : 500,
    );
  } catch (error) {
    return json({ ok: false, error: safeErrorCode(error) }, 500);
  }
});
