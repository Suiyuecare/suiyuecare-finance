const tools = [
  { id: "merge", title: "合併", desc: "把多個 PDF 合成一份。", icon: "copy-plus", color: "#7957e9" },
  { id: "compress", title: "壓縮", desc: "最佳化 PDF 結構，降低檔案大小。", icon: "minimize-2", color: "#ff313a" },
  { id: "annotate", title: "註解", desc: "在 PDF 加上文字註解。", icon: "pencil", color: "#16bfc2" },
  { id: "edit", title: "編輯文字", desc: "用覆蓋方式修改 PDF 上的短文字。", icon: "text-cursor-input", color: "#16bfc2" },
  { id: "split", title: "分割", desc: "依頁碼範圍拆分 PDF。", icon: "scissors", color: "#7957e9" },
  { id: "word", title: "PDF ↔ Word", desc: "PDF 轉 Word，或 Word 轉 PDF。", icon: "file-type-2", color: "#2f94e8" },
  { id: "toc", title: "節錄", desc: "擷取重點頁面或整理文字節錄。", icon: "list", color: "#0b58e6" },
  { id: "image", title: "PDF ↔ 圖像", desc: "PDF 轉圖片，或圖片轉 PDF。", icon: "image", color: "#f7b000" },
  { id: "translate", title: "翻譯", desc: "使用 OpenAI 翻譯 PDF 文字並輸出新 PDF。", icon: "languages", color: "#0b58e6" },
  { id: "ocr", title: "PDF OCR", desc: "辨識掃描 PDF，產生可讀文字版本。", icon: "scan-text", color: "#ff313a" },
  { id: "sign", title: "簽名", desc: "在 PDF 上加入簽名文字或手寫簽名。", icon: "signature", color: "#d94ed9" },
  { id: "request", title: "請求簽名", desc: "建立簽核連結，用印或螢幕簽名。", icon: "pen-tool", color: "#ffe13f", dark: true }
];

const moreTools = [
  { id: "converter", title: "PDF轉換器", desc: "轉成 DOCX、TXT、圖片或最佳化 PDF。", icon: "replace", color: "#ff313a" },
  { id: "excel", title: "PDF ↔ Excel", desc: "PDF 轉 XLSX，或 XLSX 轉 PDF。", icon: "file-spreadsheet", color: "#10c84a" },
  { id: "delete-pages", title: "刪除頁面", desc: "刪除指定頁碼後輸出新 PDF。", icon: "trash-2", color: "#7957e9" },
  { id: "unlock", title: "解除鎖定", desc: "用已知合法密碼解除 PDF。", icon: "lock-open", color: "#ff5b86" },
  { id: "powerpoint", title: "PDF ↔ PowerPoint", desc: "PDF 轉 PPTX，或 PPTX 轉 PDF。", icon: "presentation", color: "#ff7a00" },
  { id: "rotate", title: "旋轉", desc: "旋轉全部或指定頁面。", icon: "rotate-cw", color: "#7957e9" },
  { id: "crop", title: "裁剪", desc: "調整 PDF 頁面邊界。", icon: "crop", color: "#16bfc2" },
  { id: "extract-pages", title: "擷取頁面", desc: "抽出指定頁面成為新 PDF。", icon: "layout-grid", color: "#7957e9" },
  { id: "protect", title: "保護", desc: "加入原生 PDF 密碼保護。", icon: "lock-keyhole", color: "#ff5b86" },
  { id: "chat", title: "與 PDF 檔案進行對談", desc: "針對 PDF 內容提問，使用 OpenAI 回答。", icon: "message-square-text", color: "#0b58e6" },
  { id: "page-numbers", title: "頁碼", desc: "在 PDF 加上頁碼。", icon: "list-ordered", color: "#16bfc2" },
  { id: "redact", title: "修訂", desc: "遮蔽敏感資訊，並真正套用 redaction。", icon: "panel-top", color: "#16a7a7" },
  { id: "watermark", title: "浮水印", desc: "加入文字浮水印。", icon: "stamp", color: "#16bfc2" },
  { id: "flatten", title: "平面化", desc: "固定表單、註解與圖層內容。", icon: "layers", color: "#ff5b86" }
];

const allTools = [...tools, ...moreTools];
const accountButton = document.querySelector("#account-button");
const accountLabel = document.querySelector("#account-label");
const authModal = document.querySelector("#auth-modal");
const authClose = document.querySelector("#auth-close");
const authForm = document.querySelector("#auth-form");
const authTitle = document.querySelector("#auth-title");
const authNameField = document.querySelector("#auth-name-field");
const authName = document.querySelector("#auth-name");
const authEmail = document.querySelector("#auth-email");
const authPassword = document.querySelector("#auth-password");
const authSubmit = document.querySelector("#auth-submit");
const authLogout = document.querySelector("#auth-logout");
const authTabs = document.querySelector(".auth-tabs");
const authLoginTab = document.querySelector("#auth-login-tab");
const authRegisterTab = document.querySelector("#auth-register-tab");
const authMessage = document.querySelector("#auth-message");
const adminRefresh = document.querySelector("#admin-refresh");
const adminSummary = document.querySelector("#admin-summary");
const adminOperationTab = document.querySelector("#admin-operation-tab");
const adminErrorTab = document.querySelector("#admin-error-tab");
const adminLogList = document.querySelector("#admin-log-list");
const heroSection = document.querySelector(".hero");
const toolsSection = document.querySelector("#tools");
const moreToolsSection = document.querySelector("#more-tools");
const grid = document.querySelector("#tool-grid");
const moreGrid = document.querySelector("#more-tool-grid");
const searchInput = document.querySelector("#tool-search");
const workspace = document.querySelector("#workspace");
const workspaceNavLink = document.querySelector("#workspace-nav-link");
const backToTools = document.querySelector("#back-to-tools");
const workspaceTitle = document.querySelector("#workspace-title");
const selectedTool = document.querySelector("#selected-tool");
const dropzone = document.querySelector("#dropzone");
const dropzoneTitle = document.querySelector("#dropzone-title");
const dropzoneCopy = document.querySelector("#dropzone-copy");
const fileInput = document.querySelector("#file-input");
const pickFiles = document.querySelector("#pick-files");
const fileList = document.querySelector("#file-list");
const quality = document.querySelector("#quality");
const qualityValue = document.querySelector("#quality-value");
const outputFont = document.querySelector("#output-font");
const processButton = document.querySelector("#process-button");
const resultBox = document.querySelector("#result-box");
const jobProgress = document.querySelector("#job-progress");
const jobProgressBar = document.querySelector("#job-progress-bar");
const historyList = document.querySelector("#history-list");
const converterOptions = document.querySelector("#converter-options");
const converterFormat = document.querySelector("#converter-format");
const converterScale = document.querySelector("#converter-scale");
const converterPageBreaks = document.querySelector("#converter-page-breaks");
const annotationOptions = document.querySelector("#annotation-options");
const annotationText = document.querySelector("#annotation-text");
const annotationPosition = document.querySelector("#annotation-position");
const annotationColor = document.querySelector("#annotation-color");
const annotationAllPages = document.querySelector("#annotation-all-pages");
const editTextOptions = document.querySelector("#edit-text-options");
const editTextValue = document.querySelector("#edit-text-value");
const editTextPosition = document.querySelector("#edit-text-position");
const editTextSize = document.querySelector("#edit-text-size");
const editTextColor = document.querySelector("#edit-text-color");
const editTextCover = document.querySelector("#edit-text-cover");
const wordOptions = document.querySelector("#word-options");
const wordDirection = document.querySelector("#word-direction");
const wordKeepPageBreaks = document.querySelector("#word-keep-page-breaks");
const excelOptions = document.querySelector("#excel-options");
const excelDirection = document.querySelector("#excel-direction");
const excelOutput = document.querySelector("#excel-output");
const excelDetectColumns = document.querySelector("#excel-detect-columns");
const powerpointOptions = document.querySelector("#powerpoint-options");
const powerpointDirection = document.querySelector("#powerpoint-direction");
const powerpointScale = document.querySelector("#powerpoint-scale");
const deletePagesOptions = document.querySelector("#delete-pages-options");
const unlockOptions = document.querySelector("#unlock-options");
const unlockPassword = document.querySelector("#unlock-password");
const rotateOptions = document.querySelector("#rotate-options");
const rotateDegrees = document.querySelector("#rotate-degrees");
const cropOptions = document.querySelector("#crop-options");
const cropTop = document.querySelector("#crop-top");
const cropRight = document.querySelector("#crop-right");
const cropBottom = document.querySelector("#crop-bottom");
const cropLeft = document.querySelector("#crop-left");
const protectOptions = document.querySelector("#protect-options");
const protectOpenPassword = document.querySelector("#protect-open-password");
const protectOwnerPassword = document.querySelector("#protect-owner-password");
const protectAllowPrint = document.querySelector("#protect-allow-print");
const protectAllowCopy = document.querySelector("#protect-allow-copy");
const extractPagesOptions = document.querySelector("#extract-pages-options");
const extractPagesMode = document.querySelector("#extract-pages-mode");
const pageNumbersOptions = document.querySelector("#page-numbers-options");
const pageNumberStart = document.querySelector("#page-number-start");
const pageNumberFormat = document.querySelector("#page-number-format");
const pageNumberPosition = document.querySelector("#page-number-position");
const pageNumberSize = document.querySelector("#page-number-size");
const pageNumberColor = document.querySelector("#page-number-color");
const redactOptions = document.querySelector("#redact-options");
const redactPosition = document.querySelector("#redact-position");
const redactWidth = document.querySelector("#redact-width");
const redactHeight = document.querySelector("#redact-height");
const redactColor = document.querySelector("#redact-color");
const redactLabel = document.querySelector("#redact-label");
const watermarkOptions = document.querySelector("#watermark-options");
const watermarkText = document.querySelector("#watermark-text");
const watermarkPosition = document.querySelector("#watermark-position");
const watermarkSize = document.querySelector("#watermark-size");
const watermarkAngle = document.querySelector("#watermark-angle");
const watermarkOpacity = document.querySelector("#watermark-opacity");
const watermarkColor = document.querySelector("#watermark-color");
const flattenOptions = document.querySelector("#flatten-options");
const flattenFormFields = document.querySelector("#flatten-form-fields");
const flattenOptimize = document.querySelector("#flatten-optimize");
const excerptOptions = document.querySelector("#excerpt-options");
const excerptMode = document.querySelector("#excerpt-mode");
const excerptMergeRanges = document.querySelector("#excerpt-merge-ranges");
const imageOptions = document.querySelector("#image-options");
const imageDirection = document.querySelector("#image-direction");
const imageFormat = document.querySelector("#image-format");
const imageScale = document.querySelector("#image-scale");
const chatOptions = document.querySelector("#chat-options");
const chatQuestion = document.querySelector("#chat-question");
const chatModel = document.querySelector("#chat-model");
const chatAnswer = document.querySelector("#chat-answer");
const translateOptions = document.querySelector("#translate-options");
const translateSource = document.querySelector("#translate-source");
const translateTarget = document.querySelector("#translate-target");
const translateOutput = document.querySelector("#translate-output");
const translateApiUrl = document.querySelector("#translate-api-url");
const ocrOptions = document.querySelector("#ocr-options");
const ocrLanguage = document.querySelector("#ocr-language");
const ocrOutput = document.querySelector("#ocr-output");
const ocrScale = document.querySelector("#ocr-scale");
const signOptions = document.querySelector("#sign-options");
const signatureMode = document.querySelector("#signature-mode");
const typedSignatureField = document.querySelector("#typed-signature-field");
const drawnSignatureField = document.querySelector("#drawn-signature-field");
const signatureText = document.querySelector("#signature-text");
const signaturePad = document.querySelector("#signature-pad");
const clearSignature = document.querySelector("#clear-signature");
const signaturePosition = document.querySelector("#signature-position");
const signatureColor = document.querySelector("#signature-color");
const signatureWidth = document.querySelector("#signature-width");
const requestOptions = document.querySelector("#request-options");
const requestSignerName = document.querySelector("#request-signer-name");
const requestSignerEmail = document.querySelector("#request-signer-email");
const requestSubject = document.querySelector("#request-subject");
const requestDueDate = document.querySelector("#request-due-date");
const requestSignaturePosition = document.querySelector("#request-signature-position");
const requestAuthMethod = document.querySelector("#request-auth-method");
const requestMessage = document.querySelector("#request-message");
const requestResult = document.querySelector("#request-result");

let activeTool = null;
let selectedFiles = [];
let jobCount = 0;
const annotationFontBytes = new Map();
let signatureDrawing = false;
let currentUser = null;
let authMode = "login";
let adminLogType = "operation";

function renderToolCards(container, items) {
  container.innerHTML = items
    .map(
      (tool) => `
        <button class="tool-card ${activeTool?.id === tool.id ? "active" : ""}" type="button" data-tool="${tool.id}">
          <span class="tool-icon" style="background:${tool.color}; color:${tool.dark ? "#151515" : "#fff"}">
            <i data-lucide="${tool.icon}"></i>
          </span>
          <span>
            <span class="tool-title">
              ${tool.title}
              ${tool.pro ? '<span class="pro-badge" aria-label="進階功能"><i data-lucide="crown"></i></span>' : ""}
            </span>
            <span class="tool-desc">${tool.desc}</span>
          </span>
        </button>
      `
    )
    .join("");
}

function renderTools(groupedTools) {
  renderToolCards(grid, groupedTools.primary);
  renderToolCards(moreGrid, groupedTools.more);
  lucide.createIcons();
}

async function loadCurrentUser() {
  try {
    const response = await fetch("/api/auth/me");
    const data = await response.json();
    currentUser = data.authenticated ? data.user : null;
  } catch (error) {
    currentUser = null;
  }
  updateAuthUi();
}

function updateAuthUi() {
  accountLabel.textContent = currentUser ? currentUser.name : "登入";
  authLogout.classList.toggle("is-hidden", !currentUser);
  authForm.classList.toggle("is-signed-in", Boolean(currentUser));
  authTabs.classList.toggle("is-hidden", Boolean(currentUser));
  if (currentUser) {
    authTitle.textContent = "帳號";
    authMessage.textContent = `已登入：${currentUser.email}`;
  } else {
    setAuthMode(authMode);
  }
  lucide.createIcons();
}

function openAuthModal() {
  authModal.classList.remove("is-hidden");
  authEmail.focus();
  updateAuthUi();
}

function closeAuthModal() {
  authModal.classList.add("is-hidden");
  authMessage.textContent = "";
}

function setAuthMode(mode) {
  authMode = mode;
  const isRegister = mode === "register";
  authTitle.textContent = isRegister ? "註冊 PDF 工具箱" : "登入 PDF 工具箱";
  authNameField.classList.toggle("is-hidden", !isRegister);
  authName.required = isRegister;
  authSubmit.innerHTML = isRegister ? '<i data-lucide="user-plus"></i> 註冊' : '<i data-lucide="log-in"></i> 登入';
  authLoginTab.classList.toggle("is-active", !isRegister);
  authRegisterTab.classList.toggle("is-active", isRegister);
  authPassword.autocomplete = isRegister ? "new-password" : "current-password";
  authMessage.textContent = "";
  lucide.createIcons();
}

