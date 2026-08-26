(function financeMobileUxEngine(){
  'use strict';

  var MOBILE_ROLE_PRIMARY_NAV_LIMIT=4;
  var PHONE_QUERY='(max-width: 760px)';
  var MOBILE_PRIMARY_PAGES=['dashboard','newreq','approvals','invoices'];
  var pageIcons={
    dashboard:'⌂',newreq:'＋',expenses:'▤',approvals:'✓',vouchers:'票',shareholder:'↔',
    invoices:'發',bills:'繳',recv:'收',reports:'表',ledger:'帳',accounts:'科',
    compliance:'檢',notif:'鈴',users:'人',orgchart:'組',health:'診',settings:'設'
  };
  var pageLabels={
    dashboard:'首頁',newreq:'新增',expenses:'我的',approvals:'簽核',vouchers:'傳票',
    shareholder:'往來',invoices:'發票',bills:'繳費單',recv:'收款',reports:'三表',
    ledger:'分類帳',accounts:'科目',compliance:'合規',notif:'通知',users:'人員',
    orgchart:'組織',health:'健檢',settings:'設定'
  };
  var rolePrimary={
    accountant:MOBILE_PRIMARY_PAGES,cashier:MOBILE_PRIMARY_PAGES,ceo:MOBILE_PRIMARY_PAGES,
    general_manager:MOBILE_PRIMARY_PAGES,admin_director:MOBILE_PRIMARY_PAGES,dept_manager:MOBILE_PRIMARY_PAGES,
    section_chief:MOBILE_PRIMARY_PAGES,general_affairs:MOBILE_PRIMARY_PAGES,business_assistant:MOBILE_PRIMARY_PAGES,
    case_manager:MOBILE_PRIMARY_PAGES,employee:MOBILE_PRIMARY_PAGES
  };
  var observerQueued=false;
  var mobileMoreReturnFocus=null;
  var mobileMoreMenuSignature='';
  var mobileShareholderCurrentStep=1;
  var mobileComplianceCurrent='pending';
  var mobileDashboardCurrent='overview';
  var mobileUsersCurrent='list';
  var mobileOrgCurrent='chart';
  var mobileHealthCurrent='summary';

  function isPhone(){return !!(window.matchMedia&&window.matchMedia(PHONE_QUERY).matches);}
  function currentRole(){
    if(typeof window.financeCurrentRoleKey==='function'){
      try{return String(window.financeCurrentRoleKey()||'employee');}catch(_error){}
    }
    return String((window.S&&window.S.user&&window.S.user.role)||'employee');
  }
  function navPageFromButton(button){
    var match=String(button&&button.getAttribute('onclick')||'').match(/nav\(['"]([^'"]+)/);
    return match?match[1]:'';
  }
  function desktopNavItems(){
    return Array.prototype.slice.call(document.querySelectorAll('#sidebar nav .ni')).map(function(button){
      return {button:button,page:navPageFromButton(button)};
    }).filter(function(item){
      return item.page&&!item.button.hidden&&item.button.style.display!=='none'&&!item.button.hasAttribute('disabled');
    });
  }
  function allowedPages(){return desktopNavItems().map(function(item){return item.page;});}
  function primaryPages(){
    var allowed=allowedPages();
    var wanted=(rolePrimary[currentRole()]||MOBILE_PRIMARY_PAGES).filter(function(page){return allowed.indexOf(page)>-1;});
    return wanted.slice(0,MOBILE_ROLE_PRIMARY_NAV_LIMIT);
  }
  function primaryIcon(page){
    var icons={
      dashboard:'<svg viewBox="0 0 24 24"><path d="M4 11.5 12 4l8 7.5v8H5v-8M9 20v-6h6v6"/></svg>',
      newreq:'<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7zM14 3v5h5M10 13h6M13 10v6"/></svg>',
      approvals:'<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 4v3M16 4v3M8 12l2.5 2.5L16 9"/></svg>',
      invoices:'<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4"/></svg>'
    };
    return icons[page]||'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>';
  }
  function desktopIcon(page){
    var item=desktopNavItems().find(function(row){return row.page===page;});
    var icon=item&&item.button.querySelector('.nav-ico');
    return icon?icon.innerHTML:primaryIcon(page);
  }
  function labelFor(page){
    if(pageLabels[page])return pageLabels[page];
    var item=desktopNavItems().find(function(row){return row.page===page;});
    return item?String(item.button.textContent||page).replace(/\s*[—\d]+\s*$/,'').trim():page;
  }
  function menuLabelFor(page){
    var item=desktopNavItems().find(function(row){return row.page===page;});
    if(!item)return labelFor(page);
    var copy=item.button.cloneNode(true);
    Array.prototype.forEach.call(copy.querySelectorAll('.nav-ico,.cnt,.dot'),function(node){node.remove();});
    return String(copy.textContent||'').replace(/\s+/g,' ').trim()||labelFor(page);
  }
  function updatePrimaryNavigation(){
    var nav=document.querySelector('[data-mobile-bottom-nav="role-primary"]');
    if(!nav)return;
	var main=document.getElementById('main-wrap');
	var signedIn=!!(window.S&&window.S.user&&main&&main.style.display!=='none');
	nav.hidden=!signedIn;
	if(!signedIn){window.closeMobileMore();return;}
    var pages=primaryPages();
    var buttons=Array.prototype.slice.call(nav.querySelectorAll('[data-mobile-primary-action]'));
    buttons.forEach(function(button,index){
      var page=pages[index]||'dashboard';
      if(button.dataset.mobilePrimaryAction!==page)button.dataset.mobilePrimaryAction=page;
      if(button.dataset.mobilePage!==page)button.dataset.mobilePage=page;
      button.hidden=!pages[index];
      var icon=button.querySelector('span');
      var label=button.querySelector('b');
      var iconMarkup=desktopIcon(page),pageLabel=labelFor(page);
      if(icon&&icon.innerHTML!==iconMarkup)icon.innerHTML=iconMarkup;
      if(label&&label.textContent!==pageLabel)label.textContent=pageLabel;
      if(button.getAttribute('aria-label')!==pageLabel)button.setAttribute('aria-label',pageLabel);
      if(button.getAttribute('title')!==pageLabel)button.setAttribute('title',pageLabel);
      button.onclick=function(){window.mobileNavigate(page);};
    });
    var current=String((window.S&&window.S.page)||'dashboard');
    Array.prototype.slice.call(nav.querySelectorAll('button')).forEach(function(button){
      var active=button.dataset.mobilePage===current;
      button.classList.toggle('on',active);
      if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    });
    renderMoreSheet(pages);
  }
  function renderMoreSheet(){
    var grid=document.getElementById('mobile-more-grid');
    if(!grid)return;
    var allowed=allowedPages(),items=[];
    Array.prototype.forEach.call(document.querySelectorAll('#sidebar nav>*'),function(node){
      if(!node.classList.contains('ni'))return;
      var page=navPageFromButton(node);
      if(!page||allowed.indexOf(page)<0)return;
      items.push({page:page,node:node,label:menuLabelFor(page),icon:desktopIcon(page)});
    });
    var signature=items.map(function(item){return item.page+':'+item.label+':'+item.icon;}).join('|');
    if(mobileMoreMenuSignature!==signature||grid.dataset.mobileMenuSignature!==signature){
      grid.innerHTML='';
      items.forEach(function(item){
        var button=document.createElement('button');
        button.type='button';
        button.dataset.mobileMorePage=item.page;
        button.innerHTML='<span class="mobile-more-icon" aria-hidden="true">'+item.icon+'</span><b></b>';
        button.querySelector('b').textContent=item.label;
        button.setAttribute('aria-label','前往'+item.label);
        button.addEventListener('click',function(event){event.preventDefault();window.mobileNavigate(item.page);});
        grid.appendChild(button);
      });
      mobileMoreMenuSignature=signature;
      grid.dataset.mobileMenuSignature=signature;
    }
    var current=String((window.S&&window.S.page)||'dashboard');
    items.forEach(function(item){
      var button=grid.querySelector('[data-mobile-more-page="'+item.page+'"]');
      if(!button)return;
      var active=item.page===current;
      button.classList.toggle('on',active);
      if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
      var sourceCount=item.node.querySelector('.cnt');
      var count=button.querySelector('em');
      if(sourceCount&&!count){count=document.createElement('em');button.appendChild(count);}
      if(sourceCount&&count){var value=String(sourceCount.textContent||'').trim();if(count.textContent!==value)count.textContent=value;count.hidden=!value;}
      if(!sourceCount&&count)count.remove();
    });
    var user=document.getElementById('mobile-more-user');
    if(user){
      var row=window.S&&window.S.user;
      var name=row&&(row.n||row.email)||'目前使用者';
      var role=row&&[(row.rL||''),(row.dc||'')].filter(Boolean).join(' · ')||'';
      var userSignature=name+'|'+role;
      if(user.dataset.mobileUserSignature!==userSignature){
        user.innerHTML='';
        var avatar=document.createElement('span');avatar.className='mobile-more-avatar';avatar.textContent=String(name).trim().slice(0,1)||'使';
        var copy=document.createElement('span');copy.className='mobile-more-user-copy';
        var strong=document.createElement('strong');strong.textContent=name;
        var small=document.createElement('small');small.textContent=role||'會計系統使用者';
        copy.appendChild(strong);copy.appendChild(small);
        var logout=document.createElement('button');logout.type='button';logout.className='mobile-more-logout';logout.setAttribute('aria-label','登出');logout.setAttribute('title','登出');logout.textContent='↪';logout.addEventListener('click',function(){window.financeLogout();});
        user.appendChild(avatar);user.appendChild(copy);user.appendChild(logout);
        user.dataset.mobileUserSignature=userSignature;
      }
    }
  }
  function ensureMobileMorePortal(){
    var backdrop=document.getElementById('mobile-more-backdrop');
    if(!backdrop)return null;
    if(backdrop.parentElement!==document.body)document.body.appendChild(backdrop);
    if(backdrop.dataset.mobileEventsBound!=='1'){
      backdrop.dataset.mobileEventsBound='1';
      backdrop.addEventListener('click',function(event){if(event.target===backdrop)window.closeMobileMore();});
      var close=backdrop.querySelector('[data-mobile-more-close]');
      if(close)close.addEventListener('click',function(event){event.preventDefault();event.stopPropagation();window.closeMobileMore();});
    }
    return backdrop;
  }
  function scrollMobilePageTop(page){
    if(!isPhone()||!(window.S&&window.S.page===page))return;
    var content=document.querySelector('.content');
    if(content){content.scrollTop=0;content.scrollLeft=0;}
    window.scrollTo(0,0);
  }
  window.mobileNavigate=function(page){
    window.closeMobileMore({restoreFocus:false});
    var navigation=null;
    try{navigation=typeof window.nav==='function'?window.nav(page,null):null;}
    catch(error){console.error('[mobile navigation] failed',error);return Promise.resolve(false);}
    return Promise.resolve(navigation).then(function(){scrollMobilePageTop(page);updatePrimaryNavigation();return true;}).catch(function(error){console.error('[mobile navigation] failed',error);return false;});
  };
  window.openMobileMore=function(){
    updatePrimaryNavigation();
    var backdrop=ensureMobileMorePortal();
    if(!backdrop)return;
	mobileMoreReturnFocus=document.activeElement;
    backdrop.hidden=false;
    backdrop.style.display='flex';
    backdrop.setAttribute('aria-hidden','false');
    var menuButton=document.getElementById('mobile-menu-button');if(menuButton)menuButton.setAttribute('aria-expanded','true');
    document.documentElement.classList.add('mobile-sheet-open');
    var close=backdrop.querySelector('header button');if(close)close.focus();
  };
  window.closeMobileMore=function(options){
    var backdrop=document.getElementById('mobile-more-backdrop');
    if(backdrop){backdrop.hidden=true;backdrop.style.display='none';backdrop.setAttribute('aria-hidden','true');}
    var menuButton=document.getElementById('mobile-menu-button');if(menuButton)menuButton.setAttribute('aria-expanded','false');
    document.documentElement.classList.remove('mobile-sheet-open');
	if((!options||options.restoreFocus!==false)&&mobileMoreReturnFocus&&typeof mobileMoreReturnFocus.focus==='function')mobileMoreReturnFocus.focus();
	mobileMoreReturnFocus=null;
  };

  function setCellLabels(table){
    if(!table)return;
    var labels=Array.prototype.map.call(table.querySelectorAll('thead th'),function(th){
      var copy=th.cloneNode(true);
      Array.prototype.forEach.call(copy.querySelectorAll('.sort-mark,.finance-visually-hidden'),function(node){node.remove();});
      return String(copy.textContent||'').replace(/[↕↑↓]/g,'').replace(/\s+/g,' ').trim();
    });
    Array.prototype.forEach.call(table.tBodies||[],function(body){
      Array.prototype.forEach.call(body.rows||[],function(row){
        Array.prototype.forEach.call(row.cells||[],function(cell,index){
          if(!cell.dataset.mobileCardLabel)cell.dataset.mobileCardLabel=labels[index]||'';
          if(cell.style&&cell.style.display==='none')cell.setAttribute('data-mobile-field-hidden','true');
          else cell.removeAttribute('data-mobile-field-hidden');
        });
      });
    });
    table.dataset.mobileLabels='1';
  }
  function installKeyboardActivation(node){
    if(!node)return;
    var disabled=node.getAttribute('aria-disabled')==='true'||!node.hasAttribute('onclick');
    if(disabled){
      if(node.dataset.mobileKeyboardRole==='1'){
        node.removeAttribute('role');node.removeAttribute('tabindex');delete node.dataset.mobileKeyboardRole;
      }
      return;
    }
    node.setAttribute('role','button');
    node.setAttribute('tabindex','0');
    node.dataset.mobileKeyboardRole='1';
    if(node.dataset.mobileKeyboardBound)return;
    node.dataset.mobileKeyboardBound='1';
    node.addEventListener('keydown',function(event){
      if(event.key!=='Enter'&&event.key!==' ')return;
      if(event.target!==node&&event.target.closest('button,a,input,select,textarea,label,summary,[role="button"]'))return;
      if(node.getAttribute('aria-disabled')==='true'||!node.hasAttribute('onclick'))return;
      event.preventDefault();
      node.click();
    });
  }
  function markRows(table,kind,attribute){
    if(!table)return;
    setCellLabels(table);
    table.classList.add('mobile-native-card-table');
    Array.prototype.forEach.call(table.querySelectorAll('tbody tr'),function(row){
      row.setAttribute(attribute,kind);
      if(attribute==='data-mobile-record-card')installKeyboardActivation(row);
    });
  }
  function enhanceWorkLists(){
    var expenses=document.querySelector('#pg-expenses .expense-list-table');
    markRows(expenses,'expenses','data-mobile-record-card');
    Array.prototype.forEach.call(document.querySelectorAll('#appr-list .approval-table'),function(table){
      markRows(table,'approvals','data-mobile-record-card');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#invoice-single-sheet table'),function(table){
      markRows(table,'invoice','data-mobile-entry-card');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#invoice-batch-sheet table'),function(table){
      markRows(table,'invoice','data-mobile-entry-card');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#bill-entry-sheet table'),function(table){
      markRows(table,'bill','data-mobile-entry-card');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#nr-content .excel-sheet-table'),function(table){
      markRows(table,'newreq','data-mobile-entry-card');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#notif-list .notif-row'),function(row){
      row.setAttribute('data-mobile-touch-target','notification');
      installKeyboardActivation(row);
    });
  }
  function enhanceApprovalChrome(){
    var tabs=document.querySelector('#pg-approvals .approval-tabs-scroll');
    if(tabs){
      Array.prototype.forEach.call(tabs.querySelectorAll('.tb'),function(tab){
        var active=tab.classList.contains('on');
        tab.setAttribute('aria-selected',active?'true':'false');
        tab.setAttribute('tabindex',active?'0':'-1');
      });
      if(isPhone()){
        var current=tabs.querySelector('.tb.on');
        if(current){
          var currentKey=String(current.getAttribute('onclick')||current.textContent||'').trim();
          if(tabs.dataset.mobileCenteredTab!==currentKey){
            tabs.dataset.mobileCenteredTab=currentKey;
            var left=current.offsetLeft-(tabs.clientWidth-current.offsetWidth)/2;
            if(Math.abs(tabs.scrollLeft-left)>4)tabs.scrollTo({left:Math.max(0,left),behavior:'smooth'});
          }
        }
      }else{
        delete tabs.dataset.mobileCenteredTab;
      }
    }
  }
  function enhanceApprovalActions(){
    var modal=document.getElementById('appr-inner');
    if(!modal)return;
    var existing=Array.prototype.slice.call(modal.querySelectorAll('.mobile-approval-action-footer'));
    existing.forEach(function(footer){
      Array.prototype.slice.call(footer.children).forEach(function(button){
        var marker=button.__financeMobileActionOrigin;
        if(marker&&marker.parentNode){marker.parentNode.insertBefore(button,marker);marker.remove();}
      });
      footer.remove();
    });
  }
  function installLoginHelp(){
    if(document.getElementById('mobile-login-help'))return;
    var right=document.querySelector('#login-screen .login-right>.login-panel');
    if(!right)return;
    var links=Array.prototype.slice.call(document.querySelectorAll('#login-screen .manual-download'));
    var details=document.createElement('details');
    details.id='mobile-login-help';
    details.className='mobile-login-help';
    details.innerHTML='<summary>版本資訊與使用說明</summary><div></div>';
    var box=details.querySelector('div');
    links.forEach(function(link){box.appendChild(link.cloneNode(true));});
    right.appendChild(details);
  }
	function installLoginBrand(){
	  if(document.getElementById('mobile-login-brand'))return;
	  var right=document.querySelector('#login-screen .login-right');
	  var source=document.querySelector('#login-screen .login-mark');
	  if(!right||!source)return;
	  var brand=source.cloneNode(true);
	  brand.id='mobile-login-brand';
	  brand.classList.add('mobile-login-brand');
	  right.insertBefore(brand,right.firstChild);
	}
  function syncNewRequestView(){
    var control=document.querySelector('[data-mobile-advanced-sheet="newreq"]');
    var content=document.getElementById('nr-content');
    if(!control||!content)return;
	control.hidden=!content.querySelector('.excel-sheet-table');
    content.classList.toggle('mobile-advanced-open',control.open);
  }
  function syncInvoiceModeUi(){
    var mode='batch';
    var single=document.getElementById('mobile-invoice-single');
    var batch=document.getElementById('mobile-invoice-batch');
    if(single)single.classList.toggle('on',mode==='single');
    if(batch)batch.classList.toggle('on',mode==='batch');
  }
  function reconcileInvoiceViewport(){
    if(!window.S)return;
    var mode='batch';
    window.S.invMode='batch';
    window.S.invMobileChoice='batch';
    var singleSheet=document.getElementById('inv-s');
    var batchSheet=document.getElementById('inv-b');
    if(singleSheet)singleSheet.style.display=mode==='single'?'block':'none';
    if(batchSheet)batchSheet.style.display=mode==='batch'?'block':'none';
    var disclosure=document.querySelector('[data-mobile-batch-sheet="invoice"]');
    if(disclosure)disclosure.open=true;
    syncInvoiceModeUi();
  }
  function reconcileShareholderWizard(options){
    var wizard=document.querySelector('[data-mobile-shareholder-wizard]');
    var progress=document.querySelector('[data-mobile-shareholder-progress]');
    var actions=document.querySelector('[data-mobile-shareholder-actions]');
    if(!wizard||!progress||!actions)return;
    var phone=isPhone();
    var previousLayout=wizard.dataset.mobileLayout||'';
    wizard.dataset.mobileLayout=phone?'phone':'desktop';
    var steps=Array.prototype.slice.call(wizard.querySelectorAll('[data-mobile-shareholder-step]'));
    var optional=Array.prototype.slice.call(wizard.querySelectorAll('[data-mobile-shareholder-optional]'));
    var originalSubmit=document.getElementById('sh-submit-btn');
    if(!phone){
      if(originalSubmit&&originalSubmit.__financeMobileShareholderOrigin&&originalSubmit.__financeMobileShareholderOrigin.parentNode){
        originalSubmit.__financeMobileShareholderOrigin.parentNode.insertBefore(originalSubmit,originalSubmit.__financeMobileShareholderOrigin);
        originalSubmit.__financeMobileShareholderOrigin.remove();
        originalSubmit.__financeMobileShareholderOrigin=null;
      }
      if(originalSubmit){originalSubmit.hidden=false;originalSubmit.removeAttribute('data-mobile-shareholder-submit');}
      steps.forEach(function(step){step.hidden=false;step.removeAttribute('aria-hidden');});
      optional.forEach(function(details){details.open=true;});
      progress.hidden=true;actions.hidden=true;
      return;
    }
    if(previousLayout!=='phone')optional.forEach(function(details){details.open=false;});
    if(originalSubmit&&!originalSubmit.__financeMobileShareholderOrigin){
      var submitOrigin=document.createComment('finance-mobile-shareholder-submit-origin');
      originalSubmit.parentNode.insertBefore(submitOrigin,originalSubmit);
      originalSubmit.__financeMobileShareholderOrigin=submitOrigin;
      actions.appendChild(originalSubmit);
    }
    mobileShareholderCurrentStep=Math.max(1,Math.min(3,mobileShareholderCurrentStep||1));
    progress.hidden=false;actions.hidden=false;
    steps.forEach(function(step){
      var active=Number(step.dataset.mobileShareholderStep)===mobileShareholderCurrentStep;
      step.hidden=!active;step.setAttribute('aria-hidden',active?'false':'true');
    });
    Array.prototype.forEach.call(progress.querySelectorAll('[data-mobile-shareholder-progress-step]'),function(item){
      var active=Number(item.dataset.mobileShareholderProgressStep)===mobileShareholderCurrentStep;
      item.classList.toggle('on',active);
      if(active)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');
    });
    var previous=actions.querySelector('[data-mobile-shareholder-prev]');
    var next=actions.querySelector('[data-mobile-shareholder-next]');
    var submit=actions.querySelector('#sh-submit-btn');
    if(previous)previous.hidden=mobileShareholderCurrentStep===1;
    if(next)next.hidden=mobileShareholderCurrentStep===3;
    if(submit){submit.hidden=mobileShareholderCurrentStep!==3;submit.setAttribute('data-mobile-shareholder-submit','');}
    if(options&&options.focus){
      var current=wizard.querySelector('[data-mobile-shareholder-step="'+mobileShareholderCurrentStep+'"]');
      if(current)current.focus();
    }
  }
  window.mobileShareholderStep=function(delta){
    if(!isPhone())return;
    mobileShareholderCurrentStep=Math.max(1,Math.min(3,mobileShareholderCurrentStep+(Number(delta)||0)));
    reconcileShareholderWizard({focus:true});
  };
  function accountRowInteractiveTarget(target,row){
    if(target===row)return false;
    var interactive=target.closest('button,a,input,select,textarea,label,summary,[role="button"]');
    return !!interactive&&interactive!==row;
  }
  function bindMobileAccountRow(row){
    if(row.dataset.mobileAccountBound)return;
    row.dataset.mobileAccountBound='1';
    row.addEventListener('click',function(event){
      if(!isPhone()||accountRowInteractiveTarget(event.target,row))return;
      var expanded=row.getAttribute('aria-expanded')==='true';
      row.setAttribute('aria-expanded',expanded?'false':'true');
    });
    row.addEventListener('keydown',function(event){
      if(!isPhone()||(event.key!=='Enter'&&event.key!==' ')||accountRowInteractiveTarget(event.target,row))return;
      event.preventDefault();row.click();
    });
  }
  function enhanceAccountList(){
    var table=document.querySelector('#pg-accounts .mobile-account-table');
    var body=document.getElementById('acc-tbody');
    var pager=document.querySelector('[data-mobile-account-pager]');
    if(!table||!body||!pager)return;
    var rows=Array.prototype.slice.call(body.querySelectorAll('tr'));
    if(!isPhone()){
      rows.forEach(function(row){row.hidden=false;row.removeAttribute('role');row.removeAttribute('tabindex');row.removeAttribute('aria-expanded');row.removeAttribute('data-mobile-account-row');});
      pager.hidden=true;
      return;
    }
    setCellLabels(table);
    table.classList.add('mobile-native-card-table');
    rows.forEach(function(row){
      var isEmpty=row.cells.length===1&&row.cells[0].hasAttribute('colspan');
      row.setAttribute('data-mobile-account-row','');
      if(!isEmpty){
        row.setAttribute('role','button');row.setAttribute('tabindex','0');
        var code=row.cells[1]?String(row.cells[1].textContent||'').trim():'';
        var name=row.cells[2]?String(row.cells[2].textContent||'').trim():'';
        row.setAttribute('aria-label',(code+' '+name+'，點一下查看範圍與使用情形').trim());
        if(!row.hasAttribute('aria-expanded'))row.setAttribute('aria-expanded','false');
        bindMobileAccountRow(row);
      }
    });
    pager.hidden=false;
  }
  function enhanceComplianceTabs(){
    var page=document.getElementById('pg-compliance');
    var tabs=document.querySelector('[data-mobile-compliance-tabs]');
    if(!page||!tabs)return;
    var panes=Array.prototype.slice.call(page.querySelectorAll('[data-mobile-compliance-pane]'));
    var groups=Array.prototype.slice.call(page.querySelectorAll('.g2'));
    if(!isPhone()){
      panes.forEach(function(pane){pane.hidden=false;pane.removeAttribute('aria-hidden');});
      groups.forEach(function(group){group.hidden=false;});
      tabs.hidden=true;delete page.dataset.mobileComplianceCurrent;
      return;
    }
    tabs.hidden=false;page.dataset.mobileComplianceCurrent=mobileComplianceCurrent;
    panes.forEach(function(pane){
      var active=pane.dataset.mobileCompliancePane===mobileComplianceCurrent;
      pane.hidden=!active;pane.setAttribute('aria-hidden',active?'false':'true');
    });
    groups.forEach(function(group){
      var children=Array.prototype.slice.call(group.querySelectorAll(':scope > [data-mobile-compliance-pane]'));
      group.hidden=!!children.length&&children.every(function(child){return child.hidden;});
    });
    Array.prototype.forEach.call(tabs.querySelectorAll('[data-mobile-compliance-tab]'),function(tab){
      var active=tab.dataset.mobileComplianceTab===mobileComplianceCurrent;
      tab.setAttribute('aria-selected',active?'true':'false');tab.tabIndex=active?0:-1;tab.classList.toggle('on',active);
    });
  }
  window.mobileComplianceTab=function(name,button){
    if(['pending','close','archive'].indexOf(name)<0)return;
    mobileComplianceCurrent=name;enhanceComplianceTabs();
    if(button&&typeof button.focus==='function')button.focus();
  };
  function secondBatchPage(name){return document.getElementById('pg-'+name);}
  function secondBatchPanelStateKey(section){return section==='advanced'?'mobileAdvancedOpen':'mobileFilterOpen';}
  window.mobileTogglePagePanel=function(name,section,button){
    if(!isPhone()||['filter','advanced'].indexOf(section)<0)return;
    var page=secondBatchPage(name);if(!page)return;
    var key=secondBatchPanelStateKey(section);
    page.dataset[key]=page.dataset[key]==='true'?'false':'true';
    reconcileSecondBatchPanels();
    if(button&&typeof button.focus==='function')button.focus();
  };
  function reconcileSecondBatchPanels(){
    ['vouchers','recv','reports','ledger'].forEach(function(name){
      var page=secondBatchPage(name);if(!page)return;
      if(!isPhone()){
        delete page.dataset.mobileFilterOpen;delete page.dataset.mobileAdvancedOpen;
      }
      Array.prototype.forEach.call(page.querySelectorAll('[data-mobile-page-toggle]'),function(button){
        var section=button.dataset.mobilePageToggle;
        var open=isPhone()&&page.dataset[secondBatchPanelStateKey(section)]==='true';
        button.setAttribute('aria-expanded',open?'true':'false');
        var indicator=button.querySelector('[aria-hidden="true"]');if(indicator)indicator.textContent=open?'－':'＋';
      });
    });
  }
  function enhanceSecondBatchLists(){
    Array.prototype.forEach.call(document.querySelectorAll('#voucher-list .mobile-voucher-card,#recv-detail .recv-item'),function(row){installKeyboardActivation(row);});
    var ledger=document.querySelector('#pg-ledger .mobile-ledger-table');
    if(ledger){
      setCellLabels(ledger);ledger.classList.add('mobile-second-ledger-table');
      Array.prototype.forEach.call(ledger.querySelectorAll('tbody tr'),function(row){row.setAttribute('data-mobile-ledger-card','');});
    }
    Array.prototype.forEach.call(document.querySelectorAll('#pg-reports .reports-statement-panel table'),function(table){
      setCellLabels(table);table.classList.add('mobile-second-report-table');
    });
  }
  function reconcileMobileReportView(){
    var page=secondBatchPage('reports');if(!page)return;
    if(!isPhone())return;
    if(!page.classList.contains('on')||page.dataset.mobileReportInitialized==='1')return;
    var buttons=Array.prototype.slice.call(page.querySelectorAll('.reports-statement-tabs .rtab'));
    var profit=buttons[1];
    if(profit&&typeof window.rptTab==='function')window.rptTab('pl',profit);
    page.dataset.mobileReportInitialized='1';
  }
  function syncMobileThirdTabs(containerSelector,buttonSelector,current){
    var container=document.querySelector(containerSelector);if(!container)return;
    Array.prototype.forEach.call(container.querySelectorAll(buttonSelector),function(button){
      var key=button.dataset.mobileDashboardTab||button.dataset.mobileUsersTab||button.dataset.mobileOrgTab||button.dataset.mobileHealthTab||'';
      var active=key===current;
      button.classList.toggle('on',active);button.setAttribute('aria-selected',active?'true':'false');button.tabIndex=active?0:-1;
    });
  }
  function thirdTabFocus(button){
    if(!button||typeof button.focus!=='function')return;
    try{button.focus({preventScroll:true});}catch(_error){button.focus();}
  }
  function enhanceDashboardTabs(){
    var page=document.getElementById('pg-dashboard');if(!page)return;
    var panes=Array.prototype.slice.call(page.querySelectorAll('[data-mobile-dashboard-pane]'));
    if(!isPhone()){
      panes.forEach(function(pane){pane.hidden=false;});
      return;
    }
    panes.forEach(function(pane){pane.hidden=pane.dataset.mobileDashboardPane!==mobileDashboardCurrent;});
    syncMobileThirdTabs('[data-mobile-dashboard-tabs]','[data-mobile-dashboard-tab]',mobileDashboardCurrent);
  }
  window.mobileDashboardTab=function(name,button){
    if(['overview','organization','detail'].indexOf(name)<0)return;
    mobileDashboardCurrent=name;enhanceDashboardTabs();scrollMobilePageTop('dashboard');thirdTabFocus(button);
  };
  function enhanceUsersMobile(){
    var page=document.getElementById('pg-users'),table=page&&page.querySelector('.user-list-table');if(!page)return;
    var panes=Array.prototype.slice.call(page.querySelectorAll('[data-mobile-users-pane]'));
    if(!isPhone()){
      panes.forEach(function(pane){pane.hidden=false;});
    }else panes.forEach(function(pane){pane.hidden=pane.dataset.mobileUsersPane!==mobileUsersCurrent;});
    syncMobileThirdTabs('[data-mobile-users-tabs]','[data-mobile-users-tab]',mobileUsersCurrent);
    if(!table)return;
    setCellLabels(table);table.classList.add('mobile-third-user-table');
    var rows=Array.prototype.slice.call(table.querySelectorAll('tbody tr'));
    var dataRows=rows.filter(function(row){return !(row.cells.length===1&&row.cells[0].hasAttribute('colspan'));});
    var signature=dataRows.length+'|'+dataRows.slice(0,2).map(function(row){return String(row.textContent||'').slice(0,60);}).join('|');
    if(page.dataset.mobileUserSignature!==signature){page.dataset.mobileUserSignature=signature;page.dataset.mobileUserVisible='12';}
    var limit=Math.max(12,Number(page.dataset.mobileUserVisible)||12);
    dataRows.forEach(function(row,index){
      row.setAttribute('data-mobile-user-card','');
      if(!row.hasAttribute('aria-expanded'))row.setAttribute('aria-expanded','false');
      var first=row.cells[0];
      if(first&&!first.querySelector('.mobile-user-card-toggle')){
        var button=document.createElement('button');button.type='button';button.className='mobile-user-card-toggle';button.textContent='詳細與管理';button.setAttribute('aria-expanded','false');
        button.addEventListener('click',function(){var open=row.getAttribute('aria-expanded')==='true';row.setAttribute('aria-expanded',open?'false':'true');button.setAttribute('aria-expanded',open?'false':'true');button.textContent=open?'詳細與管理':'收合資料';});
        first.appendChild(button);
      }
      row.hidden=isPhone()&&index>=limit;
    });
    var wrap=document.getElementById('user-wrap'),pager=wrap&&wrap.querySelector('[data-mobile-user-pager]');
    if(wrap&&!pager){
      pager=document.createElement('div');pager.className='mobile-third-pager';pager.setAttribute('data-mobile-user-pager','');
      pager.innerHTML='<span role="status" aria-live="polite"></span><button type="button">再載入 12 位</button>';wrap.appendChild(pager);
      pager.querySelector('button').addEventListener('click',function(){page.dataset.mobileUserVisible=String((Number(page.dataset.mobileUserVisible)||12)+12);enhanceUsersMobile();});
    }
    if(pager){
      pager.hidden=!isPhone()||!dataRows.length;
      var shown=Math.min(limit,dataRows.length),status=pager.querySelector('span'),more=pager.querySelector('button');
      if(status)status.textContent='顯示 '+shown+' / '+dataRows.length+' 位';
      if(more)more.hidden=shown>=dataRows.length;
    }
  }
  window.mobileUsersTab=function(name,button){
    if(['list','health'].indexOf(name)<0)return;
    mobileUsersCurrent=name;enhanceUsersMobile();scrollMobilePageTop('users');thirdTabFocus(button);
  };
  function enhanceOrgMobile(){
    var page=document.getElementById('pg-orgchart');if(!page)return;
    var panes=Array.prototype.slice.call(page.querySelectorAll('[data-mobile-org-pane]'));
    if(!isPhone())panes.forEach(function(pane){pane.hidden=false;});
    else panes.forEach(function(pane){pane.hidden=pane.dataset.mobileOrgPane!==mobileOrgCurrent;});
    syncMobileThirdTabs('[data-mobile-org-tabs]','[data-mobile-org-tab]',mobileOrgCurrent);
    var editor=document.getElementById('org-editor');if(!editor)return;
    var rows=Array.prototype.slice.call(editor.querySelectorAll('.org-editor-row'));
    var signature=rows.length+'|'+rows.slice(0,2).map(function(row){return String(row.textContent||'').slice(0,60);}).join('|');
    if(page.dataset.mobileOrgSignature!==signature){page.dataset.mobileOrgSignature=signature;page.dataset.mobileOrgVisible='8';}
    var limit=Math.max(8,Number(page.dataset.mobileOrgVisible)||8);
    rows.forEach(function(row,index){
      row.setAttribute('data-mobile-org-person','');
      if(!row.hasAttribute('data-mobile-original-draggable'))row.setAttribute('data-mobile-original-draggable',row.getAttribute('draggable')||'false');
      row.setAttribute('draggable',isPhone()?'false':row.getAttribute('data-mobile-original-draggable'));
      if(!row.hasAttribute('aria-expanded'))row.setAttribute('aria-expanded','false');
      var first=row.firstElementChild;
      if(first&&!first.querySelector('.mobile-org-person-toggle')){
        var button=document.createElement('button');button.type='button';button.className='mobile-org-person-toggle';button.textContent='設定主管與簽核';button.setAttribute('aria-expanded','false');
        button.addEventListener('click',function(){var open=row.getAttribute('aria-expanded')==='true';row.setAttribute('aria-expanded',open?'false':'true');button.setAttribute('aria-expanded',open?'false':'true');button.textContent=open?'設定主管與簽核':'收合設定';});
        first.appendChild(button);
      }
      row.hidden=isPhone()&&index>=limit;
    });
    var section=document.getElementById('org-legacy-people'),pager=section&&section.querySelector('[data-mobile-org-pager]');
    if(section&&!pager){
      pager=document.createElement('div');pager.className='mobile-third-pager';pager.setAttribute('data-mobile-org-pager','');
      pager.innerHTML='<span role="status" aria-live="polite"></span><button type="button">再載入 8 位</button>';section.appendChild(pager);
      pager.querySelector('button').addEventListener('click',function(){page.dataset.mobileOrgVisible=String((Number(page.dataset.mobileOrgVisible)||8)+8);enhanceOrgMobile();});
    }
    if(pager){
      pager.hidden=!isPhone()||mobileOrgCurrent!=='people'||!rows.length;
      var shown=Math.min(limit,rows.length),status=pager.querySelector('span'),more=pager.querySelector('button');
      if(status)status.textContent='顯示 '+shown+' / '+rows.length+' 位';
      if(more)more.hidden=shown>=rows.length;
    }
  }
  window.mobileOrgTab=function(name,button){
    if(['chart','people'].indexOf(name)<0)return;
    mobileOrgCurrent=name;enhanceOrgMobile();scrollMobilePageTop('orgchart');thirdTabFocus(button);
  };
  function healthSectionSeverity(section){
    if(section.querySelector('.health-row-fail,.badge.b-rej,.badge.b-wait'))return 'issue';
    if(section.querySelector('.health-row-warn,.badge.b-purp'))return 'issue';
    return 'ok';
  }
  function enhanceHealthMobile(){
    var page=document.getElementById('pg-health'),summary=document.getElementById('health-summary'),body=document.getElementById('health-body');if(!page||!summary||!body)return;
    var sections=Array.prototype.slice.call(body.querySelectorAll(':scope > .health-flat-section'));
    sections.forEach(function(section,index){
      section.dataset.mobileHealthSection=healthSectionSeverity(section);
      var head=section.querySelector(':scope > .health-flat-head');
      if(head&&!head.querySelector('.mobile-health-section-toggle')){
        var button=document.createElement('button');button.type='button';button.className='mobile-health-section-toggle';button.textContent='查看';button.setAttribute('aria-expanded','false');
        button.addEventListener('click',function(){var open=section.dataset.mobileExpanded==='true';section.dataset.mobileExpanded=open?'false':'true';button.setAttribute('aria-expanded',open?'false':'true');button.textContent=open?'查看':'收合';});
        head.appendChild(button);
      }
      if(!section.dataset.mobileExpanded)section.dataset.mobileExpanded='false';
      if(!isPhone())section.hidden=false;
      else if(mobileHealthCurrent==='summary')section.hidden=true;
      else if(mobileHealthCurrent==='issues')section.hidden=section.dataset.mobileHealthSection!=='issue';
      else section.hidden=false;
      section.dataset.mobileHealthOrder=String(index);
    });
    summary.hidden=isPhone()&&mobileHealthCurrent!=='summary';
    Array.prototype.forEach.call(body.children,function(child){
      if(child.classList&&child.classList.contains('health-flat-section'))return;
      child.hidden=isPhone()&&mobileHealthCurrent!=='all';
    });
    if(!isPhone()){
      summary.hidden=false;
      Array.prototype.forEach.call(body.children,function(child){child.hidden=false;});
    }
    syncMobileThirdTabs('[data-mobile-health-tabs]','[data-mobile-health-tab]',mobileHealthCurrent);
  }
  window.mobileHealthTab=function(name,button){
    if(['summary','issues','all'].indexOf(name)<0)return;
    mobileHealthCurrent=name;enhanceHealthMobile();scrollMobilePageTop('health');thirdTabFocus(button);
  };
  function enhanceSettingsMobile(){
    var page=document.getElementById('pg-settings'),picker=document.getElementById('mobile-settings-section');if(!page||!picker)return;
    var active=page.querySelector('#settings-tabs .tb.on'),match=String(active&&active.getAttribute('onclick')||'').match(/settingsTab\(['"]([^'"]+)/);
    if(match&&picker.value!==match[1])picker.value=match[1];
    Array.prototype.forEach.call(page.querySelectorAll('.settings-list-table,#settings-panel-fees table'),function(table){
      setCellLabels(table);table.classList.add('mobile-third-settings-table');
      Array.prototype.forEach.call(table.querySelectorAll('tbody tr'),function(row){row.setAttribute('data-mobile-settings-card','');});
    });
    ['permissions','workflows','formfields','templates','profiles','modules'].forEach(function(name){
      var panel=document.getElementById('settings-panel-'+name);if(!panel||panel.querySelector('.mobile-settings-desktop-note'))return;
      var note=document.createElement('div');note.className='mobile-settings-desktop-note';note.textContent='此區設定項目較多；手機可檢視與做小幅調整，大量編輯建議使用桌機。';panel.insertBefore(note,panel.firstChild);
    });
  }
  window.mobileSettingsSection=function(name){
    var button=Array.prototype.slice.call(document.querySelectorAll('#settings-tabs .tb')).find(function(item){return String(item.getAttribute('onclick')||'').indexOf("'"+name+"'")>-1;});
    if(typeof window.settingsTab==='function')window.settingsTab(name,button||null);
    enhanceSettingsMobile();
  };
  function enhanceAll(){
    document.documentElement.dataset.mobileUi='first-batch-v1';
    document.documentElement.dataset.mobileSecondBatch='v1';
    document.documentElement.dataset.mobileThirdBatch='v1';
    updatePrimaryNavigation();
	installLoginBrand();
    installLoginHelp();
    syncNewRequestView();
    reconcileInvoiceViewport();
    reconcileShareholderWizard();
    enhanceWorkLists();
    enhanceApprovalChrome();
    enhanceApprovalActions();
    enhanceAccountList();
    enhanceComplianceTabs();
    reconcileSecondBatchPanels();
    enhanceSecondBatchLists();
    reconcileMobileReportView();
    enhanceDashboardTabs();
    enhanceUsersMobile();
    enhanceOrgMobile();
    enhanceHealthMobile();
    enhanceSettingsMobile();
  }
  function queueEnhance(){
    if(observerQueued)return;
    observerQueued=true;
    window.requestAnimationFrame(function(){observerQueued=false;enhanceAll();});
  }
  function installObservers(){
    var targets=['main-wrap','nr-content','exp-tbody','appr-list','appr-inner','bill-entry-sheet','notif-list','acc-tbody','accounting-control-center','comp-kpis','voucher-list','recv-detail','recv-kpis','rpt-investor-kpis','ldg-tbody','ldg-kpis','user-wrap','user-health','org-editor','org-supervisor-dashboard','org-chart-view','health-summary','health-body','settings-tabs','settings-panel-entities','settings-panel-departments','settings-panel-accounts','settings-panel-fees'];
    targets.forEach(function(id){
      var node=document.getElementById(id);if(!node)return;
      new MutationObserver(queueEnhance).observe(node,{childList:true,subtree:true,attributes:id==='main-wrap',attributeFilter:id==='main-wrap'?['style']:undefined});
    });
    var content=document.querySelector('.content');
    if(content)new MutationObserver(queueEnhance).observe(content,{subtree:true,attributes:true,attributeFilter:['class']});
    var advanced=document.querySelector('[data-mobile-advanced-sheet="newreq"]');
    if(advanced)advanced.addEventListener('toggle',syncNewRequestView);
    var complianceTabs=document.querySelector('[data-mobile-compliance-tabs]');
    if(complianceTabs&&!complianceTabs.dataset.mobileKeysBound){
      complianceTabs.dataset.mobileKeysBound='1';
      complianceTabs.addEventListener('keydown',function(event){
        if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
        var tabs=Array.prototype.slice.call(complianceTabs.querySelectorAll('[data-mobile-compliance-tab]'));
        var index=tabs.indexOf(document.activeElement);if(index<0)return;
        event.preventDefault();
        var next=(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
        window.mobileComplianceTab(tabs[next].dataset.mobileComplianceTab,tabs[next]);
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll('.mobile-third-tabs'),function(tablist){
      if(tablist.dataset.mobileKeysBound)return;
      tablist.dataset.mobileKeysBound='1';
      tablist.addEventListener('keydown',function(event){
        if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
        var tabs=Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
        var index=tabs.indexOf(document.activeElement);if(index<0)return;
        event.preventDefault();
        var next=tabs[(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];
        next.click();next.focus();
      });
    });
    var media=window.matchMedia&&window.matchMedia(PHONE_QUERY);
    if(media){
      var onViewportChange=function(){
        reconcileInvoiceViewport();reconcileShareholderWizard();
        if(typeof window.filterAccs==='function')window.filterAccs();
        enhanceAccountList();enhanceComplianceTabs();reconcileSecondBatchPanels();enhanceSecondBatchLists();reconcileMobileReportView();enhanceDashboardTabs();enhanceUsersMobile();enhanceOrgMobile();enhanceHealthMobile();enhanceSettingsMobile();queueEnhance();
      };
      if(media.addEventListener)media.addEventListener('change',onViewportChange);else if(media.addListener)media.addListener(onViewportChange);
    }
	document.addEventListener('keydown',function(event){
	  var backdrop=document.getElementById('mobile-more-backdrop');
	  if(!backdrop||backdrop.hidden)return;
	  if(event.key==='Escape'){event.preventDefault();window.closeMobileMore();return;}
	  if(event.key!=='Tab')return;
	  var focusable=Array.prototype.slice.call(backdrop.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(function(node){return getComputedStyle(node).display!=='none';});
	  if(!focusable.length){event.preventDefault();return;}
	  var first=focusable[0],last=focusable[focusable.length-1];
	  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
	  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
	});
  }

  window.MOBILE_ROLE_PRIMARY_NAV_LIMIT=MOBILE_ROLE_PRIMARY_NAV_LIMIT;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){enhanceAll();installObservers();});
  else{enhanceAll();installObservers();}
})();
