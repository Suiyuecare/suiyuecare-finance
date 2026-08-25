const encoder = new TextEncoder();

export const SCHEMA_VERSION = 1;
export const ORGANIZATION_SCHEMA_VERSION = 2;
export const MAX_PUSH_BODY_BYTES = 256 * 1024;
export const MAX_ORGANIZATION_PUSH_BODY_BYTES = 1024 * 1024;
export const MAX_WORKER_BODY_BYTES = 4 * 1024;
export const MIN_SECRET_BYTES = 32;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SyncContractError extends Error {
  constructor(code, options = {}) {
    super(code);
    this.name = "SyncContractError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

function objectValue(value, code) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new SyncContractError(code);
  }
  return value;
}

function positiveInteger(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new SyncContractError(code);
  }
  return number;
}

function boundedInteger(value, minimum, maximum, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new SyncContractError(code);
  }
  return number;
}

function boundedString(value, maxLength, code) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw new SyncContractError(code);
  }
  return normalized;
}

function uuidString(value, code) {
  const normalized = boundedString(value, 36, code).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new SyncContractError(code);
  return normalized;
}

function nullableBoundedString(value, maxLength, code) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  return boundedString(value, maxLength, code);
}

function booleanValue(value, code) {
  if (typeof value !== "boolean") throw new SyncContractError(code);
  return value;
}

function enumValue(value, allowed, code) {
  const normalized = boundedString(value, 40, code);
  if (!allowed.includes(normalized)) throw new SyncContractError(code);
  return normalized;
}

function boundedArray(value, maximum, code) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new SyncContractError(code);
  }
  return value;
}

function occurredAt(value) {
  const normalized = boundedString(value, 64, "invalid_occurred_at");
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new SyncContractError("invalid_occurred_at");
  }
  return normalized;
}

function validatedIssues(value) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 50) {
    throw new SyncContractError("invalid_snapshot_issues");
  }
  return value.map((issue) => boundedString(issue, 100, "invalid_snapshot_issue"));
}

function commonEnvelope(claim) {
  const eventId = boundedString(claim.event_id, 36, "invalid_event_id").toLowerCase();
  if (!UUID_PATTERN.test(eventId)) throw new SyncContractError("invalid_event_id");
  const eventType = boundedString(claim.event_type, 32, "invalid_event_type");
  if (!["member.changed", "company.changed", "organization.published"].includes(eventType)) {
    throw new SyncContractError("invalid_event_type");
  }
  const schemaVersion = eventType === "organization.published"
    ? ORGANIZATION_SCHEMA_VERSION
    : SCHEMA_VERSION;
  return {
    source: "finance",
    schemaVersion,
    eventId,
    eventType,
    sourceRevision: positiveInteger(claim.source_revision, "invalid_source_revision"),
    occurredAt: occurredAt(claim.occurred_at),
  };
}

function validateSnapshot(claim, snapshot, expectedSchemaVersion) {
  const value = objectValue(snapshot, "invalid_snapshot");
  if (
    value.ok !== true
    || value.source !== "finance"
    || Number(value.schemaVersion) !== expectedSchemaVersion
  ) {
    throw new SyncContractError("invalid_snapshot_contract");
  }
  if (positiveInteger(value.sourceRevision, "invalid_snapshot_revision") !==
      positiveInteger(claim.source_revision, "invalid_source_revision")) {
    throw new SyncContractError("source_revision_mismatch");
  }
  return value;
}

