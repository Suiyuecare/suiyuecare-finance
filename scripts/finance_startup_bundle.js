'use strict';

// Preserve source order without making HTML parsing wait for 23 separate
// engine requests. The original engines remain independently testable.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SDK = Object.freeze({
  version: '2.111.0',
  url: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0',
  source: 'assets/vendor/supabase-js-2.111.0.umd.js',
  sha256: '7396012594aa6d23bb373ebc25d1080bf3672fa847c3713f756520b40fd13453',
  license: 'assets/vendor/supabase-js-2.111.0.LICENSE',
  licenseSha256: '334dd6820e2eaeab2064e7c59001b810566728a28a41a7c1dbf69bbee17d0936',
  provenance: 'assets/vendor/supabase-js-2.111.0.provenance.json'
});
function pinnedSupabaseSdk(root) {
  const code = fs.readFileSync(path.join(root, SDK.source));
  const license = fs.readFileSync(path.join(root, SDK.license));
  const provenance = JSON.parse(fs.readFileSync(path.join(root, SDK.provenance), 'utf8'));
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha(code) !== SDK.sha256 || sha(license) !== SDK.licenseSha256
      || provenance.version !== SDK.version || provenance.umdSha256 !== SDK.sha256
      || provenance.licenseSha256 !== SDK.licenseSha256) {
    throw new Error('Pinned Supabase SDK source, license or provenance is invalid');
  }
  return { code, license, provenance, file: 'assets/supabase-js-' + SDK.version + '-' + SDK.sha256.slice(0, 16) + '.js' };
}

function createStartupBundle(html, root) {
  const sdk = pinnedSupabaseSdk(root);
  const sdkTag = '<script src="' + SDK.url + '"></script>';
  if (html.split(sdkTag).length !== 2) throw new Error('Expected exactly one pinned Supabase SDK source script');
  // Preserve synchronous execution before the main IIFE. Only the transport
  // changes: the exact official UMD now belongs to the sealed same-origin build.
  html = html.replace(sdkTag, '<script src="' + sdk.file + '"></script>');
  const end = html.indexOf('</head>');
  if (end < 0) throw new Error('Finance head is missing');
  let head = html.slice(0, end), scripts = [];
  head = head.replace(/<script src="(assets\/engines\/[a-z0-9-]+\.js)(?:\?[^"<>]*)?"><\/script>/g, (tag, file) => {
    scripts.push({ file, code: fs.readFileSync(path.join(root, file), 'utf8') });
    return scripts.length === 1 ? '<!-- FINANCE_STARTUP_BUNDLE -->' : '';
  });
  if (!scripts.length || scripts[0].file !== 'assets/engines/finance-v4-engine-registry.js') throw new Error('Finance engine order is invalid');
  const code = scripts.map(item => '\n/* ' + item.file + ' */\n' + item.code + '\n;').join('');
  const version = crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
  const file = 'assets/finance-startup-' + version + '.js';
  head = head.replace('<!-- FINANCE_STARTUP_BUNDLE -->', '<link rel="preload" as="script" href="' + sdk.file + '">\n<script src="' + file + '"></script>');
  return { html: head + html.slice(end), file, code, sdk, sources: scripts.map(item => item.file) };
}

module.exports = { createStartupBundle, pinnedSupabaseSdk, SDK };