async function submitAuthForm(event) {
  event.preventDefault();
  authSubmit.disabled = true;
  authMessage.textContent = authMode === "register" ? "正在建立帳號..." : "正在登入...";

  try {
    const payload = {
      email: authEmail.value.trim(),
      password: authPassword.value
    };
    if (authMode === "register") payload.name = authName.value.trim();

    const response = await fetch(`/api/auth/${authMode === "register" ? "register" : "login"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "帳號處理失敗。");

    currentUser = data.user;
    authPassword.value = "";
    updateAuthUi();
    authMessage.textContent = authMode === "register" ? "帳號已建立並登入。" : "登入成功。";
    window.setTimeout(closeAuthModal, 600);
    loadAdminDashboard();
  } catch (error) {
    authMessage.textContent = error.message || "帳號處理失敗。";
  } finally {
    authSubmit.disabled = false;
  }
}

async function logoutCurrentUser() {
  authLogout.disabled = true;
  authMessage.textContent = "正在登出...";
  try {
    await fetch("/api/auth/logout", { method: "POST" });
    currentUser = null;
    authPassword.value = "";
    updateAuthUi();
    authMessage.textContent = "已登出。";
  } catch (error) {
    authMessage.textContent = "登出失敗，請稍後再試。";
  } finally {
    authLogout.disabled = false;
  }
}

async function loadAdminDashboard() {
  if (!currentUser) {
    adminSummary.innerHTML = '<p class="empty">登入後可查看後台紀錄。</p>';
    adminLogList.innerHTML = '<p class="empty">尚未載入紀錄。</p>';
    return;
  }

  adminSummary.innerHTML = '<p class="empty">正在載入摘要...</p>';
  adminLogList.innerHTML = '<p class="empty">正在載入紀錄...</p>';

  try {
    const [summaryResponse, logsResponse] = await Promise.all([
      fetch("/api/admin/summary"),
      fetch(`/api/admin/logs?type=${adminLogType}&limit=80`)
    ]);
    const summary = await summaryResponse.json();
    const logs = await logsResponse.json();
    if (!summaryResponse.ok) throw new Error(summary.error || "後台摘要載入失敗。");
    if (!logsResponse.ok) throw new Error(logs.error || "後台紀錄載入失敗。");
    renderAdminSummary(summary);
    renderAdminLogs(logs.events || []);
  } catch (error) {
    adminSummary.innerHTML = `<p class="empty">${escapeHtml(error.message || "後台載入失敗。")}</p>`;
    adminLogList.innerHTML = '<p class="empty">無法載入紀錄。</p>';
  }
}

function renderAdminSummary(summary) {
  const stats = [
    ["最近操作", summary.counts?.recentOperations ?? 0],
    ["最近錯誤", summary.counts?.recentErrors ?? 0],
    ["失敗請求", summary.counts?.failedHttpRequests ?? 0],
    ["佇列中", summary.jobs?.queued ?? 0]
  ];
  adminSummary.innerHTML = stats
    .map(([label, value]) => `<div class="admin-stat"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function renderAdminLogs(events) {
  if (!events.length) {
    adminLogList.innerHTML = '<p class="empty">目前沒有紀錄。</p>';
    return;
  }

  adminLogList.innerHTML = events
    .map((event) => {
      const detail = formatAdminLogDetail(event);
      return `
        <div class="admin-log-item ${event.level === "error" ? "error" : ""}">
          <div><strong>${escapeHtml(event.type || "event")}</strong><span>${escapeHtml(formatDateTime(event.time))}</span></div>
          <div><span>${escapeHtml(event.method || event.operation || event.path || event.level || "")}</span><span>${escapeHtml(String(event.statusCode || event.jobId || ""))}</span></div>
          <div><span>${escapeHtml(detail)}</span></div>
        </div>
      `;
    })
    .join("");
}

function formatAdminLogDetail(event) {
  if (event.message) return event.message;
  const fields = ["path", "durationMs", "userAgent", "requestId", "jobId", "fileCount", "totalBytes", "resultSize"]
    .filter((key) => event[key] !== undefined && event[key] !== "")
    .map((key) => `${key}: ${event[key]}`);
  return fields.join(" · ") || JSON.stringify(event);
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-TW");
}

function setActiveTool(toolId) {
  activeTool = allTools.find((tool) => tool.id === toolId);
  document.body.classList.toggle("tool-page", Boolean(activeTool));
  heroSection.classList.toggle("is-hidden", Boolean(activeTool));
  toolsSection.classList.toggle("is-hidden", Boolean(activeTool));
  moreToolsSection.classList.toggle("is-hidden", Boolean(activeTool));
  workspace.classList.toggle("is-hidden", !activeTool);
  workspaceNavLink?.classList.toggle("is-hidden", !activeTool);
  selectedTool.textContent = activeTool ? activeTool.title : "尚未選擇工具";
  workspaceTitle.textContent = activeTool ? activeTool.title : "工作區";
  selectedFiles = [];
  fileInput.value = "";
  renderTools(filterTools(searchInput.value));
  updateToolMode();
  renderFiles();
  updateResult("ready");
  if (activeTool) {
    document.title = `${activeTool.title} - PDF 工具箱`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function showToolHome() {
  activeTool = null;
  selectedFiles = [];
  fileInput.value = "";
  document.body.classList.remove("tool-page");
  heroSection.classList.remove("is-hidden");
  toolsSection.classList.remove("is-hidden");
  moreToolsSection.classList.remove("is-hidden");
  workspace.classList.add("is-hidden");
  history.replaceState(null, "", "#tools");
  selectedTool.textContent = "尚未選擇工具";
  workspaceTitle.textContent = "工作區";
  document.title = "PDF 工具箱";
  renderTools(filterTools(searchInput.value));
  renderFiles();
  updateResult("ready");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function syncRouteFromHash() {
  const match = location.hash.match(/^#tool\/([^/]+)$/);
  if (match) {
    setActiveTool(decodeURIComponent(match[1]));
    return;
  }

  if (location.hash === "#admin" || location.hash === "#history" || location.hash === "#workspace" || !location.hash || location.hash === "#tools") {
    showToolHome();
  }
}

function filterTools(term) {
  const keyword = term.trim().toLowerCase();
  const matches = (tool) => `${tool.title} ${tool.desc}`.toLowerCase().includes(keyword);
  if (!keyword) return { primary: tools, more: moreTools };
  return {
    primary: tools.filter(matches),
    more: moreTools.filter(matches)
  };
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function addFiles(files) {
  const incomingFiles = Array.from(files);

  if (isPdfOnlyTool()) {
    const pdfFiles = incomingFiles.filter(isPdfFile);
    selectedFiles = [...selectedFiles, ...pdfFiles];
    renderFiles();

    if (pdfFiles.length !== incomingFiles.length) {
      showMessage(`${activeTool.title}功能目前只接受 PDF 檔案，已略過非 PDF 檔。`, "error");
      return;
    }

    updateResult("ready");
    return;
  }

  selectedFiles = [...selectedFiles, ...incomingFiles];
  renderFiles();
  updateResult("ready");
}

function renderFiles() {
  if (selectedFiles.length === 0) {
    fileList.innerHTML = "";
    return;
  }

  fileList.innerHTML = selectedFiles
    .map(
      (file, index) => `
        <div class="file-row">
          ${isPdfOnlyTool() ? `<span class="file-index">${index + 1}</span>` : '<i data-lucide="file-text"></i>'}
          <div>
            <strong>${file.name}</strong>
            <span>${file.type || "文件"} · ${formatBytes(file.size)} · 檔案 ${index + 1}</span>
          </div>
          ${
            activeTool?.id === "merge"
              ? `<div class="file-actions" aria-label="調整 ${file.name} 的合併順序">
                  <button class="icon-button" type="button" data-file-action="up" data-file-index="${index}" ${index === 0 ? "disabled" : ""} aria-label="上移"><i data-lucide="arrow-up"></i></button>
                  <button class="icon-button" type="button" data-file-action="down" data-file-index="${index}" ${index === selectedFiles.length - 1 ? "disabled" : ""} aria-label="下移"><i data-lucide="arrow-down"></i></button>
                  <button class="icon-button" type="button" data-file-action="remove" data-file-index="${index}" aria-label="移除"><i data-lucide="x"></i></button>
                </div>`
              : activeTool?.id === "compress" || activeTool?.id === "annotate" || activeTool?.id === "edit" || activeTool?.id === "split" || activeTool?.id === "word" || activeTool?.id === "excel" || activeTool?.id === "powerpoint" || activeTool?.id === "delete-pages" || activeTool?.id === "unlock" || activeTool?.id === "rotate" || activeTool?.id === "crop" || activeTool?.id === "extract-pages" || activeTool?.id === "page-numbers" || activeTool?.id === "redact" || activeTool?.id === "watermark" || activeTool?.id === "flatten" || activeTool?.id === "protect" || activeTool?.id === "toc" || activeTool?.id === "image" || activeTool?.id === "chat" || activeTool?.id === "translate" || activeTool?.id === "ocr" || activeTool?.id === "sign" || activeTool?.id === "request" || activeTool?.id === "converter"
                ? `<div class="file-actions" aria-label="移除 ${file.name}">
                    <button class="icon-button" type="button" data-file-action="remove" data-file-index="${index}" aria-label="移除"><i data-lucide="x"></i></button>
                  </div>`
                : `<span class="file-size">${formatBytes(file.size)}</span>`
          }
        </div>
      `
    )
    .join("");
  lucide.createIcons();
}

function updateResult(state) {
  if (state !== "done") clearDownloadLink();
  const dot = resultBox.querySelector(".status-dot");
  const message = resultBox.querySelector("p");
  dot.classList.toggle("ready", state === "ready" || state === "done");
  dot.classList.toggle("error", state === "error");
  resultBox.classList.toggle("error", state === "error");

  if (!activeTool && selectedFiles.length === 0) {
    message.textContent = "等待檔案與工具。";
    return;
  }

  if (!activeTool) {
    message.textContent = `已加入 ${selectedFiles.length} 個檔案，請選擇工具。`;
    return;
  }

  if (selectedFiles.length === 0) {
    message.textContent = `已選擇「${activeTool.title}」，請加入檔案。`;
    return;
  }

  if (state === "done") {
    message.textContent = `完成「${activeTool.title}」，已建立處理紀錄。`;
    return;
  }

  message.textContent = `準備使用「${activeTool.title}」處理 ${selectedFiles.length} 個檔案。`;
}

function showMessage(text, state = "ready") {
  clearDownloadLink();
  const dot = resultBox.querySelector(".status-dot");
  const message = resultBox.querySelector("p");
  dot.classList.toggle("ready", state !== "error");
  dot.classList.toggle("error", state === "error");
  resultBox.classList.toggle("error", state === "error");
  message.textContent = text;
  if (state !== "progress") hideJobProgress();
}

function clearDownloadLink() {
  resultBox.querySelector(".result-download")?.remove();
}

function showDownloadLink(url, fileName) {
  clearDownloadLink();
  const link = document.createElement("a");
  link.className = "result-download";
  link.href = url;
  link.download = fileName;
  link.textContent = `下載 ${fileName}`;
  resultBox.insertBefore(link, jobProgress);
}

function showJobProgress(percent, text) {
  jobProgress.classList.remove("is-hidden");
  jobProgress.setAttribute("aria-hidden", "false");
  jobProgressBar.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  showMessage(text, "progress");
}

function hideJobProgress() {
  jobProgress.classList.add("is-hidden");
  jobProgress.setAttribute("aria-hidden", "true");
  jobProgressBar.style.width = "0%";
}

function updateToolMode() {
  const isConverter = activeTool?.id === "converter";
  const isMerge = activeTool?.id === "merge";
  const isCompress = activeTool?.id === "compress";
  const isAnnotate = activeTool?.id === "annotate";
  const isEditText = activeTool?.id === "edit";
  const isSplit = activeTool?.id === "split";
  const isWord = activeTool?.id === "word";
  const isExcel = activeTool?.id === "excel";
  const isPowerpoint = activeTool?.id === "powerpoint";
  const isDeletePages = activeTool?.id === "delete-pages";
  const isUnlock = activeTool?.id === "unlock";
  const isRotate = activeTool?.id === "rotate";
  const isCrop = activeTool?.id === "crop";
  const isProtect = activeTool?.id === "protect";
  const isExtractPages = activeTool?.id === "extract-pages";
  const isPageNumbers = activeTool?.id === "page-numbers";
  const isRedact = activeTool?.id === "redact";
  const isWatermark = activeTool?.id === "watermark";
  const isFlatten = activeTool?.id === "flatten";
  const isExcerpt = activeTool?.id === "toc";
  const isImage = activeTool?.id === "image";
  const isChat = activeTool?.id === "chat";
  const isTranslate = activeTool?.id === "translate";
  const isOcr = activeTool?.id === "ocr";
  const isSign = activeTool?.id === "sign";
  const isRequest = activeTool?.id === "request";
  fileInput.accept = isWord
    ? ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : isExcel
      ? excelDirection.value === "pdf-to-excel"
        ? ".pdf,application/pdf"
        : ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : isPowerpoint
      ? powerpointDirection.value === "pdf-to-powerpoint"
        ? ".pdf,application/pdf"
        : ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
    : isImage
      ? ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
      : isPdfOnlyTool()
        ? ".pdf,application/pdf"
        : ".pdf,.doc,.docx,.jpg,.jpeg,.png";
  converterOptions.classList.toggle("is-hidden", !isConverter);
  annotationOptions.classList.toggle("is-hidden", !isAnnotate);
  editTextOptions.classList.toggle("is-hidden", !isEditText);
  wordOptions.classList.toggle("is-hidden", !isWord);
  excelOptions.classList.toggle("is-hidden", !isExcel);
  powerpointOptions.classList.toggle("is-hidden", !isPowerpoint);
  deletePagesOptions.classList.toggle("is-hidden", !isDeletePages);
  unlockOptions.classList.toggle("is-hidden", !isUnlock);
  rotateOptions.classList.toggle("is-hidden", !isRotate);
  cropOptions.classList.toggle("is-hidden", !isCrop);
  protectOptions.classList.toggle("is-hidden", !isProtect);
  extractPagesOptions.classList.toggle("is-hidden", !isExtractPages);
  pageNumbersOptions.classList.toggle("is-hidden", !isPageNumbers);
  redactOptions.classList.toggle("is-hidden", !isRedact);
  watermarkOptions.classList.toggle("is-hidden", !isWatermark);
  flattenOptions.classList.toggle("is-hidden", !isFlatten);
  excerptOptions.classList.toggle("is-hidden", !isExcerpt);
  imageOptions.classList.toggle("is-hidden", !isImage);
  chatOptions.classList.toggle("is-hidden", !isChat);
  translateOptions.classList.toggle("is-hidden", !isTranslate);
  ocrOptions.classList.toggle("is-hidden", !isOcr);
  signOptions.classList.toggle("is-hidden", !isSign);
  requestOptions.classList.toggle("is-hidden", !isRequest);

  if (isConverter) {
    dropzoneTitle.textContent = "加入要轉換的 PDF";
    dropzoneCopy.textContent = "選擇輸出格式後轉換 PDF；可用頁面範圍限制要處理的頁面。";
    processButton.innerHTML = '<i data-lucide="replace"></i> 開始轉換';
  } else if (isMerge) {
    dropzoneTitle.textContent = "加入要合併的 PDF";
    dropzoneCopy.textContent = "請加入兩個以上 PDF。清單由上到下就是合併後的頁面順序。";
    processButton.innerHTML = '<i data-lucide="copy-plus"></i> 合併 PDF';
  } else if (isCompress) {
    dropzoneTitle.textContent = "加入要壓縮的 PDF";
    dropzoneCopy.textContent = "可一次加入多個 PDF。系統會重新整理檔案結構並下載壓縮版本。";
    processButton.innerHTML = '<i data-lucide="minimize-2"></i> 壓縮 PDF';
  } else if (isAnnotate) {
    dropzoneTitle.textContent = "加入要註解的 PDF";
    dropzoneCopy.textContent = "可加入一個或多個 PDF。設定文字、位置與顏色後輸出新的註解版本。";
    processButton.innerHTML = '<i data-lucide="pencil"></i> 加入註解';
  } else if (isEditText) {
    dropzoneTitle.textContent = "加入要編輯文字的 PDF";
    dropzoneCopy.textContent = "以白底覆蓋原區塊並寫入新文字，適合修正短句、姓名、日期或金額。";
    processButton.innerHTML = '<i data-lucide="text-cursor-input"></i> 套用文字編輯';
  } else if (isSplit) {
    dropzoneTitle.textContent = "加入要分割的 PDF";
    dropzoneCopy.textContent = "不填頁面範圍會逐頁拆分；填 1-3, 5, 8-10 會依區段輸出。";
    processButton.innerHTML = '<i data-lucide="scissors"></i> 分割 PDF';
  } else if (isWord) {
    dropzoneTitle.textContent = "加入 PDF 或 Word 檔";
    dropzoneCopy.textContent = "選擇轉換方向後加入 PDF 或 DOCX。此版本以文字內容轉換為主。";
    processButton.innerHTML = '<i data-lucide="file-type-2"></i> 開始轉換';
  } else if (isExcel) {
    dropzoneTitle.textContent = excelDirection.value === "pdf-to-excel" ? "加入要轉成 Excel 的 PDF" : "加入要轉成 PDF 的 XLSX";
    dropzoneCopy.textContent = excelDirection.value === "pdf-to-excel"
      ? "交由後端產生原生 .xlsx 試算表，避免輸出替代格式。"
      : "交由後端解析原生 .xlsx 並輸出 PDF。";
    processButton.innerHTML = '<i data-lucide="file-spreadsheet"></i> 開始轉換';
  } else if (isPowerpoint) {
    dropzoneTitle.textContent = powerpointDirection.value === "pdf-to-powerpoint" ? "加入要轉成 PowerPoint 的 PDF" : "加入要轉成 PDF 的 PPTX";
    dropzoneCopy.textContent = powerpointDirection.value === "pdf-to-powerpoint"
      ? "交由後端產生原生 .pptx 簡報，避免輸出替代格式。"
      : "交由後端解析原生 .pptx 並輸出 PDF。";
    processButton.innerHTML = '<i data-lucide="presentation"></i> 開始轉換';
  } else if (isDeletePages) {
    dropzoneTitle.textContent = "加入要刪除頁面的 PDF";
    dropzoneCopy.textContent = "在頁面範圍填入要刪除的頁碼，例如 2, 5-7。";
    processButton.innerHTML = '<i data-lucide="trash-2"></i> 刪除頁面';
  } else if (isUnlock) {
    dropzoneTitle.textContent = "加入要解除鎖定的 PDF";
    dropzoneCopy.textContent = "輸入你已知且有權使用的 PDF 密碼，交由後端合法解除鎖定。";
    processButton.innerHTML = '<i data-lucide="lock-open"></i> 解除鎖定';
  } else if (isRotate) {
    dropzoneTitle.textContent = "加入要旋轉的 PDF";
    dropzoneCopy.textContent = "選擇角度後旋轉全部頁面，或用頁面範圍指定部分頁面。";
    processButton.innerHTML = '<i data-lucide="rotate-cw"></i> 旋轉 PDF';
  } else if (isCrop) {
    dropzoneTitle.textContent = "加入要裁剪的 PDF";
    dropzoneCopy.textContent = "設定四邊裁剪距離；可用頁面範圍指定部分頁面。";
    processButton.innerHTML = '<i data-lucide="crop"></i> 裁剪 PDF';
  } else if (isProtect) {
    dropzoneTitle.textContent = "加入要上鎖的 PDF";
    dropzoneCopy.textContent = "設定密碼後交由後端產生原生密碼 PDF；需要 /api/protect-pdf 服務。";
    processButton.innerHTML = '<i data-lucide="lock-keyhole"></i> 上鎖 PDF';
  } else if (isExtractPages) {
    dropzoneTitle.textContent = "加入要擷取頁面的 PDF";
    dropzoneCopy.textContent = "填入頁面範圍，將指定頁面抽出成新的 PDF。";
    processButton.innerHTML = '<i data-lucide="layout-grid"></i> 擷取頁面';
  } else if (isPageNumbers) {
    dropzoneTitle.textContent = "加入要加頁碼的 PDF";
    dropzoneCopy.textContent = "設定格式、位置、字級與顏色；可用頁面範圍指定部分頁面。";
    processButton.innerHTML = '<i data-lucide="list-ordered"></i> 加入頁碼';
  } else if (isRedact) {
    dropzoneTitle.textContent = "加入要修訂的 PDF";
    dropzoneCopy.textContent = "設定遮蔽區塊的位置、尺寸、顏色與標籤；可用頁面範圍指定部分頁面。";
    processButton.innerHTML = '<i data-lucide="panel-top"></i> 套用修訂';
  } else if (isWatermark) {
    dropzoneTitle.textContent = "加入要加浮水印的 PDF";
    dropzoneCopy.textContent = "設定浮水印文字、位置、角度、透明度與顏色；可用頁面範圍指定部分頁面。";
    processButton.innerHTML = '<i data-lucide="stamp"></i> 加入浮水印';
  } else if (isFlatten) {
    dropzoneTitle.textContent = "加入要平面化的 PDF";
    dropzoneCopy.textContent = "固定可填寫表單欄位並重新輸出 PDF，適合送件前定稿。";
    processButton.innerHTML = '<i data-lucide="layers"></i> 平面化 PDF';
  } else if (isExcerpt) {
    dropzoneTitle.textContent = "加入要節錄的 PDF";
    dropzoneCopy.textContent = "填頁面範圍如 1-3, 7；可輸出節錄 PDF 或文字 TXT。";
    processButton.innerHTML = '<i data-lucide="list"></i> 產生節錄';
  } else if (isImage) {
    dropzoneTitle.textContent = "加入 PDF 或圖像";
    dropzoneCopy.textContent = "PDF 可逐頁轉成 PNG/JPG；JPG/PNG 可依順序合成 PDF。";
    processButton.innerHTML = '<i data-lucide="image"></i> 開始轉換';
  } else if (isChat) {
    dropzoneTitle.textContent = "加入要對談的 PDF";
    dropzoneCopy.textContent = "抽取 PDF 文字後交給 OpenAI 回答問題；可用頁面範圍限制上下文。";
    processButton.innerHTML = '<i data-lucide="message-square-text"></i> 詢問 PDF';
  } else if (isTranslate) {
    dropzoneTitle.textContent = "加入要翻譯的 PDF";
    dropzoneCopy.textContent = "抽取 PDF 文字後翻譯，可輸出雙語 TXT 或翻譯版 PDF。";
    processButton.innerHTML = '<i data-lucide="languages"></i> 開始翻譯';
  } else if (isOcr) {
    dropzoneTitle.textContent = "加入要 OCR 的 PDF";
    dropzoneCopy.textContent = "將掃描頁面渲染成圖片後辨識文字，可輸出 TXT 或可搜尋 PDF。";
    processButton.innerHTML = '<i data-lucide="scan-text"></i> 開始 OCR';
  } else if (isSign) {
    dropzoneTitle.textContent = "加入要簽名的 PDF";
    dropzoneCopy.textContent = "選擇文字簽名或手寫簽名，設定頁面與位置後輸出已簽名 PDF。";
    processButton.innerHTML = '<i data-lucide="signature"></i> 套用簽名';
    prepareSignaturePad();
  } else if (isRequest) {
    dropzoneTitle.textContent = "加入要請求簽名的 PDF";
    dropzoneCopy.textContent = "設定簽署人、期限與簽署欄位，產生可追蹤的簽署請求紀錄。";
    processButton.innerHTML = '<i data-lucide="pen-tool"></i> 建立請求';
  } else {
    dropzoneTitle.textContent = "拖曳檔案到這裡";
    dropzoneCopy.textContent = "支援 PDF、Word、JPG、PNG。此原型會示範流程與介面狀態。";
    processButton.innerHTML = '<i data-lucide="sparkles"></i> 開始處理';
  }

  lucide.createIcons();
}

function isPdfOnlyTool() {
  return activeTool?.id === "converter" || activeTool?.id === "merge" || activeTool?.id === "compress" || activeTool?.id === "annotate" || activeTool?.id === "edit" || activeTool?.id === "split" || activeTool?.id === "delete-pages" || activeTool?.id === "unlock" || activeTool?.id === "rotate" || activeTool?.id === "crop" || activeTool?.id === "extract-pages" || activeTool?.id === "page-numbers" || activeTool?.id === "redact" || activeTool?.id === "watermark" || activeTool?.id === "flatten" || activeTool?.id === "protect" || activeTool?.id === "toc" || activeTool?.id === "chat" || activeTool?.id === "translate" || activeTool?.id === "ocr" || activeTool?.id === "sign" || activeTool?.id === "request";
}

function isPdfFile(file) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function moveFile(index, direction) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= selectedFiles.length) return;
  const nextFiles = [...selectedFiles];
  [nextFiles[index], nextFiles[targetIndex]] = [nextFiles[targetIndex], nextFiles[index]];
  selectedFiles = nextFiles;
  renderFiles();
  updateResult("ready");
}

function removeFile(index) {
  selectedFiles = selectedFiles.filter((_, fileIndex) => fileIndex !== index);
  renderFiles();
  updateResult("ready");
}

async function processFiles() {
  if (!activeTool) {
    updateResult("ready");
    return;
  }

  if (activeTool.id === "merge") {
    await mergePdfFiles();
    return;
  }

  if (activeTool.id === "converter") {
    await convertPdfWithConverter();
    return;
  }

  if (activeTool.id === "compress") {
    await compressPdfFiles();
    return;
  }

  if (activeTool.id === "annotate") {
    await annotatePdfFiles();
    return;
  }

  if (activeTool.id === "edit") {
    await editTextInPdfFiles();
    return;
  }

  if (activeTool.id === "split") {
    await splitPdfFiles();
    return;
  }

  if (activeTool.id === "word") {
    await convertPdfWordFiles();
    return;
  }

  if (activeTool.id === "excel") {
    await convertPdfExcelFiles();
    return;
  }

  if (activeTool.id === "powerpoint") {
    await convertPdfPowerpointFiles();
    return;
  }

  if (activeTool.id === "delete-pages") {
    await deletePagesFromPdfFiles();
    return;
  }

  if (activeTool.id === "unlock") {
    await unlockPdfFiles();
    return;
  }

  if (activeTool.id === "rotate") {
    await rotatePdfFiles();
    return;
  }

  if (activeTool.id === "crop") {
    await cropPdfFiles();
    return;
  }

  if (activeTool.id === "protect") {
    await protectPdfFiles();
    return;
  }

  if (activeTool.id === "extract-pages") {
    await extractPagesFiles();
    return;
  }

  if (activeTool.id === "page-numbers") {
    await addPageNumbersFiles();
    return;
  }

  if (activeTool.id === "redact") {
    await redactPdfFiles();
    return;
  }

  if (activeTool.id === "watermark") {
    await watermarkPdfFiles();
    return;
  }

  if (activeTool.id === "flatten") {
    await flattenPdfFiles();
    return;
  }

  if (activeTool.id === "toc") {
    await excerptPdfFiles();
    return;
  }

  if (activeTool.id === "image") {
    await convertPdfImageFiles();
    return;
  }

  if (activeTool.id === "chat") {
    await chatWithPdfFiles();
    return;
  }

  if (activeTool.id === "translate") {
    await translatePdfFiles();
    return;
  }

  if (activeTool.id === "ocr") {
    await ocrPdfFiles();
    return;
  }

  if (activeTool.id === "sign") {
    await signPdfFiles();
    return;
  }

  if (activeTool.id === "request") {
    await requestSignatureFiles();
    return;
  }

  if (selectedFiles.length === 0) {
    updateResult("ready");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 處理中';
  lucide.createIcons();

  window.setTimeout(() => {
    jobCount += 1;
    updateResult("done");
    addHistoryItem();
    processButton.disabled = false;
    processButton.innerHTML = '<i data-lucide="sparkles"></i> 開始處理';
    lucide.createIcons();
  }, 900);
}

async function mergePdfFiles() {
  if (selectedFiles.length < 2) {
    showMessage("請至少加入 2 個 PDF 檔案才能合併。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再合併。", "error");
    return;
  }

  if (window.location.protocol === "file:") {
    showMessage("合併功能需要本機後端服務，請用 http://localhost:8090 開啟，不要直接打開 index.html。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 合併中';
  showMessage(`正在依照清單順序合併 ${selectedFiles.length} 個 PDF...`);
  lucide.createIcons();

  try {
    const formData = new FormData();
    selectedFiles.forEach((file, index) => {
      formData.append(`file${index + 1}`, file, file.name);
    });

    const response = await fetch("/api/merge-pdf", {
      method: "POST",
      body: formData
    });
    const blob = await pdfBlobFromResponse(response, "合併 PDF 後端尚未啟用。");
    const fileName = buildPdfFileName("merged-pdf");
    const downloadUrl = downloadBlob(blob, fileName);
    jobCount += 1;
    updateResult("done");
    showDownloadLink(downloadUrl, fileName);
    addHistoryItem();
  } catch (error) {
    const detail = error?.message ? `（${error.message}）` : "";
    showMessage(`合併失敗。請確認已用 http://localhost:8090 開啟，且 PDF 沒有損毀或未知密碼加密。${detail}`, "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function compressPdfFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要壓縮的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再壓縮。", "error");
    return;
  }

  if (!window.PDFLib?.PDFDocument) {
    showMessage("PDF 處理元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 壓縮中';
  showMessage(`正在最佳化 ${selectedFiles.length} 個 PDF 的檔案結構...`);
  lucide.createIcons();

  try {
    let originalTotal = 0;
    let compressedTotal = 0;

    for (const file of selectedFiles) {
      const compressedBytes = await compressSinglePdf(file);
      originalTotal += file.size;
      compressedTotal += compressedBytes.byteLength;
      downloadPdf(compressedBytes, buildPdfFileName("compressed", file.name));
    }

    const savedBytes = Math.max(0, originalTotal - compressedTotal);
    const savedPercent = originalTotal > 0 ? Math.round((savedBytes / originalTotal) * 100) : 0;
    jobCount += 1;
    addHistoryItem(`${formatBytes(originalTotal)} → ${formatBytes(compressedTotal)} · 節省 ${savedPercent}%`);
    showMessage(`壓縮完成：${formatBytes(originalTotal)} → ${formatBytes(compressedTotal)}，節省 ${savedPercent}%。`, "done");
  } catch (error) {
    showMessage("壓縮失敗。請確認 PDF 沒有損毀、沒有無法解除的加密限制。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function compressSinglePdf(file) {
  const sourceBytes = await file.arrayBuffer();
  const sourcePdf = await PDFLib.PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const optimizedPdf = await PDFLib.PDFDocument.create();
  const pages = await optimizedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
  pages.forEach((page) => optimizedPdf.addPage(page));
  optimizedPdf.setProducer("PDF 工具箱");
  optimizedPdf.setCreator("PDF 工具箱");
  return optimizedPdf.save({
    addDefaultPage: false,
    objectsPerTick: 80,
    useObjectStreams: true
  });
}

async function convertPdfWithConverter() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要轉換的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("PDF 轉換器目前只接受 PDF 檔案。", "error");
    return;
  }

  const format = converterFormat.value;
  const needsText = format === "docx" || format === "txt";
  const needsImage = format === "png" || format === "jpeg";
  const needsPdf = format === "pdf";

  if ((needsText || needsImage) && !window.pdfjsLib?.getDocument) {
    showMessage("PDF 讀取元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  if (format === "docx" && !window.docx?.Document) {
    showMessage("Word 輸出元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  if (needsPdf && !window.PDFLib?.PDFDocument) {
    showMessage("PDF 處理元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 轉換中';
  showMessage(`正在轉換 ${selectedFiles.length} 個 PDF...`);
  lucide.createIcons();

  try {
    let outputCount = 0;

    for (const file of selectedFiles) {
      if (format === "docx") {
        const blob = await convertPdfToDocxWithRange(file);
        downloadBlob(blob, buildConverterFileName("converted-word", file.name, "docx"));
        outputCount += 1;
      } else if (format === "txt") {
        const blob = await convertPdfToTextBlob(file);
        downloadBlob(blob, buildConverterFileName("converted-text", file.name, "txt"));
        outputCount += 1;
      } else if (format === "png" || format === "jpeg") {
        outputCount += await convertPdfToConverterImages(file, format);
      } else {
        const bytes = await convertPdfToOptimizedPdf(file);
        downloadPdf(bytes, buildConverterFileName("converted-pdf", file.name, "pdf"));
        outputCount += 1;
      }
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個 PDF · 輸出 ${outputCount} 個檔案 · ${getConverterFormatLabel(format)}`);
    showMessage(`PDF 轉換完成，已輸出 ${outputCount} 個檔案。`, "done");
  } catch (error) {
    showMessage(error.message || "PDF 轉換失敗。請確認檔案沒有損毀，且頁碼範圍正確。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function convertPdfToDocxWithRange(file) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const indexes = getConverterPageIndexes(pdf.numPages);
  const paragraphs = [];
  const fontName = getOfficeFontName();

  for (const pageIndex of indexes) {
    const page = await pdf.getPage(pageIndex + 1);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim();
    paragraphs.push(new docx.Paragraph({
      children: [new docx.TextRun({ text: `第 ${pageIndex + 1} 頁`, bold: true, size: 24, font: fontName })],
      spacing: { after: 160 }
    }));
    splitTextForDocx(pageText || "此頁沒有可抽取文字。").forEach((line) => {
      paragraphs.push(new docx.Paragraph({ children: [new docx.TextRun({ text: line, size: 22, font: fontName })], spacing: { after: 120 } }));
    });

    if (converterPageBreaks.checked && pageIndex !== indexes[indexes.length - 1]) {
      paragraphs.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));
    }
  }

  const document = new docx.Document({
    creator: "PDF 工具箱",
    title: file.name.replace(/\.pdf$/i, ""),
    sections: [{ properties: {}, children: paragraphs }]
  });

  return docx.Packer.toBlob(document);
}

async function convertPdfToTextBlob(file) {
  const pages = await extractPdfPageTexts(file);
  const content = [
    `來源檔案：${file.name}`,
    `頁面範圍：${document.querySelector("#page-range").value.trim() || "全部頁面"}`,
    "",
    ...pages.map((page) => `第 ${page.pageNumber} 頁\n${page.text}`)
  ].join("\n\n---\n\n");
  return new Blob([content], { type: "text/plain;charset=utf-8" });
}

async function convertPdfToConverterImages(file, format) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const indexes = getConverterPageIndexes(pdf.numPages);
  const scale = Math.max(1, Math.min(3, Number(converterScale.value) || 2));

  for (const pageIndex of indexes) {
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const blob = await canvasToBlob(canvas, format);
    downloadBlob(blob, buildImageFileName(file.name, pageIndex + 1, format));
  }

  return indexes.length;
}

async function convertPdfToOptimizedPdf(file) {
  const sourceBytes = await file.arrayBuffer();
  const sourcePdf = await PDFLib.PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const outputPdf = await PDFLib.PDFDocument.create();
  const indexes = getConverterPageIndexes(sourcePdf.getPageCount());
  const pages = await outputPdf.copyPages(sourcePdf, indexes);
  pages.forEach((page) => outputPdf.addPage(page));
  outputPdf.setProducer("PDF 工具箱");
  outputPdf.setCreator("PDF 工具箱");
  return outputPdf.save({ useObjectStreams: true });
}

function getConverterPageIndexes(pageCount) {
  const rawRange = document.querySelector("#page-range").value.trim();
  if (!rawRange) return Array.from({ length: pageCount }, (_, index) => index);
  return [...new Set(parsePageSegments(rawRange, pageCount).flatMap((segment) => segment.indexes))].sort((a, b) => a - b);
}

function getConverterFormatLabel(format) {
  const labels = {
    docx: "Word DOCX",
    txt: "純文字 TXT",
    png: "逐頁 PNG",
    jpeg: "逐頁 JPG",
    pdf: "最佳化 PDF"
  };
  return labels[format] || format.toUpperCase();
}

function buildConverterFileName(prefix, sourceName, extension) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const cleanSource = sourceName
    .replace(/\.pdf$/i, "")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-${cleanSource || "pdf"}-${stamp}.${extension}`;
}

async function annotatePdfFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要註解的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再註解。", "error");
    return;
  }

  const note = annotationText.value.trim();
  if (!note) {
    showMessage("請輸入註解文字。", "error");
    return;
  }

  if (!window.PDFLib?.PDFDocument) {
    showMessage("PDF 處理元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 註解中';
  showMessage(`正在為 ${selectedFiles.length} 個 PDF 加入註解...`);
  lucide.createIcons();

  try {
    for (const file of selectedFiles) {
      const annotatedBytes = await annotateSinglePdf(file, note);
      downloadPdf(annotatedBytes, buildPdfFileName("annotated", file.name));
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · ${annotationAllPages.checked ? "全部頁面" : "指定/第一頁"}`);
    showMessage(`註解完成，已產生 ${selectedFiles.length} 份 PDF。`, "done");
  } catch (error) {
    showMessage("註解失敗。請確認 PDF 沒有損毀、沒有無法解除的加密限制。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function annotateSinglePdf(file, note) {
  const sourceBytes = await file.arrayBuffer();
  const pdf = await PDFLib.PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const font = await getAnnotationFont(pdf);
  const pages = pdf.getPages();
  const targetIndexes = getAnnotationPageIndexes(pages.length);
  const color = hexToRgb(annotationColor.value);

  targetIndexes.forEach((pageIndex) => {
    const page = pages[pageIndex];
    const { width, height } = page.getSize();
    const fontSize = Math.max(11, Math.min(18, Math.round(width / 42)));
    const lines = wrapAnnotationText(note, 26).slice(0, 4);
    const lineHeight = fontSize * 1.35;
    const boxWidth = Math.min(width - 64, Math.max(190, Math.max(...lines.map((line) => font.widthOfTextAtSize(line, fontSize))) + 34));
    const boxHeight = lines.length * lineHeight + 24;
    const point = getAnnotationPoint(annotationPosition.value, width, height, boxWidth, boxHeight);

    page.drawRectangle({
      x: point.x,
      y: point.y,
      width: boxWidth,
      height: boxHeight,
      color: PDFLib.rgb(1, 1, 1),
      borderColor: PDFLib.rgb(color.r, color.g, color.b),
      borderWidth: 1.4,
      opacity: 0.88,
      borderOpacity: 0.95
    });

    lines.forEach((line, lineIndex) => {
      page.drawText(line, {
        x: point.x + 14,
        y: point.y + boxHeight - 20 - lineIndex * lineHeight,
        size: fontSize,
        font,
        color: PDFLib.rgb(color.r, color.g, color.b)
      });
    });
  });

  pdf.setProducer("PDF 工具箱");
  pdf.setCreator("PDF 工具箱");
  return pdf.save({ useObjectStreams: true });
}

async function editTextInPdfFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要編輯文字的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再編輯。", "error");
    return;
  }

  const replacementText = editTextValue.value.trim();
  if (!replacementText) {
    showMessage("請輸入要寫入的新文字。", "error");
    return;
  }

  if (!window.PDFLib?.PDFDocument) {
    showMessage("PDF 處理元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 編輯中';
  showMessage(`正在為 ${selectedFiles.length} 個 PDF 套用文字編輯...`);
  lucide.createIcons();

  try {
    for (const file of selectedFiles) {
      const editedBytes = await editTextInSinglePdf(file, replacementText);
      downloadPdf(editedBytes, buildPdfFileName("edited-text", file.name));
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · 文字覆蓋編輯`);
    showMessage(`文字編輯完成，已產生 ${selectedFiles.length} 份 PDF。`, "done");
  } catch (error) {
    showMessage("文字編輯失敗。請確認 PDF 沒有損毀、沒有無法解除的加密限制。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function editTextInSinglePdf(file, replacementText) {
  const sourceBytes = await file.arrayBuffer();
  const pdf = await PDFLib.PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const font = await getAnnotationFont(pdf);
  const pages = pdf.getPages();
  const targetIndexes = getAnnotationPageIndexes(pages.length);
  const color = hexToRgb(editTextColor.value);
  const fontSize = Number(editTextSize.value) || 14;

  targetIndexes.forEach((pageIndex) => {
    const page = pages[pageIndex];
    const { width, height } = page.getSize();
    const lines = wrapAnnotationText(replacementText, 28).slice(0, 5);
    const lineHeight = fontSize * 1.35;
    const textWidth = Math.max(...lines.map((line) => font.widthOfTextAtSize(line, fontSize)));
    const boxWidth = Math.min(width - 64, Math.max(160, textWidth + 28));
    const boxHeight = lines.length * lineHeight + 20;
    const point = getAnnotationPoint(editTextPosition.value, width, height, boxWidth, boxHeight);

    if (editTextCover.checked) {
      page.drawRectangle({
        x: point.x,
        y: point.y,
        width: boxWidth,
        height: boxHeight,
        color: PDFLib.rgb(1, 1, 1),
        opacity: 0.96
      });
    }

    lines.forEach((line, lineIndex) => {
      page.drawText(line, {
        x: point.x + 12,
        y: point.y + boxHeight - 16 - lineIndex * lineHeight,
        size: fontSize,
        font,
        color: PDFLib.rgb(color.r, color.g, color.b)
      });
    });
  });

  pdf.setProducer("PDF 工具箱");
  pdf.setCreator("PDF 工具箱");
  return pdf.save({ useObjectStreams: true });
}

async function splitPdfFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要分割的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再分割。", "error");
    return;
  }

  if (!window.PDFLib?.PDFDocument) {
    showMessage("PDF 處理元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 分割中';
  showMessage(`正在分割 ${selectedFiles.length} 個 PDF...`);
  lucide.createIcons();

  try {
    let outputCount = 0;

    for (const file of selectedFiles) {
      outputCount += await splitSinglePdf(file);
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · 輸出 ${outputCount} 份 PDF`);
    showMessage(`分割完成，已輸出 ${outputCount} 份 PDF。`, "done");
  } catch (error) {
    showMessage(error.message || "分割失敗。請確認頁碼範圍正確，PDF 沒有損毀或加密限制。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function splitSinglePdf(file) {
  const sourceBytes = await file.arrayBuffer();
  const sourcePdf = await PDFLib.PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const pageCount = sourcePdf.getPageCount();
  const rawRange = document.querySelector("#page-range").value.trim();
  const segments = rawRange ? parsePageSegments(rawRange, pageCount) : createSinglePageSegments(pageCount);

  for (const segment of segments) {
    const outputPdf = await PDFLib.PDFDocument.create();
    const pages = await outputPdf.copyPages(sourcePdf, segment.indexes);
    pages.forEach((page) => outputPdf.addPage(page));
    outputPdf.setProducer("PDF 工具箱");
    outputPdf.setCreator("PDF 工具箱");
    const bytes = await outputPdf.save({ useObjectStreams: true });
    downloadPdf(bytes, buildSplitFileName(file.name, segment.label));
  }

  return segments.length;
}

async function convertPdfWordFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要轉換的 PDF 或 Word 檔案。", "error");
    return;
  }

  const direction = wordDirection.value;
  const invalidFile = selectedFiles.find((file) => (direction === "pdf-to-word" ? !isPdfFile(file) : !isDocxFile(file)));

  if (invalidFile) {
    showMessage(direction === "pdf-to-word" ? "PDF → Word 只接受 PDF 檔案。" : "Word → PDF 目前只接受 DOCX 檔案。", "error");
    return;
  }

  if (!hasWordConversionLibraries(direction)) {
    showMessage("Word 轉換元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 轉換中';
  showMessage(`正在轉換 ${selectedFiles.length} 個檔案...`);
  lucide.createIcons();

  try {
    for (const file of selectedFiles) {
      if (direction === "pdf-to-word") {
        const docxBlob = await convertPdfToWord(file);
        downloadBlob(docxBlob, buildOfficeFileName("converted-word", file.name, "docx"));
      } else {
        const pdfBytes = await convertWordToPdf(file);
        downloadPdf(pdfBytes, buildOfficeFileName("converted-pdf", file.name, "pdf"));
      }
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · ${direction === "pdf-to-word" ? "PDF → Word" : "Word → PDF"}`);
    showMessage(`轉換完成，已產生 ${selectedFiles.length} 個檔案。`, "done");
  } catch (error) {
    showMessage("轉換失敗。請確認檔案未損毀，且 PDF 內含可抽取文字。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function convertPdfExcelFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要轉換的檔案。", "error");
    return;
  }

  const direction = excelDirection.value;
  const invalidFile = selectedFiles.find((file) => (direction === "pdf-to-excel" ? !isPdfFile(file) : !isExcelFile(file)));

  if (invalidFile) {
    showMessage(direction === "pdf-to-excel" ? "PDF → Excel 只接受 PDF 檔案。" : "Excel → PDF 只接受原生 .xlsx 檔案。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 轉換中';
  showMessage(`正在呼叫原生 Excel 轉換服務處理 ${selectedFiles.length} 個檔案...`);
  lucide.createIcons();

  try {
    for (const file of selectedFiles) {
      const blob = await convertExcelWithBackend(file, direction);
      const extension = direction === "pdf-to-excel" ? "xlsx" : "pdf";
      downloadBlob(blob, buildExcelFileName(direction, file.name, extension));
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · ${direction === "pdf-to-excel" ? "PDF → XLSX" : "XLSX → PDF"}`);
    showMessage(`Excel 轉換完成，已產生 ${selectedFiles.length} 個檔案。`, "done");
  } catch (error) {
    showMessage(error.message || "Excel 轉換失敗。請確認後端 /api/convert-excel 已接好，且檔案可讀取。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function convertExcelWithBackend(file, direction) {
  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("direction", direction);
  formData.append("pageRange", document.querySelector("#page-range").value.trim());
  formData.append("detectColumns", excelDetectColumns.checked ? "true" : "false");
  formData.append("outputFont", getOutputFontValue());

  return runQueuedBackendJob("convert-excel", formData, `Excel 轉換 ${file.name}`);
}

function isExcelFile(file) {
  return file.name.toLowerCase().endsWith(".xlsx") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function buildExcelFileName(prefix, sourceName, extension) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const cleanSource = sourceName
    .replace(/\.(pdf|xlsx)$/i, "")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-${cleanSource || "table"}-${stamp}.${extension}`;
}

async function convertPdfPowerpointFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要轉換的檔案。", "error");
    return;
  }

  const direction = powerpointDirection.value;
  const invalidFile = selectedFiles.find((file) => (direction === "pdf-to-powerpoint" ? !isPdfFile(file) : !isPowerpointFile(file)));

  if (invalidFile) {
    showMessage(direction === "pdf-to-powerpoint" ? "PDF → PowerPoint 只接受 PDF 檔案。" : "PowerPoint → PDF 只接受原生 .pptx 檔案。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 轉換中';
  showMessage(`正在呼叫原生 PowerPoint 轉換服務處理 ${selectedFiles.length} 個檔案...`);
  lucide.createIcons();

  try {
    for (const file of selectedFiles) {
      const blob = await convertPowerpointWithBackend(file, direction);
      const extension = direction === "pdf-to-powerpoint" ? "pptx" : "pdf";
      downloadBlob(blob, buildPowerpointFileName(direction, file.name, extension));
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · ${direction === "pdf-to-powerpoint" ? "PDF → PPTX" : "PPTX → PDF"}`);
    showMessage(`PowerPoint 轉換完成，已產生 ${selectedFiles.length} 個檔案。`, "done");
  } catch (error) {
    showMessage(error.message || "PowerPoint 轉換失敗。請確認後端 /api/convert-powerpoint 已接好，且檔案可讀取。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function convertPowerpointWithBackend(file, direction) {
  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("direction", direction);
  formData.append("pageRange", document.querySelector("#page-range").value.trim());
  formData.append("scale", String(Math.max(1, Math.min(3, Number(powerpointScale.value) || 1.5))));
  formData.append("quality", String(Math.max(40, Math.min(100, Number(quality.value) || 82))));
  formData.append("outputFont", getOutputFontValue());

  return runQueuedBackendJob("convert-powerpoint", formData, `PowerPoint 轉換 ${file.name}`);
}

function isPowerpointFile(file) {
  return file.name.toLowerCase().endsWith(".pptx") || file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation";
}

function buildPowerpointFileName(prefix, sourceName, extension) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const cleanSource = sourceName
    .replace(/\.(pdf|pptx)$/i, "")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-${cleanSource || "presentation"}-${stamp}.${extension}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function excerptPdfFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要節錄的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再節錄。", "error");
    return;
  }

  if (!document.querySelector("#page-range").value.trim()) {
    showMessage("請輸入頁面範圍，例如 1-3, 7。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 節錄中';
  showMessage(`正在節錄 ${selectedFiles.length} 個 PDF...`);
  lucide.createIcons();

  try {
    let outputCount = 0;

    for (const file of selectedFiles) {
      outputCount += excerptMode.value === "pages" ? await excerptPagesFromPdf(file) : await excerptTextFromPdf(file);
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · 輸出 ${outputCount} 份節錄`);
    showMessage(`節錄完成，已輸出 ${outputCount} 份檔案。`, "done");
  } catch (error) {
    showMessage(error.message || "節錄失敗。請確認頁碼範圍正確，PDF 沒有損毀或加密限制。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function convertPdfImageFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要轉換的 PDF 或圖像檔案。", "error");
    return;
  }

  const direction = imageDirection.value;
  const invalidFile = selectedFiles.find((file) => (direction === "pdf-to-image" ? !isPdfFile(file) : !isImageFile(file)));

  if (invalidFile) {
    showMessage(direction === "pdf-to-image" ? "PDF → 圖像只接受 PDF 檔案。" : "圖像 → PDF 只接受 JPG 或 PNG。", "error");
    return;
  }

  if (direction === "pdf-to-image" && !window.pdfjsLib?.getDocument) {
    showMessage("PDF 圖像轉換元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  if (direction === "image-to-pdf" && !window.PDFLib?.PDFDocument) {
    showMessage("PDF 處理元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 轉換中';
  showMessage(`正在轉換 ${selectedFiles.length} 個檔案...`);
  lucide.createIcons();

  try {
    let outputCount = 0;

    if (direction === "pdf-to-image") {
      for (const file of selectedFiles) {
        outputCount += await convertPdfToImages(file);
      }
    } else {
      const pdfBytes = await convertImagesToPdf(selectedFiles);
      downloadPdf(pdfBytes, buildPdfFileName("images-to-pdf"));
      outputCount = 1;
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · 輸出 ${outputCount} 個檔案`);
    showMessage(`圖像轉換完成，已輸出 ${outputCount} 個檔案。`, "done");
  } catch (error) {
    showMessage(error.message || "圖像轉換失敗。請確認檔案沒有損毀。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function convertPdfToImages(file) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const rawRange = document.querySelector("#page-range").value.trim();
  const indexes = rawRange
    ? parsePageSegments(rawRange, pdf.numPages).flatMap((segment) => segment.indexes)
    : Array.from({ length: pdf.numPages }, (_, index) => index);
  const uniqueIndexes = [...new Set(indexes)].sort((a, b) => a - b);
  const scale = Math.max(1, Math.min(3, Number(imageScale.value) || 2));
  const format = imageFormat.value === "jpeg" ? "jpeg" : "png";

  for (const pageIndex of uniqueIndexes) {
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const blob = await canvasToBlob(canvas, format);
    downloadBlob(blob, buildImageFileName(file.name, pageIndex + 1, format));
  }

  return uniqueIndexes.length;
}

async function convertImagesToPdf(files) {
  const pdf = await PDFLib.PDFDocument.create();

  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const image = file.type === "image/png" || file.name.toLowerCase().endsWith(".png")
      ? await pdf.embedPng(bytes)
      : await pdf.embedJpg(bytes);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height
    });
  }

  pdf.setProducer("PDF 工具箱");
  pdf.setCreator("PDF 工具箱");
  return pdf.save({ useObjectStreams: true });
}

function canvasToBlob(canvas, format) {
  const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
  const quality = format === "jpeg" ? Math.max(0.4, Math.min(1, Number(document.querySelector("#quality").value) / 100)) : undefined;
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("無法產生圖像檔。"));
    }, mimeType, quality);
  });
}

function isImageFile(file) {
  return file.type === "image/png" || file.type === "image/jpeg" || /\.(png|jpe?g)$/i.test(file.name);
}

function buildImageFileName(sourceName, pageNumber, format) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const cleanSource = sourceName
    .replace(/\.pdf$/i, "")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `pdf-image-${cleanSource || "pdf"}-p${pageNumber}-${stamp}.${format === "jpeg" ? "jpg" : "png"}`;
}

async function translatePdfFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要翻譯的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再翻譯。", "error");
    return;
  }

  if (!window.pdfjsLib?.getDocument) {
    showMessage("PDF 文字抽取元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 翻譯中';
  showMessage(`正在翻譯 ${selectedFiles.length} 個 PDF...`);
  lucide.createIcons();

  try {
    for (const file of selectedFiles) {
      const pageTexts = await extractPdfPageTexts(file);
      const translatedPages = [];

      for (const page of pageTexts) {
        const translatedText = await translateText(page.text);
        translatedPages.push({ ...page, translatedText });
      }

      if (translateOutput.value === "pdf") {
        const pdfBytes = await createTranslatedPdf(translatedPages, file.name);
        downloadPdf(pdfBytes, buildTranslatedFileName(file.name, "pdf"));
      } else {
        const textBlob = createTranslatedTextBlob(translatedPages, file.name);
        downloadBlob(textBlob, buildTranslatedFileName(file.name, "txt"));
      }
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · ${getLanguageLabel(translateTarget.value)}`);
    showMessage(`翻譯完成，已產生 ${selectedFiles.length} 個檔案。`, "done");
  } catch (error) {
    showMessage(error.message || "翻譯失敗。請確認 PDF 有可抽取文字，或翻譯 API 可連線。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function chatWithPdfFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要對談的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再對談。", "error");
    return;
  }

  if (!chatQuestion.value.trim()) {
    showMessage("請輸入想問 PDF 的問題。", "error");
    return;
  }

  if (!window.pdfjsLib?.getDocument) {
    showMessage("PDF 文字抽取元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 思考中';
  chatAnswer.classList.add("is-hidden");
  chatAnswer.textContent = "";
  showMessage(`正在抽取 ${selectedFiles.length} 個 PDF 的文字並建立檢索索引...`);
  lucide.createIcons();

  try {
    const { chunks, ocrUsed } = await buildPdfChatChunksWithOcrFallback(selectedFiles);
    const combinedText = chunks.map((chunk) => chunk.text).join("\n");

    if (!hasEnoughChatText(combinedText)) {
      throw new Error("這份 PDF 幾乎沒有可抽取或可辨識文字，請確認掃描品質或改用較高 OCR 解析度。");
    }

    showMessage(`已${ocrUsed ? "透過 OCR " : ""}建立 ${chunks.length} 個文字片段，正在檢索相關內容並詢問 OpenAI...`);

    const response = await fetch("/api/openai/rag-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: chatModel.value,
        max_output_tokens: 1200,
        top_k: 8,
        instructions: "你是 PDF 文件助理。只能根據使用者提供的 PDF 文字回答；如果資料不足，請明確說明。請使用繁體中文，回答要條理清楚。",
        question: chatQuestion.value.trim(),
        chunks
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "OpenAI 代理 API 回應失敗。");
    }

    const answer = data.text || "OpenAI 沒有回傳文字答案。";
    chatAnswer.textContent = formatRagChatAnswer(answer, data.sources || []);
    chatAnswer.classList.remove("is-hidden");
    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個 PDF · ${ocrUsed ? "OCR + " : ""}RAG 對談`);
    showMessage("PDF RAG 對談完成，答案已顯示在設定面板。", "done");
  } catch (error) {
    showMessage(error.message || "PDF 對談失敗。請確認後端代理 API 已啟動，且 PDF 有可抽取文字。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function buildPdfChatContext(files) {
  const parts = [];
  const maxContextLength = 18000;

  for (const file of files) {
    const pages = await extractPdfPageTexts(file);
    parts.push(`檔案：${file.name}`);
    pages.forEach((page) => {
      parts.push(`第 ${page.pageNumber} 頁：${page.text}`);
    });

    if (parts.join("\n\n").length > maxContextLength) break;
  }

  const context = parts.join("\n\n");
  return context.length > maxContextLength
    ? `${context.slice(0, maxContextLength)}\n\n[內容已因長度限制截斷]`
    : context;
}

async function buildPdfChatChunks(files) {
  const chunks = [];
  const chunkSize = 1200;
  const overlap = 180;
  const maxChunks = 240;

  for (const file of files) {
    const pages = await extractPdfPageTexts(file);
    appendPdfChatChunks(chunks, file.name, pages, { chunkSize, overlap, maxChunks });

    if (chunks.length >= maxChunks) break;
  }

  return chunks;
}

async function buildPdfChatChunksWithOcrFallback(files) {
  const chunks = await buildPdfChatChunks(files);
  const combinedText = chunks.map((chunk) => chunk.text).join("\n");

  if (hasEnoughChatText(combinedText)) {
    return { chunks, ocrUsed: false };
  }

  if (!window.Tesseract?.createWorker) {
    throw new Error("這份 PDF 需要 OCR 才能對談，但 OCR 元件尚未載入完成。");
  }

  showMessage("PDF 文字層不足，正在自動啟動 OCR 後再進行對談...");
  const ocrChunks = [];
  const worker = await Tesseract.createWorker(ocrLanguage.value, 1, {
    workerPath: "tesseract-worker.min.js",
    corePath: "https://unpkg.com/tesseract.js-core@5.1.1",
    langPath: "https://tessdata.projectnaptha.com/4.0.0"
  });

  try {
    for (const file of files) {
      showMessage(`正在 OCR「${file.name}」以建立對談索引...`);
      const result = await runOcrForPdf(file, worker);
      const pages = result.pages.map((page) => ({
        pageNumber: page.pageNumber,
        text: page.text === "此頁沒有辨識到文字。" ? "" : page.text
      }));
      appendPdfChatChunks(ocrChunks, file.name, pages, {
        chunkSize: 1200,
        overlap: 180,
        maxChunks: 240
      });

      if (ocrChunks.length >= 240) break;
    }
  } finally {
    await worker.terminate();
  }

  return { chunks: ocrChunks, ocrUsed: true };
}

function appendPdfChatChunks(chunks, fileName, pages, options) {
  const { chunkSize, overlap, maxChunks } = options;

  for (const page of pages) {
    const text = page.text.replace(/\s+/g, " ").trim();
    if (!text || text === "此頁沒有可抽取文字。" || text === "此頁沒有辨識到文字。") continue;

    let cursor = 0;
    let chunkNumber = 1;

    while (cursor < text.length && chunks.length < maxChunks) {
      const slice = text.slice(cursor, cursor + chunkSize).trim();
      if (slice.length >= 20) {
        chunks.push({
          id: `${sanitizeChunkId(fileName)}-p${page.pageNumber}-c${chunkNumber}`,
          fileName,
          pageNumber: page.pageNumber,
          text: slice
        });
      }

      if (cursor + chunkSize >= text.length) break;
      cursor += chunkSize - overlap;
      chunkNumber += 1;
    }

    if (chunks.length >= maxChunks) break;
  }
}

function hasEnoughChatText(text) {
  const normalized = String(text || "")
    .replaceAll("此頁沒有可抽取文字。", "")
    .replaceAll("此頁沒有辨識到文字。", "")
    .replace(/\s+/g, "");
  return normalized.length >= 80;
}

function sanitizeChunkId(value) {
  return String(value || "pdf")
    .replace(/\.[^.]+$/i, "")
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36) || "pdf";
}

function formatRagChatAnswer(answer, sources) {
  if (!sources.length) return answer;

  const sourceLines = sources
    .slice(0, 6)
    .map((source, index) => {
      const page = source.pageNumber ? `第 ${source.pageNumber} 頁` : "頁碼未知";
      return `${index + 1}. ${source.fileName}，${page}，相關度 ${source.score}`;
    });

  return `${answer}\n\n參考片段：\n${sourceLines.join("\n")}`;
}

async function ocrPdfFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要 OCR 的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再 OCR。", "error");
    return;
  }

  if (!window.pdfjsLib?.getDocument || !window.Tesseract?.createWorker) {
    showMessage("OCR 元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> OCR 中';
  showMessage("正在啟動 OCR 引擎...");
  lucide.createIcons();

  let worker = null;

  try {
    worker = await Tesseract.createWorker(ocrLanguage.value, 1, {
      workerPath: "tesseract-worker.min.js",
      corePath: "https://unpkg.com/tesseract.js-core@5.1.1",
      langPath: "https://tessdata.projectnaptha.com/4.0.0"
    });

    for (const file of selectedFiles) {
      showMessage(`正在辨識「${file.name}」...`);
      const result = await runOcrForPdf(file, worker);

      if (ocrOutput.value === "pdf") {
        const searchableBytes = await createSearchableOcrPdf(result.pages, file.name);
        downloadPdf(searchableBytes, buildOcrFileName(file.name, "pdf"));
      } else {
        const textBlob = createOcrTextBlob(result.pages, file.name);
        downloadBlob(textBlob, buildOcrFileName(file.name, "txt"));
      }
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · ${ocrLanguage.value}`);
    showMessage(`OCR 完成，已產生 ${selectedFiles.length} 個檔案。`, "done");
  } catch (error) {
    showMessage(error.message || "OCR 失敗。請確認網路可下載 OCR 語言資料，或 PDF 沒有損毀。", "error");
    console.error(error);
  } finally {
    if (worker) await worker.terminate();
    processButton.disabled = false;
    updateToolMode();
  }
}

async function runOcrForPdf(file, worker) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const rawRange = document.querySelector("#page-range").value.trim();
  const indexes = rawRange
    ? [...new Set(parsePageSegments(rawRange, pdf.numPages).flatMap((segment) => segment.indexes))].sort((a, b) => a - b)
    : Array.from({ length: pdf.numPages }, (_, index) => index);
  const pages = [];
  const scale = Math.max(1, Math.min(3, Number(ocrScale.value) || 2));

  for (const pageIndex of indexes) {
    showMessage(`正在 OCR 第 ${pageIndex + 1} 頁，共 ${indexes.length} 頁...`);
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const recognition = await worker.recognize(canvas);
    const imageBlob = await canvasToBlob(canvas, "png");
    const imageBytes = await imageBlob.arrayBuffer();

    pages.push({
      pageNumber: pageIndex + 1,
      text: recognition.data.text.trim() || "此頁沒有辨識到文字。",
      imageBytes,
      width: canvas.width,
      height: canvas.height
    });
  }

  return { pages };
}

function createOcrTextBlob(pages, fileName) {
  const content = [
    `來源檔案：${fileName}`,
    `OCR 語言：${ocrLanguage.value}`,
    "",
    ...pages.map((page) => `第 ${page.pageNumber} 頁\n${page.text}`)
  ].join("\n\n---\n\n");
  return new Blob([content], { type: "text/plain;charset=utf-8" });
}

async function createSearchableOcrPdf(pages, fileName) {
  const pdf = await PDFLib.PDFDocument.create();
  const font = await getAnnotationFont(pdf);

  for (const pageData of pages) {
    const page = pdf.addPage([pageData.width, pageData.height]);
    const image = await pdf.embedPng(pageData.imageBytes);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: pageData.width,
      height: pageData.height
    });

    const lines = wrapTextForPdf(pageData.text, 80);
    let y = pageData.height - 28;
    lines.forEach((line) => {
      if (y < 20) return;
      page.drawText(line, {
        x: 18,
        y,
        size: 8,
        font,
        color: PDFLib.rgb(1, 1, 1),
        opacity: 0.01
      });
      y -= 10;
    });
  }

  pdf.setProducer("PDF 工具箱");
  pdf.setCreator(`PDF 工具箱 OCR · ${fileName}`);
  return pdf.save({ useObjectStreams: true });
}

function buildOcrFileName(sourceName, extension) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const cleanSource = sourceName
    .replace(/\.pdf$/i, "")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `ocr-${cleanSource || "pdf"}-${stamp}.${extension}`;
}

async function signPdfFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要簽名的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再簽名。", "error");
    return;
  }

  if (signatureMode.value === "typed" && !signatureText.value.trim()) {
    showMessage("請輸入簽名文字。", "error");
    return;
  }

  if (signatureMode.value === "drawn" && signaturePadIsBlank()) {
    showMessage("請先在手寫簽名畫布上簽名。", "error");
    return;
  }

  if (!window.PDFLib?.PDFDocument) {
    showMessage("PDF 處理元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 簽名中';
  showMessage(`正在為 ${selectedFiles.length} 個 PDF 加入簽名...`);
  lucide.createIcons();

  try {
    for (const file of selectedFiles) {
      const signedBytes = await signSinglePdf(file);
      downloadPdf(signedBytes, buildPdfFileName("signed", file.name));
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · ${signatureMode.value === "typed" ? "文字簽名" : "手寫簽名"}`);
    showMessage(`簽名完成，已產生 ${selectedFiles.length} 份 PDF。`, "done");
  } catch (error) {
    showMessage(error.message || "簽名失敗。請確認 PDF 沒有損毀、沒有無法解除的加密限制。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function signSinglePdf(file) {
  const sourceBytes = await file.arrayBuffer();
  const pdf = await PDFLib.PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const pages = pdf.getPages();
  const targetIndexes = getSignaturePageIndexes(pages.length);
  const requestedWidth = Math.max(80, Math.min(320, Number(signatureWidth.value) || 180));

  if (signatureMode.value === "drawn") {
    const imageBytes = await getSignaturePngBytes();
    const signatureImage = await pdf.embedPng(imageBytes);
    const imageDims = signatureImage.scale(1);
    const boxWidth = Math.min(requestedWidth, Math.max(80, imageDims.width));
    const boxHeight = boxWidth * (imageDims.height / imageDims.width);

    targetIndexes.forEach((pageIndex) => {
      const page = pages[pageIndex];
      const { width, height } = page.getSize();
      const point = getAnnotationPoint(signaturePosition.value, width, height, boxWidth, boxHeight);
      page.drawImage(signatureImage, {
        x: point.x,
        y: point.y,
        width: boxWidth,
        height: boxHeight
      });
    });
  } else {
    const font = await getAnnotationFont(pdf);
    const text = signatureText.value.trim();
    const color = hexToRgb(signatureColor.value);

    targetIndexes.forEach((pageIndex) => {
      const page = pages[pageIndex];
      const { width, height } = page.getSize();
      const fontSize = Math.max(14, Math.min(36, Math.round(requestedWidth / Math.max(6, text.length * 0.5))));
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      const boxWidth = Math.min(width - 64, Math.max(requestedWidth, textWidth + 18));
      const boxHeight = fontSize * 1.8;
      const point = getAnnotationPoint(signaturePosition.value, width, height, boxWidth, boxHeight);

      page.drawText(text, {
        x: point.x + 8,
        y: point.y + fontSize * 0.45,
        size: fontSize,
        font,
        color: PDFLib.rgb(color.r, color.g, color.b)
      });
    });
  }

  pdf.setProducer("PDF 工具箱");
  pdf.setCreator(`PDF 工具箱簽名 · ${file.name}`);
  return pdf.save({ useObjectStreams: true });
}

function getSignaturePageIndexes(pageCount) {
  const rangeInput = document.querySelector("#page-range").value.trim();
  if (!rangeInput) return [pageCount - 1];

  const indexes = new Set();
  parsePageSegments(rangeInput, pageCount).forEach((segment) => {
    segment.indexes.forEach((index) => indexes.add(index));
  });
  return indexes.size > 0 ? [...indexes].sort((a, b) => a - b) : [pageCount - 1];
}

function updateSignatureMode() {
  const isDrawn = signatureMode.value === "drawn";
  typedSignatureField.classList.toggle("is-hidden", isDrawn);
  drawnSignatureField.classList.toggle("is-hidden", !isDrawn);
  if (isDrawn) prepareSignaturePad();
}

function prepareSignaturePad() {
  const context = signaturePad.getContext("2d");
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 4;
  context.strokeStyle = signatureColor.value;
}

function clearSignaturePad() {
  const context = signaturePad.getContext("2d");
  context.clearRect(0, 0, signaturePad.width, signaturePad.height);
}

function getSignatureCanvasPoint(event) {
  const rect = signaturePad.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * signaturePad.width,
    y: ((event.clientY - rect.top) / rect.height) * signaturePad.height
  };
}

function startSignatureDraw(event) {
  if (signatureMode.value !== "drawn") return;
  signatureDrawing = true;
  signaturePad.setPointerCapture(event.pointerId);
  const point = getSignatureCanvasPoint(event);
  const context = signaturePad.getContext("2d");
  context.beginPath();
  context.moveTo(point.x, point.y);
}

function drawSignature(event) {
  if (!signatureDrawing || signatureMode.value !== "drawn") return;
  const point = getSignatureCanvasPoint(event);
  const context = signaturePad.getContext("2d");
  context.strokeStyle = signatureColor.value;
  context.lineTo(point.x, point.y);
  context.stroke();
}

function stopSignatureDraw(event) {
  if (!signatureDrawing) return;
  signatureDrawing = false;
  if (signaturePad.hasPointerCapture(event.pointerId)) {
    signaturePad.releasePointerCapture(event.pointerId);
  }
}

function signaturePadIsBlank() {
  const context = signaturePad.getContext("2d");
  const pixels = context.getImageData(0, 0, signaturePad.width, signaturePad.height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) return false;
  }
  return true;
}

async function getSignaturePngBytes() {
  const response = await fetch(signaturePad.toDataURL("image/png"));
  return response.arrayBuffer();
}

async function requestSignatureFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要請求簽名的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再建立簽署請求。", "error");
    return;
  }

  const signerName = requestSignerName.value.trim();
  const signerEmail = requestSignerEmail.value.trim();
  const subject = requestSubject.value.trim();
  const message = requestMessage.value.trim();

  if (!signerName) {
    showMessage("請輸入簽署人姓名。", "error");
    return;
  }

  if (!isValidEmail(signerEmail)) {
    showMessage("請輸入有效的簽署人 Email。", "error");
    return;
  }

  if (!subject) {
    showMessage("請輸入請求主旨。", "error");
    return;
  }

  if (!requestDueDate.value) {
    showMessage("請選擇簽署到期日。", "error");
    return;
  }

  const dueAt = new Date(`${requestDueDate.value}T23:59:59`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dueAt < today) {
    showMessage("到期日不能早於今天。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 建立中';
  requestResult.classList.add("is-hidden");
  requestResult.innerHTML = "";
  showMessage("正在建立簽署請求...");
  lucide.createIcons();

  try {
    const requestData = await createSignatureRequest({
      signerName,
      signerEmail,
      subject,
      message,
      dueAt
    });

    jobCount += 1;
    addHistoryItem(`${signerName} · ${requestData.statusLabel} · ${requestData.requestId}`);
    requestResult.innerHTML = `
      <strong>簽署請求已建立：${escapeHtml(requestData.requestId)}</strong>
      <span>${escapeHtml(formatSignatureEmailStatus(requestData.emailDelivery))}</span>
      ${requestData.passcodeForSigner ? `<span>一次性密碼：<strong>${escapeHtml(requestData.passcodeForSigner)}</strong>（請用其他管道提供給簽署人）</span>` : ""}
      <span>簽署連結：<a href="${requestData.signingUrl}" target="_blank" rel="noreferrer">${requestData.signingUrl}</a></span>
      <span>狀態 API：<a href="${requestData.statusUrl}" target="_blank" rel="noreferrer">${requestData.statusUrl}</a></span>
    `;
    requestResult.classList.remove("is-hidden");
    showMessage(getSignatureRequestMessage(requestData), "done");
  } catch (error) {
    showMessage(error.message || "建立簽署請求失敗，請稍後再試。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function createSignatureRequest({ signerName, signerEmail, subject, message, dueAt }) {
  const formData = new FormData();
  formData.append("signerName", signerName);
  formData.append("signerEmail", signerEmail);
  formData.append("subject", subject);
  formData.append("message", message);
  formData.append("dueAt", dueAt.toISOString());
  formData.append("authMethod", requestAuthMethod.value);
  formData.append("signaturePosition", requestSignaturePosition.value);
  formData.append("pageRange", document.querySelector("#page-range").value.trim() || "last-page");
  selectedFiles.forEach((file, index) => {
    formData.append(`file${index}`, file, file.name);
  });

  const response = await fetch("/api/signature-requests", {
    method: "POST",
    body: formData
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "簽署請求後端回應失敗。");
  }

  return data;
}

function formatSignatureEmailStatus(emailDelivery) {
  if (emailDelivery?.status === "sent") {
    return `通知信已寄出（${emailDelivery.provider}）`;
  }
  if (emailDelivery?.status === "failed") {
    return `通知信未寄出：${emailDelivery.error}`;
  }
  return "通知信尚未設定；請手動提供簽署連結。";
}

function getSignatureRequestMessage(requestData) {
  if (requestData.emailDelivery?.status === "sent") {
    return `簽署請求已建立：${requestData.requestId}，通知信已寄出。`;
  }
  return `簽署請求已建立：${requestData.requestId}。通知信未寄出，請手動提供簽署連結。`;
}

async function createSignatureRequestManifest({ signerName, signerEmail, subject, message, dueAt }) {
  const requestId = buildSignatureRequestId();
  const createdAt = new Date();
  const rawRange = document.querySelector("#page-range").value.trim();

  return {
    requestId,
    status: "pending",
    statusLabel: "等待簽署",
    subject,
    message,
    createdAt: createdAt.toISOString(),
    dueAt: dueAt.toISOString(),
    signer: {
      name: signerName,
      email: signerEmail,
      authMethod: requestAuthMethod.value
    },
    signatureField: {
      pageRange: rawRange || "last-page",
      position: requestSignaturePosition.value
    },
    documents: selectedFiles.map((file, index) => ({
      order: index + 1,
      name: file.name,
      size: file.size,
      type: file.type || "application/pdf"
    })),
    auditTrail: [
      {
        time: createdAt.toISOString(),
        event: "request_created",
        detail: `已建立給 ${signerEmail} 的簽署請求。`
      }
    ]
  };
}

function buildSignatureRequestId() {
  const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `REQ-${datePart}-${randomPart}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function initializeRequestDueDate() {
  const today = new Date();
  const defaultDueDate = new Date(today);
  defaultDueDate.setDate(today.getDate() + 7);
  requestDueDate.min = today.toISOString().slice(0, 10);
  if (!requestDueDate.value) {
    requestDueDate.value = defaultDueDate.toISOString().slice(0, 10);
  }
}

async function extractPdfPageTexts(file) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const rawRange = document.querySelector("#page-range").value.trim();
  const indexes = rawRange
    ? [...new Set(parsePageSegments(rawRange, pdf.numPages).flatMap((segment) => segment.indexes))].sort((a, b) => a - b)
    : Array.from({ length: pdf.numPages }, (_, index) => index);
  const pages = [];

  for (const pageIndex of indexes) {
    const page = await pdf.getPage(pageIndex + 1);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim();
    pages.push({
      pageNumber: pageIndex + 1,
      text: text || "此頁沒有可抽取文字。"
    });
  }

  return pages;
}

async function translateText(text) {
  if (!text || text === "此頁沒有可抽取文字。") return text;

  const apiUrl = translateApiUrl.value.trim();
  if (!apiUrl) return translateTextWithOpenAI(text);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: text,
        source: translateSource.value,
        target: translateTarget.value,
        format: "text"
      })
    });

    if (!response.ok) throw new Error("翻譯 API 回應失敗。");

    const data = await response.json();
    return data.translatedText || data.translation || await translateTextWithOpenAI(text);
  } catch (error) {
    console.warn(error);
    return translateTextWithOpenAI(text);
  }
}

async function translateTextWithOpenAI(text) {
  const response = await fetch("/api/openai/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      source: translateSource.value,
      target: translateTarget.value,
      max_output_tokens: 2200
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "OpenAI 翻譯後端回應失敗。");
  }

  return data.translatedText || "";
}

function offlineTranslate(text, targetLanguage) {
  if (targetLanguage === "zh") return offlineTranslateToZh(text);
  if (targetLanguage === "en") return offlineTranslateToEn(text);
  return `${text}\n\n[離線翻譯器目前主要支援中文與英文；可填入翻譯 API URL 取得完整翻譯]`;
}

function offlineTranslateToEn(text) {
  const dictionary = [
    ["合併", "merge"],
    ["壓縮", "compress"],
    ["註解", "annotate"],
    ["編輯", "edit"],
    ["文字", "text"],
    ["分割", "split"],
    ["節錄", "extract"],
    ["翻譯", "translate"],
    ["簽名", "signature"],
    ["檔案", "file"],
    ["頁面", "page"],
    ["範圍", "range"],
    ["品質", "quality"],
    ["完成", "completed"],
    ["請先加入", "please add"],
    ["輸出", "output"],
    ["設定", "settings"],
    ["日期", "date"],
    ["金額", "amount"],
    ["姓名", "name"]
  ];
  return applyDictionary(text, dictionary);
}

function offlineTranslateToZh(text) {
  const dictionary = [
    ["merge", "合併"],
    ["compress", "壓縮"],
    ["annotate", "註解"],
    ["edit", "編輯"],
    ["text", "文字"],
    ["split", "分割"],
    ["extract", "節錄"],
    ["translate", "翻譯"],
    ["signature", "簽名"],
    ["file", "檔案"],
    ["page", "頁面"],
    ["range", "範圍"],
    ["quality", "品質"],
    ["completed", "完成"],
    ["output", "輸出"],
    ["settings", "設定"],
    ["date", "日期"],
    ["amount", "金額"],
    ["name", "姓名"]
  ];
  return applyDictionary(text, dictionary);
}

function applyDictionary(text, dictionary) {
  return dictionary.reduce((result, [source, target]) => {
    const pattern = new RegExp(source, "gi");
    return result.replace(pattern, target);
  }, text);
}

function createTranslatedTextBlob(pages, fileName) {
  const content = [
    `來源檔案：${fileName}`,
    `目標語言：${getLanguageLabel(translateTarget.value)}`,
    "",
    ...pages.map((page) => `第 ${page.pageNumber} 頁\n原文：\n${page.text}\n\n譯文：\n${page.translatedText}`)
  ].join("\n\n---\n\n");
  return new Blob([content], { type: "text/plain;charset=utf-8" });
}

async function createTranslatedPdf(pages, fileName) {
  const pdf = await PDFLib.PDFDocument.create();
  const font = await getAnnotationFont(pdf);
  const margin = 48;
  const fontSize = 11;
  const lineHeight = 17;

  pages.forEach((pageData) => {
    let page = pdf.addPage([595.28, 841.89]);
    let y = page.getHeight() - margin;
    const lines = [
      `來源檔案：${fileName}`,
      `第 ${pageData.pageNumber} 頁 · 目標語言：${getLanguageLabel(translateTarget.value)}`,
      "",
      "原文",
      ...wrapTextForPdf(pageData.text, 42),
      "",
      "譯文",
      ...wrapTextForPdf(pageData.translatedText, 42)
    ];

    lines.forEach((line) => {
      if (y < margin + lineHeight) {
        page = pdf.addPage([595.28, 841.89]);
        y = page.getHeight() - margin;
      }

      page.drawText(line || " ", {
        x: margin,
        y,
        size: fontSize,
        font,
        color: PDFLib.rgb(0.12, 0.14, 0.17)
      });
      y -= lineHeight;
    });
  });

  pdf.setProducer("PDF 工具箱");
  pdf.setCreator("PDF 工具箱");
  return pdf.save({ useObjectStreams: true });
}

function getLanguageLabel(language) {
  const labels = {
    auto: "自動偵測",
    zh: "中文",
    en: "英文",
    ja: "日文",
    ko: "韓文"
  };
  return labels[language] || language;
}

function buildTranslatedFileName(sourceName, extension) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const cleanSource = sourceName
    .replace(/\.pdf$/i, "")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `translated-${cleanSource || "pdf"}-${translateTarget.value}-${stamp}.${extension}`;
}

async function excerptPagesFromPdf(file) {
  if (!window.PDFLib?.PDFDocument) {
    throw new Error("PDF 處理元件尚未載入完成，請重新整理頁面再試一次。");
  }

  const sourceBytes = await file.arrayBuffer();
  const sourcePdf = await PDFLib.PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const segments = parsePageSegments(document.querySelector("#page-range").value.trim(), sourcePdf.getPageCount());

  if (excerptMergeRanges.checked) {
    const outputPdf = await PDFLib.PDFDocument.create();
    const indexes = segments.flatMap((segment) => segment.indexes);
    const pages = await outputPdf.copyPages(sourcePdf, indexes);
    pages.forEach((page) => outputPdf.addPage(page));
    outputPdf.setProducer("PDF 工具箱");
    outputPdf.setCreator("PDF 工具箱");
    const bytes = await outputPdf.save({ useObjectStreams: true });
    downloadPdf(bytes, buildExcerptFileName(file.name, "pages", segments.map((segment) => segment.label).join("_")));
    return 1;
  }

  for (const segment of segments) {
    const outputPdf = await PDFLib.PDFDocument.create();
    const pages = await outputPdf.copyPages(sourcePdf, segment.indexes);
    pages.forEach((page) => outputPdf.addPage(page));
    outputPdf.setProducer("PDF 工具箱");
    outputPdf.setCreator("PDF 工具箱");
    const bytes = await outputPdf.save({ useObjectStreams: true });
    downloadPdf(bytes, buildExcerptFileName(file.name, "pages", segment.label));
  }

  return segments.length;
}

async function excerptTextFromPdf(file) {
  if (!window.pdfjsLib?.getDocument) {
    throw new Error("PDF 文字節錄元件尚未載入完成，請重新整理頁面再試一次。");
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const segments = parsePageSegments(document.querySelector("#page-range").value.trim(), pdf.numPages);
  const indexes = [...new Set(segments.flatMap((segment) => segment.indexes))].sort((a, b) => a - b);
  const blocks = [];

  for (const pageIndex of indexes) {
    const page = await pdf.getPage(pageIndex + 1);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim();
    blocks.push(`第 ${pageIndex + 1} 頁\n${pageText || "此頁沒有可抽取文字。"}`);
  }

  const blob = new Blob([blocks.join("\n\n")], { type: "text/plain;charset=utf-8" });
  downloadBlob(blob, buildExcerptFileName(file.name, "text", segments.map((segment) => segment.label).join("_"), "txt"));
  return 1;
}

function buildExcerptFileName(sourceName, mode, label, extension = "pdf") {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const cleanSource = sourceName
    .replace(/\.pdf$/i, "")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const cleanLabel = label.replace(/[^\w-]+/g, "-").replace(/-+/g, "-");
  return `excerpt-${mode}-${cleanSource || "pdf"}-${cleanLabel}-${stamp}.${extension}`;
}

function hasWordConversionLibraries(direction) {
  if (direction === "pdf-to-word") {
    return Boolean(window.pdfjsLib?.getDocument && window.docx?.Document);
  }
  return Boolean(window.mammoth?.extractRawText && window.PDFLib?.PDFDocument);
}

function isDocxFile(file) {
  return file.name.toLowerCase().endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

async function convertPdfToWord(file) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const paragraphs = [];
  const fontName = getOfficeFontName();

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim();
    paragraphs.push(new docx.Paragraph({
      children: [new docx.TextRun({ text: `第 ${pageNumber} 頁`, bold: true, size: 24, font: fontName })],
      spacing: { after: 160 }
    }));
    splitTextForDocx(pageText || "此頁沒有可抽取文字。").forEach((line) => {
      paragraphs.push(new docx.Paragraph({ children: [new docx.TextRun({ text: line, size: 22, font: fontName })], spacing: { after: 120 } }));
    });

    if (wordKeepPageBreaks.checked && pageNumber < pdf.numPages) {
      paragraphs.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));
    }
  }

  const document = new docx.Document({
    creator: "PDF 工具箱",
    title: file.name.replace(/\.pdf$/i, ""),
    sections: [{ properties: {}, children: paragraphs }]
  });

  return docx.Packer.toBlob(document);
}

function splitTextForDocx(text) {
  const chunks = [];
  const cleanText = text.trim();
  for (let index = 0; index < cleanText.length; index += 420) {
    chunks.push(cleanText.slice(index, index + 420));
  }
  return chunks.length > 0 ? chunks : ["此頁沒有可抽取文字。"];
}

async function deletePagesFromPdfFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要刪除頁面的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再刪除頁面。", "error");
    return;
  }

  if (!document.querySelector("#page-range").value.trim()) {
    showMessage("請在頁面範圍輸入要刪除的頁碼，例如 2, 5-7。", "error");
    return;
  }

  if (!window.PDFLib?.PDFDocument) {
    showMessage("PDF 處理元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 刪除中';
  showMessage(`正在處理 ${selectedFiles.length} 個 PDF...`);
  lucide.createIcons();

  try {
    let removedTotal = 0;

    for (const file of selectedFiles) {
      const result = await deletePagesFromSinglePdf(file);
      removedTotal += result.removedCount;
      downloadPdf(result.bytes, buildPdfFileName("deleted-pages", file.name));
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · 已刪除 ${removedTotal} 頁`);
    showMessage(`刪除頁面完成，共移除 ${removedTotal} 頁。`, "done");
  } catch (error) {
    showMessage(error.message || "刪除頁面失敗。請確認頁碼範圍正確，PDF 沒有損毀或加密限制。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function deletePagesFromSinglePdf(file) {
  const sourceBytes = await file.arrayBuffer();
  const sourcePdf = await PDFLib.PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const pageCount = sourcePdf.getPageCount();
  const removeIndexes = new Set(parsePageSegments(document.querySelector("#page-range").value.trim(), pageCount).flatMap((segment) => segment.indexes));
  const keepIndexes = Array.from({ length: pageCount }, (_, index) => index).filter((index) => !removeIndexes.has(index));

  if (keepIndexes.length === 0) {
    throw new Error(`「${file.name}」不能刪除全部頁面，請至少保留 1 頁。`);
  }

  const outputPdf = await PDFLib.PDFDocument.create();
  const pages = await outputPdf.copyPages(sourcePdf, keepIndexes);
  pages.forEach((page) => outputPdf.addPage(page));
  outputPdf.setProducer("PDF 工具箱");
  outputPdf.setCreator("PDF 工具箱");

  return {
    bytes: await outputPdf.save({ useObjectStreams: true }),
    removedCount: removeIndexes.size
  };
}

async function unlockPdfFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要解除鎖定的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再解除鎖定。", "error");
    return;
  }

  const password = unlockPassword.value;
  if (!password) {
    showMessage("請輸入你已知且有權使用的 PDF 開啟密碼。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 解除中';
  showMessage(`正在呼叫合法 PDF 解鎖服務處理 ${selectedFiles.length} 個 PDF...`);
  lucide.createIcons();

  try {
    for (const file of selectedFiles) {
      const unlockedBlob = await unlockSinglePdfWithBackend(file, password);
      downloadBlob(unlockedBlob, buildPdfFileName("unlocked", file.name));
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · 使用已知密碼解除鎖定`);
    showMessage(`解除鎖定完成，已產生 ${selectedFiles.length} 份 PDF。`, "done");
  } catch (error) {
    showMessage(error.message || "解除鎖定失敗。請確認後端 /api/unlock-pdf 已接好，且密碼正確。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function unlockSinglePdfWithBackend(file, password) {
  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("password", password);

  return runQueuedBackendJob("unlock", formData, `解除鎖定 ${file.name}`);
}

async function rotatePdfFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要旋轉的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再旋轉。", "error");
    return;
  }

  if (!window.PDFLib?.PDFDocument) {
    showMessage("PDF 處理元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 旋轉中';
  showMessage(`正在旋轉 ${selectedFiles.length} 個 PDF...`);
  lucide.createIcons();

  try {
    let rotatedTotal = 0;

    for (const file of selectedFiles) {
      const result = await rotateSinglePdf(file);
      rotatedTotal += result.rotatedCount;
      downloadPdf(result.bytes, buildPdfFileName("rotated", file.name));
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · 旋轉 ${rotatedTotal} 頁 · ${rotateDegrees.value}°`);
    showMessage(`旋轉完成，共處理 ${rotatedTotal} 頁。`, "done");
  } catch (error) {
    showMessage(error.message || "旋轉失敗。請確認頁碼範圍正確，PDF 沒有損毀或加密限制。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function rotateSinglePdf(file) {
  const sourceBytes = await file.arrayBuffer();
  const pdf = await PDFLib.PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const pages = pdf.getPages();
  const targetIndexes = getRotatePageIndexes(pages.length);
  const delta = Number(rotateDegrees.value) || 90;

  targetIndexes.forEach((pageIndex) => {
    const page = pages[pageIndex];
    const currentAngle = page.getRotation().angle || 0;
    page.setRotation(PDFLib.degrees((currentAngle + delta) % 360));
  });

  pdf.setProducer("PDF 工具箱");
  pdf.setCreator("PDF 工具箱");

  return {
    bytes: await pdf.save({ useObjectStreams: true }),
    rotatedCount: targetIndexes.length
  };
}

function getRotatePageIndexes(pageCount) {
  const rawRange = document.querySelector("#page-range").value.trim();
  if (!rawRange) return Array.from({ length: pageCount }, (_, index) => index);
  return [...new Set(parsePageSegments(rawRange, pageCount).flatMap((segment) => segment.indexes))].sort((a, b) => a - b);
}

async function cropPdfFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要裁剪的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再裁剪。", "error");
    return;
  }

  if (!window.PDFLib?.PDFDocument) {
    showMessage("PDF 處理元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  const cropMargins = getCropMargins();
  if (Object.values(cropMargins).every((value) => value === 0)) {
    showMessage("請至少設定一個大於 0 的裁剪邊距。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 裁剪中';
  showMessage(`正在裁剪 ${selectedFiles.length} 個 PDF...`);
  lucide.createIcons();

  try {
    let croppedTotal = 0;

    for (const file of selectedFiles) {
      const result = await cropSinglePdf(file, cropMargins);
      croppedTotal += result.croppedCount;
      downloadPdf(result.bytes, buildPdfFileName("cropped", file.name));
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · 裁剪 ${croppedTotal} 頁`);
    showMessage(`裁剪完成，共處理 ${croppedTotal} 頁。`, "done");
  } catch (error) {
    showMessage(error.message || "裁剪失敗。請確認裁剪邊距不要超過頁面大小，且頁碼範圍正確。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function cropSinglePdf(file, margins) {
  const sourceBytes = await file.arrayBuffer();
  const pdf = await PDFLib.PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const pages = pdf.getPages();
  const targetIndexes = getCropPageIndexes(pages.length);

  targetIndexes.forEach((pageIndex) => {
    const page = pages[pageIndex];
    const { width, height } = page.getSize();
    const cropWidth = width - margins.left - margins.right;
    const cropHeight = height - margins.top - margins.bottom;

    if (cropWidth < 36 || cropHeight < 36) {
      throw new Error(`第 ${pageIndex + 1} 頁裁剪後太小，請降低裁剪邊距。`);
    }

    page.setCropBox(margins.left, margins.bottom, cropWidth, cropHeight);
  });

  pdf.setProducer("PDF 工具箱");
  pdf.setCreator("PDF 工具箱");

  return {
    bytes: await pdf.save({ useObjectStreams: true }),
    croppedCount: targetIndexes.length
  };
}

function getCropMargins() {
  return {
    top: Math.max(0, Math.min(300, Number(cropTop.value) || 0)),
    right: Math.max(0, Math.min(300, Number(cropRight.value) || 0)),
    bottom: Math.max(0, Math.min(300, Number(cropBottom.value) || 0)),
    left: Math.max(0, Math.min(300, Number(cropLeft.value) || 0))
  };
}

function getCropPageIndexes(pageCount) {
  const rawRange = document.querySelector("#page-range").value.trim();
  if (!rawRange) return Array.from({ length: pageCount }, (_, index) => index);
  return [...new Set(parsePageSegments(rawRange, pageCount).flatMap((segment) => segment.indexes))].sort((a, b) => a - b);
}

async function protectPdfFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要上鎖的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再上鎖。", "error");
    return;
  }

  const openPassword = protectOpenPassword.value;
  const ownerPassword = protectOwnerPassword.value || openPassword;

  if (openPassword.length < 6) {
    showMessage("開啟密碼至少需要 6 個字元。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 上鎖中';
  showMessage(`正在呼叫原生 PDF 加密服務處理 ${selectedFiles.length} 個 PDF...`);
  lucide.createIcons();

  try {
    for (const file of selectedFiles) {
      const encryptedBlob = await protectSinglePdfWithBackend(file, openPassword, ownerPassword);
      downloadBlob(encryptedBlob, buildPdfFileName("protected", file.name));
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · 原生 PDF 密碼加密`);
    showMessage(`上鎖完成，已產生 ${selectedFiles.length} 份原生密碼 PDF。`, "done");
  } catch (error) {
    showMessage(error.message || "上鎖失敗。請確認後端 /api/protect-pdf 已接好，且 PDF 可讀取。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function protectSinglePdfWithBackend(file, openPassword, ownerPassword) {
  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("openPassword", openPassword);
  formData.append("ownerPassword", ownerPassword);
  formData.append("allowPrint", protectAllowPrint.checked ? "true" : "false");
  formData.append("allowCopy", protectAllowCopy.checked ? "true" : "false");

  return runQueuedBackendJob("protect", formData, `上鎖 ${file.name}`);
}

async function extractPagesFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要擷取頁面的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再擷取頁面。", "error");
    return;
  }

  if (!document.querySelector("#page-range").value.trim()) {
    showMessage("請輸入要擷取的頁面範圍，例如 1-3, 7。", "error");
    return;
  }

  if (!window.PDFLib?.PDFDocument) {
    showMessage("PDF 處理元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 擷取中';
  showMessage(`正在擷取 ${selectedFiles.length} 個 PDF 的指定頁面...`);
  lucide.createIcons();

  try {
    let outputCount = 0;

    for (const file of selectedFiles) {
      outputCount += await extractPagesFromSinglePdf(file);
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · 輸出 ${outputCount} 份 PDF`);
    showMessage(`擷取頁面完成，已輸出 ${outputCount} 份 PDF。`, "done");
  } catch (error) {
    showMessage(error.message || "擷取頁面失敗。請確認頁碼範圍正確，PDF 沒有損毀或加密限制。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function extractPagesFromSinglePdf(file) {
  const sourceBytes = await file.arrayBuffer();
  const sourcePdf = await PDFLib.PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const segments = parsePageSegments(document.querySelector("#page-range").value.trim(), sourcePdf.getPageCount());

  if (extractPagesMode.value === "merged") {
    const outputPdf = await PDFLib.PDFDocument.create();
    const indexes = [...new Set(segments.flatMap((segment) => segment.indexes))].sort((a, b) => a - b);
    const pages = await outputPdf.copyPages(sourcePdf, indexes);
    pages.forEach((page) => outputPdf.addPage(page));
    outputPdf.setProducer("PDF 工具箱");
    outputPdf.setCreator("PDF 工具箱");
    const bytes = await outputPdf.save({ useObjectStreams: true });
    downloadPdf(bytes, buildExtractPagesFileName(file.name, segments.map((segment) => segment.label).join("_")));
    return 1;
  }

  for (const segment of segments) {
    const outputPdf = await PDFLib.PDFDocument.create();
    const pages = await outputPdf.copyPages(sourcePdf, segment.indexes);
    pages.forEach((page) => outputPdf.addPage(page));
    outputPdf.setProducer("PDF 工具箱");
    outputPdf.setCreator("PDF 工具箱");
    const bytes = await outputPdf.save({ useObjectStreams: true });
    downloadPdf(bytes, buildExtractPagesFileName(file.name, segment.label));
  }

  return segments.length;
}

function buildExtractPagesFileName(sourceName, label) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const cleanSource = sourceName
    .replace(/\.pdf$/i, "")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const cleanLabel = label.replace(/[^\w-]+/g, "-").replace(/-+/g, "-");
  return `extracted-pages-${cleanSource || "pdf"}-${cleanLabel}-${stamp}.pdf`;
}

async function addPageNumbersFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要加頁碼的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再加頁碼。", "error");
    return;
  }

  if (!window.PDFLib?.PDFDocument) {
    showMessage("PDF 處理元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 加頁碼中';
  showMessage(`正在為 ${selectedFiles.length} 個 PDF 加入頁碼...`);
  lucide.createIcons();

  try {
    let totalPages = 0;

    for (const file of selectedFiles) {
      const result = await addPageNumbersToSinglePdf(file);
      totalPages += result.pageCount;
      downloadPdf(result.bytes, buildPdfFileName("page-numbers", file.name));
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · 已加頁碼 ${totalPages} 頁`);
    showMessage(`頁碼加入完成，已產生 ${selectedFiles.length} 份 PDF。`, "done");
  } catch (error) {
    showMessage(error.message || "加入頁碼失敗。請確認頁碼範圍正確，PDF 沒有損毀或加密限制。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function addPageNumbersToSinglePdf(file) {
  const sourceBytes = await file.arrayBuffer();
  const pdf = await PDFLib.PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const font = await getAnnotationFont(pdf);
  const pages = pdf.getPages();
  const targetIndexes = getPageNumberIndexes(pages.length);
  const color = hexToRgb(pageNumberColor.value);
  const fontSize = Math.max(8, Math.min(36, Number(pageNumberSize.value) || 11));
  const startNumber = Math.max(1, Number(pageNumberStart.value) || 1);
  const lastNumber = startNumber + targetIndexes.length - 1;

  targetIndexes.forEach((pageIndex, orderIndex) => {
    const page = pages[pageIndex];
    const { width, height } = page.getSize();
    const currentNumber = startNumber + orderIndex;
    const text = formatPageNumberText(currentNumber, lastNumber);
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const point = getPageNumberPoint(pageNumberPosition.value, width, height, textWidth, fontSize);

    page.drawText(text, {
      x: point.x,
      y: point.y,
      size: fontSize,
      font,
      color: PDFLib.rgb(color.r, color.g, color.b)
    });
  });

  pdf.setProducer("PDF 工具箱");
  pdf.setCreator("PDF 工具箱");
  return {
    bytes: await pdf.save({ useObjectStreams: true }),
    pageCount: targetIndexes.length
  };
}

function getPageNumberIndexes(pageCount) {
  const rawRange = document.querySelector("#page-range").value.trim();
  if (!rawRange) return Array.from({ length: pageCount }, (_, index) => index);
  return [...new Set(parsePageSegments(rawRange, pageCount).flatMap((segment) => segment.indexes))].sort((a, b) => a - b);
}

function formatPageNumberText(pageNumber, lastNumber) {
  if (pageNumberFormat.value === "zh-total") {
    return `第 ${pageNumber} / ${lastNumber} 頁`;
  }

  if (pageNumberFormat.value === "page-of-total") {
    return `Page ${pageNumber} of ${lastNumber}`;
  }

  return String(pageNumber);
}

function getPageNumberPoint(position, pageWidth, pageHeight, textWidth, fontSize) {
  const margin = 32;
  const topY = pageHeight - margin - fontSize;
  const bottomY = margin;
  const centerX = (pageWidth - textWidth) / 2;
  const rightX = pageWidth - textWidth - margin;
  const points = {
    "top-left": { x: margin, y: topY },
    "top-center": { x: centerX, y: topY },
    "top-right": { x: rightX, y: topY },
    "bottom-left": { x: margin, y: bottomY },
    "bottom-center": { x: centerX, y: bottomY },
    "bottom-right": { x: rightX, y: bottomY }
  };
  return points[position] || points["bottom-center"];
}

async function redactPdfFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要修訂的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再修訂。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 修訂中';
  showMessage(`正在呼叫進階修訂後端處理 ${selectedFiles.length} 個 PDF...`);
  lucide.createIcons();

  try {
    for (const file of selectedFiles) {
      const redactedBlob = await redactSinglePdfWithBackend(file);
      downloadBlob(redactedBlob, buildPdfFileName("redacted", file.name));
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · 進階後端修訂`);
    showMessage(`修訂完成，已產生 ${selectedFiles.length} 份 PDF。`, "done");
  } catch (error) {
    showMessage(error.message || "修訂失敗。請確認後端 /api/redact-pdf 已接好，且 PDF 可讀取。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function redactSinglePdfWithBackend(file) {
  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("pageRange", document.querySelector("#page-range").value.trim());
  formData.append("position", redactPosition.value);
  formData.append("width", String(Math.max(40, Math.min(600, Number(redactWidth.value) || 220))));
  formData.append("height", String(Math.max(16, Math.min(300, Number(redactHeight.value) || 48))));
  formData.append("color", redactColor.value);
  formData.append("label", redactLabel.value.trim());

  return runQueuedBackendJob("redact", formData, `修訂 ${file.name}`);
}

function getRedactPageIndexes(pageCount) {
  const rawRange = document.querySelector("#page-range").value.trim();
  if (!rawRange) return Array.from({ length: pageCount }, (_, index) => index);
  return [...new Set(parsePageSegments(rawRange, pageCount).flatMap((segment) => segment.indexes))].sort((a, b) => a - b);
}

function getRedactPoint(position, pageWidth, pageHeight, boxWidth, boxHeight) {
  return getAnnotationPoint(position, pageWidth, pageHeight, boxWidth, boxHeight);
}

async function watermarkPdfFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要加浮水印的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再加浮水印。", "error");
    return;
  }

  if (!watermarkText.value.trim()) {
    showMessage("請輸入浮水印文字。", "error");
    return;
  }

  if (!window.PDFLib?.PDFDocument) {
    showMessage("PDF 處理元件尚未載入完成，請重新整理頁面再試一次。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 加浮水印中';
  showMessage(`正在為 ${selectedFiles.length} 個 PDF 加入浮水印...`);
  lucide.createIcons();

  try {
    let watermarkedPages = 0;

    for (const file of selectedFiles) {
      const result = await watermarkSinglePdf(file);
      watermarkedPages += result.pageCount;
      downloadPdf(result.bytes, buildPdfFileName("watermarked", file.name));
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · 浮水印 ${watermarkedPages} 頁`);
    showMessage(`浮水印完成，已產生 ${selectedFiles.length} 份 PDF。`, "done");
  } catch (error) {
    showMessage(error.message || "加入浮水印失敗。請確認頁碼範圍正確，PDF 沒有損毀或加密限制。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function watermarkSinglePdf(file) {
  const sourceBytes = await file.arrayBuffer();
  const pdf = await PDFLib.PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const font = await getAnnotationFont(pdf);
  const pages = pdf.getPages();
  const targetIndexes = getWatermarkPageIndexes(pages.length);
  const color = hexToRgb(watermarkColor.value);
  const text = watermarkText.value.trim();
  const fontSize = Math.max(12, Math.min(96, Number(watermarkSize.value) || 42));
  const opacity = Math.max(0.1, Math.min(0.8, (Number(watermarkOpacity.value) || 22) / 100));
  const angle = Math.max(-90, Math.min(90, Number(watermarkAngle.value) || 0));

  targetIndexes.forEach((pageIndex) => {
    const page = pages[pageIndex];
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textHeight = fontSize;
    const point = getWatermarkPoint(watermarkPosition.value, width, height, textWidth, textHeight);

    page.drawText(text, {
      x: point.x,
      y: point.y,
      size: fontSize,
      font,
      color: PDFLib.rgb(color.r, color.g, color.b),
      opacity,
      rotate: PDFLib.degrees(angle)
    });
  });

  pdf.setProducer("PDF 工具箱");
  pdf.setCreator("PDF 工具箱");
  return {
    bytes: await pdf.save({ useObjectStreams: true }),
    pageCount: targetIndexes.length
  };
}

function getWatermarkPageIndexes(pageCount) {
  const rawRange = document.querySelector("#page-range").value.trim();
  if (!rawRange) return Array.from({ length: pageCount }, (_, index) => index);
  return [...new Set(parsePageSegments(rawRange, pageCount).flatMap((segment) => segment.indexes))].sort((a, b) => a - b);
}

function getWatermarkPoint(position, pageWidth, pageHeight, textWidth, textHeight) {
  const margin = 48;
  const points = {
    "top-left": { x: margin, y: pageHeight - margin - textHeight },
    "top-right": { x: pageWidth - textWidth - margin, y: pageHeight - margin - textHeight },
    center: { x: (pageWidth - textWidth) / 2, y: (pageHeight - textHeight) / 2 },
    "bottom-left": { x: margin, y: margin },
    "bottom-right": { x: pageWidth - textWidth - margin, y: margin }
  };
  return points[position] || points.center;
}

async function flattenPdfFiles() {
  if (selectedFiles.length === 0) {
    showMessage("請先加入要平面化的 PDF 檔案。", "error");
    return;
  }

  if (selectedFiles.some((file) => !isPdfFile(file))) {
    showMessage("清單中包含非 PDF 檔案，請移除後再平面化。", "error");
    return;
  }

  if (!flattenFormFields.checked && !flattenOptimize.checked) {
    showMessage("請至少選擇一個平面化或整理選項。", "error");
    return;
  }

  processButton.disabled = true;
  processButton.innerHTML = '<i data-lucide="loader-circle"></i> 平面化中';
  showMessage(`正在呼叫進階平面化後端處理 ${selectedFiles.length} 個 PDF...`);
  lucide.createIcons();

  try {
    for (const file of selectedFiles) {
      const flattenedBlob = await flattenSinglePdfWithBackend(file);
      downloadBlob(flattenedBlob, buildPdfFileName("flattened", file.name));
    }

    jobCount += 1;
    addHistoryItem(`${selectedFiles.length} 個檔案 · 進階後端平面化`);
    showMessage(`平面化完成，已產生 ${selectedFiles.length} 份 PDF。`, "done");
  } catch (error) {
    showMessage(error.message || "平面化失敗。請確認後端 /api/flatten-pdf 已接好，且 PDF 可讀取。", "error");
    console.error(error);
  } finally {
    processButton.disabled = false;
    updateToolMode();
  }
}

async function flattenSinglePdfWithBackend(file) {
  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("flattenFormFields", flattenFormFields.checked ? "true" : "false");
  formData.append("optimize", flattenOptimize.checked ? "true" : "false");

  return runQueuedBackendJob("flatten", formData, `平面化 ${file.name}`);
}

async function convertWordToPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const text = result.value.trim();

  if (!text) {
    throw new Error("Word 檔沒有可轉換文字。");
  }

  const pdf = await PDFLib.PDFDocument.create();
  const font = await getAnnotationFont(pdf);
  const margin = 48;
  const fontSize = 12;
  const lineHeight = 18;
  let page = pdf.addPage([595.28, 841.89]);
  let y = page.getHeight() - margin;

  wrapTextForPdf(text, 38).forEach((line) => {
    if (y < margin + lineHeight) {
      page = pdf.addPage([595.28, 841.89]);
      y = page.getHeight() - margin;
    }

    page.drawText(line, {
      x: margin,
      y,
      size: fontSize,
      font,
      color: PDFLib.rgb(0.12, 0.14, 0.17)
    });
    y -= lineHeight;
  });

  pdf.setProducer("PDF 工具箱");
  pdf.setCreator("PDF 工具箱");
  return pdf.save({ useObjectStreams: true });
}

function wrapTextForPdf(text, maxLength) {
  const lines = [];
  text.split(/\n+/).forEach((paragraph) => {
    const normalized = paragraph.trim();
    if (!normalized) {
      lines.push(" ");
      return;
    }

    let current = "";
    for (const char of normalized) {
      if ((current + char).length > maxLength) {
        lines.push(current);
        current = char;
      } else {
        current += char;
      }
    }
    if (current) lines.push(current);
  });
  return lines;
}

function buildOfficeFileName(prefix, sourceName, extension) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const cleanSource = sourceName
    .replace(/\.(pdf|docx)$/i, "")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-${cleanSource || "document"}-${stamp}.${extension}`;
}

function createSinglePageSegments(pageCount) {
  return Array.from({ length: pageCount }, (_, index) => ({
    indexes: [index],
    label: `p${index + 1}`
  }));
}

function parsePageSegments(rawRange, pageCount) {
  const segments = rawRange
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [startRaw, endRaw] = part.split("-").map((value) => Number(value.trim()));

      if (!Number.isInteger(startRaw) || startRaw < 1) {
        throw new Error(`頁碼範圍「${part}」格式不正確。`);
      }

      const endPage = endRaw === undefined || Number.isNaN(endRaw) ? startRaw : endRaw;

      if (!Number.isInteger(endPage) || endPage < startRaw) {
        throw new Error(`頁碼範圍「${part}」格式不正確。`);
      }

      if (startRaw > pageCount || endPage > pageCount) {
        throw new Error(`頁碼範圍「${part}」超過 PDF 總頁數 ${pageCount}。`);
      }

      const indexes = [];
      for (let page = startRaw; page <= endPage; page += 1) {
        indexes.push(page - 1);
      }

      return {
        indexes,
        label: startRaw === endPage ? `p${startRaw}` : `p${startRaw}-${endPage}`
      };
    });

  if (segments.length === 0) {
    throw new Error("請輸入有效頁碼範圍，或留空逐頁分割。");
  }

  return segments;
}

function buildSplitFileName(sourceName, label) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const cleanSource = sourceName
    .replace(/\.pdf$/i, "")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `split-${cleanSource || "pdf"}-${label}-${stamp}.pdf`;
}

async function getAnnotationFont(pdf) {
  if (window.fontkit) {
    pdf.registerFontkit(window.fontkit);
    const selectedFont = getOutputFontValue();
    if (!annotationFontBytes.has(selectedFont)) {
      const response = await fetch(`/api/output-font?font=${encodeURIComponent(selectedFont)}`);
      if (!response.ok) throw new Error("無法載入輸出字體。");
      annotationFontBytes.set(selectedFont, await response.arrayBuffer());
    }
    try {
      return await pdf.embedFont(annotationFontBytes.get(selectedFont), { subset: true });
    } catch (error) {
      if (selectedFont === "hei") throw error;
      if (!annotationFontBytes.has("hei")) {
        const fallbackResponse = await fetch("/api/output-font?font=hei");
        annotationFontBytes.set("hei", await fallbackResponse.arrayBuffer());
      }
      return pdf.embedFont(annotationFontBytes.get("hei"), { subset: true });
    }
  }

  return pdf.embedFont(PDFLib.StandardFonts.Helvetica);
}

function getOutputFontValue() {
  return outputFont?.value || "hei";
}

function getOfficeFontName() {
  const fonts = {
    kai: "DFKai-SB",
    ming: "PMingLiU",
    hei: "Microsoft JhengHei"
  };
  return fonts[getOutputFontValue()] || fonts.hei;
}

function getAnnotationPageIndexes(pageCount) {
  if (annotationAllPages.checked) {
    return Array.from({ length: pageCount }, (_, index) => index);
  }

  const rangeInput = document.querySelector("#page-range").value.trim();
  if (!rangeInput) return [0];

  const indexes = new Set();
  rangeInput.split(",").forEach((part) => {
    const [startRaw, endRaw] = part.split("-").map((value) => Number(value.trim()));
    if (!Number.isInteger(startRaw)) return;
    const start = Math.max(1, startRaw);
    const end = Number.isInteger(endRaw) ? Math.min(pageCount, endRaw) : start;
    for (let page = start; page <= end; page += 1) {
      indexes.add(page - 1);
    }
  });

  return indexes.size > 0 ? [...indexes].sort((a, b) => a - b) : [0];
}

function getAnnotationPoint(position, pageWidth, pageHeight, boxWidth, boxHeight) {
  const margin = 32;
  const points = {
    "top-left": { x: margin, y: pageHeight - boxHeight - margin },
    "top-right": { x: pageWidth - boxWidth - margin, y: pageHeight - boxHeight - margin },
    center: { x: (pageWidth - boxWidth) / 2, y: (pageHeight - boxHeight) / 2 },
    "bottom-left": { x: margin, y: margin },
    "bottom-right": { x: pageWidth - boxWidth - margin, y: margin }
  };
  return points[position] || points["top-left"];
}

function wrapAnnotationText(text, maxLength) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const lines = [];
  let current = "";

  for (const char of normalized) {
    if ((current + char).length > maxLength) {
      lines.push(current);
      current = char;
    } else {
      current += char;
    }
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : ["已審閱"];
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  const number = Number.parseInt(value.length === 3 ? value.replace(/(.)/g, "$1$1") : value, 16);
  return {
    r: ((number >> 16) & 255) / 255,
    g: ((number >> 8) & 255) / 255,
    b: (number & 255) / 255
  };
}

function buildPdfFileName(prefix, sourceName = "") {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const cleanSource = sourceName
    .replace(/\.pdf$/i, "")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleanSource ? `${prefix}-${cleanSource}-${stamp}.pdf` : `${prefix}-${stamp}.pdf`;
}

function downloadPdf(bytes, fileName) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  downloadBlob(blob, fileName);
}

async function pdfBlobFromResponse(response, missingMessage) {
  if (!response.ok) {
    let detail = "";
    try {
      const data = await response.json();
      detail = data.error || data.message || "";
      if (data.detail) {
        detail = detail ? `${detail}（${data.detail}）` : data.detail;
      }
      if (data.missingDependency) {
        detail = `${detail}（缺少：${data.missingDependency}）`;
      }
    } catch (error) {
      detail = await response.text();
    }

    if (response.status === 404 || response.status === 405) {
      throw new Error(missingMessage);
    }

    throw new Error(detail || `PDF 後端服務回應 ${response.status}。`);
  }

  const blob = await response.blob();
  if (blob.size === 0) {
    throw new Error("PDF 後端服務沒有回傳有效 PDF。");
  }
  return blob;
}

async function runQueuedBackendJob(operation, formData, label) {
  formData.append("operation", operation);
  const createResponse = await fetch("/api/jobs", {
    method: "POST",
    body: formData
  });
  const createdJob = await createResponse.json().catch(() => ({}));
  if (!createResponse.ok) {
    throw new Error(createdJob.error || "建立背景任務失敗。");
  }

  let job = createdJob;
  showJobProgress(job.progress || 0, `${label}：${job.message || "已加入佇列。"}`);

  while (!["completed", "failed"].includes(job.status)) {
    await wait(900);
    const statusResponse = await fetch(`/api/jobs/${job.id}`);
    job = await statusResponse.json();
    if (!statusResponse.ok) throw new Error(job.error || "讀取任務狀態失敗。");
    showJobProgress(job.progress || 0, `${label}：${job.message || job.status}`);
  }

  if (job.status === "failed") {
    throw new Error(job.error || "背景任務失敗。");
  }

  showJobProgress(100, `${label}：任務完成，正在下載結果。`);
  const resultResponse = await fetch(job.result.url);
  return pdfBlobFromResponse(resultResponse, "背景任務完成，但找不到下載結果。");
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 300000);
  return url;
}

function addHistoryItem(detailText = "") {
  if (jobCount === 1) historyList.innerHTML = "";

  const item = document.createElement("div");
  item.className = "history-item";
  item.innerHTML = `
    <i data-lucide="check-circle-2"></i>
    <div>
      <strong>${activeTool.title}</strong>
      <span>${detailText || `${selectedFiles.length} 個檔案 · 品質 ${quality.value}%`}</span>
    </div>
    <span class="file-size">剛剛</span>
  `;
  historyList.prepend(item);
  lucide.createIcons();
}

document.addEventListener("click", (event) => {
  const fileAction = event.target.closest("[data-file-action]");
  if (fileAction) {
    const index = Number(fileAction.dataset.fileIndex);
    if (fileAction.dataset.fileAction === "up") moveFile(index, -1);
    if (fileAction.dataset.fileAction === "down") moveFile(index, 1);
    if (fileAction.dataset.fileAction === "remove") removeFile(index);
    return;
  }

  const card = event.target.closest("[data-tool]");
  if (!card) return;
  location.hash = `tool/${encodeURIComponent(card.dataset.tool)}`;
});

searchInput.addEventListener("input", () => {
  renderTools(filterTools(searchInput.value));
});

pickFiles.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => addFiles(fileInput.files));

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragging");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragging");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");
  addFiles(event.dataTransfer.files);
});

quality.addEventListener("input", () => {
  qualityValue.textContent = `${quality.value}%`;
});

wordDirection.addEventListener("change", () => {
  selectedFiles = [];
  fileInput.value = "";
  renderFiles();
  showMessage(wordDirection.value === "pdf-to-word" ? "已切換為 PDF → Word，請加入 PDF 檔案。" : "已切換為 Word → PDF，請加入 DOCX 檔案。");
});

excelDirection.addEventListener("change", () => {
  selectedFiles = [];
  fileInput.value = "";
  updateToolMode();
  renderFiles();
  showMessage(excelDirection.value === "pdf-to-excel" ? "已切換為 PDF → XLSX，請加入 PDF 檔案。" : "已切換為 XLSX → PDF，請加入原生 .xlsx 檔案。");
});

powerpointDirection.addEventListener("change", () => {
  selectedFiles = [];
  fileInput.value = "";
  updateToolMode();
  renderFiles();
  showMessage(powerpointDirection.value === "pdf-to-powerpoint" ? "已切換為 PDF → PPTX，請加入 PDF 檔案。" : "已切換為 PPTX → PDF，請加入原生 .pptx 檔案。");
});

imageDirection.addEventListener("change", () => {
  selectedFiles = [];
  fileInput.value = "";
  renderFiles();
  showMessage(imageDirection.value === "pdf-to-image" ? "已切換為 PDF → 圖像，請加入 PDF 檔案。" : "已切換為圖像 → PDF，請加入 JPG 或 PNG。");
});

accountButton.addEventListener("click", openAuthModal);
authClose.addEventListener("click", closeAuthModal);
authModal.addEventListener("click", (event) => {
  if (event.target === authModal) closeAuthModal();
});
authLoginTab.addEventListener("click", () => setAuthMode("login"));
authRegisterTab.addEventListener("click", () => setAuthMode("register"));
authForm.addEventListener("submit", submitAuthForm);
authLogout.addEventListener("click", logoutCurrentUser);
adminRefresh.addEventListener("click", loadAdminDashboard);
adminOperationTab.addEventListener("click", () => {
  adminLogType = "operation";
  adminOperationTab.classList.add("is-active");
  adminErrorTab.classList.remove("is-active");
  loadAdminDashboard();
});
adminErrorTab.addEventListener("click", () => {
  adminLogType = "error";
  adminErrorTab.classList.add("is-active");
  adminOperationTab.classList.remove("is-active");
  loadAdminDashboard();
});

signatureMode.addEventListener("change", updateSignatureMode);
signatureColor.addEventListener("input", prepareSignaturePad);
clearSignature.addEventListener("click", clearSignaturePad);
signaturePad.addEventListener("pointerdown", startSignatureDraw);
signaturePad.addEventListener("pointermove", drawSignature);
signaturePad.addEventListener("pointerup", stopSignatureDraw);
signaturePad.addEventListener("pointerleave", stopSignatureDraw);
signaturePad.addEventListener("pointercancel", stopSignatureDraw);

processButton.addEventListener("click", processFiles);
backToTools.addEventListener("click", showToolHome);
window.addEventListener("hashchange", syncRouteFromHash);

renderTools(filterTools(""));
updateSignatureMode();
initializeRequestDueDate();
updateResult();
loadCurrentUser();
syncRouteFromHash();
