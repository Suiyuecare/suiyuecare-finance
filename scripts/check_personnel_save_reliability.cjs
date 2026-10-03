#!/usr/bin/env node
'use strict';

// Exercise the shipped personnel editor with fictional rows and a fake RPC.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function extract(name){
  const marker=name.startsWith('window.')?name+'=async function(':'function '+name+'(';
  let start=source.indexOf(marker);
  assert.ok(start>=0,'missing '+name);
  if(source.slice(start-6,start)==='async ')start-=6;
  const brace=source.indexOf('{',start);
  let depth=0,quote='',escaped=false;
  for(let i=brace;i<source.length;i++){
    const ch=source[i];
    if(quote){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch===quote)quote='';continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth++;
    if(ch==='}'&&!--depth)return source.slice(start,i+1)+(name.startsWith('window.')?';':'');
  }
  throw new Error('unterminated '+name);
}
const columns=(source.match(/var FINANCE_USER_SAFE_COLUMNS='([^']+)'/)||[])[1]||'';
assert.ok(columns.split(',').includes('member_revision'),'canonical personnel reads must include member_revision');
assert.match(source,/window\.openEditU=function\(id\)[\s\S]*?USER_EDIT_SNAPSHOT=Object\.assign\(\{\},u\)/,
  'edit snapshot must be captured when the modal opens');

