const PUBLIC_ORIGIN = 'https://finance.suiyuecare.com';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{64}$/;
const FILE_LIMIT = 8 * 1024 * 1024;
const JSON_LIMIT = 64 * 1024;
const FILE_KINDS = new Set(['identity_front', 'identity_back', 'bank_proof', 'signature']);
const PROFILE_FIELDS = ['fullName', 'idNumber', 'phone', 'address', 'bankCode', 'bankName', 'branchName', 'accountNumber', 'accountHolder'];
const UPLOAD_FIELDS = ['identityFront', 'identityBack', 'bankProof', 'signature'];
const utf8 = value => new TextEncoder().encode(value);
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

class GatewayError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

function headers(origin = '') {
  const result = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private, max-age=0',
    'Pragma': 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  };
  if (origin === PUBLIC_ORIGIN) {
    result['Access-Control-Allow-Origin'] = origin;
    result['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    result['Access-Control-Allow-Headers'] = 'authorization, content-type';
    result['Access-Control-Max-Age'] = '600';
  }
  return result;
}

function json(value, status = 200, origin = '') {
  return new Response(JSON.stringify(value), { status, headers: headers(origin) });
}

function ownKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new GatewayError('INVALID_INPUT');
  }
}

function requiredString(value, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new GatewayError('INVALID_INPUT');
  return value.trim();
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new GatewayError('INVALID_INPUT');
  return value;
}

function token(value) {
  if (typeof value !== 'string' || !TOKEN_RE.test(value)) throw new GatewayError('INVALID_LINK', 404);
  return value;
}

function version(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new GatewayError('INVALID_INPUT');
  return value;
}

