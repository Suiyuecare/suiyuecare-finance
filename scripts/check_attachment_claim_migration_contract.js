#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const original = fs.readFileSync(path.join(
  root,
  'supabase/migrations/20260922133752_finance_document_identity_attachment_scope_v1.sql'
), 'utf8');
const migrationPath = path.join(
  root,
  'supabase/migrations/20261001030323_fix_attachment_claim_path_lookup.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');
const postflight = fs.readFileSync(path.join(
  root, 'scripts/finance_attachment_claim_postflight.sql'
), 'utf8');
const canary = fs.readFileSync(path.join(
  root, 'scripts/finance_attachment_claim_canary.sql'
), 'utf8');
const fingerprint = fs.readFileSync(path.join(
  root, 'scripts/finance_attachment_claim_fingerprint.sql'
), 'utf8');

const signature = 'CREATE OR REPLACE FUNCTION private.finance_claim_attachment_metadata_v2()';
function functionText(sql) {
  const start = sql.indexOf(signature);
  assert(start >= 0, 'attachment claim function is missing');
  const end = sql.indexOf('$function$;', start);
  assert(end > start, 'attachment claim function terminator is missing');
  return sql.slice(start, end + '$function$'.length);
}
function sourceText(definition) {
  const start = definition.indexOf('AS $function$');
  assert(start >= 0, 'function source delimiter is missing');
  return definition.slice(start + 'AS $function$'.length, -'$function$'.length);
}
function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

const oldDefinition = functionText(original);
const newDefinition = functionText(migration);
const oldStart = '  if exists(select 1 from public.file_attachments attachment\n'
  + '    where attachment.tenant_id=v_tenant_id and attachment.data_environment=v_environment\n';
const newStart = "  -- Evaluate the document's exact attachment paths once";
const tail = '  return new;\nend\n$function$';
const oldBlockStart = oldDefinition.indexOf(oldStart);
const newBlockStart = newDefinition.indexOf(newStart);
const oldTailStart = oldDefinition.lastIndexOf(tail);
const newTailStart = newDefinition.lastIndexOf(tail);

assert(oldBlockStart >= 0 && newBlockStart >= 0, 'targeted final IF was not found');
assert(oldTailStart > oldBlockStart && newTailStart > newBlockStart,
  'attachment claim function tail drifted');
assert.equal(oldDefinition.slice(0, oldBlockStart),
  newDefinition.slice(0, newBlockStart),
  'migration changed a prior attachment ownership or authorization guard');
assert.equal(oldDefinition.slice(oldTailStart), newDefinition.slice(newTailStart),
  'migration changed the trigger return or final function tail');
assert.match(newDefinition.slice(newBlockStart, newTailStart),
  /finance_attachment_paths_in_document_v2\(v_document\)/);
assert.match(newDefinition.slice(newBlockStart, newTailStart),
  /join public\.file_attachments attachment\s+on attachment\.storage_path = referenced_path\.storage_path/);
assert.doesNotMatch(newDefinition.slice(newBlockStart, newTailStart),
  /finance_json_contains_attachment_path_v2\(v_document,\s*attachment\.storage_path\)/);
for (const predicate of [
  "attachment.tenant_id=v_tenant_id",
  "attachment.data_environment=v_environment",
  "attachment.bucket_id='finance-attachments'",
  "attachment.attachment_state='claimed'",
  "finance_json_contains_attachment_path_v2(v_old_document,attachment.storage_path)",
  "l.attachment_id=attachment.id",
  "l.parent_key=v_document->>'id'",
  "l.tenant_id=v_tenant_id",
  "l.data_environment=v_environment"
]) {
  assert(newDefinition.slice(newBlockStart, newTailStart).includes(predicate),
    `final authorization guard lost predicate: ${predicate}`);
}

assert.equal(
  sha256(sourceText(oldDefinition)),
  '5ff6896a6b1d95f75d1a22405314afdb91a596e79e90e5d269b30907999ee7d7',
  'original migration no longer matches audited production trigger'
);
const expectedNewHash =
  'f6b0a07ae4ee42f178da9e09fa46aee85aa902cc98936175389449b06680bbe3';
assert.equal(sha256(sourceText(newDefinition)), expectedNewHash,
  'new trigger source no longer matches postflight fingerprint');
assert(postflight.includes(expectedNewHash),
  'postflight must pin the exact new trigger source');
assert(migration.includes('SECURITY DEFINER') &&
  migration.includes("SET search_path TO ''") &&
  migration.includes('ALTER FUNCTION private.finance_claim_attachment_metadata_v2() OWNER TO postgres;') &&
  migration.includes('REVOKE ALL ON FUNCTION private.finance_claim_attachment_metadata_v2() FROM PUBLIC, anon, authenticated;') &&
  migration.includes('GRANT EXECUTE ON FUNCTION private.finance_claim_attachment_metadata_v2() TO service_role;'),
  'migration must preserve the private trigger privilege boundary');
assert(canary.includes('FINANCE_ATTACHMENT_CLAIM_CANARY_ROLLED_BACK') &&
  canary.includes('attachment_claim_canary_result') &&
  canary.includes('rollback;'),
  'rollback-only attachment claim canary is incomplete');
assert(fingerprint.includes('FINANCE_ATTACHMENT_CLAIM_FINGERPRINT'),
  'attachment claim schema fingerprint is missing');

console.log('attachment claim migration contract: PASS');
