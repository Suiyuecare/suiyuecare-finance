(function(root){
  'use strict';
  var KEY='finance_diagnostic_outbox_v1',TTL=7*24*60*60*1000,LIMIT=100;
  function token(value,max){return /^[a-zA-Z0-9_.:-]+$/.test(String(value||''))?String(value).slice(0,max):'';}
  function scope(value){value=value||{};return {owner:token(value.owner,64),tenantId:token(value.tenantId,80),dataEnv:token(value.dataEnv,24)};}
  function same(a,b){return a.owner===b.owner&&a.tenantId===b.tenantId&&a.dataEnv===b.dataEnv;}
  function minimal(row,owner,now){
    var time=Date.parse(row&&row.time),s=scope(owner);
    if(!row||!s.owner||!s.tenantId||!s.dataEnv||!Number.isFinite(time)||time<now-TTL||time>now+60000)return null;
    var id=token(row.id,100),type=token(row.type,100);
    if(!id||!type)return null;
    return Object.assign(s,{id:id,time:new Date(time).toISOString(),type:type,severity:['critical','warn','ok','info'].indexOf(row.severity)>=0?row.severity:'info',page:token(row.page,60),code:token(row.meta&&row.meta.code||row.code,80)});
  }
  function create(storage,clock){
    clock=clock||Date.now;
    function read(){try{var rows=JSON.parse(storage.getItem(KEY)||'[]');return Array.isArray(rows)?rows.map(function(r){return minimal(r,r,clock());}).filter(Boolean).slice(0,LIMIT):[];}catch(_){return [];}}
    function write(rows){try{storage.setItem(KEY,JSON.stringify(rows.slice(0,LIMIT)));return true;}catch(_){return false;}}
    return {
      save:function(events,owner){
        var s=scope(owner);if(!s.owner||!s.tenantId||!s.dataEnv)return false;
        var rows=read(),ids=new Set((events||[]).map(function(e){return e.id;}));
        rows=rows.filter(function(r){return !same(r,s)||!ids.has(r.id);});
        (events||[]).filter(function(e){return e.remoteAuditStatus!=='synced';}).forEach(function(e){var r=minimal(e,s,clock());if(r)rows.push(r);});
        rows.sort(function(a,b){return b.time.localeCompare(a.time);});return write(rows);
      },
      pending:function(owner){var s=scope(owner);return read().filter(function(r){return same(r,s);});},
      clear:function(owner){var s=scope(owner);return write(read().filter(function(r){return !same(r,s);}));}
    };
  }
  var api={create:create,limit:LIMIT,ttl:TTL};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.FinanceDiagnosticOutbox=api;
})(typeof window==='object'?window:globalThis);
