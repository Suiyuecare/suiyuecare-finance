'use strict';
// Fully fictional, deterministic organization; shared by before/after/browser tests.
module.exports=function departmentWorkspaceFixture(mode='draft'){
  const entities=[{id:'F1',code:'F1',short_name:'星河照護',legal_name:'星河照護股份有限公司',active:true},{id:'F2',code:'F2',short_name:'晴川服務',legal_name:'晴川生活服務有限公司',active:true}];
  const units=[];
  function unit(id,name,type,parent,posting=false){units.push({id,code:id.toUpperCase(),name,unit_type:type,parent_org_unit_id:parent,sort_order:units.length,active:true,is_posting_unit:posting,entity_scope_mode:parent?'inherit':'all',entity_codes:[],head:{vacant:true}});}
  unit('governance','星河股東會','shareholders','');unit('board','星河董事會','board','governance');unit('executive','星河經營層','executive','board');
  unit('care','照護服務部','department','executive',true);unit('daycare','日間照顧課','section','care',true);unit('east','東區照護組','team','daycare',true);unit('west','西區照護組','team','daycare',true);
  unit('home','居家服務課','section','care',true);unit('home_a','第一居服組','team','home',true);
  unit('admin','行政管理部','department','executive',true);unit('hr','人事支援課','section','admin',true);unit('finance','財務支援課','section','admin',true);
  const users=[{id:'fixture-ceo',finance_user_id:'fixture-ceo',n:'林星河',name:'林星河',email:'fictional-ceo@example.invalid',role:'ceo',rL:'執行長',eid:'F1',dc:'EXECUTIVE',active:true}];
  const assignments=[{id:'assignment-ceo',finance_user_id:'fixture-ceo',name:'林星河',org_unit_id:'executive',position_code:'EXECUTIVE_DIRECTOR',assignment_kind:'primary',head_kind:'permanent',can_approve:true,active:true,effective_from:'2026-01-01T00:00:00Z',effective_to:null}];
  const targetIds=['care','daycare','east','west','home','home_a','admin','hr','finance'];
  for(let i=1;i<=36;i++){
    const id='fixture-member-'+String(i).padStart(2,'0'),name='測試組員'+String(i).padStart(2,'0'),target=i===36?'daycare':targetIds[(i-1)%targetIds.length];
    users.push({id,finance_user_id:id,n:name,name,email:'fictional-'+i+'@example.invalid',role:'employee',rL:'一般組員',eid:'F1',dc:target.toUpperCase(),active:true});
    assignments.push({id:'assignment-'+i,finance_user_id:id,name,org_unit_id:target,position_code:'MEMBER',assignment_kind:'primary',head_kind:null,can_approve:false,active:true,effective_from:'2026-01-01T00:00:00Z',effective_to:null});
  }
  const permissions={can_manage:mode==='draft'||mode==='review',can_publish:mode==='review',is_permanent_ceo:mode==='review',can_view_people:mode!=='hidden'};
  const graph={org_version_id:'虛構組織第7版',etag:'fixture-etag',runtime_consistent:true,units,assignments,legal_entities:entities,permissions};
  const runtime={loading:false,available:true,error:'',graph,lastLoaded:'2026-09-08T00:00:00Z',subscription:null};
  const draft={version:mode==='draft'||mode==='review'?{id:'fixture-draft',title:'虛構組織調整',reason:'本機介面驗收資料',status:mode==='review'?'pending_review':'draft',revision:3}:null,snapshot:mode==='draft'||mode==='review'?{units:structuredClone(units),assignments:structuredClone(assignments),reporting_overrides:[]}:null,people:mode==='hidden'?[]:users,dirty:false,validation:{ok:true,errors:[],warnings:[]},impact:null,dragUnitId:'',batchUnitIds:[]};
  return {runtime,draft,users,entities,units};
};
