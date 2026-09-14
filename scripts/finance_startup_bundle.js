'use strict';

// Preserve source order without making HTML parsing wait for 23 separate
// engine requests. The original engines remain independently testable.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createStartupBundle(html, root) {
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
  head = head.replace('<!-- FINANCE_STARTUP_BUNDLE -->', '<script src="' + file + '"></script>');
  // Start the pinned SDK request alongside HTML/CSS instead of discovering it
  // only after downloading every form and the full application source.
  const sdk = html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"<>]+)"><\/script>/);
  if (sdk) head = head.replace('<link rel="icon"', '<link rel="preload" as="script" href="' + sdk[1] + '">\n<link rel="icon"');
  return { html: head + html.slice(end), file, code, sources: scripts.map(item => item.file) };
}

module.exports = { createStartupBundle };
