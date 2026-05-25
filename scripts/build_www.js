const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'www');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(path.join(root, src), path.join(root, dest));
}

fs.rmSync(out, { recursive: true, force: true });
ensureDir(path.join(out, 'assets', 'templates'));
ensureDir(path.join(out, 'docs'));

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/\s*<!-- DEMO_LOGIN_START -->[\s\S]*?<!-- DEMO_LOGIN_END -->\s*/g, '\n');
fs.writeFileSync(path.join(out, 'index.html'), html);

copyFile('privacy.html', 'www/privacy.html');
copyFile('assets/suiyue-logo-transparent.png', 'www/assets/suiyue-logo-transparent.png');
copyFile('assets/templates/hr_expense_template.xlsx', 'www/assets/templates/hr_expense_template.xlsx');
copyFile('assets/templates/labor_service_fee.docx', 'www/assets/templates/labor_service_fee.docx');
copyFile('docs/歲悅會計系統_V2-V3修訂重點.html', 'www/docs/歲悅會計系統_V2-V3修訂重點.html');
copyFile('docs/歲悅會計系統教育訓練手冊_橘色版.docx', 'www/docs/歲悅會計系統教育訓練手冊_橘色版.docx');
copyFile('docs/歲悅財務管理系統V3_使用教學.pptx', 'www/docs/歲悅財務管理系統V3_使用教學.pptx');

console.log('Built www for Finance production.');
