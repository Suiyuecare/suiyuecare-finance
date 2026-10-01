'use strict';
// Runs the shipped tus-js-client in a real Chromium page against a loopback
// TUS endpoint. All bytes and identities are fictional; no Supabase call.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const start = source.indexOf('var FINANCE_TUS_LIBRARY_READ=');
const end = source.indexOf('async function uploadAttachmentToSupabase(', start);
assert(start >= 0 && end > start, 'production resumable transport functions are present');
const transportSource = source.slice(start, end);
const sevenMiB = 7 * 1024 * 1024 + 31;
const fiftyMiB = 50 * 1024 * 1024;
const chunkSize = 6 * 1024 * 1024;

async function main() {
  const attempts = [], uploads = new Map();
  let nextId = 1, retryInjected = false;
  const server = http.createServer((req, res) => {
    const body = [];
    req.on('data', (part) => body.push(part));
    req.on('end', () => {
      const bytes = Buffer.concat(body);
      const parsed = new URL(req.url, 'http://localhost');
      const statusHeaders = { 'Tus-Resumable': '1.0.0', 'Cache-Control': 'no-store' };
      function reply(status, extra = {}, content = '') {
        res.writeHead(status, { ...statusHeaders, ...extra });
        res.end(content);
      }
      if (req.method === 'GET' && parsed.pathname === '/') {
        return reply(200, { 'Content-Type': 'text/html; charset=utf-8' }, '<!doctype html><title>TUS loopback fixture</title>');
      }
      if (req.method === 'POST' && parsed.pathname === '/storage/v1/upload/resumable') {
        const metadata = {};
        for (const pair of String(req.headers['upload-metadata'] || '').split(',')) {
          const [key, value] = pair.trim().split(' ');
          if (key) metadata[key] = value ? Buffer.from(value, 'base64').toString('utf8') : '';
        }
        const id = String(nextId++), upload = {
          id, metadata, offset: bytes.length, length: Number(req.headers['upload-length']),
          chunks: [bytes], complete: false,
        };
        uploads.set(id, upload);
        attempts.push({ method: 'POST', id, authorization: req.headers.authorization, size: bytes.length, metadata });
        const location = `http://127.0.0.1:${server.address().port}/uploads/${id}`;
        if (metadata.objectName.includes('/abort')) {
          // Hold the creation response until Chromium aborts the actual XHR.
          setTimeout(() => { if (!res.destroyed) reply(201, { Location: location, 'Upload-Offset': String(upload.offset) }); }, 700);
          return;
        }
        reply(201, { Location: location, 'Upload-Offset': String(upload.offset) });
        return;
      }
      const id = parsed.pathname.match(/^\/uploads\/(\d+)$/)?.[1];
      const upload = id && uploads.get(id);
      if (!upload) return reply(404);
      if (req.method === 'HEAD') {
        attempts.push({ method: 'HEAD', id, authorization: req.headers.authorization, offset: upload.offset });
        return reply(200, { 'Upload-Offset': String(upload.offset), 'Upload-Length': String(upload.length) });
      }
      if (req.method === 'PATCH') {
        const requestedOffset = Number(req.headers['upload-offset']);
        attempts.push({ method: 'PATCH', id, authorization: req.headers.authorization, offset: requestedOffset, size: bytes.length });
        if (requestedOffset !== upload.offset) return reply(409, { 'Upload-Offset': String(upload.offset) });
        if (!retryInjected) { retryInjected = true; return reply(503, { 'Retry-After': '0' }, 'fictional transient outage'); }
        upload.chunks.push(bytes);
        upload.offset += bytes.length;
        upload.complete = upload.offset === upload.length;
        return reply(204, { 'Upload-Offset': String(upload.offset) });
      }
      reply(405);
    });
  });
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(origin);
    await page.addScriptTag({ path: path.join(root, 'assets/vendor/tus-4.3.1.min.js') });
    const result = await page.evaluate(async ({ transportSource, origin, sevenMiB, fiftyMiB, chunkSize }) => {
      window.SUPABASE_URL = origin;
      window.SUPABASE_ANON_KEY = 'fictional-public-anon';
      window.SUPABASE_ATTACHMENT_BUCKET = 'finance-attachments';
      window.S = { user: { id: 'user-a' } };
      window.financeWorkspaceIdentityBlocked = false;
      window.currentFinanceAuthUserId = () => 'auth-user-a';
      window.financeSessionMatchesWorkspace = (session) => session?.user?.id === 'auth-user-a';
      window.currentTenantId = () => 'tenant-a';
      window.activeDataEnvironment = () => 'production';
      window.attachmentUploadError = (message, details) => Object.assign(new Error(message), details);
      window.cleanupAttachmentPersistence = async () => true;
      window.stagedAttachmentCleanupDiagnostic = () => {};
      window.formatStorageUploadError = (error) => error.message;
      window.currentToken = 'fictional-jwt-a';
      const client = { auth: { getSession: async () => ({ data: { session: { access_token: window.currentToken, user: { id: 'auth-user-a' } } } }) } };
      const uploadAttachmentResumable = new Function(transportSource + '\nreturn uploadAttachmentResumable;')();
      const blob = new Blob([new Uint8Array(sevenMiB)], { type: 'application/pdf' });
      const progress = [];
      await uploadAttachmentResumable(client, 'tenant-a/expense_requests/production/fixture/retry.pdf', blob,
        'application/pdf', { onProgress(sent, total) {
          progress.push([sent, total]);
          if (sent >= chunkSize) window.currentToken = 'fictional-jwt-b';
        } }, 'auth-user-a|user-a|tenant-a|production');
      const largeBlob = new Blob([new Uint8Array(fiftyMiB)], { type: 'application/pdf' });
      const largeProgress = [];
      await uploadAttachmentResumable(client, 'tenant-a/invoices/production/fixture/large.pdf', largeBlob,
        'application/pdf', { onProgress(sent, total) { largeProgress.push([sent, total]); } },
        'auth-user-a|user-a|tenant-a|production');
      const controller = new AbortController();
      const abortPromise = uploadAttachmentResumable(client, 'tenant-a/expense_requests/production/fixture/abort.pdf', blob,
        'application/pdf', { abortSignal: controller.signal }, 'auth-user-a|user-a|tenant-a|production');
      setTimeout(() => controller.abort(), 40);
      let aborted = false;
      try { await abortPromise; } catch (error) { aborted = error.reason === 'attachment_upload_timeout'; }
      return { progress, largeProgress, aborted, browserTus: typeof window.tus?.Upload === 'function' };
    }, { transportSource, origin, sevenMiB, fiftyMiB, chunkSize });

    assert.equal(result.browserTus, true);
    assert.equal(result.aborted, true, 'actual TUS XHR abort must reject the production transport');
    const completed = [...uploads.values()].find((upload) => upload.metadata.objectName.endsWith('/retry.pdf'));
    assert(completed, 'TUS POST contains the target object metadata');
    assert.equal(completed.metadata.bucketName, 'finance-attachments');
    assert.equal(completed.metadata.contentType, 'application/pdf');
    assert.equal(completed.length, sevenMiB);
    assert.equal(completed.chunks[0].length, chunkSize, 'creation-with-upload sends one 6 MiB chunk');
    assert.equal(completed.offset, sevenMiB);
    assert.equal(completed.complete, true);
    assert(result.progress.some(([sent]) => sent >= chunkSize));
    const patches = attempts.filter((attempt) => attempt.method === 'PATCH' && attempt.id === completed.id);
    assert(patches.length >= 2, 'transient 503 must produce a retry');
    assert(patches.every((attempt) => attempt.authorization === 'Bearer fictional-jwt-b'), 'each retried chunk uses one refreshed JWT without concatenating headers');
    assert(patches.every((attempt) => attempt.size === sevenMiB - chunkSize));
    assert.equal(attempts.find((attempt) => attempt.method === 'POST' && attempt.id === completed.id).authorization, 'Bearer fictional-jwt-a');
    assert(attempts.some((attempt) => attempt.method === 'HEAD' && attempt.id === completed.id), 'retry probes server offset');
    const large = [...uploads.values()].find((upload) => upload.metadata.objectName.endsWith('/large.pdf'));
    assert(large, '50 MiB invoice source reaches the TUS transport');
    assert.equal(large.length, fiftyMiB);
    assert.equal(large.offset, fiftyMiB);
    assert.equal(large.complete, true);
    assert.equal(large.chunks.length, 9, '50 MiB uploads in nine bounded 6 MiB chunks');
    assert(large.chunks.every((part) => part.length <= chunkSize));
    assert(result.largeProgress.some(([sent, total]) => sent === fiftyMiB && total === fiftyMiB));
    assert.equal(attempts.filter((attempt) => attempt.method === 'POST').length, 3);
    assert([...uploads.values()].some((upload) => upload.metadata.objectName.endsWith('/abort.pdf') && !upload.complete));
    console.log('PASS real Chromium + vendored tus 4.3.1 transferred 7 MiB with retry and 50 MiB invoice source in nine bounded chunks, refreshed JWT, and aborted a third transfer');
    console.log(`PASS loopback TUS trace: ${attempts.length} requests; no production network`);
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
