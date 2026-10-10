#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const migration = read('supabase/migrations/20261010120000_finance_invoice_batch_approval_notification_v1.sql');
const preflight = read('scripts/finance_invoice_batch_approval_preflight.sql');
const postflight = read('scripts/finance_invoice_batch_approval_postflight.sql');
const fingerprint = read('scripts/finance_invoice_batch_approval_fingerprint.sql');
const canary = read('scripts/finance_invoice_batch_approval_canary.sql');
const body = migration.match(/as \$refresh\$([\s\S]*?)\$refresh\$;/)?.[1];
assert.ok(body, 'notification refresh trigger body exists');

const digest = crypto.createHash('md5').update(body).digest('hex');
assert.ok(postflight.includes(digest) && canary.includes(digest),
  'postflight and read-only canary pin the exact trigger source');

assert.match(migration, /create function private\.finance_refresh_invoice_batch_approval_notification_v1\(\)/i);
assert.doesNotMatch(migration, /(?:create\s+or\s+replace|alter)\s+function\s+private\.finance_enqueue_current_approval_email/i,
  'original one-event-per-batch producer and deep-link contract stay intact');
assert.match(migration, /trg_zz_invoices_refresh_batch_approval_notification_v1[\s\S]*?after insert or update of[\s\S]*?on public\.invoices[\s\S]*?for each row execute function/i,
  'the final inserted row must refresh the batch before commit');
assert.ok('trg_zz_invoices_refresh_batch_approval_notification_v1' > 'trg_invoices_enqueue_approval_email',
  'refresh trigger must sort after the existing enqueue trigger');

assert.match(body, /i\.tenant_id\s*=\s*new\.tenant_id/);
assert.match(body, /i\.data_environment\s*=\s*new\.data_environment/);
assert.match(body, /i\.batch_id\s*=\s*v_batch_id/);
assert.match(body, /count\(\*\)[\s\S]*?count\(i\.total\)[\s\S]*?sum\(i\.total\)/i,
  'gross amount must come from complete invoice totals, not a first-row net amount');
assert.match(body, /v_invoice_count\s*<\s*2\s+or\s+v_total_count\s*<>\s*v_invoice_count/i,
  'do not claim a batch total when any gross total is missing');

const update = body.match(/update public\.notification_delivery_events e([\s\S]*?)\n\s*return new;/i)?.[1];
assert.ok(update, 'notification event update exists');
for (const condition of [
  "s.source_table = 'invoices'",
  's.source_group_id = v_batch_id',
  's.notification_event_id = e.id',
  'e.tenant_id = new.tenant_id',
  'e.data_environment = new.data_environment',
  "e.event_type = 'approval_task_assigned'",
  "e.status = 'pending'",
  "e.payload ->> 'source_group_id' = v_batch_id",
  "e.payload ->> 'source_id' = s.source_record_id",
  "e.payload ->> 'source_no' = e.request_id",
]) assert.ok(update.includes(condition), `missing event authorization/safety condition: ${condition}`);
for (const key of ['batch_count', 'batch_total', 'amount', 'amount_kind']) {
  assert.ok(update.includes(`'${key}'`), `batch notification metadata ${key} exists`);
}
assert.match(update, /'amount',\s*v_gross_total::text/i);
assert.match(update, /'amount_kind',\s*'gross_batch_total'/i);
const setClause = update.split(/\n\s*from private\.approval_notification_assignment_state s/i)[0];
assert.doesNotMatch(setClause, /\b(?:source_id|source_no|request_id|source_group_id)\s*=/i,
  'direct-link identity columns must not be overwritten');

for (const sql of [preflight, migration, postflight, canary]) {
  assert.ok(sql.includes('ebae3a8045744a11bfa2892f04d80f2f'),
    'protected gates pin the existing event producer');
}
assert.match(preflight, /20261008100000/);
assert.match(postflight, /20261010120000/);
assert.doesNotMatch(fingerprint, /from\s+public\.(?:invoices|notification_delivery_events)\b/i,
  'fingerprint may read only catalog metadata');
assert.match(canary, /begin isolation level repeatable read read only;/i);
assert.doesNotMatch(canary, /(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:invoices|notification_delivery_events)\b/i,
  'canary must not mutate production invoices or notifications');

console.log('Invoice batch notification contract: PASS');
