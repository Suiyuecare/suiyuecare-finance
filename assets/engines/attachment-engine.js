(function (global) {
  'use strict';

  var DEFAULT_BUCKET = 'finance-attachments';
  var DEFAULT_RECORD_TYPES = ['draft_requests', 'expense_requests', 'invoices', 'bills', 'vouchers'];
  var DEFAULT_MIME_ALLOW = {
    'image/jpeg': true,
    'image/jpg': true,
    'image/pjpeg': true,
    'image/png': true,
    'image/webp': true,
    'image/heic': true,
    'image/heif': true,
    'image/gif': true,
    'application/pdf': true,
    'application/msword': true,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
    'application/vnd.ms-excel': true,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true,
    'application/octet-stream': true,
    'text/csv': true,
    'text/html': true,
    'text/plain': true,
  };
  var DEFAULT_EXT_ALLOW = {
    jpg: true,
    jpeg: true,
    png: true,
    webp: true,
    heic: true,
    heif: true,
    gif: true,
    pdf: true,
    doc: true,
    docx: true,
    xls: true,
    xlsx: true,
    csv: true,
    html: true,
    txt: true,
  };

  function fileExtension(name) {
    var value = String(name || '').split('?')[0].split('#')[0];
    var dot = value.lastIndexOf('.');
    return dot > -1 ? value.slice(dot + 1).toLowerCase() : '';
  }

  function normalizeList(files) {
    if (!files) return [];
    if (Array.isArray(files)) return files.filter(Boolean);
    return [files].filter(Boolean);
  }

  function coerceMoney(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number') return isFinite(value) ? value : 0;
    var text = String(value).replace(/,/g, '').trim();
    var parsed = Number(text);
    return isFinite(parsed) ? parsed : 0;
  }

  function optionValue(options, key, row, fallback) {
    options = options || {};
    var value = options[key];
    if (typeof value === 'function') return value(row);
    if (value != null && value !== '') return value;
    return fallback;
  }

  function fileDisplayName(file) {
    if (!file) return '';
    if (typeof file === 'string') return file;
    return file.n || file.name || file.file_name || file.path || file.storagePath || file.storage_path || file.url || '';
  }

  function normalizeFileMeta(file, options) {
    options = options || {};
    if (!file) return { n: '附件', t: 'file', url: '' };
    if (typeof file === 'string') {
      return {
        n: file.split('/').pop() || '附件',
        t: fileExtension(file) || 'file',
        url: file,
      };
    }
    var name = file.n || file.name || file.file_name || '附件';
    return {
      n: name,
      t: (file.t || file.type_ext || fileExtension(file.n || file.name || file.file_name || '') || 'file').toLowerCase(),
      mime: file.mime || file.file_type || file.type || '',
      size: coerceMoney(file.size),
      url: file.url || file.file_url || file.dataUrl || file.data_url || '',
      bucket: file.bucket || file.storage_bucket || options.defaultBucket || DEFAULT_BUCKET,
      path: file.path || file.storagePath || file.storage_path || '',
      uploadedAt: file.uploadedAt || file.uploaded_at || '',
      kind: file.kind || file.category || file.file_kind || '',
      archivePath: file.archivePath || file.archive_path || file.path || file.storagePath || file.storage_path || '',
      archiveYear: file.archiveYear || file.archive_year || '',
      archiveMonth: file.archiveMonth || file.archive_month || '',
      entityId: file.entityId || file.entity_id || '',
      departmentCode: file.departmentCode || file.department_code || '',
      recordDate: file.recordDate || file.record_date || '',
      retentionUntil: file.retentionUntil || file.retention_until || '',
      dataEnv: file.dataEnv || file.data_environment || optionValue(options, 'dataEnvironment', file, 'production'),
      tenantId: optionValue(options, 'tenantId', file, ''),
      sourceCount: coerceMoney(file.sourceCount || file.source_count),
      pageCount: coerceMoney(file.pageCount || file.page_count),
      promotedFromPath: file.promotedFromPath || file.promoted_from_path || '',
    };
  }

  function normalizeFiles(files, options) {
    return normalizeList(files).map(function (file) {
      return normalizeFileMeta(file, options);
    });
  }

  function uniqueFiles(files, options) {
    var seen = Object.create(null);
    var out = [];
    normalizeList(files).forEach(function (file, index) {
      var meta = normalizeFileMeta(file, options);
      var path = meta.path || meta.archivePath || '';
      var directId =
        (file && typeof file === 'object' &&
          (file.id || file.attachmentId || file.attachment_id || file.fileId || file.file_id)) ||
        '';
      var url = String(meta.url || '');
      if (url && !/^data:/i.test(url)) url = url.split('?')[0].split('#')[0];
      var key = path
        ? 'storage:' + String(meta.bucket || (options && options.defaultBucket) || DEFAULT_BUCKET) + ':' + path
        : directId
          ? 'id:' + directId
          : url
            ? 'url:' + url
            : 'unkeyed:' + index;
      if (seen[key]) return;
      seen[key] = true;
      out.push(meta);
    });
    return out;
  }

  function isSpreadsheet(file) {
    var ext = fileExtension(fileDisplayName(file));
    var mime = String((file && (file.mime || file.type || file.file_type)) || '').toLowerCase();
    return ['xls', 'xlsx', 'csv'].indexOf(ext) > -1 || /spreadsheet|excel|csv/.test(mime);
  }

  function isImageFile(file) {
    var mime = String((file && (file.mime || file.type || file.file_type)) || '').toLowerCase();
    var ext = fileExtension(fileDisplayName(file));
    return /^image\//.test(mime) || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'bmp'].indexOf(ext) > -1;
  }

  function mimeAllowed(file, blob, allowedMime, allowedExt) {
    allowedMime = allowedMime || DEFAULT_MIME_ALLOW;
    allowedExt = allowedExt || DEFAULT_EXT_ALLOW;
    var meta = normalizeFileMeta(file);
    var name = meta.n || (file && file.name) || '附件';
    var ext = fileExtension(name);
    var mime = String((blob && blob.type) || meta.mime || (file && file.type) || '').toLowerCase();
    if (mime && allowedMime[mime]) return true;
    if (mime === 'application/octet-stream' && allowedExt[ext]) return true;
    if (!mime && allowedExt[ext]) return true;
    return false;
  }

  function storagePath(file, options) {
    var meta = normalizeFileMeta(file, options);
    return meta.path || (file && (file.storagePath || file.storage_path)) || '';
  }

  function needsRemoteUpload(file, options) {
    var meta = normalizeFileMeta(file, options);
    return !!(meta && meta.url && /^data:/i.test(meta.url) && !storagePath(meta, options));
  }

  function pathParts(file) {
    var path = String(
      (file && file.path) ||
        (file && file.storagePath) ||
        (file && file.storage_path) ||
        (file && file.archivePath) ||
        ''
    );
    return path ? path.split('/').filter(Boolean) : [];
  }

  function isRecordType(type, options) {
    var recordTypes = (options && options.recordTypes) || DEFAULT_RECORD_TYPES;
    return recordTypes.indexOf(String(type || '')) > -1;
  }

  function recordNoFromPath(file, options) {
    options = options || {};
    var p = pathParts(file);
    var productionEnv = options.productionEnv || 'production';
    var testEnv = options.testEnv || 'test';
    if (p.length >= 9 && isRecordType(p[1], options) && [productionEnv, testEnv].indexOf(p[2]) > -1) return p[7];
    if (p.length >= 8 && (p[1] === productionEnv || p[1] === testEnv)) return p[6];
    if (p.length >= 7) return p[5];
    if (p.length >= 4) return p[2];
    return '';
  }

  function recordTypeFromPath(file, options) {
    var p = pathParts(file);
    if (isRecordType(p[0], options)) return p[0] || '';
    if (isRecordType(p[1], options)) return p[1] || '';
    return p[0] || '';
  }

  function fileIdentity(file, options) {
    var meta = normalizeFileMeta(file, options);
    return [meta.path || meta.archivePath || '', meta.url || '', meta.n || '', meta.size || ''].join('|');
  }

  function inList(file, list, options) {
    var key = fileIdentity(file, options);
    return normalizeFiles(list || [], options).some(function (item) {
      return fileIdentity(item, options) === key;
    });
  }

  function looksPdf(file, options) {
    var meta = normalizeFileMeta(file, options);
    return fileExtension(meta.n || fileDisplayName(file)) === 'pdf' || /pdf/i.test(meta.mime || '') || /^data:application\/pdf/i.test(meta.url || '');
  }

  function looksImage(file, options) {
    var meta = normalizeFileMeta(file, options);
    return (
      /^image\//i.test(meta.mime || '') ||
      /^data:image\//i.test(meta.url || '') ||
      ['jpg', 'jpeg', 'png', 'webp', 'heic'].indexOf(fileExtension(meta.n || fileDisplayName(file))) > -1
    );
  }

  var api = {
    fileExtension: fileExtension,
    normalizeList: normalizeList,
    normalizeFileMeta: normalizeFileMeta,
    normalizeFiles: normalizeFiles,
    uniqueFiles: uniqueFiles,
    isSpreadsheet: isSpreadsheet,
    isImageFile: isImageFile,
    mimeAllowed: mimeAllowed,
    storagePath: storagePath,
    needsRemoteUpload: needsRemoteUpload,
    pathParts: pathParts,
    recordNoFromPath: recordNoFromPath,
    recordTypeFromPath: recordTypeFromPath,
    fileIdentity: fileIdentity,
    inList: inList,
    looksPdf: looksPdf,
    looksImage: looksImage,
  };

  global.FinanceV4Engines.register('attachments', api);
  global.FinanceAttachmentEngine = api;
})(window);
