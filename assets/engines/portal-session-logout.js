(function(global){
'use strict';
const SHARED_LOGOUT_MODULES = ['hr', 'finance', 'portal', 'apm'];
const LOGOUT_RECEIPT_KEY = 'suiyue.sharedLogout.receipt.v2';
const LOGOUT_RECEIPT_ARCHIVE_KEY = 'suiyue.sharedLogout.archivedReceipts.v2';
class SharedLogoutError extends Error {
    pendingModules;
    constructor(pendingModules = [...SHARED_LOGOUT_MODULES]) {
        super('登出尚未全部完成，請再次按登出重試。');
        this.pendingModules = pendingModules;
        this.name = 'SharedLogoutError';
    }
}
class SharedLogoutSetupError extends SharedLogoutError {
    actionUrl = 'https://login.suiyuecare.com/portal/?module=apm&returnTo=https%3A%2F%2Fapm.suiyuecare.com%2Fdashboard';
    constructor() { super(); this.message = '請先從入口網開啟 APM 一次以更新登入連結，再重試登出。'; this.name = 'SharedLogoutSetupError'; }
}
class LogoutIdentityChangedError extends Error {
    constructor() { super('登入帳號已更新，先前登出結果不會影響這次登入。'); this.name = 'LogoutIdentityChangedError'; }
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function logoutSessionId(session) {
    try {
        const part = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const value = JSON.parse(atob(part)).session_id;
        if (typeof value === 'string' && uuid.test(value))
            return value;
    }
    catch { }
    throw new SharedLogoutError();
}
function readPending(storage) {
    try {
        const p = JSON.parse(storage.getItem(LOGOUT_RECEIPT_KEY) || 'null');
        if (p && uuid.test(p.operationId) && uuid.test(p.actorUserId) && uuid.test(p.sessionId) && /^[a-f0-9]{64}$/.test(p.capability) && Number.isFinite(p.createdAt) && typeof p.prepared === 'boolean')
            return p;
    }
    catch { }
}
function receipt(value, p) {
    const v = value;
    if (!v || v.protocol !== 2 || v.operationId !== p.operationId || typeof v.ok !== 'boolean' || !Number.isFinite(Date.parse(v.cutoff)) || !Number.isFinite(Date.parse(v.expiresAt)) || Date.parse(v.expiresAt) <= Date.parse(v.cutoff) || !Array.isArray(v.revokedModules) || !Array.isArray(v.pendingModules))
        throw new SharedLogoutError();
    const all = [...v.revokedModules, ...v.pendingModules];
    if (all.length !== 4 || new Set(all).size !== 4 || !SHARED_LOGOUT_MODULES.every(id => all.includes(id)) || v.ok !== (v.pendingModules.length === 0))
        throw new SharedLogoutError();
    return v;
}
/** Capability never establishes authentication. It can only resume the exact
 * persisted operation whose identity, target set and cutoff were frozen by SQL. */
async function completeSharedLogout(options) {
    const fetcher = options.fetcher ?? fetch, clock = options.now ?? Date.now, c = options.crypto ?? globalThis.crypto;
    let pending = readPending(options.storage);
    const existing = Boolean(pending);
    const identityChanged = Boolean(pending && options.session && (pending.actorUserId !== options.session.user.id || pending.sessionId !== logoutSessionId(options.session)));
    const retainOldOperation = () => { let old = []; try {
        const value = JSON.parse(options.storage.getItem(LOGOUT_RECEIPT_ARCHIVE_KEY) || '[]');
        if (Array.isArray(value))
            old = value;
    }
    catch { } options.storage.setItem(LOGOUT_RECEIPT_ARCHIVE_KEY, JSON.stringify([...old.filter(x => x.operationId !== p.operationId), p])); options.storage.removeItem(LOGOUT_RECEIPT_KEY); };
    if (!pending) {
        if (!options.session)
            throw new SharedLogoutError();
        const bytes = c.getRandomValues(new Uint8Array(32));
        pending = { operationId: c.randomUUID(), capability: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''), actorUserId: options.session.user.id, sessionId: logoutSessionId(options.session), createdAt: clock(), prepared: false };
        options.storage.setItem(LOGOUT_RECEIPT_KEY, JSON.stringify(pending));
    }
    const p = pending;
    const send = async (phase) => {
        const headers = { 'Content-Type': 'application/json' };
        if (phase === 'prepare') {
            if (!options.session)
                throw new SharedLogoutError();
            headers.Authorization = `Bearer ${options.session.access_token}`;
        }
        let response;
        try {
            response = await fetcher(options.endpoint ?? 'https://login.suiyuecare.com/api/portal-handoff?action=logout', { method: 'POST', headers, body: JSON.stringify({ protocol: 2, source: options.source, phase, operationId: p.operationId, capability: p.capability }), credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000) });
        }
        catch {
            throw new SharedLogoutError();
        }
        let raw;
        try {
            raw = await response.json();
        }
        catch {
            throw new SharedLogoutError();
        }
        if (phase === 'prepare' && response.status === 409 && raw?.reason === 'apm_binding_required') {
            options.storage.removeItem(LOGOUT_RECEIPT_KEY);
            throw new SharedLogoutSetupError();
        }
        if (phase === 'status' && response.status === 403 && raw?.reason === 'capability')
            return null;
        if (response.status === 410 && raw?.reason === 'expired') {
            retainOldOperation();
            if (identityChanged)
                throw new LogoutIdentityChangedError();
            throw new SharedLogoutError();
        }
        if (response.status !== 200 && response.status !== 502)
            throw new SharedLogoutError();
        const result = receipt(raw, p);
        if (response.status === 502 && result.ok)
            throw new SharedLogoutError();
        return result;
    };
    let result = null;
    if (existing) {
        try {
            result = await send('status');
            if (identityChanged && !result) {
                retainOldOperation();
                throw new LogoutIdentityChangedError();
            }
        }
        catch (error) {
            if (identityChanged) {
                retainOldOperation();
                throw new LogoutIdentityChangedError();
            }
            throw error;
        }
    }
    if (!result && !p.prepared) {
        result = await send('prepare');
        if (!result?.prepared)
            throw new SharedLogoutError();
    }
    p.prepared = true;
    options.storage.setItem(LOGOUT_RECEIPT_KEY, JSON.stringify(p));
    options.onPrepared?.();
    if (!result?.ok) {
        try {
            result = await send('resume');
        }
        catch (error) {
            if (identityChanged) {
                retainOldOperation();
                throw new LogoutIdentityChangedError();
            }
            throw error;
        }
    }
    if (!result?.ok) {
        if (identityChanged) {
            retainOldOperation();
            throw new LogoutIdentityChangedError();
        }
        throw new SharedLogoutError(result?.pendingModules);
    }
    const current = await options.getCurrentSession();
    if (current && (current.user.id !== p.actorUserId || logoutSessionId(current) !== p.sessionId)) {
        options.storage.removeItem(LOGOUT_RECEIPT_KEY);
        throw new LogoutIdentityChangedError();
    }
    try {
        await options.clearLocal(p.sessionId);
    }
    catch (error) {
        if (error instanceof LogoutIdentityChangedError)
            options.storage.removeItem(LOGOUT_RECEIPT_KEY);
        throw error;
    }
    const after = await options.getCurrentSession();
    if (after && (after.user.id !== p.actorUserId || logoutSessionId(after) !== p.sessionId)) {
        options.storage.removeItem(LOGOUT_RECEIPT_KEY);
        throw new LogoutIdentityChangedError();
    }
    options.storage.removeItem(LOGOUT_RECEIPT_KEY);
    return { modules: [...SHARED_LOGOUT_MODULES] };
}
/** Supported Supabase storage adapter. A late local sign-out cannot remove a
 * session written after its initiating identity generation. */
function createLogoutStorageGuard(storage, authKey) {
    let expected = null, blocked = false;
    const changed = () => { if (blocked)
        return true; const raw = storage.getItem(authKey); if (!raw)
        return false; try {
        const value = JSON.parse(raw);
        if (logoutSessionId({ user: { id: '' }, access_token: value.access_token }) !== expected) {
            blocked = true;
            return true;
        }
    }
    catch {
        blocked = true;
        return true;
    } return false; };
    const adapter = { get length() { return storage.length; }, key: i => storage.key(i), clear: () => { if (expected)
            throw new Error('Scoped Auth removal is required.'); storage.clear(); }, getItem: key => storage.getItem(key), setItem: (key, value) => storage.setItem(key, value), removeItem: key => { if (expected && key.startsWith(authKey) && changed())
            return; storage.removeItem(key); } };
    return { storage: adapter, async removeFor(sessionId, operation) { expected = sessionId; blocked = false; try {
            await operation();
            if (blocked)
                throw new LogoutIdentityChangedError();
        }
        finally {
            expected = null;
            blocked = false;
        } } };
}

var financeAuthRemovalGuard=global.localStorage?createLogoutStorageGuard(global.localStorage,'suiyuecare-finance-auth-v3'):null;
var key='suiyuecare.finance.pendingModuleLogout.v1';
var known=['hr','finance','portal','apm'];
var running=false;
function pending(){try{return global.sessionStorage.getItem(key)==='1'||Boolean(global.sessionStorage.getItem(LOGOUT_RECEIPT_KEY));}catch{return false;}}
function mark(value){try{if(value)global.sessionStorage.setItem(key,'1');else global.sessionStorage.removeItem(key);}catch{}}
async function coordinate(client,fetcher){
 var current=await client.auth.getSession();if(current.error)throw current.error;
 var result=await completeSharedLogout({source:'finance',storage:global.sessionStorage,session:current.data.session,
 fetcher:fetcher,getCurrentSession:async function(){var value=await client.auth.getSession();if(value.error)throw value.error;return value.data.session;},
 clearLocal:async function(sid){var operation=async function(){var local=await client.auth.signOut({scope:'local'});if(local&&local.error)throw local.error;};if(financeAuthRemovalGuard)await financeAuthRemovalGuard.removeFor(sid,operation);else await operation();}});
 return result.modules;

}
function panel(message,busy,retry,complete){
 var node=document.getElementById('finance-module-logout');
 if(!node){node=document.createElement('section');node.id='finance-module-logout';node.setAttribute('role','status');node.setAttribute('aria-live','polite');node.style.cssText='position:fixed;inset:0;z-index:99999;background:#fff8ef;display:grid;place-content:center;gap:20px;padding:24px;text-align:center;font-family:inherit;color:#4a3f35;';document.body.appendChild(node);}
 node.replaceChildren();var title=document.createElement('h1');title.textContent=complete?'已登出':'正在登出';title.style.cssText='font-size:24px;margin:0';node.appendChild(title);var text=document.createElement('p');text.textContent=message;node.appendChild(text);
 if(!busy){var button=document.createElement('button');button.type='button';button.textContent=complete?'回模組頁':'重試登出';button.style.cssText='min-height:44px;padding:12px 24px;border:0;border-radius:24px;background:#f38a00;color:white;font:inherit;cursor:pointer';button.addEventListener('click',retry);node.appendChild(button);button.focus();}
}
async function start(options){
 if(running)return false;running=true;mark(true);options.clearPrivate();panel('正在登出人資、會計、APM 與模組頁…',true);
 try{await options.stopRealtime();await coordinate(options.client(),options.fetch||global.fetch.bind(global));mark(false);panel('已登出人資、會計、APM 與模組頁。',false,options.returnToPortal,true);return true;}
 catch(error){if(error instanceof LogoutIdentityChangedError){mark(false);document.getElementById('finance-module-logout')?.remove();options.onIdentityChanged?.();return false;}var names={hr:'人資',finance:'會計',portal:'模組頁',apm:'APM'};var scope=error.pendingModules&&error.pendingModules.length?error.pendingModules.map(function(id){return names[id];}).join('、'):'人資、會計與模組頁';panel(scope+'：'+error.message,false,function(){start(options);});if(error instanceof SharedLogoutSetupError){var link=document.createElement('a');link.href=error.actionUrl;link.target='_blank';link.rel='noopener';link.textContent='開啟 APM 更新登入';document.getElementById('finance-module-logout').appendChild(link);}return false;}
 finally{running=false;}
}
global.FinanceModuleLogout={pending:pending,start:start,coordinate:coordinate,authStorage:financeAuthRemovalGuard&&financeAuthRemovalGuard.storage};
})(typeof window!=='undefined'?window:globalThis);
