#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migrationsDirectory = path.join(root, 'supabase', 'migrations');
const expectedMigrationName = '20260821094614_finance_runtime_contract_v1.sql';
const expectedMigrationPath = path.join(migrationsDirectory, expectedMigrationName);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function requirePattern(sql, pattern, description) {
  if (!pattern.test(sql)) {
    fail(description);
  }
}

function forbidPattern(sql, pattern, description) {
  if (pattern.test(sql)) {
    fail(description);
  }
}

function splitTopLevelSql(source) {
  const statements = [];
  const errors = [];
  let current = '';
  let state = 'normal';
  let dollarTag = null;
  let blockCommentDepth = 0;

  function appendSpace() {
    if (current.length > 0 && !/\s$/.test(current)) current += ' ';
  }

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === 'line_comment') {
      if (character === '\n') {
        appendSpace();
        state = 'normal';
      }
      continue;
    }

    if (state === 'block_comment') {
      if (character === '/' && next === '*') {
        blockCommentDepth += 1;
        index += 1;
      } else if (character === '*' && next === '/') {
        blockCommentDepth -= 1;
        index += 1;
        if (blockCommentDepth === 0) {
          appendSpace();
          state = 'normal';
        }
      }
      continue;
    }

    if (state === 'single_quote') {
      current += character;
      if (character === "'" && next === "'") {
        current += next;
        index += 1;
      } else if (character === "'") {
        state = 'normal';
      }
      continue;
    }

    if (state === 'double_quote') {
      current += character;
      if (character === '"' && next === '"') {
        current += next;
        index += 1;
      } else if (character === '"') {
        state = 'normal';
      }
      continue;
    }

    if (state === 'dollar_quote') {
      if (source.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length - 1;
        dollarTag = null;
        state = 'normal';
      } else {
        current += character;
      }
      continue;
    }

    if (character === '-' && next === '-') {
      appendSpace();
      state = 'line_comment';
      index += 1;
    } else if (character === '/' && next === '*') {
      appendSpace();
      state = 'block_comment';
      blockCommentDepth = 1;
      index += 1;
    } else if (character === "'") {
      current += character;
      state = 'single_quote';
    } else if (character === '"') {
      current += character;
      state = 'double_quote';
    } else if (character === '$') {
      const match = source.slice(index).match(/^(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/);
      if (match) {
        dollarTag = match[1];
        current += dollarTag;
        index += dollarTag.length - 1;
        state = 'dollar_quote';
      } else {
        current += character;
      }
    } else if (character === ';') {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
    } else {
      current += character;
    }
  }

  if (state !== 'normal' && state !== 'line_comment') {
    errors.push(`unterminated SQL lexical state: ${state}`);
  }
  if (current.trim()) errors.push('migration must end each top-level statement with a semicolon');
  return { statements, errors };
}

function extractDollarBody(statement, tag) {
  const first = statement.indexOf(tag);
  const last = statement.lastIndexOf(tag);
  if (first === -1 || last === first) return null;
  if (statement.indexOf(tag, first + tag.length) !== last) return null;
  return statement.slice(first + tag.length, last);
}

