(function(){
  'use strict';

  var ROOT_CLASS='workflow-simplification-v1';
  var queued=false;
  var expenseSignature='';
  var observer=null;
  var TYPE_LABELS={
    expense_reimbursement:'費用報銷',
    payment_request:'付款申請',
    advance_request:'預支申請',
    petty_cash_request:'零用金申請',
    travel_request:'差旅申請',
    purchase_request:'採購申請',
    refund_request:'退款申請',
    welfare_request:'福利金申請',
    hr_expense_request:'人事費用申請'
  };

  function byId(id){return document.getElementById(id);}
  function text(node){return node&&String(node.textContent||'').replace(/\s+/g,' ').trim()||'';}
  function visible(node){return !!(node&&node.getClientRects&&node.getClientRects().length);}
  function money(value){
    var number=Number(String(value||'').replace(/[^0-9.-]/g,''));
    return Number.isFinite(number)?number:0;
  }
  function formatMoney(value){
    return 'NT$'+Math.round(Number(value)||0).toLocaleString('zh-TW');
  }
  function safeDate(value){
    var raw=String(value||'').trim().replace(/\//g,'-');
    if(!raw)return null;
    if(/^\d{2}-\d{2}$/.test(raw))raw=(new Date()).getFullYear()+'-'+raw;
    var parsed=new Date(raw+'T00:00:00');
    return Number.isNaN(parsed.getTime())?null:parsed;
  }
  function updateHtml(node,html){
    if(node&&node.innerHTML!==html)node.innerHTML=html;
  }
  function generated(tag,id,className){
    var node=byId(id);
    if(node)return node;
    node=document.createElement(tag);
    node.id=id;
    node.className='workflow-ui-generated '+className;
    return node;
  }
  function metric(label,value,detail){
    return '<div class="workflow-metric"><span>'+label+'</span><strong>'+value+'</strong>'+(detail?'<small>'+detail+'</small>':'')+'</div>';
  }

  function newRequestAmount(page){
    var candidates=['nr-amt','nr-total','nr-estimated-amount','nr-actual-amount','nr-purchase-estimated-amount','nr-advance-amount'];
    for(var i=0;i<candidates.length;i++){
      var field=byId(candidates[i]);
      if(field&&field.value&&money(field.value)>0)return money(field.value);
    }
    var inputs=page.querySelectorAll('#nr-content input[type="number"]');
    var total=0;
    inputs.forEach(function(input){
      if(/amount|amt|price|total/i.test(input.id||input.name||''))total+=money(input.value);
    });
    return total;
  }
  function currentNewRequestType(page){
    var state=window.S||{};
    if(state.nrType&&TYPE_LABELS[state.nrType])return TYPE_LABELS[state.nrType];
    var title=page.querySelector('#nr-content .cht,#nr-content h2,#nr-content h3');
    return text(title)||'尚未選擇申請類型';
  }
  function currentRouteState(){
    var health=byId('nr-route-health');
    var label=text(health);
    if(!label)return '送出時再次確認';
    if(/不能送出|未指定|錯誤|缺少/.test(label))return '尚有項目待修正';
    if(/可以送出|可送出|已確認|完成/.test(label))return '可送出簽核';
    return label.slice(0,28);
  }
  function enhanceNewRequest(){
    var page=byId('pg-newreq');
    if(!page)return;
    page.setAttribute('data-workflow-simplified','new-request');
    var side=byId('nr-side-panel');
    if(!side)return;
    side.removeAttribute('data-workflow-summary-only');
    var obsoleteSummary=byId('workflow-newreq-summary');
    if(obsoleteSummary)obsoleteSummary.remove();
    var content=byId('nr-content');
    if(content)content.querySelectorAll(':scope > .card').forEach(function(card,index){
      card.setAttribute('data-workflow-section',String(index+1));
    });
    var submit=page.querySelector('.nr-submit-actions');
    if(submit)submit.setAttribute('data-workflow-submit','true');
    if(!page.dataset.workflowSummaryBound){
      page.dataset.workflowSummaryBound='1';
      page.addEventListener('input',queueEnhance,true);
      page.addEventListener('change',queueEnhance,true);
    }
  }

  function expenseRows(){
    var body=byId('exp-tbody');
    if(!body)return [];
    return Array.from(body.rows||[]).filter(function(row){
      return row.cells&&row.cells.length>=7&&!/沒有|尚無|載入/.test(text(row));
    });
  }
  function expenseSnapshot(rows){
    var today=new Date();
    today.setHours(0,0,0,0);
    var month=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
    var inMonth=0,upcoming=0,total=0;
    rows.forEach(function(row){
      total+=money(text(row.cells[4]));
      var requestDate=String(text(row.cells[5])).replace(/\//g,'-');
      if(requestDate.indexOf(month)===0||requestDate.indexOf(month.slice(5))===0)inMonth++;
      var due=safeDate(text(row.cells[6]));
      if(due){
        var days=Math.floor((due.getTime()-today.getTime())/86400000);
        if(days>=0&&days<=7)upcoming++;
      }
    });
    return {count:rows.length,inMonth:inMonth,upcoming:upcoming,total:total};
  }
  function enhanceExpenses(){
    var page=byId('pg-expenses');
    if(!page)return;
    page.setAttribute('data-workflow-simplified','expense-list');
    var query=page.querySelector('.expense-query-panel');
    if(!query)return;
    var summary=generated('section','workflow-expense-summary','workflow-kpi-strip workflow-expense-summary');
    summary.setAttribute('aria-label','目前放款申請摘要');
    if(summary.parentNode!==page)page.insertBefore(summary,query);
    var rows=expenseRows();
    var snap=expenseSnapshot(rows);
    var signature=[snap.count,snap.inMonth,snap.upcoming,snap.total].join('|');
    if(signature!==expenseSignature){
      expenseSignature=signature;
      updateHtml(summary,
        metric('目前顯示',snap.count+' 筆','依目前搜尋條件')+
        metric('本月申請',snap.inMonth+' 筆','申請日期')+
        metric('七日內匯款',snap.upcoming+' 筆','預計匯款日')+
        metric('顯示金額',formatMoney(snap.total),'目前清單合計')
      );
    }
    var list=page.querySelector('[data-mobile-record-list="expenses"]');
    if(list)list.classList.add('workflow-record-list');
  }

  function updateApprovalBulkState(page){
    var slot=byId('approval-bulk-slot');
    if(!slot)return;
    var checked=page.querySelectorAll('.appr-pick:checked').length;
    slot.classList.toggle('workflow-bulk-empty',checked===0);
    slot.classList.toggle('workflow-bulk-active',checked>0);
    slot.setAttribute('data-workflow-selected',String(checked));
  }
  function enhanceApprovals(){
    var page=byId('pg-approvals');
    if(!page)return;
    page.setAttribute('data-workflow-simplified','approval-list');
    var shell=page.querySelector('.approval-shell');
    if(shell)shell.classList.add('workflow-approval-shell');
    var list=byId('appr-list');
    if(list)list.classList.add('workflow-record-list');
    updateApprovalBulkState(page);
    if(!page.dataset.workflowApprovalBound){
      page.dataset.workflowApprovalBound='1';
      page.addEventListener('change',function(event){
        if(event.target&&event.target.matches('.appr-pick,input[type="checkbox"]'))queueEnhance();
      },true);
    }
  }

  function classifyApprovalDetail(){
    var inner=byId('appr-inner');
    var modal=byId('m-appr');
    if(!inner||!modal||!visible(modal)||!inner.children.length)return;
    inner.setAttribute('data-workflow-simplified','approval-detail');
    Array.from(inner.children).forEach(function(child,index){
      child.classList.remove('workflow-detail-head','workflow-detail-alert','workflow-detail-decision','workflow-detail-purpose','workflow-detail-evidence','workflow-detail-timeline','workflow-detail-secondary','workflow-detail-body','workflow-detail-action');
      var label=text(child);
      if(index===0){child.classList.add('workflow-detail-head');return;}
      if(child.classList.contains('approval-action-section')){child.classList.add('workflow-detail-action');return;}
      if(child.classList.contains('ux-reject-card')||/已被駁回|尚未完成載入/.test(label)){child.classList.add('workflow-detail-alert');return;}
      if(child.classList.contains('supervisor-review-card')||/主管檢核重點|申請摘要/.test(label)){child.classList.add('workflow-detail-decision');return;}
      if(/^目的|申請目的/.test(label)){child.classList.add('workflow-detail-purpose');return;}
      if(/主管檢核附件|附件與佐證/.test(label)){child.classList.add('workflow-detail-evidence');return;}
      if(/簽核進度|流程進度/.test(label)){child.classList.add('workflow-detail-timeline');return;}
      if(child.querySelector('.accounting-lines-table,.invoice-review-table')||/會計科目|發票核對表/.test(label)){child.classList.add('workflow-detail-secondary');return;}
      child.classList.add('workflow-detail-body');
    });
  }

  function enhance(){
    if(!document.documentElement.classList.contains(ROOT_CLASS))return;
    enhanceNewRequest();
    enhanceExpenses();
    enhanceApprovals();
    classifyApprovalDetail();
  }
  function queueEnhance(){
    if(queued)return;
    queued=true;
    requestAnimationFrame(function(){queued=false;enhance();});
  }
  function enable(){
    document.documentElement.classList.add(ROOT_CLASS);
    queueEnhance();
  }
  function disable(){
    document.documentElement.classList.remove(ROOT_CLASS);
  }

  window.financeWorkflowSimplificationRefresh=queueEnhance;
  window.financeWorkflowSimplificationEnable=enable;
  window.financeWorkflowSimplificationDisable=disable;

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',enable,{once:true});
  else enable();
  observer=new MutationObserver(queueEnhance);
  observer.observe(document.documentElement,{subtree:true,childList:true});
})();