function sanitizeOrganization(rawOrganization, tenantId, sourceRevision) {
  const organization = objectValue(rawOrganization, "invalid_organization");
  const organizationTenantId = uuidString(
    organization.tenantId,
    "invalid_organization_tenant_id",
  );
  if (organizationTenantId !== tenantId) {
    throw new SyncContractError("organization_tenant_mismatch");
  }

  const versionNo = positiveInteger(organization.versionNo, "invalid_organization_version");
  if (versionNo !== sourceRevision) {
    throw new SyncContractError("organization_revision_mismatch");
  }
  if (Number(organization.schemaVersion) !== ORGANIZATION_SCHEMA_VERSION) {
    throw new SyncContractError("invalid_organization_schema");
  }

  const etag = boundedString(organization.etag, 64, "invalid_organization_etag").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(etag)) {
    throw new SyncContractError("invalid_organization_etag");
  }

  const units = boundedArray(organization.units, 500, "invalid_organization_units").map(
    (rawUnit) => {
      const unit = objectValue(rawUnit, "invalid_organization_unit");
      const parentOrgUnitId = nullableBoundedString(
        unit.parentOrgUnitId,
        36,
        "invalid_parent_org_unit_id",
      );
      if (parentOrgUnitId !== null && !UUID_PATTERN.test(parentOrgUnitId)) {
        throw new SyncContractError("invalid_parent_org_unit_id");
      }
      const entityCodes = boundedArray(
        unit.entityCodes,
        100,
        "invalid_unit_entity_codes",
      ).map((entityCode) => boundedString(entityCode, 80, "invalid_unit_entity_code"));
      return {
        id: uuidString(unit.id, "invalid_org_unit_id"),
        code: boundedString(unit.code, 32, "invalid_org_unit_code"),
        name: boundedString(unit.name, 200, "invalid_org_unit_name"),
        parentOrgUnitId: parentOrgUnitId === null ? null : parentOrgUnitId.toLowerCase(),
        unitType: enumValue(
          unit.unitType,
          ["shareholders", "board", "executive", "division", "department", "section", "team"],
          "invalid_org_unit_type",
        ),
        sortOrder: boundedInteger(unit.sortOrder, 0, 1_000_000, "invalid_org_unit_sort_order"),
        active: booleanValue(unit.active, "invalid_org_unit_active"),
        isPostingUnit: booleanValue(unit.isPostingUnit, "invalid_org_unit_posting"),
        entityScopeMode: enumValue(
          unit.entityScopeMode,
          ["inherit", "all", "explicit"],
          "invalid_org_unit_entity_scope",
        ),
        entityCodes,
      };
    },
  );

  const assignments = boundedArray(
    organization.assignments,
    2000,
    "invalid_organization_assignments",
  ).map((rawAssignment) => {
    const assignment = objectValue(rawAssignment, "invalid_organization_assignment");
    const headKind = nullableBoundedString(assignment.headKind, 40, "invalid_assignment_head_kind");
    if (headKind !== null && !["permanent", "acting"].includes(headKind)) {
      throw new SyncContractError("invalid_assignment_head_kind");
    }
    return {
      // Assignment IDs are intentionally safe opaque identifiers. Finance has
      // legacy governance_/reporting_ prefixes, so they must not be UUID-only.
      id: boundedString(assignment.id, 160, "invalid_assignment_id"),
      financeUserId: boundedString(
        assignment.financeUserId,
        160,
        "invalid_assignment_finance_user_id",
      ),
      orgUnitId: uuidString(assignment.orgUnitId, "invalid_assignment_org_unit_id"),
      positionCode: enumValue(
        assignment.positionCode,
        [
          "CHAIRMAN", "BOARD_MEMBER", "GENERAL_MANAGER", "EXECUTIVE_DIRECTOR",
          "DIVISION_HEAD", "DEPARTMENT_HEAD", "SECTION_HEAD", "TEAM_HEAD",
          "DIRECTOR", "MEMBER",
        ],
        "invalid_assignment_position_code",
      ),
      assignmentKind: enumValue(
        assignment.assignmentKind,
        ["primary", "secondary"],
        "invalid_assignment_kind",
      ),
      headKind,
      canApprove: booleanValue(assignment.canApprove, "invalid_assignment_can_approve"),
      effectiveFrom: nullableBoundedString(
        assignment.effectiveFrom,
        64,
        "invalid_assignment_effective_from",
      ),
      effectiveTo: nullableBoundedString(
        assignment.effectiveTo,
        64,
        "invalid_assignment_effective_to",
      ),
      active: booleanValue(assignment.active, "invalid_assignment_active"),
    };
  });

  const reportingOverrides = boundedArray(
    organization.reportingOverrides,
    2000,
    "invalid_organization_reporting_overrides",
  ).map((rawOverride) => {
    const reportingOverride = objectValue(rawOverride, "invalid_organization_reporting_override");
    return {
      id: boundedString(reportingOverride.id, 160, "invalid_reporting_override_id"),
      financeUserId: boundedString(
        reportingOverride.financeUserId,
        160,
        "invalid_reporting_override_finance_user_id",
      ),
      supervisorFinanceUserId: boundedString(
        reportingOverride.supervisorFinanceUserId,
        160,
        "invalid_reporting_override_supervisor_id",
      ),
      effectiveFrom: nullableBoundedString(
        reportingOverride.effectiveFrom,
        64,
        "invalid_reporting_override_effective_from",
      ),
      effectiveTo: nullableBoundedString(
        reportingOverride.effectiveTo,
        64,
        "invalid_reporting_override_effective_to",
      ),
      active: booleanValue(reportingOverride.active, "invalid_reporting_override_active"),
    };
  });

  return {
    tenantId: organizationTenantId,
    versionId: uuidString(organization.versionId, "invalid_organization_version_id"),
    versionNo,
    etag,
    schemaVersion: ORGANIZATION_SCHEMA_VERSION,
    publishedAt: occurredAt(organization.publishedAt),
    units,
    assignments,
    reportingOverrides,
  };
}

