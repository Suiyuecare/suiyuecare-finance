import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHandler } from '../supabase/functions/finance-labor-external/handler.mjs';

const BASE = 'https://example.supabase.co/functions/v1/finance-labor-external';
const ORIGIN = 'https://finance.suiyuecare.com';
const TOKEN = 'A'.repeat(43);
const SID = '11111111-1111-4111-8111-111111111111';
const PENDING_SID = '66666666-6666-4666-8666-666666666666';
const SIGNED_PENDING_SID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT = '55555555-5555-4555-8555-555555555555';
const UPLOAD_ID = '22222222-2222-4222-8222-222222222222';
const SUBMIT_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = 'ER20260928001';
const ID_FRONT = '77777777-7777-4777-8777-777777777777';
const ID_BACK = '88888888-8888-4888-8888-888888888888';
const BANK_PROOF = '99999999-9999-4999-8999-999999999999';
const sha = value => createHash('sha256').update(value).digest('hex');
const jsonReq = (path, body, extra = {}) => new Request(`${BASE}${path}`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
const PNG = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const SIGNATURE_PATH = `${TENANT}/${SID}/uploads/${UPLOAD_ID}`;
const FRONT_PATH = `${TENANT}/${SID}/uploads/${ID_FRONT}`;
const BACK_PATH = `${TENANT}/${SID}/uploads/${ID_BACK}`;
const BANK_PATH = `${TENANT}/${SID}/uploads/${BANK_PROOF}`;
const PAYMENT_EVIDENCE_PATH = `${TENANT}/${SID}/payment_evidence/${UPLOAD_ID}`;
const signedPendingProof = {
  signature: `${TENANT}/${SIGNED_PENDING_SID}/uploads/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
  identityFront: `${TENANT}/${SIGNED_PENDING_SID}/uploads/cccccccc-cccc-4ccc-8ccc-cccccccccccc`,
  identityBack: `${TENANT}/${SIGNED_PENDING_SID}/uploads/dddddddd-dddd-4ddd-8ddd-dddddddddddd`,
  bankProof: `${TENANT}/${SIGNED_PENDING_SID}/uploads/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee`
};

const calls = [];
const objects = new Map();
let lookupPending = false;
let lookupExpired = false;
let corruptNextUpload = false;
let uploadQuotaExceeded = false;
let mutateExport = false;
let invalidAllocation = false;
let rosterPending = false;
let signedPending = false;
let uninvitedPending = false;
let mutateRoster = false;
let rosterReadCount = 0;
const snapshot = JSON.stringify({ statementId: SID, requestId: REQUEST_ID, entityId: 'E5', period: '2026-09', profile: { fullName: '=BAD', idNumber: 'A123456789' }, serviceLines: [{ courseType: '講座', description: '<script>alert(1)</script>', serviceDate: '2026-09-28', grossCents: 10000 }], totalGrossCents: 10000, uploads: { signature: { path: SIGNATURE_PATH, sha256: sha(PNG) }, identityFront: { path: FRONT_PATH, sha256: sha(PNG) }, identityBack: { path: BACK_PATH, sha256: sha(PNG) }, bankProof: { path: BANK_PATH, sha256: sha(PNG) } }, identityMethod: 'bearer_link_only' });
const snapshotHash = sha(snapshot);
const archivePath = `${TENANT}/${SID}/signed/${snapshotHash}.json`;
const signedPendingSnapshot = JSON.stringify({ statementId: SIGNED_PENDING_SID, requestId: 'ER20260928004', entityId: 'E5', period: '2026-09', profile: { fullName: '未付款講師', idNumber: 'B123456789' }, serviceLines: [{ courseType: '實作', description: '照護示範', serviceDate: '2026-09-29', grossCents: 20000 }], totalGrossCents: 20000, uploads: Object.fromEntries(Object.entries(signedPendingProof).map(([key, path]) => [key, { path, sha256: sha(PNG) }])), identityMethod: 'bearer_link_only' });
const signedPendingHash = sha(signedPendingSnapshot);
const signedPendingArchivePath = `${TENANT}/${SIGNED_PENDING_SID}/signed/${signedPendingHash}.json`;
const service = {
  rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'finance_labor_guest_lookup_v1') return lookupExpired
      ? { data: null, error: { code: 'P0001', message: 'LABOR_LINK_EXPIRED' } }
      : { data: lookupPending ? { statementId: SID, version: 2, status: 'signed_pending_archive', signedSnapshotText: snapshot, snapshotHash, archivePath } : { statementId: SID, version: 1, status: 'invited', entityId: 'E5', entityName: '歲悅', serviceLines: [{ id: SID, courseType: '講座', grossCents: 10000 }], totalGrossCents: 10000, expiresAt: '2026-10-10', requiredUploads: {}, consentVersion: 'labor-v1', idNumber: 'DO_NOT_RETURN' }, error: null };
    if (name === 'finance_labor_guest_upload_authorize_v1') return uploadQuotaExceeded
      ? { data: null, error: { code: '23514', message: 'LABOR_UPLOAD_QUOTA_EXCEEDED' } }
      : { data: { uploadId: UPLOAD_ID, bucket: 'finance-external-labor', path: `${TENANT}/${SID}/uploads/${UPLOAD_ID}`, maxBytes: 8 * 1024 * 1024 }, error: null };
    if (name === 'finance_labor_guest_file_commit_v1') return { data: { uploadId: UPLOAD_ID, committed: true }, error: null };
    if (name === 'finance_labor_guest_submit_v1') return { data: { statementId: SID, version: 2, status: 'signed_pending_archive', snapshotHash, signedSnapshotText: snapshot, archivePath }, error: null };
    if (name === 'finance_labor_guest_archive_commit_v1') return { data: { statementId: SID, version: 3, status: 'signed', snapshotHash }, error: null };
    throw new Error(`unexpected ${name}`);
  },
  storage: { from: bucket => {
    assert.equal(bucket, 'finance-external-labor');
    return {
      upload: async (path, bytes, options) => {
        assert.equal(options.upsert, false);
        if (objects.has(path)) return { data: null, error: { status: 409, message: 'duplicate' } };
        objects.set(path, corruptNextUpload ? Uint8Array.from([0]) : new Uint8Array(bytes));
        corruptNextUpload = false;
        return { data: { path }, error: null };
      },
      download: async path => {
        const value = objects.get(path);
        return value ? { data: new Blob([value]), error: null } : { data: null, error: { status: 404 } };
      }
    };
  } }
};
const staff = { rpc: async (name, args) => {
  if (name === 'finance_labor_create_invite_v1') {
    assert.match(args.p_token_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(args.p_token_hash, TOKEN);
    return { data: { statementId: SID, requestId: REQUEST_ID, inviteId: UPLOAD_ID, version: 1, status: 'invited', totalGrossCents: 10000, expiresAt: args.p_expires_at, serviceLines: [] }, error: null };
  }
  if (name === 'finance_labor_rotate_invite_v1') return { data: { statementId: SID, inviteId: UPLOAD_ID, version: 2, status: 'invited', expiresAt: args.p_expires_at }, error: null };
  if (name === 'finance_labor_staff_evidence_authorize_v1') return { data: { bucket: 'finance-external-labor', path: PAYMENT_EVIDENCE_PATH, maxBytes: 8 * 1024 * 1024 }, error: null };
  if (name === 'finance_labor_staff_archive_repair_v1') {
    assert.equal(args.p_statement_id, SID);
    return { data: { statementId: SID, version: 2, status: 'signed_pending_archive', signedSnapshotText: snapshot, snapshotHash, archivePath }, error: null };
  }
  if (name === 'finance_labor_export_page_v1') {
    assert.equal(args.p_entity_id, 'E5');
    assert.equal(args.p_paid_from, '2026-09-01');
    assert.equal(args.p_paid_to, '2026-10-01');
    assert.equal(args.p_cursor, null);
    assert(args.p_as_of === null || args.p_as_of === '2026-09-28T12:00:00+00:00');
    return { data: { asOf: '2026-09-28T12:00:00+00:00', items: [{ statementId: SID, requestId: REQUEST_ID, payerEntityId: 'E5', period: '2026-09', status: 'paid', paymentId: UPLOAD_ID, paidAt: '2026-09-28', paidMonth: '2026-09', paidCents: mutateExport && args.p_as_of ? 10001 : 10000, incomeTaxCents: 1000, nhiCents: 0, netCents: 9000, bankRef: 'BANK1', voucherNo: 'PAY1', paymentEvidence: { bankStatementPath: PAYMENT_EVIDENCE_PATH, bankStatementSha256: sha(PNG) }, profile: { fullName: '=BAD', idNumber: 'A123456789' }, serviceLines: [{ id: SID, courseType: '講座', serviceDate: '2026-09-28' }], paymentAllocations: [{ serviceLineId: SID, grossCents: invalidAllocation ? 9999 : 10000, incomeTaxCents: 1000, nhiCents: 0 }], archive: { bucket: 'finance-external-labor', path: archivePath, sha256: snapshotHash }, incompleteReason: null }], nextCursor: null }, error: null };
  }
  if (name === 'finance_labor_month_roster_v1') {
    assert.equal(args.p_entity_id, 'E5');
    assert.equal(args.p_payment_from, '2026-09-01');
    assert.equal(args.p_payment_to, '2026-10-01');
    assert.equal(args.p_cursor, null);
    assert.equal(args.p_as_of, '2026-09-28T12:00:00+00:00');
    rosterReadCount++;
    return { data: { asOf: args.p_as_of, items: [
      { statementId: SID, requestId: REQUEST_ID, payerEntityId: 'E5', status: 'paid', signerName: '=BAD', totalGrossCents: 10000, totalPaidGrossCents: 10000, plannedPaymentDates: ['2026-09-28'], archive: { bucket: 'finance-external-labor', path: archivePath, sha256: snapshotHash }, incompleteReason: null },
      ...(rosterPending ? [{ statementId: PENDING_SID, requestId: 'ER20260928002', payerEntityId: 'E5', status: 'invited', signerName: '待簽講師', totalGrossCents: mutateRoster && rosterReadCount > 1 ? 20001 : 20000, totalPaidGrossCents: 0, plannedPaymentDates: ['2026-09-30'], archive: null, incompleteReason: 'unsigned' }] : []),
      ...(signedPending ? [{ statementId: SIGNED_PENDING_SID, requestId: 'ER20260928004', payerEntityId: 'E5', status: 'accrued', signerName: '未付款講師', totalGrossCents: 20000, totalPaidGrossCents: 0, plannedPaymentDates: ['2026-09-30'], archive: { bucket: 'finance-external-labor', path: signedPendingArchivePath, sha256: signedPendingHash }, incompleteReason: 'payment_pending' }] : [])
    ], nextCursor: null }, error: null };
  }
  if (name === 'finance_labor_uninvited_roster_v1') {
    assert.equal(args.p_entity_id, 'E5');
    assert.equal(args.p_payment_from, '2026-09-01');
    assert.equal(args.p_payment_to, '2026-10-01');
    assert.equal(args.p_cursor, null);
    assert.equal(args.p_as_of, '2026-09-28T12:00:00+00:00');
    return { data: { asOf: args.p_as_of, items: uninvitedPending ? [{
      statementId: null, requestId: 'ER20260928003', payerEntityId: 'E5',
      status: 'pending_invite', signerName: '未邀講師', totalGrossCents: 30000,
      totalPaidGrossCents: 0, plannedPaymentDates: ['2026-09-30'], incompleteReason: 'invitation_pending'
    }] : [], nextCursor: null }, error: null };
  }
  throw new Error(`unexpected staff RPC ${name}`);
} };
const deniedStaff = { rpc: async () => ({ data: null, error: { code: '42501', message: 'LABOR_STAFF_FORBIDDEN' } }) };
const handler = createHandler({ service, staff: async jwt => jwt === 'valid-staff-token' ? staff : jwt === 'denied-staff-token' ? deniedStaff : null });

function zipEntries(bytes) {
  const result = new Map();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true), nameLength = view.getUint16(offset + 26, true);
    const start = offset + 30 + nameLength;
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, start));
    result.set(name, bytes.subarray(start, start + size));
    offset = start + size;
  }
  return result;
}

async function main() {
  let response = await handler(new Request(`${BASE}/health`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { service: 'finance-labor-external', version: '1' });

  response = await handler(jsonReq('/guest/lookup', { token: TOKEN }));
  assert.equal(response.status, 200);
  const lookup = await response.json();
  assert.equal(lookup.entityName, '歲悅');
  assert.equal(lookup.idNumber, undefined);
  assert.equal(calls.at(-1).args.p_token_hash, sha(TOKEN));

  response = await handler(jsonReq('/guest/lookup', { token: TOKEN }, { origin: 'https://attacker.example' }));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);

  const invite = { requestId: REQUEST_ID, entityId: 'E5', inviteEmail: 'teacher@example.com', expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(), lines: [{ id: SID, courseRef: 'C1', courseType: '講座', description: '課程', serviceDate: '2026-09-28', departmentCode: 'A1000', grossCents: 10000 }] };
  response = await handler(jsonReq('/invite/create', invite));
  assert.equal(response.status, 401);
  response = await handler(jsonReq('/invite/create', invite, { authorization: 'Bearer valid-staff-token' }));
  assert.equal(response.status, 200);
  const issued = await response.json();
  assert.match(issued.invitationUrl, /^https:\/\/finance\.suiyuecare\.com\/external-remuneration\.html#t=[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.delivery, 'copy_link');
  response = await handler(jsonReq('/invite/create', invite, { authorization: 'Bearer denied-staff-token' }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'FORBIDDEN' });
  response = await handler(jsonReq('/invite/rotate', { statementId: SID, expectedVersion: 1, expiresAt: invite.expiresAt, reason: '遺失舊連結' }, { authorization: 'Bearer valid-staff-token' }));
  assert.equal(response.status, 200);
  assert.match((await response.json()).invitationUrl, /#t=[A-Za-z0-9_-]{43}$/);

  const form = new FormData();
  form.set('token', TOKEN); form.set('expectedVersion', '1'); form.set('kind', 'signature');
  form.set('file', new File([PNG], 'signed.png', { type: 'image/png' }));
  response = await handler(new Request(`${BASE}/guest/upload`, { method: 'POST', headers: { origin: ORIGIN }, body: form }));
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.equal(receipt.sha256, sha(PNG));
  assert.equal(receipt.committed, true);
  assert.equal(calls.at(-1).args.p_sha256, sha(PNG));
  uploadQuotaExceeded = true;
  response = await handler(new Request(`${BASE}/guest/upload`, { method: 'POST', headers: { origin: ORIGIN }, body: form }));
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: 'UPLOAD_LIMIT_REACHED' });
  uploadQuotaExceeded = false;
  objects.delete(SIGNATURE_PATH);
  corruptNextUpload = true;
  const commitsBeforeReadbackFailure = calls.filter(call => call.name === 'finance_labor_guest_file_commit_v1').length;
  response = await handler(new Request(`${BASE}/guest/upload`, { method: 'POST', headers: { origin: ORIGIN }, body: form }));
  assert.equal(response.status, 503, 'corrupted Storage readback must block receipt');
  assert.equal(calls.filter(call => call.name === 'finance_labor_guest_file_commit_v1').length, commitsBeforeReadbackFailure);
  objects.delete(SIGNATURE_PATH);

  const bad = new FormData();
  bad.set('token', TOKEN); bad.set('expectedVersion', '1'); bad.set('kind', 'signature');
  bad.set('file', new File(['evil'], 'signed.png', { type: 'image/png' }));
  const prior = calls.length;
  response = await handler(new Request(`${BASE}/guest/upload`, { method: 'POST', headers: { origin: ORIGIN }, body: bad }));
  assert.equal(response.status, 415);
  assert.equal(calls.length, prior, 'invalid file must fail before database/storage access');

  const uploads = Object.fromEntries(['identityFront', 'identityBack', 'bankProof', 'signature'].map(key => [key, { uploadId: UPLOAD_ID, path: SIGNATURE_PATH, sha256: sha(PNG) }]));
  const profile = Object.fromEntries(['fullName', 'idNumber', 'phone', 'address', 'bankCode', 'bankName', 'branchName', 'accountNumber', 'accountHolder'].map(key => [key, 'Test only']));
  response = await handler(jsonReq('/guest/submit', { token: TOKEN, expectedVersion: 1, submitId: SUBMIT_ID, profile, uploads, consentVersion: 'labor-v1' }));
  assert.equal(response.status, 200);
  const submitted = await response.json();
  assert.equal(submitted.status, 'signed');
  assert.equal(submitted.signedSnapshotText, undefined);
  assert.equal(submitted.snapshotHash, snapshotHash);
  assert.equal(sha(objects.get(archivePath)), snapshotHash);
  assert.equal(calls.at(-1).name, 'finance_labor_guest_archive_commit_v1');
  lookupPending = true;
  response = await handler(jsonReq('/guest/lookup', { token: TOKEN }));
  assert.equal(response.status, 200);
  const recovered = await response.json();
  assert.equal(recovered.status, 'signed');
  assert.equal(recovered.signedSnapshotText, undefined);
  lookupPending = false;

  response = await handler(jsonReq('/staff/archive/repair', { statementId: SID }));
  assert.equal(response.status, 401);
  response = await handler(jsonReq('/staff/archive/repair', { statementId: SID }, { authorization: 'Bearer denied-staff-token' }));
  assert.equal(response.status, 403);
  lookupExpired = true;
  response = await handler(jsonReq('/guest/lookup', { token: TOKEN }));
  assert.equal(response.status, 404);
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await handler(jsonReq('/staff/archive/repair', { statementId: SID }, { authorization: 'Bearer valid-staff-token' }));
    assert.equal(response.status, 200, 'staff must recover an expired-link pending archive, including an idempotent retry');
    const repaired = await response.json();
    assert.equal(repaired.status, 'signed');
    assert.equal(repaired.signedSnapshotText, undefined);
    assert.equal(sha(objects.get(archivePath)), snapshotHash);
  }
  lookupExpired = false;

  const bankEvidence = new FormData();
  bankEvidence.set('statementId', SID);
  bankEvidence.set('file', new File([PNG], 'bank.png', { type: 'image/png' }));
  response = await handler(new Request(`${BASE}/staff/evidence/upload`, { method: 'POST', headers: { origin: ORIGIN }, body: bankEvidence }));
  assert.equal(response.status, 401);
  response = await handler(new Request(`${BASE}/staff/evidence/upload`, { method: 'POST', headers: { origin: ORIGIN, authorization: 'Bearer denied-staff-token' }, body: bankEvidence }));
  assert.equal(response.status, 403);
  response = await handler(new Request(`${BASE}/staff/evidence/upload`, { method: 'POST', headers: { origin: ORIGIN, authorization: 'Bearer valid-staff-token' }, body: bankEvidence }));
  assert.equal(response.status, 200);
  const proof = await response.json();
  assert.equal(proof.path, PAYMENT_EVIDENCE_PATH);
  assert.equal(proof.sha256, sha(PNG));
  assert.equal(sha(objects.get(proof.path)), sha(PNG));
  for (const path of [FRONT_PATH, BACK_PATH, BANK_PATH, SIGNATURE_PATH]) objects.set(path, PNG);

  response = await handler(jsonReq('/export/month', { entityId: 'E5', paidMonth: '2026-09' }));
  assert.equal(response.status, 401);
  response = await handler(jsonReq('/export/month', { entityId: 'E5', paidMonth: '2026-09' }, { authorization: 'Bearer denied-staff-token' }));
  assert.equal(response.status, 403);
  response = await handler(jsonReq('/export/preview', { entityId: 'E5', paidMonth: '2026-09' }, { authorization: 'Bearer valid-staff-token' }));
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.ready, true);
  assert.equal(preview.incompleteCount, 0);
  response = await handler(jsonReq('/export/month', { entityId: 'E5', paidMonth: '2026-09' }, { authorization: 'Bearer valid-staff-token' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.equal(response.headers.get('x-export-incomplete-count'), '0');
  const entries = zipEntries(new Uint8Array(await response.arrayBuffer()));
  for (const name of ['register.csv', 'pending_roster.csv', 'incomplete.csv', 'manifest.json', `signed/${SID}.json`, `forms/${SID}.html`, `signatures/${SID}.png`, `payment_evidence/${UPLOAD_ID}.png`, `private_proofs/${SID}/identity_front.png`, `private_proofs/${SID}/identity_back.png`, `private_proofs/${SID}/bank_proof.png`]) assert(entries.has(name), `missing ${name}`);
  assert.equal(new TextDecoder().decode(entries.get(`signed/${SID}.json`)), snapshot);
  assert.match(new TextDecoder().decode(entries.get(`forms/${SID}.html`)), /&lt;script&gt;/);
  assert.match(new TextDecoder().decode(entries.get('register.csv')), /'=BAD/);
  const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')));
  assert.equal(manifest.incompleteCount, 0);
  assert.equal(manifest.containsSensitivePersonalData, true);
  for (const file of manifest.files) {
    assert(entries.has(file.path), `manifest references missing ${file.path}`);
    assert.equal(sha(entries.get(file.path)), file.sha256, `manifest hash mismatch for ${file.path}`);
  }
  signedPending = true;
  objects.set(signedPendingArchivePath, new TextEncoder().encode(signedPendingSnapshot));
  for (const path of Object.values(signedPendingProof)) objects.set(path, PNG);
  response = await handler(jsonReq('/export/month', { entityId: 'E5', paidMonth: '2026-09' }, { authorization: 'Bearer valid-staff-token' }));
  assert.equal(response.status, 200);
  const signedPendingEntries = zipEntries(new Uint8Array(await response.arrayBuffer()));
  assert(signedPendingEntries.has(`signed/${SIGNED_PENDING_SID}.json`), 'signed unpaid statement must be in month package');
  for (const name of [`signatures/${SIGNED_PENDING_SID}.png`, `private_proofs/${SIGNED_PENDING_SID}/identity_front.png`, `private_proofs/${SIGNED_PENDING_SID}/identity_back.png`, `private_proofs/${SIGNED_PENDING_SID}/bank_proof.png`]) assert(signedPendingEntries.has(name), `missing unpaid proof ${name}`);
  assert(!new TextDecoder().decode(signedPendingEntries.get('register.csv')).includes('ER20260928004'), 'unpaid statement must not enter paid register');
  assert(new TextDecoder().decode(signedPendingEntries.get('pending_roster.csv')).includes('ER20260928004'));
  const signedPendingManifest = JSON.parse(new TextDecoder().decode(signedPendingEntries.get('manifest.json')));
  assert.equal(signedPendingManifest.paidStatementCount, 1);
  assert.equal(signedPendingManifest.statementCount, 2);
  assert.equal(signedPendingManifest.pendingCount, 1);
  assert.equal(signedPendingManifest.files.filter(file => file.path === `signed/${SID}.json`).length, 1, 'paid overlap must not duplicate archive');
  objects.delete(signedPendingProof.bankProof);
  response = await handler(jsonReq('/export/preview', { entityId: 'E5', paidMonth: '2026-09' }, { authorization: 'Bearer valid-staff-token' }));
  assert.equal(response.status, 200);
  const missingUnpaidProof = await response.json();
  assert.equal(missingUnpaidProof.ready, false);
  assert(missingUnpaidProof.incomplete.some(entry => entry.statementId === SIGNED_PENDING_SID && entry.reason === 'bank_proof_hash_mismatch_or_missing'));
  signedPending = false;
  invalidAllocation = true;
  response = await handler(jsonReq('/export/preview', { entityId: 'E5', paidMonth: '2026-09' }, { authorization: 'Bearer valid-staff-token' }));
  assert.equal(response.status, 200);
  const incorrectAllocation = await response.json();
  assert.equal(incorrectAllocation.ready, false);
  assert.equal(incorrectAllocation.incomplete[0].reason, 'payment_allocation_missing_or_mismatch');
  invalidAllocation = false;
  objects.delete(PAYMENT_EVIDENCE_PATH);
  response = await handler(jsonReq('/export/preview', { entityId: 'E5', paidMonth: '2026-09' }, { authorization: 'Bearer valid-staff-token' }));
  assert.equal(response.status, 200);
  const missingProof = await response.json();
  assert.equal(missingProof.ready, false);
  assert.equal(missingProof.incomplete[0].reason, 'bank_statement_hash_mismatch_or_missing');
  objects.set(PAYMENT_EVIDENCE_PATH, PNG);
  rosterPending = true; uninvitedPending = true;
  response = await handler(jsonReq('/export/preview', { entityId: 'E5', paidMonth: '2026-09' }, { authorization: 'Bearer valid-staff-token' }));
  assert.equal(response.status, 200);
  const pendingPreview = await response.json();
  assert.equal(pendingPreview.ready, false);
  assert.equal(pendingPreview.pendingCount, 2);
  assert.equal(pendingPreview.uninvitedCount, 1);
  assert.deepEqual(pendingPreview.pending.map(row => row.reason), ['unsigned', 'invitation_pending']);
  response = await handler(jsonReq('/export/month', { entityId: 'E5', paidMonth: '2026-09' }, { authorization: 'Bearer valid-staff-token' }));
  assert.equal(response.headers.get('x-export-incomplete-count'), '2');
  const pendingEntries = zipEntries(new Uint8Array(await response.arrayBuffer()));
  assert.match(new TextDecoder().decode(pendingEntries.get('pending_roster.csv')), /ER20260928002/);
  assert.match(new TextDecoder().decode(pendingEntries.get('pending_roster.csv')), /ER20260928003/);
  assert.equal(JSON.parse(new TextDecoder().decode(pendingEntries.get('manifest.json'))).pendingCount, 2);
  mutateRoster = true; rosterReadCount = 0;
  response = await handler(jsonReq('/export/month', { entityId: 'E5', paidMonth: '2026-09' }, { authorization: 'Bearer valid-staff-token' }));
  assert.equal(response.status, 409, 'changed pending roster must not produce a ZIP');
  mutateRoster = false; rosterPending = false; uninvitedPending = false;
  mutateExport = true;
  response = await handler(jsonReq('/export/month', { entityId: 'E5', paidMonth: '2026-09' }, { authorization: 'Bearer valid-staff-token' }));
  assert.equal(response.status, 409, 'changed source data must not produce a ZIP');
  assert.deepEqual(await response.json(), { error: 'EXPORT_CHANGED_RETRY' });
  mutateExport = false;
  objects.set(archivePath, new TextEncoder().encode('{"tampered":true}'));
  response = await handler(jsonReq('/export/preview', { entityId: 'E5', paidMonth: '2026-09' }, { authorization: 'Bearer valid-staff-token' }));
  assert.equal(response.status, 200);
  const damaged = await response.json();
  assert.equal(damaged.ready, false);
  assert.equal(damaged.incompleteCount, 1);
  assert.equal(damaged.incomplete[0].reason, 'archive_hash_mismatch_or_missing');
  objects.set(archivePath, new TextEncoder().encode(snapshot));
  console.log('external labor gateway: health, origin, staff auth/scope, invite/rotate, private lookup, file sniff/hash, canonical archive, staff bank proof, monthly ZIP passed');
}

await main();
