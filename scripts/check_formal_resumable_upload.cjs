'use strict';
// Fictional accounts and an in-memory Storage/TUS transport: never writes to production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const engineSource = fs.readFileSync(path.join(root, 'assets/engines/attachment-engine.js'), 'utf8');
const sixMiB = 6 * 1024 * 1024;
const fixturePath = 'tenant-a/expense_requests/production/2026/10/E1/A100/FICTIONAL/receipt/unique.pdf';
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert(a >= 0 && b > a, `missing source range ${start}`);
  return source.slice(a, b);
}
function fakeFile(size, name = 'original.pdf') {
  const file = new Blob([Buffer.alloc(size)], { type: 'application/pdf' });
  file.name = name;
  return file;
}
function officeFile(kind, size, mime) {
  // Real uncompressed Open XML packages, including OPC relationships and a
  // valid main document. They contain only fictional text and padding XML.
  const main = kind === 'docx' ? 'word/document.xml' : 'xl/workbook.xml';
  const contentType = kind === 'docx'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
  const entries = [
    ['[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${main}" ContentType="${contentType}"/>${kind === 'xlsx' ? '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' : ''}</Types>`],
    ['_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/></Relationships>`],
    [main, kind === 'docx'
      ? '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>虛構退費附件</w:t></w:r></w:p></w:body></w:document>'
      : '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="退費清冊" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['customXml/item1.xml', '<fixture xmlns="urn:finance:fictional">' + 'x'.repeat(size) + '</fixture>'],
  ];
  if (kind === 'xlsx') entries.push(
    ['xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>虛構測試</t></is></c></row></sheetData></worksheet>']);
  function crc(bytes) {
    let result = 0xffffffff;
    for (const byte of bytes) {
      result ^= byte;
      for (let bit = 0; bit < 8; bit++) result = (result >>> 1) ^ (0xedb88320 & -(result & 1));
    }
    return (result ^ 0xffffffff) >>> 0;
  }
  const local = [], central = []; let offset = 0;
  for (const [entry, value] of entries) {
    const name = Buffer.from(entry), data = Buffer.from(value), checksum = crc(data);
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4);
    head.writeUInt32LE(checksum, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(head, name, data); central.push(directory, name); offset += head.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const file = new Blob([Buffer.concat([...local, directory, end])], { type: mime });
  file.name = `虛構退費附件-${size}.${kind}`;
  return file;
}
function engine() {
  const ctx = { window: { FinanceV4Engines: { register() {} } }, Blob };
  vm.runInNewContext(engineSource, ctx);
  return ctx.window.FinanceAttachmentEngine;
}
const attachmentEngine = engine();

async function main() {
  const file = fakeFile(sixMiB + 1);
  let readerCreated = 0;
  const fileCtx = {
    Blob, Promise, Date, ATTACHMENT_RESUMABLE_THRESHOLD_BYTES: sixMiB,
    SUPABASE_ATTACHMENT_BUCKET: 'finance-attachments',
    activeDataEnvironment: () => 'production', fileExt: attachmentEngine.fileExtension, num: Number,
    FileReader: class { constructor() { readerCreated++; } },
  };
  vm.runInNewContext(between('function fileToAttachment(', 'function safeStorageName('), fileCtx);
  const prepared = await fileCtx.fileToAttachment(file, { directLarge: true });
  assert.equal(prepared.uploadBlob, file);
  assert.equal(prepared.url, '');
  assert.equal(readerCreated, 0, 'large formal file must never be base64-read');
  assert.equal(attachmentEngine.normalizeFileMeta(prepared).uploadBlob, file);
  assert.equal(attachmentEngine.normalizeFileMeta(prepared).size, sixMiB + 1);
  const existing = await fileCtx.fileToAttachment({ n: 'old.pdf', path: 'tenant-a/old.pdf', size: 1 }, { directLarge: true });
  assert.equal(existing.path, 'tenant-a/old.pdf');
  assert.equal(existing.uploadBlob, undefined);
  console.log('PASS formal large file stays a native Blob through normalization; existing draft path is retained');

  const invoiceFile = fakeFile(50 * 1024 * 1024, 'fictional-large-invoice.pdf');
  const invoiceFeedback = [];
  const invoiceCtx = {
    ...fileCtx,
    fileToAttachment: fileCtx.fileToAttachment,
    todayIso: () => '2026-10-02',
    attachmentLooksPdf: (item) => item.t === 'pdf',
    attachmentLooksImage: () => false,
    receiptBundleAttachment: async (items) => {
      assert.equal(items[0].uploadBlob, invoiceFile, 'the optional receipt bundle may not base64-copy the 50 MiB original');
      return null;
    },
    invoiceExcelAttachment: () => ({ n: 'details.xls', size: 100, url: 'data:application/vnd.ms-excel,fixture' }),
    setActionFeedback: (...args) => invoiceFeedback.push(args),
    uploadAttachmentsToSupabase: async (items, ctx) => {
      assert.equal(items.length, 2);
      assert.equal(items[1].uploadBlob, invoiceFile, 'the original invoice must reach the upload stage as a Blob');
      ctx.onProgress(invoiceFile.size / 2, invoiceFile.size, { fileIndex: 2, fileCount: 2 });
      return items;
    },
  };
  vm.runInNewContext(between('async function invoiceInitialStepFiles(', 'async function issueInvCore('), invoiceCtx);
  const invoiceFiles = await invoiceCtx.invoiceInitialStepFiles([invoiceFile], [{ total: 123 }], { recordNo: 'FICTIONAL', eid: 'E1', dc: 'A100' });
  assert.equal(invoiceFiles[1].uploadBlob, invoiceFile);
  assert.equal(readerCreated, 0, '50 MiB invoice submission must not instantiate FileReader');
  assert(invoiceFeedback.some((item) => item[2].includes('第 2 / 2 個附件') && item[2].includes('50%')));
  assert(invoiceFeedback.at(-1)[2].includes('附件已保存'));
  console.log('PASS 50 MiB single and batch invoice source retains the native Blob and shows upload progress');

  let currentScope = 'user-a|tenant-a|production';
  const trace = { tus: [], sdk: [], rows: [], removals: [], cleanupOptions: [], deletions: [], signed: [], progress: [], aborts: 0, diagnostics: [] };
  let rejectRequiredCleanup = false;
  let tusBehavior = (upload) => {
    upload.options.onProgress(upload.file.size, upload.file.size);
    upload.options.onSuccess();
  };
  let abortBehavior = () => Promise.resolve();
  class Upload {
    constructor(uploadFile, options) { this.file = uploadFile; this.options = options; trace.tus.push(this); }
    start() { queueMicrotask(() => tusBehavior(this)); }
    abort() { trace.aborts++; return abortBehavior(this); }
  }
  const authUserId = 'auth-user-a';
  const makeSession = (token = 'fixture-access-token', id = authUserId) => ({
    access_token: token, user: { id, email: 'user-a@suiyuecare.com' },
  });
  const auth = { data: { session: makeSession() } };
  const client = {
    auth: { getSession: async () => auth },
    storage: { from(bucket) {
      assert.equal(bucket, 'finance-attachments');
      return {
        upload: async (storagePath, blob, options) => { trace.sdk.push({ storagePath, blob, options }); return { data: { path: storagePath } }; },
        download: async () => ({ data: file }),
        remove: async (paths) => { trace.removals.push(...paths); return { data: paths }; },
      };
    } },
    from(table) {
      assert.equal(table, 'file_attachments');
      return {
        insert: async (row) => { trace.rows.push(row); return { data: row }; },
      };
    },
  };
  const archive = {
    recordType: 'expense_requests', recordNo: 'FICTIONAL', kind: 'receipt',
    year: 2026, ym: '2026-10', dataEnvironment: 'production', tenantId: 'tenant-a',
    entityId: 'E1', departmentCode: 'A100', recordDate: '2026-10-02', retentionUntil: '2036-10-02',
  };
  const c = {
    Blob, Date, Promise, URL, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    console: { warn() {}, error() {} },
    S: { user: { get id() { return currentScope.split('|')[0]; } }, demoLogin: false }, window: { tus: { Upload } },
    financeWorkspaceIdentityBlocked: false,
    currentFinanceAuthUserId: () => authUserId,
    financeSessionMatchesWorkspace: (session) => !!session && session.user?.id === authUserId
      && session.user?.email === 'user-a@suiyuecare.com',
    SUPABASE_URL: 'https://fictional-project.supabase.co', SUPABASE_ANON_KEY: 'anon-fixture',
    SUPABASE_ATTACHMENT_BUCKET: 'finance-attachments', ATTACHMENT_RESUMABLE_THRESHOLD_BYTES: sixMiB,
    normalizeFileMeta: attachmentEngine.normalizeFileMeta,
    currentTenantId: () => currentScope.split('|')[1],
    activeDataEnvironment: () => currentScope.split('|')[2],
    preflightAttachmentForUpload: (att) => att.promote
      ? { needsUpload: false, needsPromotion: true, sourceBucket: 'finance-attachments', sourcePath: att.path, archive, path: fixturePath, name: att.n }
      : att.path
      ? { needsUpload: false, needsPromotion: false }
      : { needsUpload: true, needsPromotion: false, blob: att.uploadBlob, archive, path: fixturePath, name: att.n },
    hasSupabase: () => true, requireRemotePersistence: () => true,
    collectAttachmentStoragePaths: groups => [...new Set(groups.flat().map(item => item && item.path).filter(Boolean))],
    ensureSupabaseStorageReady: async () => ({ ok: true }), getSb: () => client,
    tenantColumnsEnabled: () => true, isSchemaCacheMiss: () => false,
    assertAttachmentUploadable: () => {},
    verifyUploadedAttachmentReadable: async (_, storagePath) => { trace.signed.push(storagePath); },
    cleanupAttachmentPersistence: async (_, storagePath, opts) => {
      trace.removals.push(storagePath);
      trace.cleanupOptions.push(opts || {});
      if (rejectRequiredCleanup && opts && opts.objectRequired) throw new Error('Storage remove returned no affected object');
      if (opts && opts.metadataFirst) trace.deletions.push(storagePath);
    },
    stagedAttachmentCleanupDiagnostic: (...args) => { trace.diagnostics.push(args); },
    attachmentUploadError: (message, details) => Object.assign(new Error(message), details),
    formatStorageUploadError: (error) => error && error.message || String(error),
  };
  vm.createContext(c);
  vm.runInContext(between('var FINANCE_TUS_LIBRARY_READ=', 'async function uploadAttachmentToSupabase(')
    + between('async function uploadAttachmentToSupabase(', 'function recordLateAttachmentCleanupFailure(')
    + between('function uploadAttachmentWithTrackedTimeout(', 'async function uploadAttachmentsToSupabase(')
    + between('async function cleanupUploadedSupabaseAttachments(', 'var STAGED_ATTACHMENT_LOGIN_CLEANUP_KEY='), c);
  const scoped = await c.uploadAttachmentToSupabase({ ...prepared, kind: 'receipt' }, {});
  assert.equal(trace.tus.length, 1);
  assert.equal(trace.sdk.length, 0, 'large file must bypass one-shot SDK upload');
  assert.equal(trace.tus[0].file, file);
  assert.equal(trace.tus[0].options.endpoint, 'https://fictional-project.storage.supabase.co/storage/v1/upload/resumable');
  assert.equal(trace.tus[0].options.chunkSize, sixMiB);
  assert.equal(trace.tus[0].options.headers.authorization, undefined, 'auth is set once per request by the refresh hook');
  const requestHeaders = {};
  const request = { setHeader(key, value) { requestHeaders[key] = value; } };
  auth.data.session.access_token = 'fixture-refreshed-token';
  await trace.tus[0].options.onBeforeRequest(request);
  assert.equal(requestHeaders.authorization, 'Bearer fixture-refreshed-token', 'each TUS chunk/retry gets current refreshed JWT');
  auth.data.session.access_token = 'fixture-access-token';
  assert.match(await trace.tus[0].options.fingerprint(file), /auth-user-a\|user-a\|tenant-a\|production\|tenant-a\/expense_requests/);
  assert.equal(trace.tus[0].options.metadata.objectName, fixturePath);
  assert.equal(trace.tus[0].options.metadata.bucketName, 'finance-attachments');
  assert.equal(trace.rows[0].tenant_id, 'tenant-a');
  assert.equal(trace.rows[0].uploaded_by, 'user-a');
  assert.equal(trace.rows[0].data_environment, 'production');
  assert.equal(trace.rows[0].attachment_state, 'staged');
  assert.deepEqual(trace.signed, [fixturePath]);
  assert.equal(Object.hasOwn(scoped, 'uploadBlob'), false, 'Blob must not enter persisted request payload');
  assert.equal(Object.keys(scoped).includes('__uploadCreatedThisAttempt'), false);
  assert.equal(scoped.__uploadCreatedThisAttempt, true);
  assert.equal(scoped.path, fixturePath);
  console.log('PASS large upload uses scoped Supabase TUS endpoint, 6 MiB chunks, bearer auth, staged metadata and verified read');

  currentScope = 'user-b|tenant-a|production';
  await assert.rejects(trace.tus[0].options.onBeforeRequest(request), /登入身分已切換/);
  currentScope = 'user-a|tenant-a|production';
  auth.data.session = null;
  await assert.rejects(trace.tus[0].options.onBeforeRequest(request), /登入狀態已過期/);
  auth.data.session = makeSession();
  auth.data.session.user.id = 'auth-user-b';
  await assert.rejects(trace.tus[0].options.onBeforeRequest(request), /登入身分已切換/);
  auth.data.session = makeSession();
  c.financeWorkspaceIdentityBlocked = true;
  await assert.rejects(trace.tus[0].options.onBeforeRequest(request), /登入身分已切換/);
  c.financeWorkspaceIdentityBlocked = false;
  console.log('PASS TUS request hook denies switched accounts and expired auth before sending a chunk');

  const small = fakeFile(512, 'small.pdf');
  const smallResult = await c.uploadAttachmentToSupabase({ n: small.name, mime: small.type, size: small.size, uploadBlob: small }, {});
  assert.equal(trace.sdk.length, 1);
  assert.equal(trace.sdk[0].blob, small);
  assert.equal(trace.sdk[0].options.upsert, false);
  assert.equal(trace.tus.length, 1, 'small files retain the original SDK upload behavior');
  assert.equal(smallResult.__uploadCreatedThisAttempt, true);
  const previouslyUploaded = await c.uploadAttachmentToSupabase({ n: 'old.pdf', path: 'tenant-a/draft_requests/production/old.pdf' }, {});
  assert.equal(previouslyUploaded.__uploadCreatedThisAttempt, undefined);
  console.log('PASS small files use the existing SDK path and old draft objects are not marked as new');

  const officeSources = [
    officeFile('docx', 3 * 1024 * 1024, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    officeFile('docx', Math.floor(1.3 * 1024 * 1024), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    officeFile('xlsx', Math.floor(57.9 * 1024), ''),
  ];
  const officePrepared = [];
  const readersBeforeOffice = readerCreated, uploadsBeforeOffice = trace.sdk.length, signedBeforeOffice = trace.signed.length;
  for (const original of officeSources) {
    assert.equal(attachmentEngine.mimeAllowed(original, original), true, 'official and omitted Safari MIME remain allowed');
    const item = await fileCtx.fileToAttachment(original, { directUpload: true });
    assert.equal(item.n, original.name);
    assert.equal(item.t, attachmentEngine.fileExtension(original.name));
    assert.equal(item.uploadBlob, original);
    assert.equal(item.url, '');
    assert.equal(attachmentEngine.normalizeFileMeta(item).uploadBlob, original);
    officePrepared.push(item);
    const uploaded = await c.uploadAttachmentToSupabase(item, {});
    const transport = trace.sdk.at(-1);
    assert.equal(transport.blob, original, 'small Office original reaches Storage without a base64 read or decode');
    assert.deepEqual(Buffer.from(await transport.blob.arrayBuffer()), Buffer.from(await original.arrayBuffer()));
    assert.equal(transport.options.contentType, original.type || 'application/octet-stream');
    assert.equal(transport.options.upsert, false);
    assert.equal(uploaded.size, original.size);
    assert.equal(Object.hasOwn(uploaded, 'uploadBlob'), false);
    assert.equal(uploaded.path, fixturePath);
    assert.equal(trace.rows.at(-1).attachment_state, 'staged');
    assert.equal(trace.rows.at(-1).uploaded_by, 'user-a');
    assert.equal(trace.rows.at(-1).tenant_id, 'tenant-a');
  }
  assert.equal(readerCreated, readersBeforeOffice, 'all three small Office submissions avoid FileReader');
  assert.equal(trace.sdk.length - uploadsBeforeOffice, 3);
  assert.equal(trace.signed.length - signedBeforeOffice, 3, 'every original retains existing signed-download verification');
  c.normalizeFiles = attachmentEngine.normalizeFiles;
  c.attachmentLooksPdf = attachmentEngine.looksPdf;
  c.attachmentLooksImage = attachmentEngine.looksImage;
  vm.runInContext(between('async function receiptPdfAttachment(', 'function isReceiptBundleAttachment(')
    + between('async function receiptBundleAttachment(', 'var RECEIPT_VIEWER_STATE='), c);
  assert.equal(await c.receiptBundleAttachment(officePrepared, { no: 'FICTIONAL-REFUND' }), null,
    'Office originals must not be duplicated into a base64 HTML summary');
  assert.equal(attachmentEngine.mimeAllowed({ name: 'renamed.xlsx', type: 'application/zip' }, new Blob(['PK fake archive'], { type: 'application/zip' })), false,
    'generic ZIP still cannot be admitted by an Office extension');
  assert.equal(attachmentEngine.mimeAllowed({ name: 'program.exe', type: 'application/x-msdownload' }, new Blob(['MZ'], { type: 'application/x-msdownload' })), false);
  // OCR must retain its explicit data URL path; submission opt-in is separate.
  fileCtx.FileReader = class {
    constructor() { readerCreated++; }
    readAsDataURL(original) { original.arrayBuffer().then(bytes => { this.result = 'data:' + (original.type || 'application/octet-stream') + ';base64,' + Buffer.from(bytes).toString('base64'); this.onload(); }); }
  };
  const forOcr = await fileCtx.fileToAttachment(officeSources[0]);
  assert.match(forOcr.url, /^data:application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document;base64,/);
  assert.equal(forOcr.uploadBlob, undefined);
  assert.equal(readerCreated, readersBeforeOffice + 1);
  assert.match(source, /S\.nrFiles\.map\(function\(file\)\{return fileToAttachment\(file,\{directUpload:true\}\);\}\)/);
  console.log('PASS three real fictional Office packages keep original bytes, size, scope, staged metadata and download checks; no FileReader/HTML duplication; ZIP/executable stay denied and OCR stays separate');

  const rowsBeforeNetworkError = trace.rows.length;
  tusBehavior = (upload) => upload.options.onError(new Error('fictional broken connection after chunk'));
  await assert.rejects(c.uploadAttachmentToSupabase({ ...prepared, kind: 'receipt' }, {}), /broken connection/);
  assert.equal(trace.rows.length, rowsBeforeNetworkError, 'network interruption cannot create committed metadata');
  assert.equal(trace.removals.at(-1), fixturePath, 'incomplete upload is cleaned only at the new target path');
  console.log('PASS interrupted TUS transfer is not recorded as an attachment and cleans only its new path');

  const abortsBeforeDeadline = trace.aborts;
  tusBehavior = () => {}; // The server never responds after starting the transfer.
  await assert.rejects(c.uploadAttachmentWithTrackedTimeout({ ...prepared, kind: 'receipt' }, {}, 'large fixture', 25), /逾時/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(trace.aborts, abortsBeforeDeadline + 1, 'deadline must abort the active TUS transport');
  assert.equal(trace.removals.at(-1), fixturePath, 'deadline cleanup touches only the target path');
  console.log('PASS transfer deadline aborts TUS rather than abandoning a live background upload');

  let releaseAbort;
  abortBehavior = () => new Promise((resolve) => { releaseAbort = resolve; });
  let racingUpload;
  tusBehavior = (upload) => { racingUpload = upload; };
  const raceController = new AbortController();
  const rowsBeforeRace = trace.rows.length;
  const racePromise = c.uploadAttachmentToSupabase({ ...prepared, kind: 'receipt' }, { abortSignal: raceController.signal });
  await new Promise((resolve) => setTimeout(resolve, 0));
  raceController.abort();
  await new Promise((resolve) => setTimeout(resolve, 0));
  let raceSettled = false;
  racePromise.then(() => { raceSettled = true; }, () => { raceSettled = true; });
  racingUpload.options.onSuccess(); // A final chunk confirms while abort is in flight.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(raceSettled, false, 'completion race must wait for transport abort confirmation');
  assert.equal(trace.rows.length, rowsBeforeRace, 'completion race cannot create staged metadata');
  releaseAbort();
  await assert.rejects(racePromise, /已中止分段傳輸/);
  assert.equal(trace.cleanupOptions.at(-1).objectRequired, true, 'a completed final chunk must require confirmed cleanup after abort');
  const removalsAfterAbort = trace.removals.length;
  racingUpload.options.onSuccess(); // A late confirmation after abort gets another exact-path cleanup.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(trace.removals.length, removalsAfterAbort + 1);
  assert.equal(trace.removals.at(-1), fixturePath);
  abortBehavior = () => Promise.resolve();
  console.log('PASS final-chunk/abort race waits for transport stop and cleans late completion');

  const uploadsBeforePreStartAbort = trace.tus.length;
  const signalAbortingDuringRegistration = {
    aborted: false,
    addEventListener(_name, callback) { this.aborted = true; callback(); },
    removeEventListener() {},
  };
  await assert.rejects(c.uploadAttachmentResumable(client, fixturePath, file, file.type,
    { abortSignal: signalAbortingDuringRegistration }, 'auth-user-a|user-a|tenant-a|production'), /已中止分段傳輸/);
  assert.equal(trace.tus.length, uploadsBeforePreStartAbort, 'pre-start abort cannot create a background TUS request');
  console.log('PASS abort during signal registration cannot start a late transfer');

  const beforeRows = trace.rows.length;
  const abortsBeforeSwitch = trace.aborts;
  currentScope = 'user-a|tenant-a|production';
  tusBehavior = (upload) => {
    auth.data.session = makeSession('replacement-token', 'auth-user-b');
    upload.options.onSuccess();
  };
  await assert.rejects(c.uploadAttachmentToSupabase({ ...prepared, kind: 'receipt' }, {}), /登入身分已切換/);
  assert.equal(trace.rows.length, beforeRows, 'a replacement Auth subject cannot insert metadata while the displayed employee stays unchanged');
  assert.equal(trace.cleanupOptions.at(-1).objectRequired, true, 'completed upload under a changed account must confirm object deletion');
  auth.data.session = makeSession();
  tusBehavior = (upload) => {
    currentScope = 'user-b|tenant-a|production';
    upload.options.onSuccess();
  };
  rejectRequiredCleanup = true;
  await assert.rejects(c.uploadAttachmentToSupabase({ ...prepared, kind: 'receipt' }, {}), /登入身分已切換/);
  assert.equal(trace.diagnostics.at(-1)[0], 'attachment_resumable_cleanup_failed', 'inaccessible completed object leaves an actionable diagnostic');
  rejectRequiredCleanup = false;
  currentScope = 'user-a|tenant-a|production';
  auth.data.session = makeSession();
  rejectRequiredCleanup = true;
  await assert.rejects(c.cleanupUploadedSupabaseAttachments([[{ path: fixturePath }]], 'fictional rollback'), /未完整完成/);
  assert.equal(trace.cleanupOptions.at(-1).objectRequired, true, 'batch rollback cannot count an unconfirmed Storage deletion as successful');
  rejectRequiredCleanup = false;
  console.log('PASS a changed Auth subject after transfer cannot write under the unchanged displayed employee');

  tusBehavior = (upload) => {
    currentScope = 'user-b|tenant-a|production';
    upload.options.onProgress(1, upload.file.size);
  };
  await assert.rejects(c.uploadAttachmentToSupabase({ ...prepared, kind: 'receipt' }, {}), /登入身分已切換/);
  assert.equal(trace.aborts, abortsBeforeSwitch + 1);
  assert.equal(trace.rows.length, beforeRows, 'account switch cannot insert metadata');
  assert.equal(trace.removals.at(-1), fixturePath, 'only this attempt path is cleaned');
  console.log('PASS account switch aborts an in-flight resumable upload without persisting metadata');

  currentScope = 'user-a|tenant-a|production';
  const draftSource = 'tenant-a/draft_requests/production/2026/10/E1/A100/DRAFT/receipt/source.pdf';
  const removalCountBeforePromotion = trace.removals.length;
  await assert.rejects(c.uploadAttachmentToSupabase({ n: 'source.pdf', path: draftSource, promote: true }, {}), /登入身分已切換/);
  assert.deepEqual(trace.removals.slice(removalCountBeforePromotion), [fixturePath], 'promotion failure preserves the pre-existing draft source');
  console.log('PASS identity switch during draft promotion preserves the original draft attachment');

  currentScope = 'user-a|tenant-a|production';
  tusBehavior = (upload) => upload.options.onSuccess();
  const originalInsert = client.from;
  client.from = (table) => ({ insert: async (row) => { trace.rows.push(row); currentScope = 'user-b|tenant-a|production'; return { data: row }; } });
  await assert.rejects(c.uploadAttachmentToSupabase({ ...prepared, kind: 'receipt' }, {}), /登入身分已切換/);
  assert.equal(trace.deletions.at(-1), fixturePath, 'switch after metadata insert removes only the new row and object');
  client.from = originalInsert;
  console.log('PASS account switch after metadata insert cleans the new staged row and object');

  currentScope = 'user-a|tenant-a|production';
  const originalResumable = c.uploadAttachmentResumable;
  const originalCleanup = c.cleanupAttachmentPersistence;
  c.uploadAttachmentResumable = async () => { currentScope = 'user-b|tenant-a|production'; };
  c.cleanupAttachmentPersistence = async () => { throw new Error('fictional cleanup denied'); };
  const diagnosticsBefore = trace.diagnostics.length;
  await assert.rejects(c.uploadAttachmentToSupabase({ ...prepared, kind: 'receipt' }, {}),
    (error) => error.reason === 'attachment_identity_cleanup_failed' && error.storagePath === fixturePath);
  assert.equal(trace.diagnostics.length, diagnosticsBefore + 1, 'cross-account cleanup failure has an actionable incident');
  assert.equal(trace.diagnostics.at(-1)[0], 'attachment_identity_cleanup_failed');
  c.uploadAttachmentResumable = originalResumable;
  c.cleanupAttachmentPersistence = originalCleanup;
  currentScope = 'user-a|tenant-a|production';
  console.log('PASS post-upload account-switch cleanup failure emits an actionable diagnostic');

  const batchCleanup = [];
  const batch = {
    Promise, Date, console: { info() {} },
    ATTACHMENT_RESUMABLE_THRESHOLD_BYTES: sixMiB, ATTACHMENT_LARGE_UPLOAD_TIMEOUT_MS: 1200000,
    ATTACHMENT_UPLOAD_TIMEOUT_MS: 90000, num: Number,
    preflightAttachmentsForSupabase: async (files) => files,
    uploadAttachmentWithTrackedTimeout: async (att) => {
      if (att.fail) throw Object.assign(new Error('fictional outage'), { reason: 'network' });
      return att;
    },
    normalizeFileMeta: (att) => att,
    formatStorageUploadError: (error) => error.message,
    cleanupUploadedSupabaseAttachments: async (groups) => { batchCleanup.push(groups); return groups[0].length; },
    attachmentUploadError: (message, details) => Object.assign(new Error(message), details),
  };
  vm.createContext(batch);
  vm.runInContext(between('async function uploadAttachmentsToSupabase(', 'function attachmentStoragePath('), batch);
  const newFile = Object.defineProperty({ n: 'new.pdf', path: fixturePath }, '__uploadCreatedThisAttempt', { value: true });
  await assert.rejects(batch.uploadAttachmentsToSupabase([previouslyUploaded, newFile, { n: 'fails.pdf', fail: true }], {}), /fictional outage/);
  assert.equal(batchCleanup.length, 1);
  assert.equal(batchCleanup[0][0].length, 1);
  assert.equal(batchCleanup[0][0][0], newFile, 'batch failure must not delete pre-existing draft object');
  assert.equal(batch.newlyUploadedAttachmentResults([previouslyUploaded, newFile]).length, 1);
  console.log('PASS batch rollback includes only objects created in the current attempt');

  let deletedObjects = [];
  let deletedRows = [];
  const cleanupClient = {
    storage: { from: () => ({ remove: async () => ({ data: deletedObjects }) }) },
    from: () => ({ delete: () => ({ eq: () => ({ select: async () => ({ data: deletedRows }) }) }) }),
  };
  const cleanup = {
    SUPABASE_ATTACHMENT_BUCKET: 'finance-attachments',
    attachmentUploadError: (message, details) => Object.assign(new Error(message), details),
    formatStorageUploadError: (error) => error?.message || String(error),
  };
  vm.createContext(cleanup);
  vm.runInContext(between('async function removeUploadedAttachmentObject(', 'async function verifyUploadedAttachmentReadable('), cleanup);
  await assert.rejects(cleanup.cleanupAttachmentPersistence(cleanupClient, fixturePath,
    { objectOnly: true, objectRequired: true }), /沒有確認刪除/);
  await cleanup.cleanupAttachmentPersistence(cleanupClient, fixturePath, { objectOnly: true });
  deletedObjects = [{ name: 'unique.pdf' }];
  deletedRows = [{ id: 'fictional-staged-row' }];
  await cleanup.cleanupAttachmentPersistence(cleanupClient, fixturePath,
    { metadataFirst: true, objectRequired: true, metadataRequired: true });
  deletedRows = [];
  await assert.rejects(cleanup.cleanupAttachmentPersistence(cleanupClient, fixturePath,
    { metadataFirst: true, objectRequired: true, metadataRequired: true }), /沒有確認刪除這筆暫存附件/);
  console.log('PASS cleanup requires confirmed affected rows for known uploaded objects and metadata');

  const migration = fs.readFileSync(path.join(root,
    'supabase/migrations/20261001202434_finance_attachment_owner_staged_cleanup_select_v3.sql'), 'utf8');
  assert.match(migration, /for select\s+to authenticated/i);
  assert.match(migration, /finance_can_mutate_attachment_object_v2\(name, owner_id, created_at\)/i);
  assert.doesNotMatch(migration, /for delete\s+to authenticated/i);
  console.log('PASS owner-only staged cleanup read policy mirrors the existing narrow delete predicate');

  const vendor = fs.readFileSync(path.join(root, 'assets/vendor/tus-4.3.1.min.js'));
  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'assets/vendor/tus-4.3.1.provenance.json'), 'utf8'));
  const sha = require('node:crypto').createHash('sha256').update(vendor).digest('hex');
  assert.equal(provenance.sha256, sha, 'vendored client has pinned source digest');
  const tusContext = { window: {}, self: {}, globalThis: {}, setTimeout, clearTimeout, setInterval, clearInterval, Blob, URL, Promise };
  vm.runInNewContext(vendor.toString('utf8'), tusContext);
  assert.equal(typeof tusContext.window.tus?.Upload, 'function', 'same-origin vendored browser bundle exposes tus.Upload');
  console.log('PASS pinned same-origin TUS bundle loads and matches provenance digest');
}

module.exports = { officeFile };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
