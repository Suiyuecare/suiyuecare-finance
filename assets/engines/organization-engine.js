(function (global) {
  'use strict';

  function normalizeDepartmentCode(code) {
    return String(code || '').trim().toUpperCase();
  }

  function departmentSeries(code) {
    return normalizeDepartmentCode(code).charAt(0) || '';
  }

  function sameSeries(a, b) {
    var left = departmentSeries(a);
    return !!left && left === departmentSeries(b);
  }

  function pick(row, keys) {
    row = row || {};
    keys = Array.isArray(keys) ? keys : [];
    for (var i = 0; i < keys.length; i += 1) {
      var value = row[keys[i]];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return String(value).trim();
      }
    }
    return '';
  }

  function booleanValue(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (value === true || value === false) return value;
    var normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 't', 'yes', 'y', 'on', '啟用', '可', '是'].indexOf(normalized) > -1) return true;
    if (['0', 'false', 'f', 'no', 'n', 'off', '停用', '不可', '否'].indexOf(normalized) > -1) return false;
    return fallback;
  }

  function normalizeSettingValue(value) {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (error) {
        return value;
      }
    }
    return value;
  }

  function refKeys(prefix, type) {
    var key = String(prefix || 'user');
    if (type === 'id') {
      if (key === 'supervisor') return ['supervisorId', 'supervisor_id', 'supervisorFinanceUserId', 'supervisor_finance_user_id', 'directSupervisorId', 'direct_supervisor_id', 'directSupervisorFinanceUserId', 'direct_supervisor_finance_user_id'];
      if (key === 'delegate') return ['approvalDelegateId', 'approval_delegate_id', 'approvalDelegateFinanceUserId', 'approval_delegate_finance_user_id', 'delegateId', 'delegate_id', 'delegateFinanceUserId', 'delegate_finance_user_id'];
      return ['userId', 'user_id', 'financeUserId', 'finance_user_id', 'employeeFinanceUserId', 'employee_finance_user_id', 'employeeId', 'employee_id'];
    }
    if (type === 'email') {
      if (key === 'supervisor') return ['supervisorEmail', 'supervisor_email', 'directSupervisorEmail', 'direct_supervisor_email'];
      if (key === 'delegate') return ['delegateEmail', 'delegate_email', 'approvalDelegateEmail', 'approval_delegate_email'];
      return ['userEmail', 'user_email', 'email', 'employeeEmail', 'employee_email', 'financeUserEmail', 'finance_user_email'];
    }
    if (type === 'name') {
      if (key === 'supervisor') return ['supervisorName', 'supervisor_name', 'directSupervisorName', 'direct_supervisor_name'];
      if (key === 'delegate') return ['delegateName', 'delegate_name', 'approvalDelegateName', 'approval_delegate_name'];
      return ['userName', 'user_name', 'name', 'employeeName', 'employee_name', 'financeUserName', 'finance_user_name'];
    }
    if (key === 'supervisor') return ['supervisorRole', 'supervisor_role', 'directSupervisorRole', 'direct_supervisor_role'];
    if (key === 'delegate') return ['delegateRole', 'delegate_role', 'approvalDelegateRole', 'approval_delegate_role'];
    return ['userRole', 'user_role', 'role', 'roleKey', 'role_key', 'employeeRole', 'employee_role'];
  }

  function userRef(row, prefix, options) {
    row = row || {};
    options = options || {};
    var ref = {
      id: pick(row, refKeys(prefix, 'id')),
      email: pick(row, refKeys(prefix, 'email')),
      name: pick(row, refKeys(prefix, 'name')),
      role: pick(row, refKeys(prefix, 'role')),
    };
    if (typeof options.resolveUser === 'function') {
      var resolved = options.resolveUser(ref.id, ref.email, ref.name, ref.role);
      if (resolved) {
        ref.id = resolved.id || ref.id;
        ref.email = resolved.email || ref.email;
        ref.name = resolved.n || resolved.name || ref.name;
        ref.role = resolved.role || ref.role;
      }
    }
    return ref;
  }

  function normalizeRows(data, options) {
    data = normalizeSettingValue(data);
    if (data && Array.isArray(data.rows)) data = data.rows;
    if (!Array.isArray(data)) return [];

    var byKey = {};
    data.forEach(function (raw) {
      var row = normalizeSettingValue(raw) || {};
      if (row.active === false || row.is_active === false) return;

      var user = userRef(row, 'user', options);
      if (!user.id && !user.email && !user.name) return;

      var supervisor = userRef(row, 'supervisor', options);
      if (supervisor.id && user.id && supervisor.id === user.id) {
        supervisor = { id: '', email: '', name: '', role: '' };
      }

      var delegate = userRef(row, 'delegate', options);
      if (delegate.id && user.id && delegate.id === user.id) {
        delegate = { id: '', email: '', name: '', role: '' };
      }

      var isManager = booleanValue(
        row.isDepartmentManager !== undefined ? row.isDepartmentManager : row.is_department_manager !== undefined ? row.is_department_manager : row.departmentManager,
        false
      );
      var isDirector = booleanValue(
        row.isDepartmentDirector !== undefined ? row.isDepartmentDirector : row.is_department_director !== undefined ? row.is_department_director : row.departmentDirector,
        false
      );
      var canApprove = booleanValue(
        row.canApprove !== undefined ? row.canApprove : row.can_approve !== undefined ? row.can_approve : row.approvalEnabled !== undefined ? row.approvalEnabled : row.approval_enabled,
        true
      );

      var normalized = {
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        userRole: user.role,
        supervisorId: supervisor.id,
        supervisorEmail: supervisor.email,
        supervisorName: supervisor.name,
        supervisorRole: supervisor.role,
        effectiveSupervisorId: pick(row, ['effectiveSupervisorId', 'effective_supervisor_id', 'routingSupervisorId', 'routing_supervisor_id']),
        effectiveSupervisorEmail: pick(row, ['effectiveSupervisorEmail', 'effective_supervisor_email', 'routingSupervisorEmail', 'routing_supervisor_email']),
        effectiveSupervisorName: pick(row, ['effectiveSupervisorName', 'effective_supervisor_name', 'routingSupervisorName', 'routing_supervisor_name']),
        effectiveSupervisorRole: pick(row, ['effectiveSupervisorRole', 'effective_supervisor_role', 'routingSupervisorRole', 'routing_supervisor_role']),
        routingSupervisorId: pick(row, ['routingSupervisorId', 'routing_supervisor_id', 'effectiveSupervisorId', 'effective_supervisor_id']),
        routingSupervisorEmail: pick(row, ['routingSupervisorEmail', 'routing_supervisor_email', 'effectiveSupervisorEmail', 'effective_supervisor_email']),
        routingSupervisorName: pick(row, ['routingSupervisorName', 'routing_supervisor_name', 'effectiveSupervisorName', 'effective_supervisor_name']),
        routingSupervisorRole: pick(row, ['routingSupervisorRole', 'routing_supervisor_role', 'effectiveSupervisorRole', 'effective_supervisor_role']),
        supervisorPendingLogin: booleanValue(row.supervisorPendingLogin !== undefined ? row.supervisorPendingLogin : row.supervisor_pending_login, false),
        supervisorPendingActivation: booleanValue(row.supervisorPendingActivation !== undefined ? row.supervisorPendingActivation : row.supervisor_pending_activation, false),
        supervisorCanSign: booleanValue(row.supervisorCanSign !== undefined ? row.supervisorCanSign : row.supervisor_can_sign, false),
        canApprove: canApprove,
        isDepartmentManager: isManager,
        is_department_manager: isManager,
        isDepartmentDirector: isDirector,
        is_department_director: isDirector,
        approvalDelegateId: delegate.id,
        approval_delegate_finance_user_id: delegate.id,
        delegateId: delegate.id,
        delegateEmail: delegate.email,
        delegateName: delegate.name,
        delegateRole: delegate.role,
        departmentCode: pick(row, ['departmentCode', 'department_code', 'dc']),
        entityId: pick(row, ['entityId', 'entity_id', 'eid']),
        positionId: pick(row, ['positionId', 'position_id']),
        roleId: pick(row, ['roleId', 'role_id', 'employeeRoleId', 'employee_role_id']),
        source: pick(row, ['source', 'canonicalSource', 'canonical_source']) || 'organization_chart',
      };
      var key = normalized.userId || (normalized.userEmail ? 'email:' + normalized.userEmail.toLowerCase() : '') || (normalized.userName ? 'name:' + normalized.userName : '');
      if (!key) return;
      byKey[key] = normalized;
    });

    return Object.keys(byKey).map(function (key) {
      return byKey[key];
    });
  }

  function normalizeRuntimeRows(data, options) {
    data = normalizeSettingValue(data);
    if (data && Array.isArray(data.rows)) data = data.rows;
    if (!Array.isArray(data)) return null;
    return normalizeRows(data, options);
  }

  function normalizeAdminList(data) {
    data = normalizeSettingValue(data);
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  }

  function normalizeAdminHealth(data) {
    data = Array.isArray(data) ? data[0] || null : data;
    data = normalizeSettingValue(data);
    return data && typeof data === 'object' ? data : null;
  }

  function htmlEscape(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function callOption(options, key, fallback) {
    return options && typeof options[key] === 'function' ? options[key] : fallback;
  }

  function toNumber(value) {
    if (value === undefined || value === null || value === '') return 0;
    var number = Number(String(value).replace(/,/g, ''));
    return isFinite(number) ? number : 0;
  }

  function activeCount(rows, predicate) {
    rows = Array.isArray(rows) ? rows : [];
    return rows.filter(function (row) {
      row = row || {};
      if (row.active === false) return false;
      return typeof predicate === 'function' ? predicate(row) : true;
    }).length;
  }

  function orgAdminRuntimeStatus(runtime, context) {
    runtime = runtime || {};
    context = context || {};
    var health = runtime.health || {};
    var frontHealth = runtime.frontOfficeHealth || {};

    if (runtime.available === false) {
      return {
        status: 'warn',
        label: '組織與簽核資料尚未啟用',
        detail: '目前只能讀取備援資料。請聯絡系統管理者完成系統更新，再按「重新檢查」。',
      };
    }
    if (runtime.error) {
      return { status: 'warn', label: '組織與簽核資料讀取失敗', detail: '請確認網路連線後按「重新檢查」；若仍失敗，請截圖並聯絡系統管理者。' };
    }
    if (runtime.available !== true) {
      return {
        status: 'skip',
        label: '尚未完成讀取',
        detail: '系統正在讀取組織與簽核資料，請稍候後按「重新檢查」。',
      };
    }

    var localDept = activeCount(context.localDepartments);
    var localUsers = activeCount(context.localUsers);
    var remoteDept = activeCount(runtime.departments);
    var remoteRoles = activeCount(runtime.employeeRoles, function (row) {
      return row.is_primary !== false;
    });
    var drift = [];

    if (remoteDept !== localDept) drift.push('畫面部門 ' + localDept + ' 筆、簽核資料部門 ' + remoteDept + ' 筆');
    if (remoteRoles !== localUsers) drift.push('啟用人員 ' + localUsers + ' 位、主要簽核權限 ' + remoteRoles + ' 位');
    if (toNumber(health.missing_primary_role_count)) drift.push('缺主要角色 ' + toNumber(health.missing_primary_role_count) + ' 位');
    if (toNumber(health.role_without_department_count)) drift.push('角色部門異常 ' + toNumber(health.role_without_department_count) + ' 筆');
    if (toNumber(health.manager_without_role_count)) drift.push('主管/主任角色未對齊 ' + toNumber(health.manager_without_role_count) + ' 筆');
    if (toNumber(frontHealth.role_mismatch_count)) drift.push('系統權限未同步 ' + toNumber(frontHealth.role_mismatch_count) + ' 位');
    if (toNumber(frontHealth.department_mismatch_count)) drift.push('人員部門未同步 ' + toNumber(frontHealth.department_mismatch_count) + ' 位');
    if (toNumber(frontHealth.tenant_member_mismatch_count)) drift.push('登入鏡像未同步 ' + toNumber(frontHealth.tenant_member_mismatch_count) + ' 位');
    if (runtime.frontOfficeHealthError) drift.push('人員與簽核權限尚未完成檢查');

    if (health.ok === false || drift.length) {
      return {
        status: 'warn',
        label: '組織與簽核資料需要確認',
        detail: (drift.join('；') || '組織與簽核資料不一致。') + ' 請先重新同步；若仍異常，請依人員健康檢查名單逐一修正。',
      };
    }
    return {
      status: 'ok',
      label: '組織與簽核資料已同步',
      detail: '部門、人員主要權限與簽核關係目前一致，新送出的表單可正常引用。',
    };
  }

  function orgAdminRuntimeStatusHtml(runtime, state, options) {
    runtime = runtime || {};
    options = options || {};
    state = state || orgAdminRuntimeStatus(runtime, options);

    var escape = callOption(options, 'escape', htmlEscape);
    var healthBadgeClass = callOption(options, 'healthBadgeClass', function () { return 'b-gray'; });
    var refreshAction = options.refreshAction || 'refreshApprovalOrgAdminRuntime(null,&quot;manual&quot;)';
    var last = runtime.lastLoaded ? String(runtime.lastLoaded).slice(11, 19) : '尚未讀取';
    var deptCount = Array.isArray(runtime.departments) ? runtime.departments.length : 0;
    var roleCount = Array.isArray(runtime.employeeRoles) ? runtime.employeeRoles.length : 0;
    var posCount = Array.isArray(runtime.positions) ? runtime.positions.length : 0;
    var frontHealth = runtime.frontOfficeHealth || {};
    var frontSummary = frontHealth && frontHealth.checked_at
      ? ' · 人員權限 ' + (frontHealth.ok ? '已連動' : '需確認') + '（角色差異 ' + toNumber(frontHealth.role_mismatch_count) + '、部門差異 ' + toNumber(frontHealth.department_mismatch_count) + '、登入鏡像差異 ' + toNumber(frontHealth.tenant_member_mismatch_count) + '）'
      : (runtime.frontOfficeHealthError ? ' · 人員與簽核權限尚未完成檢查' : '');

    return '<div class="card" style="margin-bottom:10px;border-color:#efd7b8;background:#fffaf3">'
      + '<div style="padding:10px 12px;display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">'
      + '<div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><strong style="font-size:12px;color:#334155">組織與簽核資料狀態</strong><span class="badge ' + escape(healthBadgeClass(state.status)) + '">' + escape(state.label) + '</span></div>'
      + '<div style="font-size:11px;color:#64748b;line-height:1.6;margin-top:4px">' + escape(state.detail || '') + '</div>'
      + '<div style="font-size:10px;color:#94a3b8;margin-top:4px">已讀取部門 ' + deptCount + ' 筆 · 職位 ' + posCount + ' 筆 · 人員主要權限 ' + roleCount + ' 筆' + escape(frontSummary) + ' · 最後檢查 ' + escape(last) + '</div></div>'
      + '<button type="button" class="btn-g" style="font-size:10px;padding:4px 9px" onclick="' + refreshAction + '">重新檢查</button>'
      + '</div></div>';
  }

  function normalizeVersionedGraph(data) {
    data = normalizeSettingValue(data) || {};
    var units = Array.isArray(data.units) ? data.units : [];
    var assignments = Array.isArray(data.assignments) ? data.assignments : [];
    var entities = Array.isArray(data.legal_entities)
      ? data.legal_entities
      : Array.isArray(data.legalEntities)
        ? data.legalEntities
        : [];
    return {
      ok: data.ok !== false,
      orgVersionId: pick(data, ['org_version_id', 'orgVersionId']),
      etag: pick(data, ['etag']),
      activatedAt: pick(data, ['activated_at', 'activatedAt']),
      nextEffectiveChangeAt: pick(data, ['next_effective_change_at', 'nextEffectiveChangeAt']),
      permissions: data.permissions && typeof data.permissions === 'object' ? data.permissions : {},
      units: units.map(function (raw) {
        raw = raw || {};
        var entityCodes = Array.isArray(raw.entity_codes) ? raw.entity_codes : Array.isArray(raw.entityCodes) ? raw.entityCodes : [];
        return {
          id: pick(raw, ['id', 'org_unit_id', 'orgUnitId']),
          code: normalizeDepartmentCode(pick(raw, ['code'])),
          name: pick(raw, ['name']),
          unitType: pick(raw, ['unit_type', 'unitType']) || 'section',
          parentId: pick(raw, ['parent_org_unit_id', 'parentOrgUnitId', 'parentId']),
          sortOrder: toNumber(raw.sort_order !== undefined ? raw.sort_order : raw.sortOrder),
          isPostingUnit: booleanValue(raw.is_posting_unit !== undefined ? raw.is_posting_unit : raw.isPostingUnit, false),
          entityScopeMode: pick(raw, ['entity_scope_mode', 'entityScopeMode']) || 'inherit',
          entityCodes: entityCodes.map(normalizeDepartmentCode).filter(Boolean),
          active: booleanValue(raw.active, true),
          pathCodes: Array.isArray(raw.path_codes) ? raw.path_codes.slice() : Array.isArray(raw.pathCodes) ? raw.pathCodes.slice() : [],
          depth: toNumber(raw.depth),
          head: raw.head && typeof raw.head === 'object' ? raw.head : { vacant: true },
          metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
        };
      }),
      assignments: assignments.map(function (raw) {
        raw = raw || {};
        return {
          id: pick(raw, ['id', 'assignment_id', 'assignmentId']),
          financeUserId: pick(raw, ['finance_user_id', 'financeUserId']),
          name: pick(raw, ['name']),
          orgUnitId: pick(raw, ['org_unit_id', 'orgUnitId']),
          positionCode: pick(raw, ['position_code', 'positionCode']),
          positionName: pick(raw, ['position_name', 'positionName']),
          assignmentKind: pick(raw, ['assignment_kind', 'assignmentKind']) || 'secondary',
          headKind: pick(raw, ['head_kind', 'headKind']),
          canApprove: booleanValue(raw.can_approve !== undefined ? raw.can_approve : raw.canApprove, false),
          effectiveFrom: pick(raw, ['effective_from', 'effectiveFrom']),
          effectiveTo: pick(raw, ['effective_to', 'effectiveTo']),
          active: booleanValue(raw.active, true),
          metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
        };
      }),
      legalEntities: entities.map(function (raw) {
        raw = raw || {};
        return {
          id: pick(raw, ['id']),
          code: normalizeDepartmentCode(pick(raw, ['code'])),
          shortName: pick(raw, ['short_name', 'shortName', 'name']),
          legalName: pick(raw, ['legal_name', 'legalName', 'name']),
          taxId: pick(raw, ['tax_id', 'taxId']),
          active: booleanValue(raw.active, true),
        };
      }),
    };
  }

  function graphMaps(graph) {
    graph = normalizeVersionedGraph(graph);
    var byId = {};
    var byCode = {};
    var children = {};
    graph.units.forEach(function (unit) {
      byId[unit.id] = unit;
      byCode[unit.code] = unit;
      var parentKey = unit.parentId || '';
      if (!children[parentKey]) children[parentKey] = [];
      children[parentKey].push(unit);
    });
    Object.keys(children).forEach(function (key) {
      children[key].sort(function (a, b) {
        return a.sortOrder - b.sortOrder || a.code.localeCompare(b.code);
      });
    });
    return { graph: graph, byId: byId, byCode: byCode, children: children };
  }

  function graphTree(graph, includeInactive) {
    var maps = graphMaps(graph);
    function branch(unit, path) {
      path = path || {};
      if (!unit || path[unit.id]) return null;
      var nextPath = Object.assign({}, path);
      nextPath[unit.id] = true;
      var childRows = (maps.children[unit.id] || []).filter(function (child) {
        return includeInactive || child.active;
      }).map(function (child) {
        return branch(child, nextPath);
      }).filter(Boolean);
      return { unit: unit, children: childRows };
    }
    return (maps.children[''] || []).filter(function (unit) {
      return includeInactive || unit.active;
    }).map(function (unit) {
      return branch(unit, {});
    }).filter(Boolean);
  }

  function graphSubtreeIds(graph, rootId) {
    var maps = graphMaps(graph);
    var result = [];
    var queue = [rootId];
    var seen = {};
    while (queue.length) {
      var current = queue.shift();
      if (!current || seen[current]) continue;
      seen[current] = true;
      result.push(current);
      (maps.children[current] || []).forEach(function (child) {
        queue.push(child.id);
      });
    }
    return result;
  }

  function wouldCreateUnitCycle(graph, unitId, nextParentId) {
    if (!nextParentId) return false;
    if (unitId === nextParentId) return true;
    return graphSubtreeIds(graph, unitId).indexOf(nextParentId) > -1;
  }

  function effectiveEntityScope(graph, unitId) {
    var maps = graphMaps(graph);
    var unit = maps.byId[unitId];
    var seen = {};
    while (unit && !seen[unit.id]) {
      seen[unit.id] = true;
      if (unit.entityScopeMode === 'all') {
        return {
          mode: 'all',
          entityCodes: maps.graph.legalEntities.filter(function (entity) { return entity.active; }).map(function (entity) { return entity.code; }),
          sourceUnitId: unit.id,
        };
      }
      if (unit.entityScopeMode === 'explicit') {
        return { mode: 'explicit', entityCodes: unit.entityCodes.slice(), sourceUnitId: unit.id };
      }
      unit = maps.byId[unit.parentId];
    }
    return { mode: 'inherit', entityCodes: [], sourceUnitId: '' };
  }

  function postingUnits(graph, entityCode) {
    var normalized = normalizeVersionedGraph(graph);
    var wantedEntity = normalizeDepartmentCode(entityCode);
    return normalized.units.filter(function (unit) {
      if (!unit.active || !unit.isPostingUnit) return false;
      if (!wantedEntity) return true;
      var scope = effectiveEntityScope(normalized, unit.id);
      return scope.entityCodes.indexOf(wantedEntity) > -1;
    }).sort(function (a, b) {
      return (a.pathCodes || []).join('/').localeCompare((b.pathCodes || []).join('/')) || a.sortOrder - b.sortOrder;
    });
  }

  function snapshotFromGraph(graph) {
    var normalized = normalizeVersionedGraph(graph);
    return {
      schema_version: 2,
      units: normalized.units.map(function (unit) {
        return {
          id: unit.id,
          code: unit.code,
          name: unit.name,
          unit_type: unit.unitType,
          parent_org_unit_id: unit.parentId || null,
          sort_order: unit.sortOrder,
          is_posting_unit: unit.isPostingUnit,
          entity_scope_mode: unit.entityScopeMode,
          entity_codes: unit.entityCodes.slice(),
          active: unit.active,
          legacy_department_code: unit.metadata.legacy_department_code || unit.code,
          metadata: unit.metadata || {},
        };
      }),
      assignments: normalized.assignments.map(function (assignment) {
        return {
          id: assignment.id,
          finance_user_id: assignment.financeUserId,
          org_unit_id: assignment.orgUnitId,
          position_code: assignment.positionCode || 'MEMBER',
          assignment_kind: assignment.assignmentKind,
          head_kind: assignment.headKind || null,
          can_approve: assignment.canApprove,
          effective_from: assignment.effectiveFrom || new Date().toISOString(),
          effective_to: assignment.effectiveTo || null,
          active: assignment.active,
          metadata: assignment.metadata || {},
        };
      }),
      reporting_overrides: [],
    };
  }

  function validateDraftGraph(graph) {
    var maps = graphMaps(graph);
    var errors = [];
    var warnings = [];
    var activeUnits = maps.graph.units.filter(function (unit) { return unit.active; });
    var roots = activeUnits.filter(function (unit) { return unit.unitType === 'shareholders' && !unit.parentId; });
    if (roots.length !== 1) errors.push('啟用中的組織必須恰好有一個股東會根節點');
    var seenCodes = {};
    activeUnits.forEach(function (unit) {
      if (!unit.code || !unit.name) errors.push('所有單位都必須有代碼與名稱');
      if (seenCodes[unit.code]) errors.push('單位代碼重複：' + unit.code);
      seenCodes[unit.code] = true;
      if (unit.parentId && !maps.byId[unit.parentId]) errors.push(unit.name + ' 的上層單位不存在');
      if (wouldCreateUnitCycle(maps.graph, unit.id, unit.parentId)) errors.push(unit.name + ' 形成循環');
      if (unit.isPostingUnit && ['shareholders', 'board', 'executive', 'division'].indexOf(unit.unitType) > -1) {
        errors.push(unit.name + ' 不可作為表單／會計歸屬');
      }
      if (unit.entityScopeMode === 'explicit' && !unit.entityCodes.length) errors.push(unit.name + ' 尚未指定服務法人');
      var head = maps.graph.assignments.some(function (assignment) {
        return assignment.active && assignment.orgUnitId === unit.id && !!assignment.headKind;
      });
      if (unit.unitType !== 'shareholders' && !head) warnings.push(unit.name + ' 主管空缺');
    });
    return { ok: errors.length === 0, errors: Array.from(new Set(errors)), warnings: Array.from(new Set(warnings)) };
  }

  function actorRequestsFromSteps(steps) {
    var seen = {};
    return (Array.isArray(steps) ? steps : []).map(function (step, index) {
      step = step || {};
      if (step.a || step.action === 'approved') return null;
      var key = pick(step, ['rk', 'role_key', 'roleKey', 'key']) || ('step_' + (index + 1));
      var uid = pick(step, ['uid', 'finance_user_id', 'financeUserId']);
      var actorKind = String(pick(step, [
        'runtimeActorKind', 'actor_kind', 'actorKind', 'workflowActorKind',
      ]) || '').trim().toLowerCase();
      var configuredTarget = String(pick(step, [
        'workflowActorTarget', 'actor_target', 'actorTarget', 'target',
      ]) || '').trim().toLowerCase();
      var configuredLevel = String(pick(step, [
        'workflowActorTargetUnitType', 'target_unit_type', 'targetUnitType',
      ]) || '').trim().toLowerCase();
      var actorRef = String(pick(step, [
        'workflowActorRef', 'actor_ref', 'actorRef',
      ]) || '').trim().toLowerCase();
      var allowCrossEntity = booleanValue(
        step.workflowAllowCrossEntity !== undefined
          ? step.workflowAllowCrossEntity
          : step.allow_cross_entity !== undefined
            ? step.allow_cross_entity
            : step.allowCrossEntity,
        false
      );
      var target = '';
      var level = '';
      if (actorKind === 'org_unit_head') {
        target = configuredTarget || actorRef || 'nearest_parent';
        level = configuredLevel;
        if (['group', 'shareholders', 'board', 'executive', 'division', 'department', 'section', 'team'].indexOf(target) > -1) {
          level = target;
          target = 'specified_level';
        }
        if (target === 'specified_level' && !level) level = actorRef;
      } else if (['direct_supervisor', 'supervisor'].indexOf(key) > -1) target = 'direct_supervisor';
      else if (['section_chief'].indexOf(key) > -1) { target = 'specified_level'; level = 'section'; }
      else if (['dept_manager', 'department_manager', 'department_director'].indexOf(key) > -1) { target = 'specified_level'; level = 'department'; }
      else if (key === 'ceo') target = 'group_ceo';
      var dedupeKey = key + ':' + actorKind + ':' + (target || uid) + ':' + level + ':' + allowCrossEntity;
      if (seen[dedupeKey]) return null;
      seen[dedupeKey] = true;
      if (target) return {
        step_key: key,
        actor_kind: actorKind || 'org_unit_head',
        target: target,
        target_unit_type: level || null,
        allow_cross_entity: allowCrossEntity,
      };
      if (uid) return {
        step_key: key,
        finance_user_id: uid,
        actor_kind: actorKind || (key.indexOf('applicant_') === 0 ? 'applicant' : 'explicit'),
        allow_cross_entity: allowCrossEntity,
      };
      return null;
    }).filter(Boolean);
  }

  var api = {
    normalizeDepartmentCode: normalizeDepartmentCode,
    departmentSeries: departmentSeries,
    sameSeries: sameSeries,
    pick: pick,
    booleanValue: booleanValue,
    normalizeSettingValue: normalizeSettingValue,
    userRef: userRef,
    normalizeRows: normalizeRows,
    normalizeRuntimeRows: normalizeRuntimeRows,
    normalizeAdminList: normalizeAdminList,
    normalizeAdminHealth: normalizeAdminHealth,
    orgAdminRuntimeStatus: orgAdminRuntimeStatus,
    orgAdminRuntimeStatusHtml: orgAdminRuntimeStatusHtml,
    normalizeVersionedGraph: normalizeVersionedGraph,
    graphMaps: graphMaps,
    graphTree: graphTree,
    graphSubtreeIds: graphSubtreeIds,
    wouldCreateUnitCycle: wouldCreateUnitCycle,
    effectiveEntityScope: effectiveEntityScope,
    postingUnits: postingUnits,
    snapshotFromGraph: snapshotFromGraph,
    validateDraftGraph: validateDraftGraph,
    actorRequestsFromSteps: actorRequestsFromSteps,
  };

  global.FinanceOrganizationEngine = api;
  global.FinanceV4Engines.register('organization', api);
})(window);
