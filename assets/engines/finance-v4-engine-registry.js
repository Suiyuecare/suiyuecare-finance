(function (global) {
  'use strict';

  var registry = Object.create(null);
  var requiredEngines = ['data', 'forms', 'approvals', 'attachments', 'reports', 'permissions', 'organization', 'accounting'];

  function cloneList(list) {
    return Array.prototype.slice.call(list || []);
  }

  function register(name, api) {
    if (!name || typeof name !== 'string') {
      throw new Error('Finance V4 engine registration requires a string name.');
    }
    if (!api || typeof api !== 'object') {
      throw new Error('Finance V4 engine "' + name + '" must expose an API object.');
    }
    registry[name] = Object.freeze(api);
    return registry[name];
  }

  function get(name) {
    return registry[name] || null;
  }

  function has(name) {
    return !!registry[name];
  }

  function list() {
    return Object.keys(registry).sort();
  }

  function missingRequired() {
    return requiredEngines.filter(function (name) {
      return !has(name);
    });
  }

  global.FinanceV4Engines = Object.freeze({
    required: cloneList(requiredEngines),
    register: register,
    get: get,
    has: has,
    list: list,
    missingRequired: missingRequired,
  });
})(window);
