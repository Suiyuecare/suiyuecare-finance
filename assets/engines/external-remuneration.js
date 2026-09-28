(() => {
  'use strict';
  const root = document.getElementById('external-labor');
  if (!root) return;
  const endpoint = root.dataset.apiUrl || '';
  const message = document.getElementById('message');
  const formArea = document.getElementById('form-area');
  const form = document.getElementById('labor-form');
  const complete = document.getElementById('complete');
  const submitButton = document.getElementById('submit-button');
  const clearSignatureButton = document.getElementById('clear-signature');
  const canvas = document.getElementById('signature-pad');
  const context = canvas.getContext('2d');
  const state = { token: '', version: 0, submitId: crypto.randomUUID(), uploads: {}, ink: false, busy: false, pendingPayload: null };
  const uploadNames = { identity_front: 'identityFront', identity_back: 'identityBack', bank_proof: 'bankProof', signature: 'signature' };
  const money = cents => new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(cents / 100);
  const reasons = {
    INVALID_LINK: '連結無效或已失效，請向原邀請承辦人索取新連結。',
    NOT_AVAILABLE: '此連結目前不可使用，可能已過期、撤銷或完成簽署。請聯繫原邀請承辦人。',
    CONFLICT: '資料版本已更新，請聯繫承辦人重新取得連結。',
    INVALID_FILE_TYPE: '檔案格式不符。請使用 PNG、JPG 或 PDF；簽名須為 PNG。',
    PAYLOAD_TOO_LARGE: '檔案過大，每份不得超過 8 MB。',
    INVALID_FILE: '檔案無法使用，請重新選擇。',
    INVALID_INPUT: '資料尚未符合送出條件。請核對服務、姓名與帳戶名稱後重試。',
    DATA_MISMATCH: '姓名或帳戶名稱與承辦資料不一致。請先聯繫承辦人核對，勿改填其他人資料。',
    UPLOAD_FAILED: '附件尚未上傳完成，請重試。',
    UPLOAD_LIMIT_REACHED: '此連結的附件嘗試次數已達上限。請聯絡會計撤銷舊連結並重新寄送。',
    ARCHIVE_PENDING: '簽署已收件，但正式封存仍在處理。請保留此畫面並按送出重試，勿再次填寫新表單。',
    SERVICE_UNAVAILABLE: '服務暫時無法完成，請稍後重試；資料尚未確認送出。'
  };

  function say(text, error = false) {
    message.textContent = text;
    message.classList.toggle('error', error);
  }

  async function call(path, body, isFile = false, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${endpoint}${path}`, {
        method: 'POST',
        headers: isFile ? undefined : { 'Content-Type': 'application/json' },
        body: isFile ? body : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        credentials: 'omit'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'SERVICE_UNAVAILABLE');
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('SERVICE_UNAVAILABLE');
      throw error;
    } finally { clearTimeout(timeout); }
  }

  function displayError(error) {
    say(reasons[error.message] || '目前無法完成操作，請稍後重試或聯繫原邀請承辦人。', true);
    if (state.token && formArea.hidden && complete.hidden && ['SERVICE_UNAVAILABLE', 'ARCHIVE_PENDING'].includes(error.message)) {
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'secondary'; retry.textContent = '重新嘗試讀取';
      retry.addEventListener('click', () => { say('正在重新確認簽署狀態…'); call('/guest/lookup', { token: state.token }).then(renderSummary).catch(displayError); }, { once: true });
      message.append(document.createElement('br'), retry);
    }
    message.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function renderSummary(data) {
    if (data.status === 'signed' && data.statementId) {
      state.token = ''; formArea.hidden = true; complete.hidden = false; say('');
      document.getElementById('complete-id').textContent = data.statementId;
      return;
    }
    if (!Array.isArray(data.serviceLines) || !Number.isSafeInteger(data.totalGrossCents) || !Number.isSafeInteger(data.version) || data.status !== 'invited') throw new Error('SERVICE_UNAVAILABLE');
    state.version = data.version;
    document.getElementById('entity-name').textContent = data.entityName || data.entityId || '付款單位';
    const list = document.getElementById('service-lines');
    list.replaceChildren();
    for (const line of data.serviceLines) {
      const item = document.createElement('div'); item.className = 'service-line';
      const detail = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = line.courseType || '講師服務';
      const description = document.createElement('small'); description.textContent = [line.description, line.courseRef, line.serviceDate].filter(Boolean).join(' · ');
      const amount = document.createElement('span'); amount.className = 'money'; amount.textContent = money(line.grossCents);
      detail.append(title, description); item.append(detail, amount); list.append(item);
    }
    document.getElementById('total-gross').textContent = money(data.totalGrossCents);
    formArea.hidden = false;
    say('請核對服務內容並填寫資料。');
  }

  function position(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
  }
  context.lineWidth = 3.5;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#27231f';
  let drawing = false;
  canvas.addEventListener('pointerdown', event => {
    if (state.busy || state.pendingPayload) return;
    drawing = true; state.ink = true;
    document.getElementById('signature-file').value = '';
    delete state.uploads.signature;
    canvas.setPointerCapture(event.pointerId);
    const p = position(event); context.beginPath(); context.moveTo(p.x, p.y); context.lineTo(p.x + .1, p.y); context.stroke();
  });
  canvas.addEventListener('pointermove', event => {
    if (!drawing) return;
    const p = position(event); context.lineTo(p.x, p.y); context.stroke();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, () => { drawing = false; });
  clearSignatureButton.addEventListener('click', () => {
    if (state.busy || state.pendingPayload) return;
    context.clearRect(0, 0, canvas.width, canvas.height); state.ink = false;
    document.getElementById('signature-file').value = '';
    delete state.uploads.signature;
  });
  document.getElementById('signature-file').addEventListener('change', event => {
    if (event.target.files.length) {
      context.clearRect(0, 0, canvas.width, canvas.height); state.ink = false;
    }
    delete state.uploads.signature;
  });
  for (const input of document.querySelectorAll('input[data-kind]')) input.addEventListener('change', () => { delete state.uploads[uploadNames[input.dataset.kind]]; });

  async function signatureFile() {
    const selected = document.getElementById('signature-file').files[0];
    if (selected) return selected;
    if (!state.ink) throw new Error('SIGNATURE_REQUIRED');
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('SIGNATURE_REQUIRED');
    return new File([blob], 'signature.png', { type: 'image/png' });
  }

  async function upload(kind, file) {
    const key = uploadNames[kind];
    if (state.uploads[key]) return state.uploads[key];
    if (!file || file.size < 1 || file.size > 8 * 1024 * 1024) throw new Error('INVALID_FILE');
    const data = new FormData();
    data.append('token', state.token); data.append('expectedVersion', String(state.version));
    data.append('kind', kind); data.append('file', file, file.name);
    const receipt = await call('/guest/upload', data, true, 60000);
    if (!receipt.committed || !receipt.uploadId || !receipt.sha256 || !receipt.path) throw new Error('UPLOAD_FAILED');
    state.uploads[key] = { uploadId: receipt.uploadId, path: receipt.path, sha256: receipt.sha256 };
    return state.uploads[key];
  }

  async function send(event) {
    event.preventDefault();
    if (state.busy) return;
    if (!state.pendingPayload && !form.reportValidity()) return;
    if (!state.pendingPayload && !document.getElementById('consent').checked) { say('請先閱讀並勾選簽署聲明。', true); return; }
    state.busy = true; submitButton.disabled = true;
    try {
      if (!state.pendingPayload) {
        const profile = {};
        for (const field of ['fullName', 'idNumber', 'phone', 'address', 'bankCode', 'bankName', 'branchName', 'accountNumber', 'accountHolder']) profile[field] = form.elements[field].value.trim();
        const files = [...document.querySelectorAll('input[data-kind]')];
        for (let i = 0; i < files.length; i++) {
          const input = files[i];
          say(`正在安全上傳附件 ${i + 1} / 4…`);
          await upload(input.dataset.kind, input.files[0]);
        }
        say('正在安全上傳簽名 4 / 4…');
        await upload('signature', await signatureFile());
        state.pendingPayload = {
          token: state.token, expectedVersion: state.version, submitId: state.submitId,
          profile, uploads: structuredClone(state.uploads), consentVersion: 'labor-v1'
        };
        for (const input of form.querySelectorAll('input')) input.disabled = true;
        clearSignatureButton.disabled = true;
        submitButton.textContent = '重試完成封存';
      }
      say('正在建立簽署紀錄並封存，請勿關閉頁面…');
      const result = await call('/guest/submit', state.pendingPayload, false, 45000);
      if (result.status !== 'signed') throw new Error('ARCHIVE_PENDING');
      state.token = ''; state.uploads = {}; state.pendingPayload = null;
      form.reset(); context.clearRect(0, 0, canvas.width, canvas.height);
      formArea.hidden = true; complete.hidden = false; say('');
      document.getElementById('complete-id').textContent = result.statementId;
      complete.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (error) {
      if (state.pendingPayload && ['DATA_MISMATCH', 'INVALID_INPUT'].includes(error.message)) {
        state.pendingPayload = null;
        for (const input of form.querySelectorAll('input')) input.disabled = false;
        clearSignatureButton.disabled = false;
        submitButton.textContent = '確認並送出簽署';
      }
      displayError(error.message === 'SIGNATURE_REQUIRED' ? new Error('SIGNATURE_REQUIRED') : error);
      if (error.message === 'SIGNATURE_REQUIRED') say('請手寫簽名或上傳簽名 PNG。', true);
      if (state.pendingPayload) submitButton.textContent = '重試完成封存';
    } finally { state.busy = false; submitButton.disabled = false; }
  }

  form.addEventListener('submit', send);
  const parsed = /^#t=([A-Za-z0-9_-]{43})$/.exec(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
  if (!endpoint || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/finance-labor-external$/i.test(endpoint)) {
    say('此預覽環境無法提交正式表單。請使用承辦人提供的正式連結。', true);
  } else if (!parsed) {
    say('請使用承辦人提供的完整專屬連結開啟表單。', true);
  } else {
    state.token = parsed[1];
    call('/guest/lookup', { token: state.token }).then(renderSummary).catch(displayError);
  }
})();
