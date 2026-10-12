(function (root) {
  'use strict';
  var MAX_ITEMS = 2000, CHUNK_SIZE = 100;
  function failure(message, code) { var error = new Error(message); error.code = code; return error; }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + canonical(value[key]); }).join(',') + '}';
    return JSON.stringify(value);
  }
  function plain(value) {
    return JSON.parse(JSON.stringify(value, function (_key, item) {
      if (typeof item === 'string' && /^(?:blob:|data:[^,]*,)/i.test(item)) throw failure('本機檔案連結尚未上傳，不能標示為雲端保存。', 'UNSAVED_FILE');
      if (item && typeof item === 'object') {
        if (typeof Blob !== 'undefined' && item instanceof Blob) throw failure('檔案尚未上傳，不能標示為雲端保存。', 'UNSAVED_FILE');
      }
      return item;
    }));
  }
  function create(options) {
    if (!options || typeof options.rpc !== 'function' || typeof options.identity !== 'function') throw new Error('Cloud submission requires an authenticated RPC and identity callback');
    var running = new Map();
    var timeoutMs = Math.min(60000, Math.max(1, Number(options.timeoutMs) || 30000));
    var commitTimeoutMs = Math.min(120000, Math.max(1, Number(options.commitTimeoutMs) || 90000));
    function assertIdentity(owner) {
      if (!owner || owner !== options.identity()) throw failure('登入身分已變更，請以原帳號查看雲端草稿。', 'CLIENT_IDENTITY_CHANGED');
    }
    async function call(name, args, owner) {
      assertIdentity(owner);
      var timer, response;
      try {
        response = await Promise.race([
          Promise.resolve().then(function () { return options.rpc(name, args); }),
          new Promise(function (_resolve, reject) { timer = setTimeout(function () {
            var error = failure('雲端回應逾時；原草稿與送件識別碼已保留，請查詢原筆結果。', 'CLOUD_RESULT_UNKNOWN');
            error.resultUnknown = true; error.draftId = args.p_draft_id; reject(error);
          }, name === 'finance_cloud_submission_commit_v1' ? commitTimeoutMs : timeoutMs); })
        ]);
      } finally { clearTimeout(timer); }
      assertIdentity(owner);
      if (!response || response.error) {
        var source = response && response.error;
        var error = failure(source && source.message || '雲端回應尚未確認，請保留原草稿後重試。', source && source.code || 'CLOUD_RESULT_UNKNOWN');
        throw error;
      }
      var data = response.data;
      if (!data || data.ok !== true) throw failure('雲端回執不完整，請查核原草稿。', 'CLOUD_RESULT_UNKNOWN');
      return data;
    }
    function progress(data, phase, owner) {
      assertIdentity(owner);
      if (typeof options.onProgress === 'function') options.onProgress({phase: phase, draftId: data.id, state: data.state, saved: data.stagedCount || 0, total: data.expectedCount || 0, operationKey: data.operationKey});
    }
    async function readOwned(id, environment, owner) {
      return call('finance_cloud_draft_read_v1', {p_draft_id: id, p_data_environment: environment || 'production'}, owner);
    }
    async function reconcileSave(draft, owner) {
      var payload = plain(draft.payload || {}), files = plain(draft.files || []);
      var kind = draft.kind, environment = draft.environment || draft.dataEnvironment || 'production';
      var current = await readOwned(draft.id, environment, owner);
      if (current.documentType !== kind || current.dataEnvironment !== environment
        || canonical(current.payload) !== canonical(payload)
        || canonical(current.files) !== canonical(files)
        || current.state === 'discarded') throw failure('雲端保存版本與本次完整內容不同，請重新讀取後核對，系統未覆寫。', 'PT409');
      current.reconciledSave = true;
      return current;
    }
    var api = {
      save: async function (draft) {
        var owner = options.identity(), files = plain(draft.files || []);
        files.forEach(function (file) {
          if (!file.path || file.bucket !== 'finance-attachments' || file.url || file.dataUrl) throw failure('請先完成檔案上傳；本機選檔不等於已保存。', 'UNSAVED_FILE');
        });
        var frozen = Object.assign({}, draft, {payload: plain(draft.payload || {}), files: files});
        try {
          return await call('finance_cloud_draft_save_v1', {
            p_draft_id: frozen.id, p_expected_revision: frozen.revision || 0,
            p_document_type: frozen.kind, p_payload: frozen.payload, p_files: files,
            p_data_environment: frozen.environment || 'production'
          }, owner);
        } catch (error) {
          assertIdentity(owner);
          if (error.code && !['CLOUD_RESULT_UNKNOWN','NETWORK','FETCH_ERROR','PT409','55000'].includes(error.code)) throw error;
          try { return await reconcileSave(frozen, owner); }
          catch (recoveryError) { assertIdentity(owner); if (recoveryError.code === 'PT409') throw recoveryError; throw error; }
        }
      },
      reconcileSave: function (draft) { return reconcileSave(draft, options.identity()); },
      read: function (id, environment) { return readOwned(id, environment, options.identity()); },
      list: function (environment, cursor, limit) {
        return call('finance_cloud_draft_list_v1', {
          p_data_environment: environment || 'production', p_before_time: cursor && cursor.updatedAt || null,
          p_before_id: cursor && cursor.id || null, p_limit: limit || 50
        }, options.identity());
      },
      discard: function (draft) { return call('finance_cloud_draft_discard_v1', {p_draft_id: draft.id, p_expected_revision: draft.revision, p_data_environment: draft.dataEnvironment}, options.identity()); },
      reopen: function (draft) { return call('finance_cloud_draft_reopen_v1', {p_draft_id: draft.id, p_expected_revision: draft.revision, p_data_environment: draft.dataEnvironment}, options.identity()); },
      stageAndCommit: async function (draft, suppliedItems) {
        var owner = options.identity(), identityKey = owner + '|' + draft.id;
        assertIdentity(owner);
        if (running.has(identityKey)) return running.get(identityKey);
        var task = (async function () {
          var current = await readOwned(draft.id, draft.dataEnvironment, owner);
          if (current.state === 'committed') { progress(current, 'committed', owner); return current; }
          if (current.revision !== draft.revision) throw failure('雲端草稿已在其他裝置更新，請先重新讀取。', 'PT409');
          // Frozen server content makes browser restart/device change safe.
          var savedItems = current.payload && current.payload.items;
          var items = plain(suppliedItems || savedItems || []);
          if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) throw failure('一張申請必須包含 1 到 2000 筆，請保留原草稿。', 'BATCH_LIMIT');
          if (!Array.isArray(savedItems) || canonical(plain(savedItems)) !== canonical(items)) throw failure('送件明細與雲端保存版本不同，請先儲存變更。', 'PT409');
          current = await call('finance_cloud_submission_begin_v1', {p_draft_id: draft.id, p_expected_revision: draft.revision, p_expected_count: items.length, p_data_environment: draft.dataEnvironment}, owner);
          if (current.state === 'committed') return current;
          progress(current, 'staging', owner);
          for (var start = 0; start < items.length; start += CHUNK_SIZE) {
            current = await call('finance_cloud_submission_stage_v1', {p_draft_id: draft.id, p_expected_revision: draft.revision, p_start: start, p_items: items.slice(start, start + CHUNK_SIZE), p_data_environment: draft.dataEnvironment}, owner);
            progress(current, 'staging', owner);
          }
          if (current.state !== 'ready' || !current.stagedFingerprint || current.stagedCount !== items.length) throw failure('明細尚未完整保存，沒有建立正式單據。', 'INCOMPLETE_BATCH');
          progress(current, 'committing', owner);
          try {
            current = await call('finance_cloud_submission_commit_v1', {p_draft_id: draft.id, p_expected_revision: draft.revision, p_staged_fingerprint: current.stagedFingerprint, p_data_environment: draft.dataEnvironment}, owner);
          } catch (error) {
            assertIdentity(owner);
            // A lost response is not a rollback. Query the same server draft;
            // never create a replacement UUID or invoke ordinary submit here.
            var result;
            try { result = await readOwned(draft.id, draft.dataEnvironment, owner); }
            catch (readError) { assertIdentity(owner); error.draftId = draft.id; error.resultUnknown = true; throw error; }
            if (result.state !== 'committed') { error.draftId = draft.id; error.resultUnknown = true; throw error; }
            current = result;
          }
          if (current.state !== 'committed' || !current.result || current.result.ok !== true || current.result.count !== items.length) throw failure('正式結果尚未確認，請查看原草稿。', 'CLOUD_RESULT_UNKNOWN');
          progress(current, 'committed', owner); return current;
        })();
        running.set(identityKey, task);
        try { return await task; } finally { running.delete(identityKey); }
      }
    };
    return api;
  }
  var api = {create: create, maxItems: MAX_ITEMS, chunkSize: CHUNK_SIZE};
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FinanceCloudSubmission = api;
})(typeof window === 'object' ? window : globalThis);
