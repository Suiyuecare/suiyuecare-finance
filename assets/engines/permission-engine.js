(function (global) {
  'use strict';

  var roleAliases = {
    ceo: 'ceo',
    entrepreneur: 'ceo',
    executive_director: 'ceo',
    chief_executive_officer: 'ceo',
    '執行長': 'ceo',
    '董事長': 'ceo',
    external_audit: 'external_audit',
    auditor: 'external_audit',
    audit: 'external_audit',
    '外部檢核單位': 'external_audit',
    '會計事務所': 'external_audit',
    board: 'board',
    '董事會': 'board',
    shareholder: 'shareholder',
    '股東': 'shareholder',
    accounting: 'accountant',
    accountant: 'accountant',
    '會計': 'accountant',
    cashier: 'cashier',
    '出納': 'cashier',
    '出納人員': 'cashier',
    admin_director: 'admin_director',
    admin: 'admin_director',
    '行政部門主任': 'admin_director',
    '行政主任': 'admin_director',
    general_affairs: 'general_affairs',
    '總務': 'general_affairs',
    hr: 'hr',
    human_resources: 'hr',
    '人資': 'hr',
    dept_manager: 'dept_manager',
    department_manager: 'dept_manager',
    '部門主管': 'dept_manager',
    section_chief: 'section_chief',
    '課長': 'section_chief',
    employee: 'employee',
    staff: 'employee',
    '一般組員': 'employee',
    '一般員工': 'employee',
  };

  function resolveRoleAlias(role) {
    var raw = String(role || '').trim();
    if (!raw) return '';
    return roleAliases[raw] || roleAliases[raw.toLowerCase()] || '';
  }

  function normalizeRole(role) {
    var raw = String(role || '').trim();
    if (!raw) return 'employee';
    return resolveRoleAlias(raw) || raw;
  }

  function normalizeUserRole(user) {
    user = user || {};
    var email = String(user.email || '').trim().toLowerCase();
    if (email === 'entrepreneur@suiyuecare.com') return 'ceo';
    var raw = String(user.role || '').trim();
    var label = String(user.rL || user.role_label || '').trim();
    return resolveRoleAlias(raw) || resolveRoleAlias(label) || raw || label || 'employee';
  }

  function mapPortalRole(role) {
    role = role || {};
    return {
      id: role.id,
      name: role.name,
      defaultScope: role.default_scope || role.defaultScope || '',
      financeRole: role.finance_role || role.financeRole || '',
      category: role.category || '',
      modules: Array.isArray(role.modules) ? role.modules : [],
      actions: Array.isArray(role.actions) ? role.actions : [],
      limits: role.limits || '',
      active: role.active !== false,
    };
  }

  function portalRoleById(id, roles, defaultRoles) {
    var source = Array.isArray(roles) && roles.length ? roles : defaultRoles;
    return (source || []).find(function (role) {
      return role && role.id === id;
    }) || null;
  }

  function defaultPortalRoleForFinanceRole(role, roles, defaultRoles) {
    var map = {
      ceo: 'ceo',
      admin_director: 'admin-director',
      hr: 'hr-chief',
      accountant: 'accounting-chief',
      cashier: 'cashier-chief',
      general_affairs: 'ga-chief',
      dept_manager: 'business-director',
      section_chief: 'section-chief',
      employee: 'staff',
      external_audit: 'external-audit',
      board: 'board',
      shareholder: 'shareholder',
    };
    return portalRoleById(map[normalizeRole(role)] || 'staff', roles, defaultRoles) || portalRoleById('staff', roles, defaultRoles);
  }

  function portalRoleForUser(user, roles, defaultRoles) {
    return defaultPortalRoleForFinanceRole(normalizeUserRole(user), roles, defaultRoles);
  }

  function cloneModule(module) {
    if (!module || typeof module !== 'object') return {};
    return Object.assign({}, module, {
      dependsOn: Array.isArray(module.dependsOn) ? module.dependsOn.slice() : [],
      checks: Array.isArray(module.checks) ? module.checks.slice() : [],
    });
  }

  function normalizeProductModules(value, defaults) {
    defaults = Array.isArray(defaults) ? defaults : [];
    var byId = {};
    defaults.forEach(function (module) {
      if (!module || !module.id) return;
      byId[module.id] = cloneModule(module);
    });
    (Array.isArray(value) ? value : []).forEach(function (module) {
      if (!module || !module.id) return;
      byId[module.id] = Object.assign({}, byId[module.id] || {}, module);
      byId[module.id].dependsOn = Array.isArray(byId[module.id].dependsOn) ? byId[module.id].dependsOn : [];
      byId[module.id].checks = Array.isArray(byId[module.id].checks) ? byId[module.id].checks : [];
    });
    var defaultIds = {};
    defaults.forEach(function (module) {
      if (module && module.id) defaultIds[module.id] = true;
    });
    return defaults.map(function (module) {
      return byId[module.id];
    }).concat(Object.keys(byId).filter(function (id) {
      return !defaultIds[id];
    }).map(function (id) {
      return byId[id];
    }));
  }

  function productModuleById(id, modules) {
    return (Array.isArray(modules) ? modules : []).find(function (module) {
      return module && module.id === id;
    }) || null;
  }

  function productModuleEnabled(id, modules, defaults) {
    if (!id) return true;
    modules = normalizeProductModules(modules, defaults);
    var module = productModuleById(id, modules);
    return !module || (module.enabled !== false && module.status !== 'disabled');
  }

  function normalizePermissionLevel(value, levels) {
    levels = Array.isArray(levels) && levels.length ? levels : ['none', 'view', 'edit', 'delete'];
    if (value === true) return 'edit';
    if (value === false || value == null) return 'none';
    if (typeof value === 'number') return levels[Math.max(0, Math.min(levels.length - 1, value))] || 'none';
    var raw = String(value).trim();
    var key = raw.toLowerCase();
    if (levels.indexOf(raw) > -1) return raw;
    if (levels.indexOf(key) > -1) return key;
    if (key === 'read' || key === 'view_only' || key === 'readonly') return 'view';
    if (key === 'write' || key === 'manage' || key === 'admin' || key === 'approve') return 'edit';
    if (key === 'remove') return 'delete';
    return 'none';
  }

  function permissionLevelFrom(perms, key, levels) {
    if (Array.isArray(perms)) return perms.indexOf(key) > -1 ? 'edit' : 'none';
    if (perms && typeof perms === 'object') return normalizePermissionLevel(perms[key], levels);
    return 'none';
  }

  function permissionConfigHasKey(perms, key) {
    if (Array.isArray(perms)) return perms.indexOf(key) > -1;
    if (perms && typeof perms === 'object') return Object.prototype.hasOwnProperty.call(perms, key);
    return false;
  }

  function permissionMapForRole(role, source, keys, fallbackByRole, levels) {
    var normalized = normalizeRole(role);
    source = source || {};
    fallbackByRole = fallbackByRole || {};
    keys = Array.isArray(keys) ? keys : [];
    var saved = source[normalized];
    if (saved == null) saved = source[role];
    var fallback = fallbackByRole[normalized];
    if (fallback == null) fallback = fallbackByRole[role] || [];
    var hasSavedConfig = saved != null;
    var map = {};

    keys.forEach(function (key) {
      if (!hasSavedConfig) {
        map[key] = permissionLevelFrom(fallback, key, levels);
      } else if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        map[key] = permissionConfigHasKey(saved, key)
          ? permissionLevelFrom(saved, key, levels)
          : permissionLevelFrom(fallback, key, levels);
      } else {
        map[key] = permissionLevelFrom(saved, key, levels);
      }
    });

    return map;
  }

  function defaultRolePermissions(options) {
    options = options || {};
    var pages = Array.isArray(options.pages) ? options.pages.slice() : [];
    var actionKeys = Array.isArray(options.actionKeys) ? options.actionKeys.slice() : [];
    var common = ['dashboard', 'newreq', 'expenses', 'approvals', 'notif', 'invoices', 'bills', 'recv'];
    var finance = pages.filter(function (page) {
      return page !== 'settings';
    });
    var accountingActions = actionKeys.slice();

    return {
      employee: common.slice(),
      section_chief: common.slice(),
      dept_manager: common.slice(),
      admin_director: pages.concat(accountingActions),
      general_affairs: common.slice(),
      hr: common.concat(['users', 'orgchart', 'compliance']),
      accountant: finance.concat(accountingActions),
      cashier: ['dashboard', 'expenses', 'approvals', 'notif'],
      ceo: pages.concat(accountingActions),
      external_audit: ['dashboard', 'reports', 'ledger', 'vouchers', 'compliance', 'notif'],
      board: ['dashboard', 'reports', 'vouchers', 'compliance', 'notif'],
      shareholder: ['dashboard', 'reports', 'shareholder', 'notif'],
    };
  }

  function normalizeRolePermissionsConfig(saved, options) {
    options = options || {};
    var pages = Array.isArray(options.pages) ? options.pages.slice() : [];
    var actionKeys = Array.isArray(options.actionKeys) ? options.actionKeys.slice() : [];
    var levels = Array.isArray(options.levels) && options.levels.length ? options.levels : ['none', 'view', 'edit', 'delete'];
    var defaults = defaultRolePermissions({
      pages: pages,
      actionKeys: actionKeys,
    });
    var allKeys = pages.concat(actionKeys);
    var next = Object.assign({}, defaults, saved || {});
    var hasAnyAction = false;

    Object.keys(next).forEach(function (role) {
      actionKeys.forEach(function (key) {
        if (permissionLevelFrom(next[role], key, levels) !== 'none') hasAnyAction = true;
      });
    });

    if (!hasAnyAction) {
      ['accountant', 'ceo'].forEach(function (role) {
        var map = permissionMapForRole(role, next, allKeys, defaults, levels);
        actionKeys.forEach(function (key) {
          map[key] = 'edit';
        });
        next[role] = map;
      });
    }

    return next;
  }

  function permissionLevel(map, role, key) {
    var normalized = normalizeRole(role);
    var source = (map && (map[normalized] || map[role])) || {};
    return normalizePermissionLevel(source[key]);
  }

  function can(map, role, key, allowed) {
    var level = permissionLevel(map, role, key);
    var accepted = Array.isArray(allowed) ? allowed : ['edit', 'delete', 'write', 'admin', 'approve'];
    return accepted.indexOf(level) > -1;
  }

  function roleKey(userOrRole) {
    if (userOrRole && typeof userOrRole === 'object') return normalizeUserRole(userOrRole);
    return normalizeRole(userOrRole);
  }

  function hasRole(userOrRole, roles) {
    roles = Array.isArray(roles) ? roles : [];
    return roles.indexOf(roleKey(userOrRole)) > -1;
  }

  function isFinanceUser(userOrRole) {
    return hasRole(userOrRole, ['accountant', 'ceo', 'admin_director', 'external_audit', 'board']);
  }

  function canSeeAllIncomeDocs(userOrRole) {
    return isFinanceUser(userOrRole);
  }

  function canManageUsers(userOrRole) {
    return hasRole(userOrRole, ['ceo', 'admin_director', 'hr']);
  }

  function canManageOrgChart(userOrRole) {
    return hasRole(userOrRole, ['ceo', 'hr', 'admin_director']);
  }

  function canManageSettings(userOrRole) {
    return hasRole(userOrRole, ['ceo', 'admin_director', 'accountant']);
  }

  function canAccessPage(page, user, options) {
    options = options || {};
    if (page === 'detail') return true;
    if (!user) return false;
    if (typeof options.pageModuleEnabled === 'function' && !options.pageModuleEnabled(page)) return false;

    var role = roleKey(user);
    if (['dashboard', 'newreq', 'expenses', 'approvals', 'notif', 'invoices', 'bills', 'recv'].indexOf(page) > -1) {
      if (typeof options.roleHasPermission === 'function') return !!options.roleHasPermission(role, page);
      if (options.rolePermissions) return permissionLevel(options.rolePermissions, role, page) !== 'none';
      return true;
    }
    if (page === 'shareholder') return ['ceo', 'admin_director', 'accountant'].indexOf(role) > -1;
    if (page === 'users') return canManageUsers(role);
    // The supervisor chart is visible to every signed-in employee. Editing
    // remains separately protected by canManageOrgChart().
    if (page === 'orgchart') return true;
    if (page === 'health') return canManageSettings(role);
    if (page === 'settings') return canManageSettings(role);
    if (page === 'compliance') return isFinanceUser(role) || role === 'hr';
    if (typeof options.roleHasPermission === 'function') return !!options.roleHasPermission(role, page);
    if (options.rolePermissions) return permissionLevel(options.rolePermissions, role, page) !== 'none';
    return false;
  }

  var api = {
    normalizeRole: normalizeRole,
    normalizeUserRole: normalizeUserRole,
    mapPortalRole: mapPortalRole,
    portalRoleById: portalRoleById,
    defaultPortalRoleForFinanceRole: defaultPortalRoleForFinanceRole,
    portalRoleForUser: portalRoleForUser,
    normalizeProductModules: normalizeProductModules,
    productModuleById: productModuleById,
    productModuleEnabled: productModuleEnabled,
    normalizePermissionLevel: normalizePermissionLevel,
    permissionLevelFrom: permissionLevelFrom,
    permissionConfigHasKey: permissionConfigHasKey,
    permissionMapForRole: permissionMapForRole,
    defaultRolePermissions: defaultRolePermissions,
    normalizeRolePermissionsConfig: normalizeRolePermissionsConfig,
    permissionLevel: permissionLevel,
    can: can,
    roleKey: roleKey,
    hasRole: hasRole,
    isFinanceUser: isFinanceUser,
    canSeeAllIncomeDocs: canSeeAllIncomeDocs,
    canManageUsers: canManageUsers,
    canManageOrgChart: canManageOrgChart,
    canManageSettings: canManageSettings,
    canAccessPage: canAccessPage,
  };

  global.FinancePermissionEngine = api;
  global.FinanceV4Engines.register('permissions', api);
})(window);