function scrubSqlLiteralsAndComments(source) {
  let output = '';
  let state = 'normal';
  let dollarTag = null;
  let blockCommentDepth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === 'line_comment') {
      output += character === '\n' ? '\n' : ' ';
      if (character === '\n') state = 'normal';
      continue;
    }
    if (state === 'block_comment') {
      output += ' ';
      if (character === '/' && next === '*') {
        output += ' ';
        blockCommentDepth += 1;
        index += 1;
      } else if (character === '*' && next === '/') {
        output += ' ';
        blockCommentDepth -= 1;
        index += 1;
        if (blockCommentDepth === 0) state = 'normal';
      }
      continue;
    }
    if (state === 'single_quote') {
      output += ' ';
      if (character === "'" && next === "'") {
        output += ' ';
        index += 1;
      } else if (character === "'") {
        state = 'normal';
      }
      continue;
    }
    if (state === 'dollar_quote') {
      if (source.startsWith(dollarTag, index)) {
        output += ' '.repeat(dollarTag.length);
        index += dollarTag.length - 1;
        dollarTag = null;
        state = 'normal';
      } else {
        output += ' ';
      }
      continue;
    }

    if (character === '-' && next === '-') {
      output += '  ';
      state = 'line_comment';
      index += 1;
    } else if (character === '/' && next === '*') {
      output += '  ';
      state = 'block_comment';
      blockCommentDepth = 1;
      index += 1;
    } else if (character === "'") {
      output += ' ';
      state = 'single_quote';
    } else if (character === '$') {
      const match = source.slice(index).match(/^(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/);
      if (match) {
        dollarTag = match[1];
        output += ' '.repeat(dollarTag.length);
        index += dollarTag.length - 1;
        state = 'dollar_quote';
      } else {
        output += character;
      }
    } else if (character === '"') {
      // Preserve quoted identifier text so forbidden names cannot hide in quotes.
      output += ' ';
    } else {
      output += character;
    }
  }

  return { output, closed: state === 'normal' || state === 'line_comment' };
}

const allowedBodyFunctionCalls = new Set([
  'auth.jwt',
  'auth.uid',
  'coalesce',
  'pg_catalog.acldefault',
  'pg_catalog.aclexplode',
  'pg_catalog.array_agg',
  'pg_catalog.array_to_string',
  'pg_catalog.bool_and',
  'pg_catalog.cardinality',
  'pg_catalog.count',
  'pg_catalog.jsonb_agg',
  'pg_catalog.jsonb_build_array',
  'pg_catalog.jsonb_build_object',
  'pg_catalog.jsonb_each',
  'pg_catalog.jsonb_object_length',
  'pg_catalog.jsonb_typeof',
  'pg_catalog.statement_timestamp',
  'pg_catalog.to_jsonb',
  'pg_catalog.to_regprocedure',
  'pg_catalog.unnest',
  'public.finance_runtime_contract',
]);

const sqlCallSyntaxKeywords = new Set(['and', 'exists', 'filter', 'from', 'in', 'not', 'values']);