export function buildPushEnvelope(claim, rawSnapshot) {
  const common = commonEnvelope(claim);
  const snapshot = validateSnapshot(claim, rawSnapshot, common.schemaVersion);
  const tenantId = uuidString(claim.tenant_id, "invalid_tenant_id");
  const aggregateId = boundedString(claim.aggregate_id, 160, "invalid_aggregate_id");

  let envelope;
  if (common.eventType === "member.changed") {
    const identity = objectValue(snapshot.identity, "invalid_identity");
    const company = objectValue(snapshot.company, "invalid_company");
    if (String(identity.financeUserId ?? "").trim() !== aggregateId) {
      throw new SyncContractError("member_aggregate_mismatch");
    }
    if (!identity.tenantId || String(identity.tenantId).toLowerCase() !== tenantId) {
      throw new SyncContractError("member_tenant_mismatch");
    }
    if (!company.tenantId || String(company.tenantId).toLowerCase() !== tenantId) {
      throw new SyncContractError("company_tenant_mismatch");
    }
    envelope = {
      ...common,
      identity,
      company,
    };
    if (snapshot.actors && typeof snapshot.actors === "object" && !Array.isArray(snapshot.actors)) {
      envelope.actors = snapshot.actors;
    }
    if (typeof snapshot.workflowReady === "boolean") {
      envelope.workflowReady = snapshot.workflowReady;
    }
    const issues = validatedIssues(snapshot.issues);
    if (issues !== undefined) envelope.issues = issues;
  } else if (common.eventType === "company.changed") {
    const company = objectValue(snapshot.company, "invalid_company");
    if (String(company.entityId ?? "").trim() !== aggregateId) {
      throw new SyncContractError("company_aggregate_mismatch");
    }
    if (String(company.tenantId ?? "").toLowerCase() !== tenantId) {
      throw new SyncContractError("company_tenant_mismatch");
    }
    envelope = { ...common, company };
  } else {
    if (aggregateId.toLowerCase() !== tenantId) {
      throw new SyncContractError("organization_aggregate_mismatch");
    }
    const organization = sanitizeOrganization(
      snapshot.organization,
      tenantId,
      common.sourceRevision,
    );
    envelope = { ...common, tenantId, organization };
  }

  const rawBody = JSON.stringify(envelope);
  const maximumBodyBytes = common.eventType === "organization.published"
    ? MAX_ORGANIZATION_PUSH_BODY_BYTES
    : MAX_PUSH_BODY_BYTES;
  if (encoder.encode(rawBody).byteLength > maximumBodyBytes) {
    throw new SyncContractError("push_body_too_large");
  }
  return { envelope, rawBody };
}

