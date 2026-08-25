#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  MAX_ORGANIZATION_PUSH_BODY_BYTES,
  MAX_PUSH_BODY_BYTES,
  ORGANIZATION_SCHEMA_VERSION,
  SyncContractError,
  buildPushEnvelope,
  canonicalHmacMessage,
  classifyEdocResponse,
  constantTimeTextEqual,
  hmacHex,
  retryAfterSeconds,
  safeErrorCode,
} from "../supabase/functions/sync-finance-members-to-edoc/worker-core.mjs";

let passed = 0;
async function test(name, callback) {
  try {
    await callback();
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const memberClaim = {
  event_id: "11111111-1111-4111-8111-111111111111",
  event_type: "member.changed",
  tenant_id: "22222222-2222-4222-8222-222222222222",
  aggregate_id: "FIN-001",
  source_revision: 7,
  occurred_at: "2026-08-22T01:02:03.000Z",
};

const memberSnapshot = {
  ok: true,
  source: "finance",
  schemaVersion: 1,
  sourceRevision: 7,
  identity: {
    tenantId: memberClaim.tenant_id,
    financeUserId: "FIN-001",
    name: "測試人員",
    email: "masked@example.invalid",
    role: "section_chief",
    roleLabel: "課長",
    memberRevision: 7,
    jobTitle: "課長",
    extension: "123",
    contactEmail: "masked@example.invalid",
    departmentName: "測試部門",
    unitName: "測試部門",
    active: true,
  },
  company: {
    tenantId: memberClaim.tenant_id,
    entityId: "TEST",
    name: "去識別公司",
    taxId: "00000000",
    address: "去識別地址",
    active: true,
  },
  actors: {
    applicantManager: {
      tenantId: memberClaim.tenant_id,
      financeUserId: "FIN-002",
      role: "dept_manager",
      memberRevision: 8,
      jobTitle: "主任",
      extension: "456",
      contactEmail: "masked2@example.invalid",
      departmentName: "測試部門",
      unitName: "測試部門",
    },
  },
  workflowReady: true,
  issues: [],
};

const organizationClaim = {
  event_id: "44444444-4444-4444-8444-444444444444",
  event_type: "organization.published",
  tenant_id: memberClaim.tenant_id,
  aggregate_id: memberClaim.tenant_id,
  source_revision: 14,
  occurred_at: "2026-08-25T09:30:00.000Z",
};

const organizationSnapshot = {
  ok: true,
  source: "finance",
  schemaVersion: ORGANIZATION_SCHEMA_VERSION,
  sourceRevision: 14,
  organization: {
    tenantId: memberClaim.tenant_id,
    versionId: "55555555-5555-4555-8555-555555555555",
    versionNo: 14,
    etag: "a".repeat(64),
    schemaVersion: ORGANIZATION_SCHEMA_VERSION,
    publishedAt: "2026-08-25T09:29:59.000Z",
    units: [{
      id: "66666666-6666-4666-8666-666666666666",
      code: "TEST_DEPARTMENT",
      name: "去識別部門",
      parentOrgUnitId: null,
      unitType: "department",
      sortOrder: 10,
      active: true,
      isPostingUnit: true,
      entityScopeMode: "explicit",
      entityCodes: ["TEST"],
      metadata: { mustNotLeaveFinance: true },
    }],
    assignments: [{
      id: "governance_77777777-7777-4777-8777-777777777777",
      financeUserId: "FIN-001",
      orgUnitId: "66666666-6666-4666-8666-666666666666",
      positionCode: "DEPARTMENT_HEAD",
      assignmentKind: "primary",
      headKind: "permanent",
      canApprove: true,
      effectiveFrom: null,
      effectiveTo: null,
      active: true,
      metadata: { mustNotLeaveFinance: true },
    }],
    reportingOverrides: [{
      id: "reporting_88888888-8888-4888-8888-888888888888",
      financeUserId: "FIN-001",
      supervisorFinanceUserId: "FIN-002",
      effectiveFrom: null,
      effectiveTo: null,
      active: true,
      metadata: { mustNotLeaveFinance: true },
    }],
    metadata: { mustNotLeaveFinance: true },
  },
};

await test("member.changed keeps the fixed eDoc envelope and canonical Finance role", () => {
  const { envelope, rawBody } = buildPushEnvelope(memberClaim, memberSnapshot);
  assert.equal(envelope.source, "finance");
  assert.equal(envelope.eventType, "member.changed");
  assert.equal(envelope.sourceRevision, 7);
  assert.equal(envelope.identity.role, "section_chief");
  assert.equal(envelope.identity.jobTitle, "課長");
  assert.equal(envelope.actors.applicantManager.extension, "456");
  assert.equal(envelope.actors.applicantManager.memberRevision, 8);
  assert.deepEqual(JSON.parse(rawBody), envelope);
});

await test("company.changed has an independent aggregate revision", () => {
  const claim = {
    ...memberClaim,
    event_id: "33333333-3333-4333-8333-333333333333",
    event_type: "company.changed",
    aggregate_id: "TEST",
    source_revision: 3,
  };
  const snapshot = {
    ok: true,
    source: "finance",
    schemaVersion: 1,
    sourceRevision: 3,
    company: memberSnapshot.company,
  };
  const { envelope } = buildPushEnvelope(claim, snapshot);
  assert.equal(envelope.eventType, "company.changed");
  assert.equal(envelope.sourceRevision, 3);
  assert.deepEqual(Object.keys(envelope), [
    "source", "schemaVersion", "eventId", "eventType", "sourceRevision", "occurredAt", "company",
  ]);
});

await test("organization.published emits schema v2 and strips non-whitelisted metadata", () => {
  const { envelope, rawBody } = buildPushEnvelope(organizationClaim, organizationSnapshot);
  assert.equal(envelope.schemaVersion, 2);
  assert.equal(envelope.eventType, "organization.published");
  assert.equal(envelope.tenantId, memberClaim.tenant_id);
  assert.equal(envelope.organization.versionNo, 14);
  assert.equal(envelope.organization.publishedAt, "2026-08-25T09:29:59.000Z");
  assert.equal(
    envelope.organization.assignments[0].id,
    "governance_77777777-7777-4777-8777-777777777777",
  );
  assert.equal(
    envelope.organization.reportingOverrides[0].id,
    "reporting_88888888-8888-4888-8888-888888888888",
  );
  assert.equal("metadata" in envelope.organization, false);
  assert.equal("metadata" in envelope.organization.units[0], false);
  assert.equal("metadata" in envelope.organization.assignments[0], false);
  assert.deepEqual(JSON.parse(rawBody), envelope);
});

await test("organization tenant, aggregate and revision mismatches fail closed", () => {
  assert.throws(
    () => buildPushEnvelope(
      { ...organizationClaim, aggregate_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      organizationSnapshot,
    ),
    (error) => error instanceof SyncContractError
      && error.code === "organization_aggregate_mismatch",
  );
  assert.throws(
    () => buildPushEnvelope(organizationClaim, {
      ...organizationSnapshot,
      organization: { ...organizationSnapshot.organization, versionNo: 15 },
    }),
    (error) => error instanceof SyncContractError
      && error.code === "organization_revision_mismatch",
  );
});

function largeOpaqueId(prefix, index) {
  return `${prefix}_${String(index).padStart(5, "0")}_${"x".repeat(120)}`;
}

await test("organization payload may exceed 256 KiB but stays bounded at 1 MiB", () => {
  const largeSnapshot = structuredClone(organizationSnapshot);
  largeSnapshot.organization.assignments = Array.from({ length: 900 }, (_, index) => ({
    ...organizationSnapshot.organization.assignments[0],
    id: largeOpaqueId("governance", index),
    financeUserId: largeOpaqueId("member", index),
  }));
  largeSnapshot.organization.reportingOverrides = [];
  const { rawBody } = buildPushEnvelope(organizationClaim, largeSnapshot);
  const byteLength = new TextEncoder().encode(rawBody).byteLength;
  assert.ok(byteLength > MAX_PUSH_BODY_BYTES);
  assert.ok(byteLength <= MAX_ORGANIZATION_PUSH_BODY_BYTES);
});

await test("organization payload over 1 MiB is rejected before network delivery", () => {
  const oversizedSnapshot = structuredClone(organizationSnapshot);
  oversizedSnapshot.organization.assignments = Array.from({ length: 2000 }, (_, index) => ({
    ...organizationSnapshot.organization.assignments[0],
    id: largeOpaqueId("governance", index),
    financeUserId: largeOpaqueId("member", index),
  }));
  oversizedSnapshot.organization.reportingOverrides = Array.from(
    { length: 2000 },
    (_, index) => ({
      ...organizationSnapshot.organization.reportingOverrides[0],
      id: largeOpaqueId("reporting", index),
      financeUserId: largeOpaqueId("member", index),
      supervisorFinanceUserId: largeOpaqueId("supervisor", index),
    }),
  );
  assert.throws(
    () => buildPushEnvelope(organizationClaim, oversizedSnapshot),
    (error) => error instanceof SyncContractError && error.code === "push_body_too_large",
  );
});

await test("source revision mismatch is rejected before network delivery", () => {
  assert.throws(
    () => buildPushEnvelope(memberClaim, { ...memberSnapshot, sourceRevision: 8 }),
    (error) => error instanceof SyncContractError && error.code === "source_revision_mismatch",
  );
});

await test("cross-tenant member snapshot is rejected", () => {
  assert.throws(
    () => buildPushEnvelope(memberClaim, {
      ...memberSnapshot,
      identity: { ...memberSnapshot.identity, tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    }),
    (error) => error instanceof SyncContractError && error.code === "member_tenant_mismatch",
  );
});

await test("pending first login remains employed while auth readiness stays separate", () => {
  const pending = {
    ...memberSnapshot,
    identity: {
      ...memberSnapshot.identity,
      active: true,
      sourceActive: true,
      authUserBound: false,
      googleLoginVerified: false,
    },
    workflowReady: false,
    issues: ["identity_auth_unbound", "identity_google_unverified"],
  };
  const { envelope } = buildPushEnvelope(memberClaim, pending);
  assert.equal(envelope.identity.active, true);
  assert.equal(envelope.identity.authUserBound, false);
  assert.equal(envelope.identity.googleLoginVerified, false);
});

await test("system account keeps raw employment flag and distinct org status", () => {
  const systemAccount = {
    ...memberSnapshot,
    identity: {
      ...memberSnapshot.identity,
      active: true,
      sourceActive: true,
      orgStatus: "system_account",
    },
    workflowReady: false,
    issues: ["identity_org_inactive"],
  };
  const { envelope } = buildPushEnvelope(memberClaim, systemAccount);
  assert.equal(envelope.identity.active, true);
  assert.equal(envelope.identity.orgStatus, "system_account");
});

await test("offboarded member is delivered as inactive rather than skipped", () => {
  const inactive = {
    ...memberSnapshot,
    identity: {
      ...memberSnapshot.identity,
      active: false,
      sourceActive: false,
      orgStatus: "inactive",
    },
    workflowReady: false,
    issues: ["identity_inactive"],
  };
  const { envelope } = buildPushEnvelope(memberClaim, inactive);
  assert.equal(envelope.identity.active, false);
  assert.equal(envelope.identity.financeUserId, memberClaim.aggregate_id);
});

await test("HMAC exactly matches timestamp.nonce.rawBody contract", async () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const timestamp = "1787331723";
  const nonce = "abcdef0123456789abcdef0123456789";
  const rawBody = buildPushEnvelope(memberClaim, memberSnapshot).rawBody;
  const expected = createHmac("sha256", secret)
    .update(canonicalHmacMessage(timestamp, nonce, rawBody))
    .digest("hex");
  assert.equal(await hmacHex(secret, timestamp, nonce, rawBody), expected);
});

await test("worker secret comparison rejects mismatches without plain comparison", async () => {
  const secret = "0123456789abcdef0123456789abcdef";
  assert.equal(await constantTimeTextEqual(secret, secret), true);
  assert.equal(await constantTimeTextEqual(secret, `${secret}x`), false);
  assert.equal(await constantTimeTextEqual("short", "short"), false);
});

await test("pinned status outcomes and matching compatibility booleans complete an event", () => {
  assert.equal(classifyEdocResponse(200, '{"status":"applied","applied":true}'), "applied");
  assert.equal(classifyEdocResponse(200, '{"status":"stale","stale":true}'), "stale");
  assert.equal(classifyEdocResponse(
    409,
    '{"status":"replayed","replayed":true,"originalStatus":"applied"}',
  ), "replayed");
  assert.equal(classifyEdocResponse(200, '{"status":"applied"}'), "applied");
  assert.equal(classifyEdocResponse(200, '{"applied":true}'), "applied");
  assert.throws(
    () => classifyEdocResponse(200, '{"status":"applied","stale":true}'),
    (error) => error instanceof SyncContractError && error.code === "edoc_response_outcome_mismatch",
  );
  assert.throws(
    () => classifyEdocResponse(200, '{"status":"applied","applied":false}'),
    (error) => error instanceof SyncContractError && error.code === "edoc_response_outcome_mismatch",
  );
  assert.throws(() => classifyEdocResponse(409, '{"status":"applied","applied":true}'));
  assert.throws(() => classifyEdocResponse(200, '{"ok":true}'));
  assert.throws(
    () => classifyEdocResponse(503, '{"error":"unavailable"}'),
    (error) => error.code === "edoc_http_503_unavailable",
  );
  assert.throws(
    () => classifyEdocResponse(422, '{"error":"finance_member_sync_contract_invalid"}'),
    (error) => error.code === "edoc_http_422_finance_member_sync_contract_invalid",
  );
});

await test("retry delays and errors are bounded and contain no provider response body", () => {
  assert.equal(retryAfterSeconds("1"), 30);
  assert.equal(retryAfterSeconds("999999"), 21600);
  assert.equal(retryAfterSeconds("bad"), null);
  assert.equal(safeErrorCode({ code: "Remote failed: user@example.com / secret text" }),
    "remote_failed:_user_example.com_secret_text");
  assert.ok(safeErrorCode({ code: "x".repeat(500) }).length <= 160);
});

await test("forward migration keeps durable outbox, async fast wake and cron recovery", () => {
  const migration = readFileSync(new URL(
    "../supabase/migrations/20260825103034_finance_edoc_organization_published_v2.sql",
    import.meta.url,
  ), "utf8");
  const worker = readFileSync(new URL(
    "../supabase/functions/sync-finance-members-to-edoc/index.ts",
    import.meta.url,
  ), "utf8");
  assert.match(migration, /organization[.]published/);
  assert.match(migration, /finance_edoc_organization_sync_snapshot_v2/);
  assert.match(migration, /finance_membership_org_versions_edoc_v2/);
  assert.match(migration, /finance_edoc_outbox_fast_wake_v2/);
  assert.match(migration, /finance_wake_edoc_sync_worker_v1/);
  assert.match(migration, /finance-edoc-member-company-sync/);
  assert.match(
    migration,
    /version_row[.]version_no = p_expected_revision[\s\S]*status in \('published', 'archived'\)[\s\S]*published_at is not null/,
  );
  assert.match(migration, /where older[.]aggregate_type <> 'organization'/);
  assert.match(migration, /event_row[.]aggregate_type = 'organization'[\s\S]*or not exists/);
  assert.match(migration, /to service_role/);
  assert.doesNotMatch(migration, /to (?:anon|authenticated)/);
  assert.match(worker, /organization[.]published/);
  assert.match(worker, /finance_edoc_organization_sync_snapshot_v2/);
});

if (!process.exitCode) {
  process.stdout.write(`\n${passed}/16 worker-core and migration tests passed\n`);
}