function hex(bytes) { return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
async function digest(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}
function makeToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function joinBytes(chunks, total) {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

// Store-only ZIP keeps the Edge runtime dependency-free. Signed files are
// already small; an explicit cap prevents a partial/corrupt monthly package.
export function zipFiles(files) {
  if (files.length > 2000) throw new GatewayError('EXPORT_TOO_LARGE', 413);
  const chunks = [], directory = [];
  let offset = 0;
  for (const file of files) {
    if (!/^[A-Za-z0-9_./-]+$/.test(file.name) || file.name.includes('..') || file.name.startsWith('/')) throw new GatewayError('EXPORT_INVALID_PATH', 500);
    const name = utf8(file.name);
    const body = file.bytes instanceof Uint8Array ? file.bytes : utf8(file.bytes);
    if (name.byteLength > 65535 || body.byteLength > 0xffffffff || offset + body.byteLength + 300 > 96 * 1024 * 1024) throw new GatewayError('EXPORT_TOO_LARGE', 413);
    const crc = crc32(body);
    const local = new Uint8Array(30 + name.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, body.byteLength, true);
    lv.setUint32(22, body.byteLength, true); lv.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    chunks.push(local, body);
    directory.push({ name, bodyLength: body.byteLength, crc, offset });
    offset += local.byteLength + body.byteLength;
  }
  const centralStart = offset;
  for (const item of directory) {
    const entry = new Uint8Array(46 + item.name.byteLength);
    const dv = new DataView(entry.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true); dv.setUint16(10, 0, true);
    dv.setUint32(16, item.crc, true); dv.setUint32(20, item.bodyLength, true);
    dv.setUint32(24, item.bodyLength, true); dv.setUint16(28, item.name.byteLength, true);
    dv.setUint32(42, item.offset, true); entry.set(item.name, 46);
    chunks.push(entry); offset += entry.byteLength;
  }
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, directory.length, true); ev.setUint16(10, directory.length, true);
  ev.setUint32(12, offset - centralStart, true); ev.setUint32(16, centralStart, true);
  chunks.push(end); offset += end.byteLength;
  return joinBytes(chunks, offset);
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function csv(rows) { return `\ufeff${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
function formatTwdCents(value) { return Number.isSafeInteger(value) ? `NT$${(value / 100).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : ''; }
function signedHtml(snapshot, signatureFile) {
  const profile = snapshot.profile || {};
  const fields = [
    ['姓名', profile.fullName], ['證號', profile.idNumber], ['電話', profile.phone], ['地址', profile.address],
    ['銀行代碼', profile.bankCode], ['銀行', profile.bankName], ['分行', profile.branchName],
    ['戶名', profile.accountHolder], ['帳號', profile.accountNumber]
  ];
  const rows = (Array.isArray(snapshot.serviceLines) ? snapshot.serviceLines : []).map(line => `<tr><td>${escapeHtml(line.courseType)}</td><td>${escapeHtml(line.description)}</td><td>${escapeHtml(line.serviceDate)}</td><td>${escapeHtml(formatTwdCents(line.grossCents))}</td></tr>`).join('');
  const signature = signatureFile ? `<img alt="講師簽名影像" src="../${escapeHtml(signatureFile)}" style="max-height:100px;max-width:300px">` : '<strong>簽名影像未納入本批次，請檢查清單</strong>';
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>電子勞務報酬單 ${escapeHtml(snapshot.statementId)}</title><style>body{font:15px/1.7 system-ui,sans-serif;max-width:850px;margin:35px auto;color:#27221d}h1{border-bottom:2px solid #d97000;padding-bottom:10px}table{border-collapse:collapse;width:100%;margin:15px 0}th,td{border:1px solid #cbbbaa;text-align:left;padding:8px}.note{background:#fff1df;padding:12px}footer{margin-top:28px;font-size:12px;overflow-wrap:anywhere}@media print{body{margin:10mm}}</style><h1>電子勞務報酬單</h1><p>申請編號：${escapeHtml(snapshot.requestId)}　簽署時間：${escapeHtml(snapshot.signedAt)}</p><p>付款公司：${escapeHtml(snapshot.entityId)}　所屬月份：${escapeHtml(snapshot.period)}</p><h2>服務明細</h2><table><thead><tr><th>課程類型</th><th>服務內容</th><th>日期</th><th>報酬（新臺幣）</th></tr></thead><tbody>${rows}</tbody></table><p><strong>報酬合計：${escapeHtml(formatTwdCents(snapshot.totalGrossCents))}</strong>（未扣代扣項目）</p><h2>講師及銀行資料</h2><table>${fields.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</table><h2>電子簽名</h2>${signature}<p class="note">此資料由專屬連結持有人填寫，連結本身不構成身分驗證。會計核對與付款另行進行。</p><footer>不可變原始快照 SHA-256：${escapeHtml(snapshot.snapshotHash || '')}；簽名影像 SHA-256：${escapeHtml(snapshot.uploads?.signature?.sha256 || '')}。正式證據以同包 signed JSON 與 manifest 雜湊為準。</footer></html>`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function scanPayments(staff, entityId, paidFrom, paidTo, fixedAsOf = null) {
  const payments = [];
  let cursor = null, asOf = fixedAsOf;
  const seen = new Set();
  for (let page = 0; page < 100; page++) {
    const result = await rpc(staff, 'finance_labor_export_page_v1', {
      p_entity_id: entityId, p_paid_from: paidFrom, p_paid_to: paidTo,
      p_limit: 100, p_cursor: cursor, p_as_of: asOf
    });
    if (!Array.isArray(result.items) || result.items.length > 100 || typeof result.asOf !== 'string' || !Number.isFinite(Date.parse(result.asOf))) throw new GatewayError('SERVICE_UNAVAILABLE', 503);
    if (asOf && result.asOf !== asOf) throw new GatewayError('EXPORT_CHANGED_RETRY', 409);
    asOf = result.asOf;
    payments.push(...result.items);
    if (payments.length > 10000) throw new GatewayError('EXPORT_TOO_LARGE', 413);
    if (!result.nextCursor) { cursor = null; break; }
    const next = stableStringify(result.nextCursor);
    if (seen.has(next) || !/^\d{4}-\d{2}-\d{2}$/.test(result.nextCursor.paidOn || '') || !UUID_RE.test(result.nextCursor.paymentId || '')) throw new GatewayError('SERVICE_UNAVAILABLE', 503);
    seen.add(next); cursor = result.nextCursor;
  }
  if (cursor) throw new GatewayError('EXPORT_TOO_LARGE', 413);
  return { payments, asOf, fingerprint: await digest(stableStringify(payments)) };
}

async function scanPlannedRoster(staff, entityId, paidFrom, paidTo, fixedAsOf) {
  const entries = [];
  let cursor = null;
  const seen = new Set();
  for (let page = 0; page < 100; page++) {
    const result = await rpc(staff, 'finance_labor_month_roster_v1', {
      p_entity_id: entityId, p_payment_from: paidFrom, p_payment_to: paidTo,
      p_limit: 100, p_cursor: cursor, p_as_of: fixedAsOf
    });
    if (!Array.isArray(result.items) || result.items.length > 100 || result.asOf !== fixedAsOf) throw new GatewayError('SERVICE_UNAVAILABLE', 503);
    entries.push(...result.items);
    if (entries.length > 10000) throw new GatewayError('EXPORT_TOO_LARGE', 413);
    if (!result.nextCursor) { cursor = null; break; }
    if (!UUID_RE.test(result.nextCursor) || seen.has(result.nextCursor)) throw new GatewayError('SERVICE_UNAVAILABLE', 503);
    seen.add(result.nextCursor); cursor = result.nextCursor;
  }
  if (cursor) throw new GatewayError('EXPORT_TOO_LARGE', 413);
  return { entries, fingerprint: await digest(stableStringify(entries)) };
}

async function scanUninvitedRoster(staff, entityId, paidFrom, paidTo, fixedAsOf) {
  const entries = [];
  let cursor = null;
  const seen = new Set();
  for (let page = 0; page < 100; page++) {
    const result = await rpc(staff, 'finance_labor_uninvited_roster_v1', {
      p_entity_id: entityId, p_payment_from: paidFrom, p_payment_to: paidTo,
      p_limit: 100, p_cursor: cursor, p_as_of: fixedAsOf
    });
    if (!Array.isArray(result.items) || result.items.length > 100 || result.asOf !== fixedAsOf) throw new GatewayError('SERVICE_UNAVAILABLE', 503);
    entries.push(...result.items);
    if (entries.length > 10000) throw new GatewayError('EXPORT_TOO_LARGE', 413);
    if (!result.nextCursor) { cursor = null; break; }
    if (typeof result.nextCursor !== 'string' || !result.nextCursor || result.nextCursor.length > 512 || seen.has(result.nextCursor)) throw new GatewayError('SERVICE_UNAVAILABLE', 503);
    seen.add(result.nextCursor); cursor = result.nextCursor;
  }
  if (cursor) throw new GatewayError('EXPORT_TOO_LARGE', 413);
  return { entries, fingerprint: await digest(stableStringify(entries)) };
}

async function privateFile(service, path, expectedHash) {
  const result = await service.storage.from('finance-external-labor').download(path);
  if (result.error || !result.data) return null;
  const bytes = new Uint8Array(await result.data.arrayBuffer());
  if (await digest(bytes) !== expectedHash) return null;
  return bytes;
}

function evidenceExtension(bytes) {
  return { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' }[detectMime(bytes)] || '';
}

function scopedEvidencePath(prefix, subdirectory, path) {
  const start = `${prefix}${subdirectory}/`;
  return typeof path === 'string' && path.startsWith(start) && UUID_RE.test(path.slice(start.length));
}

function paymentAllocationDetail(item) {
  if (!Array.isArray(item.serviceLines) || !Array.isArray(item.paymentAllocations) || !item.paymentAllocations.length) return null;
  const lines = new Map(item.serviceLines.map(line => [line.id, line]));
  let gross = 0, tax = 0, nhi = 0;
  const detail = [];
  for (const allocation of item.paymentAllocations) {
    const line = lines.get(allocation.serviceLineId);
    if (!line || ![allocation.grossCents, allocation.incomeTaxCents, allocation.nhiCents].every(Number.isSafeInteger)) return null;
    gross += allocation.grossCents; tax += allocation.incomeTaxCents; nhi += allocation.nhiCents;
    detail.push({ courseType: line.courseType, serviceDate: line.serviceDate,
      grossCents: allocation.grossCents, incomeTaxCents: allocation.incomeTaxCents, nhiCents: allocation.nhiCents });
  }
  if (gross !== item.paidCents || tax !== item.incomeTaxCents || nhi !== item.nhiCents) return null;
  return JSON.stringify(detail);
}

async function exportMonth(body, request, deps, origin, preview = false) {
  ownKeys(body, ['entityId', 'paidMonth']);
  const jwt = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') || '')?.[1];
  if (!jwt) throw new GatewayError('UNAUTHENTICATED', 401);
  const staff = await deps.staff(jwt);
  if (!staff) throw new GatewayError('UNAUTHENTICATED', 401);
  const entityId = requiredString(body.entityId, 64);
  if (!/^[A-Za-z0-9_-]+$/.test(entityId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.paidMonth)) throw new GatewayError('INVALID_INPUT');
  const [year, month] = body.paidMonth.split('-').map(Number);
  const paidFrom = `${body.paidMonth}-01`;
  const paidTo = `${new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7)}-01`;
  const firstScan = await scanPayments(staff, entityId, paidFrom, paidTo);
  const { payments, asOf } = firstScan;
  const firstRoster = await scanPlannedRoster(staff, entityId, paidFrom, paidTo, asOf);
  const firstUninvited = await scanUninvitedRoster(staff, entityId, paidFrom, paidTo, asOf);

  const files = [];
  const incomplete = [];
  const archives = new Map();
  const registerRows = [[
    '付款公司代碼', '實際付款月份', '實際付款日期', '報酬單 ID', '申請單號', '講師姓名',
    '證號', '本次付款課程分攤（分，JSON）', '付款毛額（分）', '所得稅（分）',
    '補充保費（分）', '實付淨額（分）', '銀行交易參考', '傳票號碼', '原始快照 SHA-256', '未完成原因'
  ]];
  for (const item of payments) {
    if (!UUID_RE.test(item.statementId || '') || !UUID_RE.test(item.paymentId || '') || item.payerEntityId !== entityId || item.paidMonth !== body.paidMonth) throw new GatewayError('SERVICE_UNAVAILABLE', 503);
    const reason = item.incompleteReason || '';
    if (reason) incomplete.push({ statementId: item.statementId, paymentId: item.paymentId, reason });
    const allocationDetail = paymentAllocationDetail(item);
    if (!allocationDetail) incomplete.push({ statementId: item.statementId, paymentId: item.paymentId, reason: 'payment_allocation_missing_or_mismatch' });
    const proof = item.paymentEvidence || {};
    const evidencePrefix = `${String(item.archive?.path || '').split('/')[0]}/${item.statementId}/`;
    if (!SHA_RE.test(proof.bankStatementSha256 || '') || !scopedEvidencePath(evidencePrefix, 'payment_evidence', proof.bankStatementPath)) {
      incomplete.push({ statementId: item.statementId, paymentId: item.paymentId, reason: 'bank_statement_reference_missing_or_invalid' });
    } else {
      const bankBytes = await privateFile(deps.service, proof.bankStatementPath, proof.bankStatementSha256);
      const ext = bankBytes && evidenceExtension(bankBytes);
      if (!ext) incomplete.push({ statementId: item.statementId, paymentId: item.paymentId, reason: 'bank_statement_hash_mismatch_or_missing' });
      else files.push({ name: `payment_evidence/${item.paymentId}.${ext}`, bytes: bankBytes });
    }
    registerRows.push([
      item.payerEntityId, item.paidMonth, item.paidAt, item.statementId, item.requestId,
      item.profile?.fullName, item.profile?.idNumber,
      allocationDetail,
      item.paidCents, item.incomeTaxCents, item.nhiCents, item.netCents,
      item.bankRef, item.voucherNo, item.archive?.sha256, reason
    ]);
    if (!archives.has(item.statementId)) archives.set(item.statementId, item);
  }
  files.push({ name: 'register.csv', bytes: utf8(csv(registerRows)) });

  const pending = [];
  for (const item of [...firstRoster.entries, ...firstUninvited.entries]) {
    const uninvited = item.status === 'pending_invite';
    if ((!uninvited && !UUID_RE.test(item.statementId || '')) || (uninvited && item.statementId !== null) ||
      (item.payerEntityId != null && item.payerEntityId !== entityId) ||
      typeof item.requestId !== 'string' || !item.requestId ||
      (typeof item.incompleteReason !== 'string' && item.incompleteReason !== null)) {
      throw new GatewayError('SERVICE_UNAVAILABLE', 503);
    }
    if (item.incompleteReason) pending.push({
      statementId: item.statementId, requestId: item.requestId,
      signerName: item.signerName, status: item.status,
      totalGrossCents: item.totalGrossCents, totalPaidGrossCents: item.totalPaidGrossCents,
      plannedPaymentDates: item.plannedPaymentDates, reason: item.incompleteReason
    });
  }
  files.push({ name: 'pending_roster.csv', bytes: utf8(csv([
    ['報酬單 ID', '申請單號', '講師姓名', '狀態', '報酬毛額（分）', '已付毛額（分）', '預計付款日', '未完成原因'],
    ...pending.map(item => [item.statementId, item.requestId, item.signerName, item.status,
      item.totalGrossCents, item.totalPaidGrossCents, (item.plannedPaymentDates || []).join('；'), item.reason])
  ])) });

  const archivedStatuses = new Set(['signed', 'reviewed', 'accrued', 'partially_paid', 'paid']);
  for (const item of firstRoster.entries) {
    if (!archivedStatuses.has(item.status) || archives.has(item.statementId)) continue;
    if (!item.archive) {
      incomplete.push({ statementId: item.statementId, paymentId: '', reason: 'signed_archive_not_verified' });
      continue;
    }
    archives.set(item.statementId, item);
  }

  for (const item of archives.values()) {
    const archive = item.archive;
    const prefix = `${String(archive?.path || '').split('/')[0]}/${item.statementId}/`;
    if (archive?.bucket !== 'finance-external-labor' || !SHA_RE.test(archive.sha256 || '') || !new RegExp(`^[0-9a-f-]{36}/${item.statementId}/signed/${archive.sha256}\\.json$`, 'i').test(archive.path || '')) {
      incomplete.push({ statementId: item.statementId, paymentId: item.paymentId || '', reason: 'invalid_archive_reference' });
      continue;
    }
    const bytes = await privateFile(deps.service, archive.path, archive.sha256);
    if (!bytes) { incomplete.push({ statementId: item.statementId, paymentId: item.paymentId || '', reason: 'archive_hash_mismatch_or_missing' }); continue; }
    let snapshot;
    try { snapshot = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { incomplete.push({ statementId: item.statementId, paymentId: item.paymentId || '', reason: 'invalid_archive_json' }); continue; }
    if (snapshot.statementId !== item.statementId || snapshot.requestId !== item.requestId) {
      incomplete.push({ statementId: item.statementId, paymentId: item.paymentId || '', reason: 'archive_binding_mismatch' }); continue;
    }
    const signature = snapshot.uploads?.signature;
    let signatureName = '';
    if (SHA_RE.test(signature?.sha256 || '') && scopedEvidencePath(prefix, 'uploads', signature.path)) {
      const signatureBytes = await privateFile(deps.service, signature.path, signature.sha256);
      if (signatureBytes && detectMime(signatureBytes) === 'image/png') {
        signatureName = `signatures/${item.statementId}.png`;
        files.push({ name: signatureName, bytes: signatureBytes });
      }
    }
    if (!signatureName) incomplete.push({ statementId: item.statementId, paymentId: item.paymentId || '', reason: 'signature_hash_mismatch_or_missing' });
    for (const [key, label] of [['identityFront', 'identity_front'], ['identityBack', 'identity_back'], ['bankProof', 'bank_proof']]) {
      const receipt = snapshot.uploads?.[key];
      let included = false;
      if (SHA_RE.test(receipt?.sha256 || '') && scopedEvidencePath(prefix, 'uploads', receipt.path)) {
        const documentBytes = await privateFile(deps.service, receipt.path, receipt.sha256);
        const ext = documentBytes && evidenceExtension(documentBytes);
        if (ext) {
          files.push({ name: `private_proofs/${item.statementId}/${label}.${ext}`, bytes: documentBytes });
          included = true;
        }
      }
      if (!included) incomplete.push({ statementId: item.statementId, paymentId: item.paymentId || '', reason: `${label}_hash_mismatch_or_missing` });
    }
    files.push({ name: `signed/${item.statementId}.json`, bytes });
    files.push({ name: `forms/${item.statementId}.html`, bytes: utf8(signedHtml({ ...snapshot, snapshotHash: archive.sha256 }, signatureName)) });
  }

  files.push({ name: 'incomplete.csv', bytes: utf8(csv([['報酬單 ID', '付款 ID', '未完成原因'], ...incomplete.map(entry => [entry.statementId, entry.paymentId, entry.reason])])) });
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    asOf,
    payerEntityId: entityId,
    actualPaidMonth: body.paidMonth,
    paymentCount: payments.length,
    paidStatementCount: new Set(payments.map(item => item.statementId)).size,
    statementCount: archives.size,
    uninvitedCount: firstUninvited.entries.length,
    pendingCount: pending.length,
    incompleteCount: incomplete.length + pending.length,
    incomplete,
    pending,
    containsSensitivePersonalData: true,
    note: 'register.csv 列出實際付款；pending_roster.csv 列出該月預計付款但尚未完成的報酬單。private_proofs/ 及 payment_evidence/ 含敏感個資，僅供授權會計核對。signed/*.json 是資料庫交易產生的不可變原始簽署快照；forms/*.html 僅供列印，正式 PDF 尚待伺服器產製。專屬連結不構成身分驗證。',
    files: await Promise.all(files.map(async file => ({ path: file.name, sizeBytes: file.bytes.byteLength, sha256: await digest(file.bytes) })))
  };
  files.push({ name: 'manifest.json', bytes: utf8(JSON.stringify(manifest, null, 2)) });
  const secondScan = await scanPayments(staff, entityId, paidFrom, paidTo, asOf);
  const secondRoster = await scanPlannedRoster(staff, entityId, paidFrom, paidTo, asOf);
  const secondUninvited = await scanUninvitedRoster(staff, entityId, paidFrom, paidTo, asOf);
  if (secondScan.fingerprint !== firstScan.fingerprint || secondScan.asOf !== asOf ||
    secondRoster.fingerprint !== firstRoster.fingerprint || secondUninvited.fingerprint !== firstUninvited.fingerprint) throw new GatewayError('EXPORT_CHANGED_RETRY', 409);
  if (preview) return json({ payerEntityId: entityId, actualPaidMonth: body.paidMonth, asOf,
    paymentCount: payments.length, paidStatementCount: new Set(payments.map(item => item.statementId)).size,
    statementCount: archives.size, uninvitedCount: firstUninvited.entries.length, pendingCount: pending.length,
    incompleteCount: incomplete.length + pending.length, incomplete, pending,
    ready: incomplete.length === 0 && pending.length === 0 }, 200, origin);
  const zip = zipFiles(files);
  const responseHeaders = { ...headers(origin),
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="external_labor_${entityId}_${body.paidMonth}.zip"`,
    'X-Export-Incomplete-Count': String(incomplete.length + pending.length),
    'Access-Control-Expose-Headers': 'Content-Disposition, X-Export-Incomplete-Count'
  };
  return new Response(zip, { status: 200, headers: responseHeaders });
}

async function readBytes(request, maximum) {
  const advertised = Number(request.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > maximum) throw new GatewayError('PAYLOAD_TOO_LARGE', 413);
  if (!request.body) throw new GatewayError('INVALID_INPUT');
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) { await reader.cancel(); throw new GatewayError('PAYLOAD_TOO_LARGE', 413); }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { output.set(chunk, at); at += chunk.byteLength; }
  return output;
}

async function readJson(request) {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) throw new GatewayError('INVALID_CONTENT_TYPE', 415);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(request, JSON_LIMIT))); }
  catch (error) { if (error instanceof GatewayError) throw error; throw new GatewayError('INVALID_INPUT'); }
}

function detectMime(bytes) {
  if (bytes.length > 7 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return 'application/pdf';
  return '';
}

function safeDatabaseError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (/LABOR_UPLOAD_QUOTA_EXCEEDED/.test(message)) return new GatewayError('UPLOAD_LIMIT_REACHED', 429);
  if (/LABOR_LINK_|LABOR_SUBMISSION_REPLAY_FORBIDDEN/.test(message)) return new GatewayError('INVALID_LINK', 404);
  if (/LABOR_SIGNER_ACCOUNT_MISMATCH_REVIEW_REQUIRED/.test(message)) return new GatewayError('DATA_MISMATCH', 422);
  if (/LABOR_STAFF_|LABOR_GATEWAY_ONLY/.test(message)) return new GatewayError('FORBIDDEN', 403);
  if (/LABOR_ARCHIVE_/.test(message)) return new GatewayError('ARCHIVE_PENDING', 503);
  if (code === '40001') return new GatewayError('CONFLICT', 409);
  if (code === '22023' || code === '23514') return new GatewayError('INVALID_INPUT', 422);
  if (code === 'P0001' || code === 'P0002' || code === '42501') return new GatewayError('NOT_AVAILABLE', 403);
  if (code === '23505') return new GatewayError('CONFLICT', 409);
  return new GatewayError('SERVICE_UNAVAILABLE', 503);
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw safeDatabaseError(error);
  if (!data || typeof data !== 'object') throw new GatewayError('SERVICE_UNAVAILABLE', 503);
  return data;
}

async function lookup(body, deps) {
  ownKeys(body, ['token']);
  const result = await rpc(deps.service, 'finance_labor_guest_lookup_v1', { p_token_hash: await digest(token(body.token)) });
  if (result.status === 'signed_pending_archive') {
    const completed = await archiveSigned(result, deps);
    return { statementId: completed.statementId, version: completed.version, status: 'signed' };
  }
  // Whitelist prevents new private SQL fields from accidentally becoming public.
  const { statementId, version: currentVersion, status, entityId, entityName, serviceLines, totalGrossCents, expiresAt, requiredUploads, consentVersion } = result;
  return { statementId, version: currentVersion, status, entityId, entityName, serviceLines, totalGrossCents, expiresAt, requiredUploads, consentVersion };
}

async function invite(body, request, deps) {
  ownKeys(body, ['requestId', 'entityId', 'inviteEmail', 'expiresAt', 'lines']);
  const jwt = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') || '')?.[1];
  if (!jwt) throw new GatewayError('UNAUTHENTICATED', 401);
  const staff = await deps.staff(jwt);
  if (!staff) throw new GatewayError('UNAUTHENTICATED', 401);
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(requiredString(body.requestId, 128))) throw new GatewayError('INVALID_INPUT');
  requiredString(body.entityId, 64);
  const inviteEmail = requiredString(body.inviteEmail, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) throw new GatewayError('INVALID_INPUT');
  const expires = new Date(body.expiresAt);
  if (!Number.isFinite(expires.getTime()) || expires.getTime() < Date.now() + 60 * 60 * 1000 || expires.getTime() > Date.now() + 30 * 86400000) throw new GatewayError('INVALID_INPUT');
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100) throw new GatewayError('INVALID_INPUT');
  for (const line of body.lines) {
    ownKeys(line, ['id', 'courseRef', 'courseType', 'description', 'serviceDate', 'departmentCode', 'grossCents']);
    if (line.id != null) uuid(line.id);
    requiredString(line.courseRef, 160); requiredString(line.courseType, 160);
    requiredString(line.description, 300); requiredString(line.departmentCode, 64);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(line.serviceDate) || !Number.isSafeInteger(line.grossCents) || line.grossCents < 1 || line.grossCents > 100000000000) throw new GatewayError('INVALID_INPUT');
  }
  const rawToken = makeToken();
  const result = await rpc(staff, 'finance_labor_create_invite_v1', {
    p_request_id: body.requestId,
    p_entity_id: body.entityId,
    p_invite_email: inviteEmail,
    p_token_hash: await digest(rawToken),
    p_expires_at: expires.toISOString(),
    p_lines: body.lines
  });
  return {
    statementId: result.statementId,
    requestId: result.requestId,
    inviteId: result.inviteId,
    version: result.version,
    status: result.status,
    totalGrossCents: result.totalGrossCents,
    expiresAt: result.expiresAt,
    serviceLines: result.serviceLines,
    invitationUrl: `${PUBLIC_ORIGIN}/external-remuneration.html#t=${rawToken}`,
    delivery: 'copy_link'
  };
}

async function rotateInvite(body, request, deps) {
  ownKeys(body, ['statementId', 'expectedVersion', 'expiresAt', 'reason']);
  const jwt = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') || '')?.[1];
  if (!jwt) throw new GatewayError('UNAUTHENTICATED', 401);
  const staff = await deps.staff(jwt);
  if (!staff) throw new GatewayError('UNAUTHENTICATED', 401);
  uuid(body.statementId); version(body.expectedVersion);
  const reason = requiredString(body.reason, 500);
  const expires = new Date(body.expiresAt);
  if (!Number.isFinite(expires.getTime()) || expires.getTime() < Date.now() + 60 * 60 * 1000 || expires.getTime() > Date.now() + 30 * 86400000) throw new GatewayError('INVALID_INPUT');
  const rawToken = makeToken();
  const result = await rpc(staff, 'finance_labor_rotate_invite_v1', {
    p_statement_id: body.statementId,
    p_expected_version: body.expectedVersion,
    p_token_hash: await digest(rawToken),
    p_expires_at: expires.toISOString(),
    p_reason: reason
  });
  return {
    statementId: result.statementId,
    inviteId: result.inviteId,
    version: result.version,
    status: result.status,
    expiresAt: result.expiresAt,
    invitationUrl: `${PUBLIC_ORIGIN}/external-remuneration.html#t=${rawToken}`,
    delivery: 'copy_link'
  };
}

async function upload(request, deps) {
  const bytes = await readBytes(request, FILE_LIMIT + JSON_LIMIT);
  let form;
  try { form = await new Request(request.url, { method: 'POST', headers: { 'content-type': request.headers.get('content-type') || '' }, body: bytes }).formData(); }
  catch { throw new GatewayError('INVALID_INPUT'); }
  const permitted = ['token', 'expectedVersion', 'kind', 'file'];
  if ([...form.keys()].some(key => !permitted.includes(key)) || [...form.keys()].some(key => form.getAll(key).length !== 1)) throw new GatewayError('INVALID_INPUT');
  const rawToken = token(form.get('token'));
  const expectedVersion = version(Number(form.get('expectedVersion')));
  const kind = form.get('kind');
  if (!FILE_KINDS.has(kind)) throw new GatewayError('INVALID_INPUT');
  const file = form.get('file');
  if (!(file instanceof File) || file.size < 1 || file.size > FILE_LIMIT) throw new GatewayError('INVALID_FILE', 400);
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectMime(fileBytes);
  if (!mime || (kind === 'signature' && mime !== 'image/png') || (file.type && file.type !== mime)) throw new GatewayError('INVALID_FILE_TYPE', 415);
  const fileName = file.name.replace(/[\\/\u0000-\u001f]/g, '').slice(0, 120) || 'upload';
  const hash = await digest(rawToken);
  const auth = await rpc(deps.service, 'finance_labor_guest_upload_authorize_v1', {
    p_token_hash: hash, p_expected_version: expectedVersion, p_kind: kind,
    p_file_name: fileName, p_mime: mime, p_size_bytes: fileBytes.byteLength
  });
  uuid(auth.uploadId);
  if (auth.bucket !== 'finance-external-labor' || typeof auth.path !== 'string' || auth.path.length > 300 || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/uploads\/[0-9a-f-]{36}$/i.test(auth.path) || auth.maxBytes < fileBytes.byteLength) throw new GatewayError('SERVICE_UNAVAILABLE', 503);
  const sha256 = await digest(fileBytes);
  const uploaded = await deps.service.storage.from(auth.bucket).upload(auth.path, fileBytes, { contentType: mime, upsert: false, cacheControl: '0', metadata: { sha256 } });
  if (uploaded.error) throw new GatewayError('UPLOAD_FAILED', 503);
  const readback = await privateFile(deps.service, auth.path, sha256);
  if (!readback || readback.byteLength !== fileBytes.byteLength) throw new GatewayError('UPLOAD_FAILED', 503);
  const receipt = await rpc(deps.service, 'finance_labor_guest_file_commit_v1', {
    p_token_hash: hash, p_upload_id: auth.uploadId, p_path: auth.path, p_kind: kind,
    p_sha256: sha256, p_size_bytes: fileBytes.byteLength, p_mime: mime
  });
  if (receipt.committed !== true) throw new GatewayError('UPLOAD_FAILED', 503);
  return { uploadId: auth.uploadId, path: auth.path, sha256, kind, committed: true };
}

async function staffEvidenceUpload(request, deps) {
  const jwt = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') || '')?.[1];
  if (!jwt) throw new GatewayError('UNAUTHENTICATED', 401);
  const staff = await deps.staff(jwt);
  if (!staff) throw new GatewayError('UNAUTHENTICATED', 401);
  const bytes = await readBytes(request, FILE_LIMIT + JSON_LIMIT);
  let form;
  try { form = await new Request(request.url, { method: 'POST', headers: { 'content-type': request.headers.get('content-type') || '' }, body: bytes }).formData(); }
  catch { throw new GatewayError('INVALID_INPUT'); }
  if ([...form.keys()].some(key => !['statementId', 'file'].includes(key)) || form.getAll('statementId').length !== 1 || form.getAll('file').length !== 1) throw new GatewayError('INVALID_INPUT');
  const statementId = uuid(form.get('statementId'));
  const file = form.get('file');
  if (!(file instanceof File) || file.size < 1 || file.size > FILE_LIMIT) throw new GatewayError('INVALID_FILE');
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectMime(fileBytes);
  if (!mime || (file.type && file.type !== mime)) throw new GatewayError('INVALID_FILE_TYPE', 415);
  const filename = file.name.replace(/[\\/\u0000-\u001f]/g, '').slice(0, 120) || 'bank-proof';
  const allowed = await rpc(staff, 'finance_labor_staff_evidence_authorize_v1', {
    p_statement_id: statementId, p_file_name: filename, p_mime: mime, p_size_bytes: fileBytes.byteLength
  });
  if (allowed.bucket !== 'finance-external-labor' || !new RegExp(`^[0-9a-f-]{36}/${statementId}/payment_evidence/[0-9a-f-]{36}$`, 'i').test(allowed.path || '') || allowed.maxBytes < fileBytes.byteLength) throw new GatewayError('SERVICE_UNAVAILABLE', 503);
  const sha256 = await digest(fileBytes);
  const stored = await deps.service.storage.from(allowed.bucket).upload(allowed.path, fileBytes, { contentType: mime, upsert: false, cacheControl: '0', metadata: { sha256 } });
  if (stored.error) throw new GatewayError('UPLOAD_FAILED', 503);
  const readback = await privateFile(deps.service, allowed.path, sha256);
  if (!readback || readback.byteLength !== fileBytes.byteLength) throw new GatewayError('UPLOAD_FAILED', 503);
  return { evidenceId: allowed.evidenceId, bucket: allowed.bucket, path: allowed.path, sha256, sizeBytes: fileBytes.byteLength, mime };
}

function validateSubmission(body) {
  ownKeys(body, ['token', 'expectedVersion', 'submitId', 'profile', 'uploads', 'consentVersion']);
  token(body.token); version(body.expectedVersion); uuid(body.submitId);
  ownKeys(body.profile, PROFILE_FIELDS);
  for (const key of PROFILE_FIELDS) requiredString(body.profile[key], key === 'address' ? 400 : 160);
  ownKeys(body.uploads, UPLOAD_FIELDS);
  for (const key of UPLOAD_FIELDS) {
    const upload = body.uploads[key];
    ownKeys(upload, ['uploadId', 'path', 'sha256']);
    uuid(upload.uploadId); requiredString(upload.path, 300);
    if (!SHA_RE.test(upload.sha256)) throw new GatewayError('INVALID_INPUT');
  }
  if (body.consentVersion !== 'labor-v1') throw new GatewayError('INVALID_INPUT');
}

async function submit(body, deps) {
  validateSubmission(body);
  const signed = await rpc(deps.service, 'finance_labor_guest_submit_v1', {
    p_token_hash: await digest(body.token), p_expected_version: body.expectedVersion,
    p_submit_id: body.submitId, p_profile: body.profile, p_uploads: body.uploads,
    p_consent_version: body.consentVersion
  });
  return archiveSigned(signed, deps);
}

async function repairArchive(body, request, deps) {
  ownKeys(body, ['statementId']);
  const jwt = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') || '')?.[1];
  if (!jwt) throw new GatewayError('UNAUTHENTICATED', 401);
  const staff = await deps.staff(jwt);
  if (!staff) throw new GatewayError('UNAUTHENTICATED', 401);
  const signed = await rpc(staff, 'finance_labor_staff_archive_repair_v1', { p_statement_id: uuid(body.statementId) });
  const completed = await archiveSigned(signed, deps);
  return { statementId: completed.statementId, version: completed.version, status: completed.status, replayed: completed.replayed };
}

async function archiveSigned(signed, deps) {
  uuid(signed.statementId);
  if (signed.status === 'signed') return { statementId: signed.statementId, version: signed.version, status: 'signed', snapshotHash: signed.snapshotHash, replayed: true, identityMethod: 'bearer_link_only' };
  if (signed.status !== 'signed_pending_archive' || typeof signed.signedSnapshotText !== 'string' || !SHA_RE.test(signed.snapshotHash)) throw new GatewayError('SERVICE_UNAVAILABLE', 503);
  const snapshotBytes = new TextEncoder().encode(signed.signedSnapshotText);
  const fileHash = await digest(snapshotBytes);
  if (fileHash !== signed.snapshotHash) throw new GatewayError('SERVICE_UNAVAILABLE', 503);
  const path = signed.archivePath;
  if (typeof path !== 'string' || !/^[A-Za-z0-9_-]+\/[0-9a-f-]{36}\/signed\/[0-9a-f]{64}\.json$/i.test(path) || !path.endsWith(`${signed.snapshotHash}.json`)) throw new GatewayError('SERVICE_UNAVAILABLE', 503);
  await deps.service.storage.from('finance-external-labor').upload(path, snapshotBytes, { contentType: 'application/json', cacheControl: '0', upsert: false, metadata: { sha256: fileHash } });
  // Duplicate uploads may be reported as 400 or 409 across Storage versions.
  // The read-back is authoritative: only exact immutable bytes may be committed.
  const readback = await deps.service.storage.from('finance-external-labor').download(path);
  if (readback.error || !readback.data) throw new GatewayError('ARCHIVE_PENDING', 503);
  const persistedBytes = new Uint8Array(await readback.data.arrayBuffer());
  if (persistedBytes.byteLength !== snapshotBytes.byteLength || await digest(persistedBytes) !== fileHash) throw new GatewayError('ARCHIVE_PENDING', 503);
  const committed = await rpc(deps.service, 'finance_labor_guest_archive_commit_v1', {
    p_statement_id: signed.statementId, p_snapshot_hash: signed.snapshotHash,
    p_path: path, p_file_sha256: fileHash
  });
  if (committed.status !== 'signed') throw new GatewayError('ARCHIVE_PENDING', 503);
  return { statementId: committed.statementId, version: committed.version, status: 'signed', snapshotHash: committed.snapshotHash, replayed: Boolean(committed.replayed || signed.replayed), identityMethod: 'bearer_link_only' };
}

export function createHandler(deps) {
  return async request => {
    const origin = request.headers.get('origin') || '';
    if (origin && origin !== PUBLIC_ORIGIN) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
    const route = new URL(request.url).pathname.replace(/\/+$/, '').split('/').slice(-2).join('/');
    if (request.method === 'GET' && route === 'finance-labor-external/health') return json({ service: 'finance-labor-external', version: '1' }, 200, origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(origin) });
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, origin);
    try {
      let result;
      if (route === 'guest/lookup') result = await lookup(await readJson(request), deps);
      else if (route === 'guest/upload') result = await upload(request, deps);
      else if (route === 'evidence/upload' && new URL(request.url).pathname.includes('/staff/')) result = await staffEvidenceUpload(request, deps);
      else if (route === 'guest/submit') result = await submit(await readJson(request), deps);
      else if (route === 'archive/repair' && new URL(request.url).pathname.endsWith('/finance-labor-external/staff/archive/repair')) result = await repairArchive(await readJson(request), request, deps);
      else if (route === 'invite/create') result = await invite(await readJson(request), request, deps);
      else if (route === 'invite/rotate') result = await rotateInvite(await readJson(request), request, deps);
      else if (route === 'export/month') result = await exportMonth(await readJson(request), request, deps, origin);
      else if (route === 'export/preview') result = await exportMonth(await readJson(request), request, deps, origin, true);
      else throw new GatewayError('NOT_FOUND', 404);
      return result instanceof Response ? result : json(result, 200, origin);
    } catch (error) {
      const failure = error instanceof GatewayError ? error : new GatewayError('SERVICE_UNAVAILABLE', 503);
      return json({ error: failure.code }, failure.status, origin);
    }
  };
}
