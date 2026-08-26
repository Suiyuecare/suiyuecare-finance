(function (global) {
  'use strict';

  var memoryStorage = Object.create(null);
  var storageDeniedWarned = false;

  function windowRef(options) {
    return (options && options.window) || global;
  }

  function storageAvailable(options) {
    var win = windowRef(options);
    try {
      var storage = win && win.localStorage;
      if (!storage) return false;
      var key = 'module_finance_storage_test';
      storage.setItem(key, '1');
      storage.removeItem(key);
      return true;
    } catch (error) {
      if (!storageDeniedWarned) {
        if (global.console && console.warn) {
          console.warn('localStorage unavailable; using in-memory fallback for this session.', error);
        }
        storageDeniedWarned = true;
      }
      return false;
    }
  }

  function safeGetItem(key, options) {
    var win = windowRef(options);
    if (storageAvailable({ window: win })) {
      try {
        return win.localStorage.getItem(key);
      } catch (error) {}
    }
    return Object.prototype.hasOwnProperty.call(memoryStorage, key) ? memoryStorage[key] : null;
  }

  function safeSetItem(key, value, options) {
    var win = windowRef(options);
    value = String(value);
    memoryStorage[key] = value;
    if (storageAvailable({ window: win })) {
      try {
        win.localStorage.setItem(key, value);
        return true;
      } catch (error) {}
    }
    return false;
  }

  function safeRemoveItem(key, options) {
    var win = windowRef(options);
    delete memoryStorage[key];
    if (storageAvailable({ window: win })) {
      try {
        win.localStorage.removeItem(key);
        return true;
      } catch (error) {}
    }
    return false;
  }

  function safeJsonGet(key, fallback, options) {
    var raw = safeGetItem(key, options);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function safeJsonSet(key, value, options) {
    return safeSetItem(key, JSON.stringify(value), options);
  }

  function sessionSetItem(key, value, options) {
    var win = windowRef(options);
    try {
      win.sessionStorage.setItem(key, String(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function sessionGetItem(key, options) {
    var win = windowRef(options);
    try {
      return win.sessionStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function sessionRemoveItem(key, options) {
    var win = windowRef(options);
    try {
      win.sessionStorage.removeItem(key);
    } catch (error) {}
  }

  function rawErrorText(err) {
    if (!err) return '';
    if (typeof err === 'string') return err;
    var parts = [];
    if (typeof err === 'object') {
      ['message', 'details', 'hint', 'error_description', 'error', 'statusCode', 'status', 'code', 'reason', 'name'].forEach(function (key) {
        if (err[key] != null && String(err[key]).trim()) parts.push(key + ': ' + String(err[key]));
      });
      if (err.sourceError) parts.push(rawErrorText(err.sourceError));
    }
    if (!parts.length) {
      try {
        parts.push(JSON.stringify(err));
      } catch (error) {
        parts.push(String(err));
      }
    }
    return parts.filter(Boolean).join('；');
  }

  function friendlyErrorMessage(err, opts) {
    opts = opts || {};
    var area = opts.area || '';
    var action = opts.action || '這個動作';
    var raw = rawErrorText(err);
    var lower = raw.toLowerCase();
    var reason = String((err && err.reason) || '').toLowerCase();
    var batchLimitMatch = raw.match(/每次批次送出必須包含\s*1\s*到\s*(\d+)\s*筆/);

    if (batchLimitMatch) {
      return '這批資料超過正式系統單次上限 ' + batchLimitMatch[1] + ' 筆，整批尚未送出。請把檔案拆成每批最多 ' + batchLimitMatch[1] + ' 筆後再試。';
    }
    if (reason === 'auth_email_mismatch' || lower.indexOf('auth_email_mismatch') > -1) {
      return '目前登入的 Google 帳號與 Finance 使用者不一致。請登出後，用同一個公司 Google 帳號重新登入。';
    }
    if (lower.indexOf('申請人資料必須與目前登入身分完全一致') > -1 || lower.indexOf('送單必須由目前申請人完成第一關送出') > -1) {
      return '這張申請的送件人與目前 Google 登入帳號不一致，系統已在建立申請單前停止。請重新整理；若仍發生，請登出後用自己的公司 Google 帳號重新登入。';
    }
    if (reason === 'missing_auth_session' || lower.indexOf('jwt') > -1 || lower.indexOf('not authenticated') > -1 || lower.indexOf('unauthorized') > -1 || lower.indexOf('auth session') > -1) {
      return '登入狀態已過期或尚未完成正式登入。請回入口網或使用公司 Google 帳號重新登入後再試。';
    }
    if (reason === 'demo_or_unconfigured' || reason === 'remote_storage_required' || lower.indexOf('尚未初始化') > -1 || lower.indexOf('missing supabase') > -1 || lower.indexOf('缺少 supabase') > -1) {
      return '正式系統連線尚未完成，系統已停止這次操作以避免資料只留在本機。請重新整理後再試；若仍發生，請通知系統管理員。';
    }
    if (/offboarding[_ -]?preview[_ -]?stale|stale[_ -]?revision|revision[_ -]?mismatch/.test(lower)) {
      return '待簽單或主管關係剛剛已有變動。系統會重新檢查最新影響範圍；請再次確認接手人並重新勾選後再執行。';
    }
    if (/cannot[_ -]?offboard[_ -]?self|offboarding[_ -]?self/.test(lower)) {
      return '不能停用目前登入中的自己。請由另一位執行長、行政部門主任或人資執行離職交接。';
    }
    if (/ceo[_ -]?handoff[_ -]?required|offboarding[_ -]?ceo/.test(lower)) {
      return '執行長必須改走專用的「執行長交接」程序，不能從一般離職交接直接停用。';
    }
    if (/hr[_ -]?control[_ -]?role[_ -]?requires[_ -]?executive/.test(lower)) {
      return '人資不能停用會計／出納等控制角色，請由執行長或行政部門主任執行。';
    }
    if (/successor[_ -]?required|offboarding[_ -]?successor[_ -]?required/.test(lower)) {
      return '這位人員仍有待簽單或主管關係，必須先選擇符合資格的接手人。';
    }
    if (/successor[_ -]?not[_ -]?eligible|offboarding[_ -]?successor[_ -]?ineligible/.test(lower)) {
      return '所選接手人目前不具備完整簽核資格。請先完成其登入、簽核權限及主管設定，或改選其他人。';
    }
    if (/reason[_ -]?too[_ -]?short|offboarding[_ -]?reason/.test(lower)) {
      return '請填寫至少 3 個字的離職／交接原因後再執行。';
    }
    if (lower.indexOf('退回、不通過、加簽或抽單必須填寫原因') > -1 || lower.indexOf('退回、不通過或加簽必須填寫原因') > -1 || lower.indexOf('add_sign_reason_required') > -1 || lower.indexOf('add sign reason') > -1) {
      return '已選擇加簽人，請在「加簽原因」填寫說明後再送出。這張單目前沒有被修改。';
    }
    if (lower.indexOf('申請人不可成為自己的加簽人') > -1 || lower.indexOf('不可加簽自己') > -1 || lower.indexOf('countersign_applicant_forbidden') > -1) {
      return '不能選擇自己或這張單的申請人作為加簽人。請改選其他已完成登入綁定的人員；這張單目前沒有被修改。';
    }
    if (/(指定的)?加簽人.*(登入綁定|已停用|不存在)/.test(raw) || lower.indexOf('pending_assignee_not_login_ready') > -1) {
      return '所選加簽人尚未完成登入綁定、已停用或已不在人員清單。請重新整理後改選其他人員；這張單目前沒有被修改。';
    }
    if (lower.indexOf('目前人員權限不允許新增加簽') > -1 || lower.indexOf('approval.add_sign') > -1) {
      return '目前帳號沒有新增加簽的權限。這張單目前沒有被修改；請主管或人資確認權限設定。';
    }
    if (lower.indexOf('目前角色或動作不可修訂申請單會計明細') > -1) {
      return '目前簽核關卡只允許處理核准，不允許同時修改會計明細。請重新整理後再試；若仍發生，請通知系統管理員檢查前台簽核資料。';
    }
    if (lower.indexOf('row-level security') > -1 || lower.indexOf('permission denied') > -1 || lower.indexOf('rls') > -1 || lower.indexOf('42501') > -1) {
      return '目前帳號沒有權限完成這個動作。請確認是否輪到你處理這張單，或請主管／人資確認帳號角色與簽核設定。';
    }
    if (lower.indexOf('schema cache') > -1 || lower.indexOf('could not find') > -1 || lower.indexOf('column') > -1 || lower.indexOf('relation') > -1 || lower.indexOf('function') > -1 || lower.indexOf('rpc') > -1) {
      return '系統後台設定尚未同步完成，這筆資料尚未送出或更新。請重新整理後再試；若仍失敗，請把畫面截圖給系統管理員。';
    }
    if (lower.indexOf('invalid key') > -1 || reason === 'unsafe_storage_environment') {
      return '附件檔名或路徑含有系統不接受的字元。請重新選擇檔案後再上傳；若仍失敗，請先把檔名改成中文、英文或數字。';
    }
    if (lower.indexOf('mime') > -1 || lower.indexOf('not allowed') > -1 || lower.indexOf('unsupported') > -1) {
      return '這個附件格式目前不支援。請改傳 PDF、JPG、PNG、Excel、Word 或 CSV 後再試。';
    }
    if (lower.indexOf('payload too large') > -1 || lower.indexOf('file_size') > -1 || lower.indexOf('too large') > -1) {
      return '附件檔案太大，單一附件上限為 50MB。請壓縮檔案或拆成多個附件後再上傳。';
    }
    if (lower.indexOf('bucket') > -1 || lower.indexOf('signed url') > -1 || lower.indexOf('下載連結') > -1 || reason === 'signed_url_failed') {
      return area === 'attachment-download'
        ? '附件已留有紀錄，但目前無法產生下載連結。請重新整理後再試；若仍失敗，請通知申請人重新上傳或請管理員檢查附件保存權限。'
        : '附件保存區目前無法完成上傳後驗證，系統已停止送單。請重新整理後再試；若仍失敗，請把附件名稱與畫面截圖給管理員。';
    }
    if (lower.indexOf('object not found') > -1 || (lower.indexOf('not found') > -1 && area.indexOf('attachment') > -1)) {
      return '附件原檔不存在，或送單時尚未完成正式綁定。請目前簽核人退回上一關並註明重新上傳附件；申請人補傳後再重新送出。';
    }
    if (lower.indexOf('duplicate key') > -1 || lower.indexOf('already exists') > -1 || lower.indexOf('撞號') > -1) {
      return '系統偵測到單號或資料重複，已停止這次操作。請重新整理頁面後再送一次。';
    }
    if (lower.indexOf('failed to fetch') > -1 || lower.indexOf('network') > -1 || lower.indexOf('timeout') > -1 || lower.indexOf('逾時') > -1) {
      return '網路或系統連線逾時，這次操作尚未完成。請確認網路後重新整理，再試一次。';
    }
    return opts.fallback || action + '暫時無法完成。請重新整理後再試；若仍失敗，請把畫面截圖給系統管理員。';
  }

  function formatStorageUploadError(err) {
    return friendlyErrorMessage(err, { area: 'attachment-upload', action: '附件上傳' });
  }

  function isSchemaCacheMiss(message) {
    var text = String(message || '').toLowerCase();
    return text.indexOf('schema cache') > -1 || text.indexOf('column') > -1 || text.indexOf('could not find') > -1;
  }

  function remoteTableMissing(err) {
    return isSchemaCacheMiss(err && err.message ? err.message : err);
  }

  function isRpcMissing(err) {
    var msg = String((err && err.message) || err || '').toLowerCase();
    return msg.indexOf('schema cache') > -1 || msg.indexOf('could not find') > -1 || (msg.indexOf('function') > -1 && msg.indexOf('not found') > -1) || msg.indexOf('404') > -1;
  }

  function isTransientRemoteReadError(err, options) {
    options = options || {};
    var text = typeof options.healthErrorMessage === 'function' ? options.healthErrorMessage(err) : String((err && err.message) || err || '');
    var p1 = typeof options.p1TransientHealthErrorText === 'function' && options.p1TransientHealthErrorText(text);
    return !!p1 || /statement timeout|canceling statement|timed out|timeout|fetch failed|failed to fetch|gateway timeout|service unavailable/i.test(text);
  }

  function applyRemoteLimit(query, count) {
    count = Number(count || 0);
    return count > 0 && query && typeof query.limit === 'function' ? query.limit(count) : query;
  }

  async function loadOptionalTable(client, table, orderCol, ascending, options) {
    options = options || {};
    var limit = options.limit || 0;
    var logger = options.logger || (global.console || {});
    var q = client.from(table).select('*');
    if (orderCol) q = q.order(orderCol, { ascending: ascending !== false });
    q = applyRemoteLimit(q, limit);
    var result = await q;
    if (result.error && remoteTableMissing(result.error)) {
      if (logger.warn) logger.warn('Optional Supabase table not installed:', table);
      return [];
    }
    if (result.error && isTransientRemoteReadError(result.error, options)) {
      if (logger.warn) logger.warn('Optional Supabase table timed out:', table, result.error.message || result.error);
      return [];
    }
    if (result.error) throw result.error;
    return result.data || [];
  }

  async function loadOptionalRpc(client, name, args, options) {
    options = options || {};
    var logger = options.logger || (global.console || {});
    var result = await client.rpc(name, args || {});
    if (result.error && isRpcMissing(result.error)) {
      if (logger.warn) logger.warn('Optional Supabase RPC not installed:', name);
      return [];
    }
    if (result.error) {
      if (logger.warn) logger.warn('Optional Supabase RPC failed:', name, result.error.message);
      return [];
    }
    return result.data || [];
  }

  var api = {
    storageAvailable: storageAvailable,
    safeGetItem: safeGetItem,
    safeSetItem: safeSetItem,
    safeRemoveItem: safeRemoveItem,
    safeJsonGet: safeJsonGet,
    safeJsonSet: safeJsonSet,
    sessionSetItem: sessionSetItem,
    sessionGetItem: sessionGetItem,
    sessionRemoveItem: sessionRemoveItem,
    rawErrorText: rawErrorText,
    friendlyErrorMessage: friendlyErrorMessage,
    formatStorageUploadError: formatStorageUploadError,
    isSchemaCacheMiss: isSchemaCacheMiss,
    remoteTableMissing: remoteTableMissing,
    isRpcMissing: isRpcMissing,
    isTransientRemoteReadError: isTransientRemoteReadError,
    applyRemoteLimit: applyRemoteLimit,
    loadOptionalTable: loadOptionalTable,
    loadOptionalRpc: loadOptionalRpc,
  };

  global.FinanceV4Engines.register('data', api);
  global.FinanceDataEngine = api;
})(window);