const names=[
  'mapUser','financeMemberRevision','financeMemberProfileMatches','financeMemberSnapshot',
  'financeMemberSaveConflict','financeMemberSaveUncertain','financeMemberReadCanonical',
  'financeMemberExpectedRevision','financeMemberVerifyUnknownResult',
  'financeMemberAdminScope','financeMemberAttemptKey','financeMemberAttemptBlocked',
  'financeMemberPendingAttempt','financeMemberMarkAttempt','financeMemberClearAttempt',
  'financeMemberRequestId','financeMemberShowRetry','financeMemberRequestPending',
  'financeMemberRequestPayloadMismatch','window.submitAddUser','window.toggleU',
  'window.retryOriginalMemberSave'
];
function person(revision=4){return{
  id:'staff-1',tenant_id:'tenant-a',name:'測試人員',email:'person@suiyuecare.com',
  org_contact_email:'person@suiyuecare.com',job_title:'職員',extension:'123',
  role:'employee',entity_id:'E1',department_code:'D1',active:true,member_revision:revision,
  created_at:new Date(Date.now()-86400000).toISOString()
};}
function fixture(options={}){
  let row=options.row===undefined?person():options.row,mode=options.mode||'success';
  let completeRpc;
  const calls=[],reads=[],alerts=[],closed=[],fields={
    un:{value:'測試人員'},ujob:{value:'職員'},ue:{value:'person@suiyuecare.com'},
    ucontact:{value:'person@suiyuecare.com'},uext:{value:'123'},
    ur:{value:'employee'},ud:{value:'D1'},uent:{value:'E1'},
    'add-err':{style:{display:'none'},textContent:''},
    'user-modal-submit':{disabled:false},
    'user-retry-original':{disabled:false,style:{display:'none'},dataset:{pendingKey:''}}
  };
  const state={S:{demoLogin:false,page:'users',user:{id:'admin-1',authUserId:'auth-1'}},USERS:options.users===undefined?[{
    id:'staff-1',tenantId:'tenant-a',n:'測試人員',email:'person@suiyuecare.com',
    contactEmail:'person@suiyuecare.com',jobTitle:'職員',extension:'123',
    role:'employee',eid:'E1',dc:'D1',active:options.inactive?false:true,
    memberRevision:options.localRevision===undefined?4:options.localRevision
  }]:options.users,USER_EDIT_ID:options.create?'':'staff-1',
  USER_EDIT_SNAPSHOT:null,USER_EDIT_GENERATION:1,FINANCE_MEMBER_SAVE_INFLIGHT:false,
  FINANCE_MEMBER_PENDING_CONFIRMATIONS:Object.create(null),
  FINANCE_USER_SAFE_COLUMNS:columns,FINANCE_MEMBER_ADMIN_INFLIGHT:Object.create(null),
  financeAuthIdentityEpoch:1,
  RL:{employee:'一般組員'},console,Date,Promise,Number,Object,Array,
  crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},
  normalizedRoleKey:u=>u.role,entityOfDept:()=> 'E1',
  currentTenantId:()=> 'tenant-a',currentFinanceAuthUserId:()=>state.S.user.authUserId,
  activeDataEnvironment:()=> 'production',canManageUsers:()=>true,
  personnelDeptSelectRowsForPreferred:()=>[{c:'D1'}],
  financeGoogleLoginHealthForUser:u=>({email:u.email,status:'waiting_first_login'}),
  financeGoogleLoginStatusPresentation:()=>({detail:'等待本人登入'}),
  rememberFinanceGoogleLoginHealth:()=>{},saveLocalAppStateSoon:()=>{},
  renderUsers:()=>{},renderUsersHealth:()=>{},financeMemberRefreshAfterSave:()=>{},
  loadRemoteData:()=>{throw Error('broad reload must not run during save');},
  closeModal:name=>closed.push(name),openUserOffboarding:()=>{},
  isRpcMissing:()=>false,friendlyErrorMessage:e=>e&&e.message||String(e),
  el:id=>fields[id]||null,alert:value=>alerts.push(String(value)),
  withOperationTimeout:async pending=>await pending,
  getSb:()=>client
  };
  const client={
    from(table){assert.equal(table,'finance_users');let column,value;
      const query={select(requested){assert.ok(requested.includes('member_revision'));return query;},
        eq(key,arg){if(key!=='tenant_id'){column=key;value=arg;}return query;},
        limit(){return query;},
        then(resolve,reject){reads.push({column,value});
          const match=row&&String(row[column])===String(value)?[row]:[];
          return Promise.resolve({data:match,error:null}).then(resolve,reject);
        }};
      return query;
    },
    async rpc(name,args){assert.equal(name,'finance_admin_upsert_member_reliable_v1');calls.push(args);
      if(mode==='deferred')return new Promise(resolve=>{completeRpc=resolve;});
      if(mode==='conflict')return{error:{code:'PT409',status:409,message:'人員資料已由其他人更新'}};
      if(mode==='requestPending')return{error:{code:'PT409',status:409,details:'MEMBER_REQUEST_PENDING',message:'Original request still running'}};
      if(mode==='payloadMismatch')return{error:{code:'PT409',status:409,details:'MEMBER_REQUEST_PAYLOAD_MISMATCH',message:'Request payload mismatch'}};
      if(mode==='poolTimeout')return{error:{code:'PGRST003',message:'Timed out acquiring connection from connection pool'}};
      if(mode==='explicitFalse')return{data:{ok:false,atomic:false,member:{...person(5)}}};
      if(mode==='timeoutThenReplay'){
        if(calls.length===1){row={...row,name:args.p_member.name,active:args.p_member.active,member_revision:args.p_expected_revision+1};return{error:{status:504,message:'Gateway Timeout'}};}
        return{data:{ok:true,atomic:true,replayed:true,member:row}};
      }
      if(mode==='replayStale'){
        if(calls.length===1)return{error:{status:504,message:'Gateway Timeout'}};
        row={...row,name:'較新的其他異動',member_revision:7};
        return{data:{ok:true,atomic:true,replayed:true,member:{...row,name:args.p_member.name,member_revision:5}}};
      }
      if(mode==='timeout'){
        if(options.afterRpc)row=options.afterRpc(row,args);
        return{error:{status:504,message:'Gateway Timeout'}};
      }
      if(mode==='malformed'){
        if(options.afterRpc)row=options.afterRpc(row,args);
        return{data:{ok:true}};
      }
      const member={...row,id:args.p_member.id||'new-1',name:args.p_member.name,
        email:args.p_member.login_email,org_contact_email:args.p_member.contact_email,
        job_title:args.p_member.job_title,extension:args.p_member.extension,
        role:args.p_member.role,entity_id:args.p_member.entity_id,
        department_code:args.p_member.department_code,active:args.p_member.active,
        member_revision:args.p_expected_revision+1};
      return{data:{ok:true,atomic:true,member}};
    }
  };
  state.window=state;
  state.sessionStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
  state.USER_EDIT_SNAPSHOT=state.USER_EDIT_ID?{...state.USERS[0]}:null;
  vm.createContext(state);
  for(const name of names){
    try{vm.runInContext(extract(name),state);}catch(error){console.error('Failed extraction:',name,extract(name).slice(0,120));throw error;}
  }
  return{state,fields,calls,reads,alerts,closed,client,resolveRpc:value=>{
    assert.equal(typeof completeRpc,'function','the RPC must already be pending');completeRpc(value);
  }};
}
async function check(name,run){await run();console.log('PASS '+name);}
(async()=>{
  await check('existing member sends the authoritative positive revision and confirms without broad reload',async()=>{
    const f=fixture();await f.state.window.submitAddUser();
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].p_expected_revision,4);
    assert.equal(f.state.USERS[0].memberRevision,5);assert.equal(f.closed.length,1);
  });
  await check('missing cached revision reads one exact member and never writes version zero',async()=>{
    const f=fixture({localRevision:0});await f.state.window.submitAddUser();
    assert.equal(f.reads.length,1);assert.equal(f.reads[0].column,'id');
    assert.equal(f.calls[0].p_expected_revision,4);
  });
  await check('missing revision with changed canonical row preserves draft and sends no write',async()=>{
    const f=fixture({localRevision:0,row:{...person(),name:'另一人已更名'}});
    await f.state.window.submitAddUser();
    assert.equal(f.calls.length,0);assert.equal(f.closed.length,0);
    assert.equal(f.fields.un.value,'測試人員');assert.equal(f.fields['user-modal-submit'].disabled,true);
    assert.match(f.fields['add-err'].textContent,/核對最新資料/);
  });
  await check('PT409 business conflict is not retried and user draft stays intact',async()=>{
    const f=fixture({mode:'conflict'});await f.state.window.submitAddUser();
    assert.equal(f.calls.length,1);assert.equal(f.fields.un.value,'測試人員');
    assert.equal(f.fields['user-modal-submit'].disabled,true);
    assert.match(f.fields['add-err'].textContent,/不會自動覆蓋/);
  });
  await check('editing uses the modal-open baseline even after a background directory refresh',async()=>{
    const f=fixture({mode:'conflict'});
    f.state.USERS[0].memberRevision=5;
    f.state.USERS[0].n='另一人剛更新';
    await f.state.window.submitAddUser();
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].p_expected_revision,4);
    assert.equal(f.closed.length,0);assert.equal(f.fields.un.value,'測試人員');
    assert.match(f.fields['add-err'].textContent,/已由其他人更新/);
  });
  await check('gateway timeout with matching row remains unconfirmed after one bounded read',async()=>{
    const f=fixture({mode:'timeout',afterRpc:(old,args)=>({...old,member_revision:args.p_expected_revision+1})});
    await f.state.window.submitAddUser();
    assert.equal(f.calls.length,1);assert.equal(f.reads.length,1);
    assert.equal(f.closed.length,0);assert.equal(f.alerts.length,0);
    assert.match(f.fields['add-err'].textContent,/內容吻合.*無法證明/);
    assert.equal(f.fields['user-modal-submit'].disabled,true);
  });
  await check('gateway timeout without matching readback remains unknown and cannot be clicked again',async()=>{
    const f=fixture({mode:'timeout'});await f.state.window.submitAddUser();
    assert.equal(f.calls.length,1);assert.equal(f.closed.length,0);
    assert.equal(f.fields['user-modal-submit'].disabled,true);
    assert.match(f.fields['add-err'].textContent,/結果待確認/);
    assert.doesNotMatch(f.fields['add-err'].textContent,/維持原狀/);
  });
  await check('old existing email is not misidentified as a newly created member after timeout',async()=>{
    const f=fixture({mode:'timeout',create:true,users:[]});await f.state.window.submitAddUser();
    assert.equal(f.calls.length,1);assert.equal(f.closed.length,0);
    assert.match(f.fields['add-err'].textContent,/結果待確認/);
  });
  await check('new personnel creation succeeds with one atomic call and no offboarding action',async()=>{
    const f=fixture({create:true,users:[],row:null});await f.state.window.submitAddUser();
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].p_expected_revision,0);
    assert.equal(f.state.USERS.length,1);assert.equal(f.closed.length,1);
  });
  await check('malformed success response is not accepted as an atomic commit',async()=>{
    const f=fixture({mode:'malformed',afterRpc:(old,args)=>({...old,member_revision:args.p_expected_revision+1})});
    await f.state.window.submitAddUser();
    assert.equal(f.calls.length,1);assert.equal(f.reads.length,0);
    assert.equal(f.closed.length,0);assert.equal(f.alerts.length,0);
    assert.match(f.fields['add-err'].textContent,/沒有回傳完整/);
  });
  await check('explicit non-atomic rejection cannot be synthesized into success',async()=>{
    const f=fixture({mode:'explicitFalse'});await f.state.window.submitAddUser();
    assert.equal(f.calls.length,1);assert.equal(f.closed.length,0);
    assert.equal(f.fields['user-modal-submit'].disabled,true);
    assert.match(f.fields['add-err'].textContent,/不能視為本次/);
  });
  await check('PostgREST pool timeout stays uncertain and survives a modal reopen',async()=>{
    const f=fixture({mode:'poolTimeout'});await f.state.window.submitAddUser();
    assert.equal(f.calls.length,1);assert.equal(f.fields['user-modal-submit'].disabled,true);
    assert.match(f.fields['add-err'].textContent,/結果待確認/);
    f.state.USER_EDIT_GENERATION++;
    f.fields['user-modal-submit'].disabled=false;
    await f.state.window.submitAddUser();
    assert.equal(f.calls.length,1);assert.equal(f.fields['user-modal-submit'].disabled,true);
  });
  await check('retry after unknown replays the original UUID, member and revision only',async()=>{
    const f=fixture({mode:'timeoutThenReplay'});await f.state.window.submitAddUser();
    assert.equal(f.closed.length,0);
    assert.equal(f.fields['user-retry-original'].style.display,'inline-flex');
    f.fields.un.value='後續未送出的修改';
    await f.state.window.retryOriginalMemberSave();
    assert.equal(f.calls.length,2);
    assert.equal(JSON.stringify(f.calls[1]),JSON.stringify(f.calls[0]));
    assert.equal(f.calls[1].p_member.name,'測試人員');
    assert.match(f.calls[1].p_request_id,/^[0-9a-f-]{36}$/);
    assert.equal(f.closed.length,1);assert.equal(f.state.USERS[0].memberRevision,5);
  });
  await check('replayed receipt never overwrites a newer canonical personnel version',async()=>{
    const f=fixture({mode:'replayStale'});await f.state.window.submitAddUser();
    await f.state.window.retryOriginalMemberSave();
    assert.equal(f.state.USERS[0].memberRevision,7);
    assert.equal(f.state.USERS[0].n,'較新的其他異動');
  });
  await check('in-progress request conflict retains the original request for replay',async()=>{
    const f=fixture({mode:'requestPending'});await f.state.window.submitAddUser();
    assert.equal(f.calls.length,1);assert.equal(f.closed.length,0);
    assert.equal(f.fields['user-retry-original'].style.display,'inline-flex');
    await f.state.window.retryOriginalMemberSave();
    assert.equal(f.calls.length,2);
    assert.equal(JSON.stringify(f.calls[1]),JSON.stringify(f.calls[0]));
    assert.equal(f.fields['user-retry-original'].style.display,'inline-flex');
  });
  await check('request payload mismatch retains original attempt and cannot send new form values',async()=>{
    const f=fixture({mode:'payloadMismatch'});await f.state.window.submitAddUser();
    f.fields.un.value='不能混入的新內容';
    await f.state.window.retryOriginalMemberSave();
    assert.equal(f.calls.length,2);
    assert.equal(JSON.stringify(f.calls[1]),JSON.stringify(f.calls[0]));
    assert.match(f.fields['add-err'].textContent,/識別碼與正式紀錄的內容不一致/);
  });
  await check('two concurrent submit calls are singleflight',async()=>{
    const f=fixture({mode:'deferred'}),first=f.state.window.submitAddUser();
    await Promise.resolve();
    const second=f.state.window.submitAddUser();
    assert.equal(f.calls.length,1);
    f.resolveRpc({error:{code:'PT409',status:409,message:'人員資料已由其他人更新'}});
    await Promise.all([first,second]);
    assert.equal(f.calls.length,1);assert.equal(f.closed.length,0);
  });
  await check('late save response from another identity cannot update a new modal or user list',async()=>{
    const f=fixture({mode:'deferred'}),pending=f.state.window.submitAddUser();
    await Promise.resolve();
    f.state.S.user={id:'other-admin',authUserId:'other-auth'};
    f.state.financeAuthIdentityEpoch++;
    f.state.USER_EDIT_ID='staff-2';f.state.USER_EDIT_GENERATION++;
    f.resolveRpc({data:{ok:true,atomic:true,member:{...person(5),name:'過期回應'}}});
    await pending;
    assert.equal(f.closed.length,0);assert.equal(f.state.USERS[0].n,'測試人員');
    assert.equal(f.fields['add-err'].textContent,'');
  });
  await check('activation uses the same revision and conflict protection',async()=>{
    const f=fixture({inactive:true,row:{...person(),active:false}});
    await f.state.window.toggleU('staff-1');
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].p_expected_revision,4);
    assert.equal(f.calls[0].p_member.active,true);
    const stale=fixture({inactive:true,row:{...person(),active:false},mode:'conflict'});
    await stale.state.window.toggleU('staff-1');
    assert.equal(stale.calls.length,1);assert.match(stale.alerts[0],/重新整理人員清單/);
  });
  await check('late activation response from another identity cannot update personnel',async()=>{
    const f=fixture({inactive:true,row:{...person(),active:false},mode:'deferred'});
    const pending=f.state.window.toggleU('staff-1');await Promise.resolve();
    f.state.S.user={id:'other-admin',authUserId:'other-auth'};
    f.state.financeAuthIdentityEpoch++;
    f.resolveRpc({data:{ok:true,atomic:true,member:{...person(5),active:true}}});
    await pending;
    assert.equal(f.state.USERS[0].active,false);assert.equal(f.alerts.length,0);
  });
  console.log('20 personnel save reliability checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