function auditReadOnlyBody(label, body, allowedRelations) {
  const errors = [];
  const scrubbedResult = scrubSqlLiteralsAndComments(body);
  if (!scrubbedResult.closed) {
    errors.push(`${label}: unterminated literal or comment`);
    return errors;
  }

  let scrubbed = scrubbedResult.output.toLowerCase();
  // These are column-alias declarations, not calls. Strip only their exact,
  // reviewed shapes before applying the function-call allowlist.
  scrubbed = scrubbed
    .replace(/\bas\s+required_procedure\s*\(\s*signature\s*\)/g, ' ')
    .replace(/\bas\s+capability_row\s*\(\s*ordinal\s*,\s*name\s*,\s*available\s*\)/g, ' ')
    .replace(/\bas\s+required_capability\s*\(\s*name\s*,\s*ordinal\s*\)/g, ' ')
    .replace(/\brequired_capability\s*\(\s*name\s*\)/g, ' ');

  const forbiddenPatterns = [
    [/\b(?:insert|update|delete|merge|truncate|copy|call|execute|perform|create|alter|drop|grant|revoke|comment|notify|set|reset|do|lock|vacuum|analyze|reindex|cluster|refresh|listen|unlisten|discard|checkpoint|prepare|deallocate|commit|rollback|savepoint)\b/, 'write/DDL/session/dynamic SQL keyword'],
    [/\bsecurity\s+label\b/, 'SECURITY LABEL DDL'],
    [/\bcreate\s+(?:foreign\s+data\s+wrapper|server|user\s+mapping|extension)\b/, 'foreign object or extension DDL'],
    [/\b(?:dblink(?:_[a-z0-9_]+)?|https?)\s*\(/, 'external dblink/http function'],
    [/\bnet\s*\.\s*http[a-z0-9_]*\s*\(/, 'pg_net HTTP function'],
    [/\b(?:pg_net|foreign|extension|program)\b/, 'external/foreign/program capability'],
    [/\b(?:set_config|lo_import|lo_export|pg_read_file|pg_read_binary_file|pg_write_file|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_sleep|nextval|setval)\s*\(/, 'stateful or server-side function'],
  ];
  for (const [pattern, description] of forbiddenPatterns) {
    if (pattern.test(scrubbed)) errors.push(`${label}: forbidden ${description}`);
  }

  const relationPattern = /\b(from|join)\s+(?:only\s+)?([a-z_][a-z0-9_$]*(?:\s*\.\s*[a-z_][a-z0-9_$]*)?)/g;
  let relationMatch;
  while ((relationMatch = relationPattern.exec(scrubbed)) !== null) {
    const prefix = scrubbed.slice(Math.max(0, relationMatch.index - 20), relationMatch.index);
    if (relationMatch[1] === 'from' && /\bdistinct\s*$/.test(prefix)) continue;
    const relation = relationMatch[2].replace(/\s+/g, '');
    if (!allowedRelations.has(relation)) {
      errors.push(`${label}: relation/source is not allowlisted: ${relation}`);
    }
  }

  const callPattern = /\b((?:[a-z_][a-z0-9_$]*\s*\.\s*)?[a-z_][a-z0-9_$]*)\s*\(/g;
  let callMatch;
  while ((callMatch = callPattern.exec(scrubbed)) !== null) {
    const call = callMatch[1].replace(/\s+/g, '');
    if (!allowedBodyFunctionCalls.has(call) && !sqlCallSyntaxKeywords.has(call)) {
      const context = scrubbed.slice(Math.max(0, callMatch.index - 50), callPattern.lastIndex + 20).replace(/\s+/g, ' ');
      errors.push(`${label}: function/call is not allowlisted: ${call} near ${context}`);
    }
  }

  return [...new Set(errors)];
}

function validateMigrationSource(candidateSql) {
  const result = splitTopLevelSql(candidateSql);
  const errors = [...result.errors];
  const statementRules = [
    ['BEGIN', /^begin$/i],
    ['SET LOCAL lock_timeout', /^set\s+local\s+lock_timeout\s*=\s*'5s'$/i],
    ['SET LOCAL statement_timeout', /^set\s+local\s+statement_timeout\s*=\s*'60s'$/i],
    ['preflight DO', /^do\s+\$preflight\$[\s\S]*\$preflight\$$/i],
    ['CREATE FUNCTION exact target', /^create\s+function\s+public\.finance_runtime_contract\s*\(\s*\)\s+returns\s+jsonb\s+language\s+plpgsql\s+stable\s+security\s+invoker\s+set\s+search_path\s*=\s*''\s+as\s+\$function\$[\s\S]*\$function\$$/i],
    ['ALTER FUNCTION exact owner', /^alter\s+function\s+public\.finance_runtime_contract\s*\(\s*\)\s+owner\s+to\s+postgres$/i],
    ['REVOKE exact ACL reset', /^revoke\s+all\s+on\s+function\s+public\.finance_runtime_contract\s*\(\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role$/i],
    ['GRANT exact ACL', /^grant\s+execute\s+on\s+function\s+public\.finance_runtime_contract\s*\(\s*\)\s+to\s+authenticated\s*,\s*service_role$/i],
    ['COMMENT exact target', /^comment\s+on\s+function\s+public\.finance_runtime_contract\s*\(\s*\)\s+is\s+'(?:''|[^'])*'$/i],
    ['catalog postflight DO', /^do\s+\$postflight_catalog\$[\s\S]*\$postflight_catalog\$$/i],
    ['SET LOCAL ROLE service_role', /^set\s+local\s+role\s+service_role$/i],
    ['payload postflight DO', /^do\s+\$postflight_payload\$[\s\S]*\$postflight_payload\$$/i],
    ['RESET ROLE', /^reset\s+role$/i],
    ['NOTIFY PostgREST', /^notify\s+pgrst\s*,\s*'reload schema'$/i],
    ['COMMIT', /^commit$/i],
  ];

  if (result.statements.length !== statementRules.length) {
    errors.push(`expected exactly ${statementRules.length} top-level statements, found ${result.statements.length}`);
  }
  for (let index = 0; index < Math.max(result.statements.length, statementRules.length); index += 1) {
    const statement = result.statements[index];
    const rule = statementRules[index];
    if (!statement || !rule || !rule[1].test(statement)) {
      errors.push(`top-level statement ${index + 1} must be ${rule ? rule[0] : 'absent'}`);
    }
  }

  const bodySpecs = [
    [3, '$preflight$', 'preflight', new Set(['pg_catalog.pg_proc', 'pg_catalog.pg_namespace'])],
    [4, '$function$', 'runtime function', new Set(['pg_catalog.pg_class', 'pg_catalog.pg_namespace'])],
    [9, '$postflight_catalog$', 'catalog postflight', new Set(['pg_catalog.pg_roles', 'pg_catalog.pg_proc', 'pg_catalog.pg_namespace', 'pg_catalog.aclexplode'])],
    [11, '$postflight_payload$', 'payload postflight', new Set(['pg_catalog.unnest', 'pg_catalog.jsonb_each'])],
  ];
  for (const [statementIndex, tag, label, allowedRelations] of bodySpecs) {
    const statement = result.statements[statementIndex];
    if (!statement) continue;
    const body = extractDollarBody(statement, tag);
    if (body === null) {
      errors.push(`${label}: expected exactly one ${tag} body`);
    } else {
      errors.push(...auditReadOnlyBody(label, body, allowedRelations));
    }
  }

  return [...new Set(errors)];
}

if (!fs.existsSync(expectedMigrationPath)) {
  fail(`missing migration ${expectedMigrationName}`);
  process.exit();
}

const candidates = fs
  .readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith('_finance_runtime_contract_v1.sql'));

if (candidates.length !== 1 || candidates[0] !== expectedMigrationName) {
  fail(`expected one canonical runtime-contract migration, found: ${candidates.join(', ') || 'none'}`);
}

const sql = fs.readFileSync(expectedMigrationPath, 'utf8');

const requiredCapabilities = [
  'member_admin_atomic_v1',
  'organization_versions_v1',
  'expense_submit_org_guard_v1',
  'expense_resubmit_org_guard_v1',
  'approval_participant_history_v1',
];

const expectedCapabilityConstants = {
  member_admin_atomic_v1: { available: false, rpc: 'finance_admin_upsert_member_atomic_v1' },
  organization_versions_v1: {
    available: false,
    read_rpc: 'membership_org_get_published_graph',
    validate_rpc: 'membership_org_validate_draft',
    publish_rpc: 'membership_org_publish_draft',
  },
  expense_submit_org_guard_v1: { available: false, rpc: 'finance_submit_expense_request' },
  expense_resubmit_org_guard_v1: { available: false, rpc: 'finance_resubmit_expense_request' },
  approval_participant_history_v1: {
    available: false,
    rpc: 'finance_approval_participant_history_for_current_user',
  },
  bulk_jobs_v1: { available: false, policy: 'unsupported_no_client_side_fallback' },
  workflow_command_ledger_v1: { available: false, policy: 'not_yet_installed' },
  workflow_admin_v1: { available: false, policy: 'disabled_until_manifested' },
  membership_change_sets_v1: { available: false, policy: 'disabled_until_manifested' },
  membership_permission_catalog_v1: { available: false, policy: 'disabled_until_manifested' },
  membership_org_bulk_v1: { available: false, policy: 'disabled_until_manifested' },
};

const expectedTopLevelKeys = [
  'contract_name',
  'contract_version',
  'generated_at',
  'api_contract',
  'schema_contract',
  'deployment_manifest',
  'release',
  'client_compatibility',
  'required_capabilities',
  'capability_policy',
  'capability_verification',
  'required_capabilities_present',
  'server_capabilities_ready',
  'missing_required_capabilities',
  'capabilities',
  'limits',
  'caller',
];

const exactTopLevelValues = {
  api_contract: {
    name: 'finance-api',
    version: '2026-08-21.1',
    rpc: 'finance_runtime_contract',
    rpc_arguments: [],
    overloads_supported: false,
  },
  schema_contract: {
    name: 'finance-schema',
    version: '2026-08-21.1',
    migration: '20260821094614_finance_runtime_contract_v1',
    verification_scope: 'required_relations_and_rpc_signatures',
  },
  deployment_manifest: {
    manifest_version: 1,
    contract_migration: '20260821094614',
    required_migration_head: null,
    candidate_local_prerequisite_floor: '20260821170000',
    observed_migration_head: null,
    migration_history_verified: false,
    source: 'embedded_candidate_manifest',
    update_policy: 'new_migration_only',
  },
  release: {
    phase: 'candidate_blocked',
    server_contract_build: '20260821094614',
    writes_enabled: false,
    block_reason: 'minimum_client_build_not_activated',
  },
  client_compatibility: {
    minimum_protocol: 1,
    maximum_protocol: 1,
    minimum_client_build: null,
    build_gate_configured: false,
    server_accepts_writes: false,
    on_mismatch: 'read_only_no_fallback',
  },
  required_capabilities: requiredCapabilities,
  capability_policy: {
    required_core: 'all_must_be_verified_before_activation',
    optional_or_dormant: 'disabled_unless_declared_available',
    unknown_capability: 'deny',
    fallback_to_legacy_rpc: false,
  },
  limits: {
    approval_history_page: { default: 50, maximum: 50 },
    organization_version_page: { default: 40, maximum: 100 },
    expense_actor_requests: { maximum: 50 },
    organization_snapshot_schema_version: 2,
    bulk_submit: { supported: false, maximum_items: null, policy: 'do_not_split_or_fallback' },
  },
  caller: { kind: 'service_role', permanent_user: null },
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJson(value, right[index]));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return sameJson(leftKeys, rightKeys) && leftKeys.every((key) => sameJson(left[key], right[key]));
}

function validatePostflightPayload(payload) {
  if (!isPlainObject(payload)) return false;
  if (!sameJson(Object.keys(payload).sort(), [...expectedTopLevelKeys].sort())) return false;
  if (payload.contract_name !== 'finance_runtime_contract' || payload.contract_version !== 1) return false;
  if (typeof payload.generated_at !== 'string') return false;
  for (const [key, expected] of Object.entries(exactTopLevelValues)) {
    if (!sameJson(payload[key], expected)) return false;
  }
  if (payload.capability_verification !== 'signature_presence_only') return false;
  if (payload.server_capabilities_ready !== false) return false;
  if (!isPlainObject(payload.capabilities)) return false;
  if (!sameJson(Object.keys(payload.capabilities).sort(), Object.keys(expectedCapabilityConstants).sort())) return false;

  for (const [name, expectedConstants] of Object.entries(expectedCapabilityConstants)) {
    const actual = payload.capabilities[name];
    if (!isPlainObject(actual) || actual.available !== false) return false;
    if (requiredCapabilities.includes(name)) {
      if (typeof actual.present !== 'boolean') return false;
      const { present, ...constants } = actual;
      void present;
      if (!sameJson(constants, expectedConstants)) return false;
    } else if (!sameJson(actual, expectedConstants)) {
      return false;
    }
  }

  const expectedMissing = requiredCapabilities.filter((name) => payload.capabilities[name].present !== true);
  if (!sameJson(payload.missing_required_capabilities, expectedMissing)) return false;
  if (payload.required_capabilities_present !== (expectedMissing.length === 0)) return false;
  return true;
}

const postflightFixture = {
  contract_name: 'finance_runtime_contract',
  contract_version: 1,
  generated_at: '2026-08-21T09:46:14.000Z',
  ...exactTopLevelValues,
  capability_verification: 'signature_presence_only',
  required_capabilities_present: true,
  server_capabilities_ready: false,
  missing_required_capabilities: [],
  capabilities: Object.fromEntries(
    Object.entries(expectedCapabilityConstants).map(([name, constants]) => [
      name,
      requiredCapabilities.includes(name) ? { present: true, ...constants } : { ...constants },
    ])
  ),
};

function collectObjectKeyPaths(value, prefix = [], paths = []) {
  if (!isPlainObject(value) && !Array.isArray(value)) return paths;
  for (const key of Object.keys(value)) {
    const pathParts = [...prefix, key];
    paths.push(pathParts);
    collectObjectKeyPaths(value[key], pathParts, paths);
  }
  return paths;
}

function deleteAtPath(value, pathParts) {
  let cursor = value;
  for (let index = 0; index < pathParts.length - 1; index += 1) {
    cursor = cursor[pathParts[index]];
  }
  const finalKey = pathParts[pathParts.length - 1];
  if (Array.isArray(cursor)) cursor.splice(Number(finalKey), 1);
  else delete cursor[finalKey];
}

let dynamicDeletionChecks = 0;

if (!validatePostflightPayload(postflightFixture)) {
  fail('dynamic postflight fixture must pass before mutation');
} else {
  for (const pathParts of collectObjectKeyPaths(postflightFixture)) {
    dynamicDeletionChecks += 1;
    const mutated = JSON.parse(JSON.stringify(postflightFixture));
    deleteAtPath(mutated, pathParts);
    if (validatePostflightPayload(mutated)) {
      fail(`deleting required payload key must fail: ${pathParts.join('.')}`);
    }
  }
  for (const capabilityName of Object.keys(postflightFixture.capabilities)) {
    const mutated = JSON.parse(JSON.stringify(postflightFixture));
    mutated.capabilities[capabilityName].available = true;
    if (validatePostflightPayload(mutated)) {
      fail(`candidate capability must never become available: ${capabilityName}`);
    }
  }
  const extraKeyFixture = JSON.parse(JSON.stringify(postflightFixture));
  extraKeyFixture.unreviewed_extension = true;
  if (validatePostflightPayload(extraKeyFixture)) {
    fail('unreviewed top-level payload keys must fail exact-key validation');
  }
}

const sourceValidationErrors = validateMigrationSource(sql);
for (const error of sourceValidationErrors) {
  fail(`migration source allowlist: ${error}`);
}

function insertBeforeCommit(source, injectedStatement) {
  if (!/\bcommit\s*;\s*$/i.test(source)) {
    throw new Error('canonical migration does not end with COMMIT');
  }
  return source.replace(/\bcommit\s*;\s*$/i, `${injectedStatement}\ncommit;\n`);
}

function insertBeforePayloadPostflightEnd(source, injectedStatement) {
  const ending = /\nend;\s*\n\$postflight_payload\$;/i;
  if (!ending.test(source)) {
    throw new Error('canonical migration does not contain the payload postflight ending');
  }
  return source.replace(ending, (match) => `\n  ${injectedStatement}${match}`);
}

const sourceMutationFixtures = [
  {
    name: 'DELETE application rows',
    sql: insertBeforeCommit(sql, 'delete from public.finance_users;'),
    expectedError: /top-level statement|expected exactly/,
  },
  {
    name: 'UPDATE application rows',
    sql: insertBeforeCommit(sql, 'update public.finance_users set active = false;'),
    expectedError: /top-level statement|expected exactly/,
  },
  {
    name: 'TRUNCATE application table',
    sql: insertBeforeCommit(sql, 'truncate table public.finance_users;'),
    expectedError: /top-level statement|expected exactly/,
  },
  {
    name: 'COPY TO PROGRAM',
    sql: insertBeforeCommit(sql, "copy public.finance_users to program 'id';"),
    expectedError: /top-level statement|expected exactly/,
  },
  {
    name: 'dblink side effect',
    sql: insertBeforePayloadPostflightEnd(
      sql,
      "perform dblink_exec('dbname=postgres', 'delete from public.finance_users');"
    ),
    expectedError: /external dblink\/http function/,
  },
  {
    name: 'dynamic EXECUTE inside audited postflight',
    sql: insertBeforePayloadPostflightEnd(sql, "execute 'delete from public.finance_users';"),
    expectedError: /write\/DDL\/session\/dynamic SQL keyword/,
  },
];

let sourceMutationChecks = 0;
for (const fixture of sourceMutationFixtures) {
  sourceMutationChecks += 1;
  if (fixture.sql === sql) {
    fail(`source mutation fixture did not alter migration: ${fixture.name}`);
  } else {
    const errors = validateMigrationSource(fixture.sql);
    if (errors.length === 0) {
      fail(`source mutation fixture must fail read-only allowlist: ${fixture.name}`);
    } else if (!errors.some((error) => fixture.expectedError.test(error))) {
      fail(`source mutation fixture failed for the wrong reason: ${fixture.name}: ${errors.join(' | ')}`);
    }
  }
}

requirePattern(
  sql,
  /create\s+function\s+public\.finance_runtime_contract\s*\(\s*\)/i,
  'runtime RPC must have one canonical zero-argument signature'
);
forbidPattern(sql, /create\s+or\s+replace\s+function\s+public\.finance_runtime_contract/i, 'runtime RPC install must be non-rerunnable');
requirePattern(sql, /security\s+invoker/i, 'runtime RPC must use SECURITY INVOKER');
requirePattern(sql, /set\s+search_path\s*=\s*''/i, 'runtime RPC must pin an empty search_path');
forbidPattern(sql, /finance_runtime_contract\s*\([^)]*\)[\s\S]{0,200}security\s+definer/i, 'runtime RPC must never use SECURITY DEFINER');

requirePattern(
  sql,
  /revoke\s+all\s+on\s+function\s+public\.finance_runtime_contract\s*\(\s*\)[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role\s*;/i,
  'runtime RPC must reset execute ACLs for PUBLIC, anon, authenticated, and service_role'
);
requirePattern(
  sql,
  /grant\s+execute\s+on\s+function\s+public\.finance_runtime_contract\s*\(\s*\)[\s\S]*?to\s+authenticated\s*,\s*service_role\s*;/i,
  'runtime RPC must grant only authenticated and service_role execution'
);
forbidPattern(
  sql,
  /grant\s+execute[\s\S]{0,160}\bto\s+(?:public|anon)\b/i,
  'runtime RPC must not grant execution to PUBLIC or anon'
);

const requiredSignatures = [
  'public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)',
  'public.membership_org_get_published_graph()',
  'public.membership_org_validate_draft(uuid)',
  'public.membership_org_publish_draft(uuid,timestamp with time zone)',
  'public.finance_submit_expense_request(jsonb,uuid,text,jsonb)',
  'public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb)',
  'public.finance_approval_participant_history_for_current_user(integer,integer,text,text)',
];

for (const signature of requiredSignatures) {
  if (!sql.includes(signature)) {
    fail(`missing prerequisite/capability signature: ${signature}`);
  }
}

const requiredPayloadLiterals = [
  "'contract_name', 'finance_runtime_contract'",
  "'contract_version', 1",
  "'version', '2026-08-21.1'",
  "'phase', 'candidate_blocked'",
  "'contract_migration', '20260821094614'",
  "'required_migration_head', null",
  "'candidate_local_prerequisite_floor', '20260821170000'",
  "'observed_migration_head', null",
  "'migration_history_verified', false",
  "'update_policy', 'new_migration_only'",
  "'writes_enabled', false",
  "'minimum_client_build', null",
  "'build_gate_configured', false",
  "'server_accepts_writes', false",
  "'capability_verification', 'signature_presence_only'",
  "'server_capabilities_ready', false",
  "'required_core', 'all_must_be_verified_before_activation'",
  "'on_mismatch', 'read_only_no_fallback'",
  "'bulk_jobs_v1'",
  "'available', false",
  "'policy', 'unsupported_no_client_side_fallback'",
  "'optional_or_dormant', 'disabled_unless_declared_available'",
  "'unknown_capability', 'deny'",
  "'fallback_to_legacy_rpc', false",
  "'workflow_admin_v1'",
  "'membership_change_sets_v1'",
  "'membership_permission_catalog_v1'",
  "'membership_org_bulk_v1'",
];

for (const literal of requiredPayloadLiterals) {
  if (!sql.includes(literal)) {
    fail(`missing fail-closed contract literal: ${literal}`);
  }
}

requirePattern(
  sql,
  /procedure_row\.proname\s*=\s*'finance_runtime_contract'[\s\S]*already exists; refusing a non-rerunnable install/i,
  'migration must reject every pre-existing same-name function'
);
requirePattern(
  sql,
  /set\s+local\s+role\s+service_role;[\s\S]*public\.finance_runtime_contract\s*\(\s*\)/i,
  'postflight must execute and validate the payload as an allowed API role'
);
requirePattern(sql, /pg_catalog\.aclexplode[\s\S]*v_acl_count\s*<>\s*3/i, 'postflight must enforce an exact three-entry ACL');
requirePattern(sql, /pg_catalog\.jsonb_each\(v_contract\s*->\s*'capabilities'\)[\s\S]*'available'[\s\S]*'false'::jsonb/i, 'postflight must prove every candidate capability remains unavailable');
const postflightMatch = sql.match(/do\s+\$postflight_payload\$([\s\S]*?)\$postflight_payload\$\s*;/i);
if (!postflightMatch) {
  fail('missing executable postflight payload body');
} else {
  const postflightBody = postflightMatch[1];
  forbidPattern(postflightBody, /<>/, 'payload postflight must not use NULL-unsafe <> comparisons');
  requirePattern(postflightBody, /v_contract\s*\?&\s*v_required_top_level_keys/i, 'payload postflight must require every top-level key');
  requirePattern(postflightBody, /jsonb_object_length\(v_contract\)[\s\S]*cardinality\(v_required_top_level_keys\)/i, 'payload postflight must reject extra top-level keys');
  requirePattern(postflightBody, /'caller'[\s\S]*'kind'\s*,\s*'service_role'/i, 'service_role postflight must prove the service-role caller branch');
  const distinctComparisons = postflightBody.match(/is\s+distinct\s+from/gi) || [];
  if (distinctComparisons.length < 25) {
    fail(`payload postflight needs comprehensive NULL-safe comparisons; found ${distinctComparisons.length}`);
  }
  const requiredKeyNames = new Set(
    collectObjectKeyPaths(postflightFixture)
      .map((pathParts) => pathParts[pathParts.length - 1])
      .filter((key) => !/^\d+$/.test(key))
  );
  for (const key of requiredKeyNames) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const appearsAsJsonPathPart = new RegExp(`(?:\\{|,)${escapedKey}(?:,|\\})`).test(postflightBody);
    if (!postflightBody.includes(`'${key}'`) && !appearsAsJsonPathPart) {
      fail(`SQL postflight does not name required payload key: ${key}`);
    }
  }
}
for (const literal of [
  'v_procedure.proowner <> v_postgres_oid',
  "v_procedure.prokind <> 'f'",
  'v_procedure.pronargs <> 0',
  'v_procedure.pronargdefaults <> 0',
  "v_procedure.prorettype <> 'pg_catalog.jsonb'::pg_catalog.regtype",
  'v_procedure.proconfig is distinct from array[\'search_path=""\']::text[]',
  'acl_row.grantor = v_postgres_oid',
  'acl_row.is_grantable is false',
]) {
  if (!sql.includes(literal)) {
    fail(`missing exact catalog/ACL postflight: ${literal}`);
  }
}
requirePattern(sql, /from\s+pg_catalog\.pg_class[\s\S]*namespace_row\.nspname\s*=\s*'private'/i, 'private capability detection must use readable pg_catalog metadata');
forbidPattern(sql, /to_regclass\s*\(\s*'private\./i, 'SECURITY INVOKER must not resolve private relations through schema USAGE');
requirePattern(sql, /notify\s+pgrst\s*,\s*'reload schema'\s*;/i, 'migration must reload the PostgREST schema cache');

forbidPattern(sql, /@[a-z0-9.-]+\.[a-z]{2,}/i, 'migration must not depend on a person-specific email');
forbidPattern(sql, /\b(cms\.ntpc|homecare\.taipei|蘇之瑄|尤雅婷|朱夏新)\b/i, 'migration must not depend on incident-specific people');

if (!process.exitCode) {
  console.log(
    `PASS: Finance runtime contract is single-signature, read-only, authenticated-only, fail-closed, and rejects ${dynamicDeletionChecks} required-key deletions plus ${sourceMutationChecks} side-effect mutations.`
  );
}
