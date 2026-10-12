'use strict';

// Fictional personnel only. The explicit edges are the source of truth for
// testing that chart filtering never changes a person's direct supervisor.
module.exports=function orgChartClarityFixture(){
  const entities=[
    {id:'E1',s:'虛構照護',full:'虛構照護股份有限公司',active:true},
    {id:'E2',s:'虛構支援',full:'虛構支援有限公司',active:true}
  ];
  const departments=[
    {c:'D1',n:'日間照顧課',eid:'E1',entityCodes:['E1'],lv:4,active:true},
    {c:'D2',n:'行政管理部',eid:'E1',entityCodes:['E1'],lv:3,active:true},
    {c:'X1',n:'東區服務課',eid:'E2',entityCodes:['E2'],lv:4,active:true},
    {c:'X2',n:'跨法人支援組',eid:'E2',entityCodes:['E2'],lv:5,active:true}
  ];
  const users=[],rows=[];
  function add(id,name,role,entity,department,supervisor,active=true){
    const person={id,n:name,init:name.slice(0,1),role,rL:role==='ceo'?'執行長':role==='dept_manager'?'部門主管':'一般組員',
      jobTitle:role==='ceo'?'執行長':role==='dept_manager'?'部門主管':'服務專員',
      eid:entity,dc:department,active,
      email:'fictional-'+id+'@suiyuecare.com',contactEmail:'fictional-'+id+'@example.invalid',
      googleLoginVerifiedAt:'2026-01-01T00:00:00Z',orgSource:'personnel_management'};
    users.push(person);
    rows.push({userId:id,userEmail:person.email,userName:name,userRole:role,
      supervisorId:supervisor||'',canApprove:role!=='employee',
      isDepartmentManager:role==='dept_manager',is_department_manager:role==='dept_manager'});
  }
  add('ceo-a','虛構總經理甲','ceo','E1','D2','');
  add('ceo-b','虛構總經理乙','ceo','E2','X1','');
  add('mgr-care','虛構照護主管','dept_manager','E1','D1','ceo-a');
  add('mgr-admin','虛構行政主管','dept_manager','E1','D2','ceo-a');
  add('mgr-east','虛構東區主管','dept_manager','E2','X1','ceo-b');
  for(let i=1;i<=30;i++){
    const id='staff-'+String(i).padStart(2,'0');
    const group=i<=12?['E1','D1','mgr-care']:i<=21?['E1','D2','mgr-admin']:['E2','X1','mgr-east'];
    add(id,'虛構組員'+String(i).padStart(2,'0'),'employee',group[0],group[1],group[2]);
  }
  // Literal punctuation and long names/titles must fit real cards and export.
  users.find(user=>user.id==='staff-28').n='虛構長姓名測試長姓名測試員';
  rows.find(row=>row.userId==='staff-28').userName='虛構長姓名測試長姓名測試員';
  users.find(user=>user.id==='staff-29').n='虛構 <&\" 員';
  rows.find(row=>row.userId==='staff-29').userName='虛構 <&\" 員';
  users.find(user=>user.id==='staff-30').jobTitle='虛構跨部門長期照顧資源整合暨品質管理專員';
  // Two people intentionally share a name: edit navigation must target IDs.
  users.find(user=>user.id==='staff-02').n='虛構組員01';
  rows.find(row=>row.userId==='staff-02').userName='虛構組員01';
  add('deep-manager','虛構深層主管','dept_manager','E1','D1','mgr-care');
  add('deep-person','虛構深層成員','employee','E1','D1','deep-manager');
  add('cross-company-staff','虛構跨法人支援員','employee','E2','X2','mgr-care');
  add('orphan','虛構缺主管員','employee','E1','D1','missing-manager');
  add('inactive-manager','虛構停用主管','dept_manager','E2','X1','ceo-b',false);
  add('inactive-report','虛構停用主管下屬','employee','E2','X1','inactive-manager');
  add('cycle-a','虛構循環甲','employee','E2','X2','cycle-b');
  add('cycle-b','虛構循環乙','employee','E2','X2','cycle-a');
  const byId=Object.fromEntries(users.map(user=>[user.id,user]));
  rows.forEach(row=>{
    const supervisor=byId[row.supervisorId];
    if(supervisor){row.supervisorEmail=supervisor.email;row.supervisorName=supervisor.n;row.supervisorRole=supervisor.role;}
  });
  return {entities,departments,users,rows,revision:'fictional-org-revision-7',
    expected:{activeCount:users.filter(user=>user.active).length,
      crossCompany:{person:'cross-company-staff',supervisor:'mgr-care'},
      missing:'orphan',inactive:'inactive-report',cycle:['cycle-a','cycle-b'],
      deep:'deep-person',sameName:['staff-01','staff-02']}};
};
