const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  applyBuildEnvironment,
  resolveBuildConfig
} = require('./finance_build_environment');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'www');
const buildConfig = resolveBuildConfig(process.env);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(path.join(root, src), path.join(root, dest));
}

function copyDir(src, dest) {
  const from = path.join(root, src);
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, path.join(root, dest), { recursive: true });
}

fs.rmSync(out, { recursive: true, force: true });
ensureDir(path.join(out, 'assets', 'templates'));
ensureDir(path.join(out, 'docs'));

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const engineDir = path.join(root, 'assets', 'engines');
const styleDir = path.join(root, 'assets', 'styles');
const versionedAssets = fs.readdirSync(engineDir)
  .filter((file) => file.endsWith('.js'))
  .map((file) => ({ key: `engines/${file}`, path: path.join(engineDir, file) }))
  .concat(
    fs.readdirSync(styleDir)
      .filter((file) => file.endsWith('.css'))
      .map((file) => ({ key: `styles/${file}`, path: path.join(styleDir, file) }))
  )
  .sort((a, b) => a.key.localeCompare(b.key));
const assetVersion = versionedAssets
  .reduce((hash, asset) => hash.update(asset.key).update(fs.readFileSync(asset.path)), crypto.createHash('sha256'))
  .digest('hex')
  .slice(0, 16);
html = html.replace(/__FINANCE_ASSET_VERSION__/g, assetVersion);
html = applyBuildEnvironment(html, buildConfig);
fs.writeFileSync(path.join(out, 'index.html'), html);

copyFile('privacy.html', 'www/privacy.html');
copyFile('assets/suiyue-logo-transparent.png', 'www/assets/suiyue-logo-transparent.png');
copyDir('assets/styles', 'www/assets/styles');
copyDir('assets/engines', 'www/assets/engines');
copyFile('assets/templates/hr_expense_template.xlsx', 'www/assets/templates/hr_expense_template.xlsx');
copyFile('assets/templates/labor_service_fee.docx', 'www/assets/templates/labor_service_fee.docx');
copyFile('docs/歲悅會計系統_V4修訂重點.html', 'www/docs/歲悅會計系統_V4修訂重點.html');
copyFile('docs/歲悅會計系統教育訓練手冊_橘色版.docx', 'www/docs/歲悅會計系統教育訓練手冊_橘色版.docx');
copyFile('docs/歲悅財務管理系統V4_使用教學.pptx', 'www/docs/歲悅財務管理系統V4_使用教學.pptx');

console.log(`Built www for Finance ${buildConfig.target} (${buildConfig.runtimeMode}, asset version ${assetVersion}).`);
