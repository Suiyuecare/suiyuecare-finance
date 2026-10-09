import assert from 'node:assert/strict';import vm from'node:vm';import{readFile}from'node:fs/promises';
const source=await readFile(new URL('../assets/engines/portal-session-logout.js',import.meta.url),'utf8');
const storage=new Map(),localStorage=new Map([['suiyuecare-finance-auth-v3','synthetic-token']]);const context=vm.createContext({AbortSignal,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},localStorage:{getItem:k=>localStorage.get(k)||null,removeItem:k=>localStorage.delete(k)}});vm.runInContext(source,context);const api=context.FinanceModuleLogout;
let local=0;const client={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-token'}}}),signOut:async options=>{assert.equal(options.scope,'local');local++;return{};}}};
let calls=0;const okay=async(url,opts)=>{calls++;assert.equal(url,'https://login.suiyuecare.com/api/portal-handoff?action=logout');assert.equal(JSON.parse(opts.body).source,'finance');assert.equal(opts.credentials,'omit');assert.equal(opts.cache,'no-store');assert.ok(!url.includes('synthetic-token'));return{ok:true,json:async()=>({ok:true,revokedModules:['portal','hr','finance','apm']})};};
assert.deepEqual(Array.from(await api.coordinate(client,okay)),['hr','finance','portal','apm']);assert.equal(local,1);
for(const result of [{ok:false,pendingModules:['finance','apm']},{ok:true,revokedModules:['finance','hr','portal']},{ok:true,revokedModules:[]}]){await assert.rejects(()=>api.coordinate(client,async()=>({ok:true,json:async()=>result})));assert.equal(local,1);}
const receiptId='f9000000-0000-4000-8000-000000000001';
const pending={ok:false,pending:true,sourceRevoked:true,receiptId,revokedModules:['finance'],pendingModules:['portal','hr','apm']};
await assert.rejects(()=>api.coordinate(client,async()=>({status:202,ok:true,json:async()=>({...pending,sourceRevoked:false})})));assert.equal(local,1);
const outcome=await api.coordinate(client,async()=>({status:202,ok:true,json:async()=>pending}));assert.equal(outcome.pending,true);assert.equal(outcome.receiptId,receiptId);assert.equal(local,2);assert.equal(localStorage.has('suiyuecare-finance-auth-v3'),false);
await assert.rejects(()=>api.coordinate(client,async()=>{throw new Error('timeout');}));assert.equal(local,2);
assert.equal(api.pending(),false);storage.set('suiyuecare.finance.pendingModuleLogout.v1','1');assert.equal(api.pending(),true);assert.equal(storage.size,1);assert.ok(!JSON.stringify([...storage]).includes('token'));
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');assert.ok(html.includes('FinanceModuleLogout.pending()){await window.financeLogout();return false;}'));assert.ok(html.includes('++financeAuthIdentityEpoch;setFinanceWorkspaceIdentityBlocked(true)'));assert.ok(!html.slice(html.indexOf('window.financeLogout='),html.indexOf('window.showLogin=')).includes('redirectFinanceLogoutToPortalLogin'));
assert.ok(html.includes("pendingToPortal:function(){location.replace(PORTAL_MODULE_URL+'?logout=pending');}"));
console.log('ok - coordinated Finance logout, incomplete/timeout retention, token-free reload fence');