function bytesToHex(value) {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function canonicalHmacMessage(timestamp, nonce, rawBody) {
  return `${timestamp}.${nonce}.${rawBody}`;
}

export async function hmacHex(secret, timestamp, nonce, rawBody) {
  if (encoder.encode(String(secret || "")).byteLength < MIN_SECRET_BYTES) {
    throw new SyncContractError("bridge_secret_not_configured");
  }
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(canonicalHmacMessage(timestamp, nonce, rawBody)),
  );
  return bytesToHex(signature);
}

export async function sha256Hex(value) {
  return bytesToHex(await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(String(value))));
}

export async function constantTimeTextEqual(expected, provided) {
  const expectedBytes = encoder.encode(String(expected || ""));
  if (expectedBytes.byteLength < MIN_SECRET_BYTES) return false;
  const [left, right] = await Promise.all([
    globalThis.crypto.subtle.digest("SHA-256", expectedBytes),
    globalThis.crypto.subtle.digest("SHA-256", encoder.encode(String(provided || ""))),
  ]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let difference = leftBytes.byteLength ^ rightBytes.byteLength;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    difference |= leftBytes[index] ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export function classifyEdocResponse(status, rawBody) {
  let body = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new SyncContractError("edoc_response_not_json", { httpStatus: status });
  }
  if (!body || Array.isArray(body) || typeof body !== "object") {
    throw new SyncContractError("edoc_response_invalid", { httpStatus: status });
  }

  // Preserve a bounded machine-readable receiver error for non-conflict HTTP
  // failures.  This never stores response text or personal data, but makes a
  // contract rejection diagnosable instead of collapsing every 4xx into
  // ``edoc_response_missing_outcome``.
  if ((status < 200 || status >= 300) && status !== 409) {
    const receiverError = typeof body.error === "string" ? body.error.trim().toLowerCase() : "";
    if (/^[a-z0-9_.:-]{1,120}$/.test(receiverError)) {
      throw new SyncContractError(`edoc_http_${status}_${receiverError}`, { httpStatus: status });
    }
  }

  const outcomes = ["applied", "stale", "replayed"];
  const pinnedOutcome = typeof body.status === "string" && outcomes.includes(body.status)
    ? body.status
    : null;
  if (body.status !== undefined && pinnedOutcome === null) {
    throw new SyncContractError("edoc_response_invalid_outcome", { httpStatus: status });
  }

  for (const outcome of outcomes) {
    if (body[outcome] !== undefined && typeof body[outcome] !== "boolean") {
      throw new SyncContractError("edoc_response_invalid_outcome", { httpStatus: status });
    }
  }
  const trueBooleanOutcomes = outcomes.filter((outcome) => body[outcome] === true);
  let outcome = pinnedOutcome;
  if (outcome) {
    // `status` is the pinned contract. A boolean, when supplied for backwards
    // compatibility, must affirm that same outcome and may not contradict it.
    if ((body[outcome] !== undefined && body[outcome] !== true) ||
        trueBooleanOutcomes.some((candidate) => candidate !== outcome)) {
      throw new SyncContractError("edoc_response_outcome_mismatch", { httpStatus: status });
    }
  } else if (trueBooleanOutcomes.length === 1) {
    outcome = trueBooleanOutcomes[0];
  } else if (trueBooleanOutcomes.length > 1) {
    throw new SyncContractError("edoc_response_outcome_mismatch", { httpStatus: status });
  } else {
    throw new SyncContractError("edoc_response_missing_outcome", { httpStatus: status });
  }

  const acceptedStatus = status >= 200 && status < 300;
  const conflictResolution = status === 409 && (outcome === "stale" || outcome === "replayed");
  if (!acceptedStatus && !conflictResolution) {
    throw new SyncContractError(`edoc_http_${status}`, { httpStatus: status });
  }
  return outcome;
}

export function safeErrorCode(error) {
  const raw = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : error instanceof Error
      ? error.name
      : "unknown_error";
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160);
  return normalized || "unknown_error";
}

export function retryAfterSeconds(value) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(Math.max(Math.round(seconds), 30), 21600);
}
