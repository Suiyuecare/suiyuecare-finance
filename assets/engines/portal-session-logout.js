(function(global){
'use strict';
var key='suiyuecare.finance.pendingModuleLogout.v1';
var known=['hr','finance','portal','apm'];
var running=false;
function pending(){try{return global.sessionStorage.getItem(key)==='1';}catch{return false;}}
function mark(value){try{if(value)global.sessionStorage.setItem(key,'1');else global.sessionStorage.removeItem(key);}catch{}}
async function coordinate(client,fetcher){
 var current=await client.auth.getSession();
 var token=current&&current.data&&current.data.session&&current.data.session.access_token;
 if(!token)throw new Error('登入狀態已失效，其他模組登出結果尚未確認。');
 var response=await fetcher('https://login.suiyuecare.com/api/portal-handoff?action=logout',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({source:'finance'}),credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(30000)});
 var value=await response.json();
 if(!response.ok||value.ok!==true||!Array.isArray(value.revokedModules)||!known.every(function(id){return value.revokedModules.includes(id);})){var error=new Error('登出尚未全部完成，請重試。');error.pendingModules=Array.isArray(value.pendingModules)?value.pendingModules.filter(function(id){return known.includes(id);}):known;throw error;}
 var local=await client.auth.signOut({scope:'local'});if(local&&local.error)throw new Error('本機登入資料尚未清除，請重試。');
 return known.slice();
}
function panel(message,busy,retry,complete){
 var node=document.getElementById('finance-module-logout');
 if(!node){node=document.createElement('section');node.id='finance-module-logout';node.setAttribute('role','status');node.setAttribute('aria-live','polite');node.style.cssText='position:fixed;inset:0;z-index:99999;background:#fff8ef;display:grid;place-content:center;gap:20px;padding:24px;text-align:center;font-family:inherit;color:#4a3f35;';document.body.appendChild(node);}
 node.replaceChildren();var title=document.createElement('h1');title.textContent=complete?'已登出':'正在登出';title.style.cssText='font-size:24px;margin:0';node.appendChild(title);var text=document.createElement('p');text.textContent=message;node.appendChild(text);
 if(!busy){var button=document.createElement('button');button.type='button';button.textContent=complete?'回模組頁':'重試登出';button.style.cssText='min-height:44px;padding:12px 24px;border:0;border-radius:24px;background:#f38a00;color:white;font:inherit;cursor:pointer';button.addEventListener('click',retry);node.appendChild(button);button.focus();}
}
async function start(options){
 if(running)return false;running=true;mark(true);options.clearPrivate();panel('正在登出人資、會計、敏捷專案管理與模組頁…',true);
 try{await options.stopRealtime();await coordinate(options.client(),options.fetch||global.fetch.bind(global));mark(false);panel('已登出人資、會計、敏捷專案管理與模組頁。',false,options.returnToPortal,true);return true;}
 catch(error){var names={hr:'人資',finance:'會計',portal:'模組頁',apm:'敏捷專案管理'};var scope=error.pendingModules&&error.pendingModules.length?error.pendingModules.map(function(id){return names[id];}).join('、'):'人資、會計、敏捷專案管理與模組頁';panel(scope+'：'+error.message,false,function(){start(options);});return false;}
 finally{running=false;}
}
global.FinanceModuleLogout={pending:pending,start:start,coordinate:coordinate};
})(typeof window!=='undefined'?window:globalThis);
