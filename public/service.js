let serviceTenantId=null,serviceItems=[],serviceLoading=0,settingsReportTab='Overview',socialTab='Content calendar';
const serviceKindForView={'Tickets':'customer','Cancellation requests':'cancellation','Billing issues':'billing','Bug reports':'bug'};
const oldRenderMarketing=renderMarketing;
renderMarketing=function(){if(view==='Social Media'){renderSocialMedia();return}oldRenderMarketing()};
const oldRenderModule=renderModule;
renderModule=function(){if(category==='Customer service'&&['Tickets','Cancellation requests','Billing overview','Billing issues','Bug reports'].includes(view)){renderCustomerService();return}oldRenderModule()};
const oldRenderSettings=renderSettings;
renderSettings=function(){if(view==='Reporting'){renderSettingsReporting();return}if(view==='Profile'){$('#main').innerHTML=header('Profile','Your account settings')+`<section class="surface section-card"><h2>Your profile</h2><div class="field-row"><span>Name</span><strong id="profile-name">Loading…</strong></div><div class="field-row"><span>Email</span><strong id="profile-email">Loading…</strong></div><p>Your name and email are managed through your signed-in account.</p></section>`;if(typeof syncProfileIdentity==='function')syncProfileIdentity();return}oldRenderSettings()};
function innerTabs(names,selected,attribute){return `<div class="service-tabs" role="tablist" aria-label="${attribute==='data-report-tab'?'Reporting':'Social Media'} sections">${names.map(name=>`<button type="button" role="tab" aria-selected="${name===selected}" class="${name===selected?'active':''}" ${attribute}="${escapeHTML(name)}">${escapeHTML(name)}</button>`).join('')}</div>`}
function renderSocialMedia(){
  const sections=['Content calendar','Drafts','Approvals','Analytics'];
  if(!sections.includes(socialTab))socialTab=sections[0];
  const copy=moduleCopy['Social Media'][socialTab];
  $('#detail').hidden=true;
  $('#main').innerHTML=header('Social Media','Plan posts and review channel activity')+innerTabs(sections,socialTab,'data-social-tab')+notice('Social accounts and publishing are not connected. This workspace is a preview.')+`<section class="surface section-card"><span class="eyebrow">${escapeHTML(socialTab.toUpperCase())}</span><h2>${escapeHTML(copy[0])}</h2><p>${escapeHTML(copy[1])}</p>${simpleEmpty('Nothing here yet','Connect an approved social account to manage this section.')}</section>`;
}
function renderSettingsReporting(){
  const sections=canViewSalesReports?['Overview','Sales dashboard','Campaign reports','Audit history']:['Overview','Campaign reports','Audit history'];
  if(!sections.includes(settingsReportTab))settingsReportTab='Overview';
  if(settingsReportTab==='Sales dashboard')renderReports();
  else if(settingsReportTab==='Audit history')renderAudit();
  else if(settingsReportTab==='Campaign reports')$('#main').innerHTML=header('Campaign reports','Marketing and campaign performance')+notice('No ad, social, or email analytics providers are connected.')+`<section class="surface section-card"><h2>Campaign performance</h2><p>Connect approved providers to review spend, engagement, and conversions.</p></section>`;
  else $('#main').innerHTML=header('Reporting','Reports and account activity')+`<div class="cards"><section class="surface section-card"><h2>Sales dashboard</h2><p>Open pipeline value, outcomes, follow ups, and team performance.</p>${canViewSalesReports?'<button class="secondary" type="button" data-report-tab="Sales dashboard">View sales report</button>':'<p>Manager access is required.</p>'}</section><section class="surface section-card"><h2>Campaign reports</h2><p>Provider data will appear after accounts are connected.</p><button class="secondary" type="button" data-report-tab="Campaign reports">View campaigns</button></section><section class="surface section-card"><h2>Audit history</h2><p>Review account activity. The current page contains illustrative events.</p><button class="secondary" type="button" data-report-tab="Audit history">View activity</button></section></div>`;
  $('#main').insertAdjacentHTML('afterbegin',innerTabs(sections,settingsReportTab,'data-report-tab'));
}
async function ensureServiceTenant(){
  if(serviceTenantId)return serviceTenantId;
  const response=await fetch('/api/crm?resource=organizations',{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw new Error('Could not load your company workspace.');
  const orgs=(await response.json()).items||[];
  serviceTenantId=orgs.find(item=>['business_owner','sales_manager','support_readonly'].includes(item.role))?.id||null;
  if(!serviceTenantId)throw new Error('Create a company in Admin center before using Customer service.');
  return serviceTenantId;
}
async function serviceApi(method='GET',body=null){
  const tenantId=await ensureServiceTenant();
  const response=await fetch(`/api/service?tenant_id=${encodeURIComponent(tenantId)}`,{method,credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify({tenant_id:tenantId,...body}):undefined});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||'Could not load customer service.');
  return result;
}
function renderCustomerService(){
  const stamp=++serviceLoading;
  $('#detail').hidden=true;
  const descriptions={'Tickets':'Track customer questions and support issues.','Cancellation requests':'Review requests to end a subscription or account.','Billing overview':'See recorded purchases and billing support status.','Billing issues':'Track payment and invoice questions.','Bug reports':'Record issues for the technical team to review.'};
  $('#main').innerHTML=header(view,descriptions[view])+`<div id="service-content" aria-live="polite"><div class="surface section-card">Loading customer service…</div></div>`;
  void (async()=>{try{const result=await serviceApi();if(stamp!==serviceLoading||category!=='Customer service')return;serviceItems=result.items||[];renderServiceContent();}catch(error){if(stamp===serviceLoading){const el=$('#service-content');if(el)el.innerHTML=notice(error.message||'Customer service is unavailable.',true)}}})();
}
function ticketList(kind){
  const rows=serviceItems.filter(item=>item.kind===kind),editable=currentRole==='business_owner'||currentRole==='sales_manager';
  return `<div class="service-list">${rows.length?rows.map(item=>`<article class="surface service-ticket"><div class="service-ticket-top"><h3>${escapeHTML(item.title)}</h3><span class="status-pill">${escapeHTML(item.status.replace('_',' '))}</span></div><p>${escapeHTML(item.description)}</p>${item.kind==='cancellation'?`<p class="service-reference"><strong>Account or subscription:</strong> ${escapeHTML(item.subscription_reference||'Not recorded')}<br><strong>Requested effective date:</strong> ${escapeHTML(item.requested_effective_date||'Not specified')}</p>`:''}<small>${escapeHTML(item.customer_name||'Internal')} ${item.customer_email?`· ${escapeHTML(item.customer_email)}`:''} · ${escapeHTML(item.priority)} priority · ${escapeHTML(item.created_at)}</small>${editable?`<label>${item.kind==='cancellation'?'Request status':'Ticket status'} <select data-service-status="${escapeHTML(item.id)}"><option value="open" ${item.status==='open'?'selected':''}>Open</option><option value="in_progress" ${item.status==='in_progress'?'selected':''}>In progress</option><option value="resolved" ${item.status==='resolved'?'selected':''}>${item.kind==='cancellation'?'Request closed':'Resolved'}</option></select></label>`:''}</article>`).join(''):'<div class="surface section-card"><h2>No reports yet</h2><p>New reports will appear here.</p></div>'}</div>`;
}
function serviceForm(kind){if(currentRole==='support_readonly')return '';
  if(kind==='cancellation')return `<form id="service-ticket-form" class="surface section-card service-form" data-kind="cancellation"><h2>Record cancellation request</h2><div class="form-grid"><label>Customer name<input name="customer_name" required maxlength="160" autocomplete="name"></label><label>Customer email<input name="customer_email" required type="email" maxlength="254" autocomplete="email"></label><label>Account or subscription reference<input name="subscription_reference" required maxlength="160" placeholder="Account ID or subscription ID"></label><label>Requested effective date<input name="requested_effective_date" type="date"></label></div><label>Reason or request details<textarea name="description" required minlength="5" maxlength="5000" rows="4" placeholder="Record the customer's request and any follow up needed."></textarea></label><p class="form-note">This saves a request for staff review. It does not cancel a subscription, stop billing, or notify a payment provider.</p><button class="primary" type="submit">Save cancellation request</button></form>`;
  return `<form id="service-ticket-form" class="surface section-card service-form" data-kind="${kind}"><h2>${kind==='bug'?'Report a bug':kind==='billing'?'Add a billing issue':'Add a customer ticket'}</h2><div class="form-grid"><label>Title<input name="title" required minlength="3" maxlength="180" placeholder="Brief summary"></label><label>Priority<select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></label>${kind!=='bug'?'<label>Customer name<input name="customer_name" maxlength="160"></label><label>Customer email<input name="customer_email" type="email" maxlength="254"></label>':''}</div><label>Description<textarea name="description" required minlength="5" maxlength="5000" rows="4" placeholder="What happened? What help is needed?"></textarea></label><p class="form-note">${kind==='bug'?'Saved to the internal bug queue. Tech notifications are not connected yet.':'Saved in this company workspace.'}</p><button class="primary" type="submit">Save ${kind==='bug'?'bug report':'ticket'}</button></form>`;
}
function renderServiceContent(){
  const el=$('#service-content');if(!el)return;
  if(view==='Billing overview'){
    const billing=serviceItems.filter(item=>item.kind==='billing'),cancellations=serviceItems.filter(item=>item.kind==='cancellation'&&item.status!=='resolved');
    el.innerHTML=notice('Payment processing and invoice data are not connected. Purchase data below, when available, is manually recorded.')+`<div class="dashboard-metrics"><div class="surface dashboard-metric"><span>Open billing issues</span><strong>${billing.filter(item=>item.status!=='resolved').length}</strong></div><div class="surface dashboard-metric"><span>Resolved billing issues</span><strong>${billing.filter(item=>item.status==='resolved').length}</strong></div><div class="surface dashboard-metric"><span>Cancellation requests</span><strong>${cancellations.length}</strong><small>Awaiting review</small></div></div><div id="service-purchases" class="surface section-card"><h2>Recorded purchases</h2><p>${currentRole==='business_owner'?'Loading saved purchase records…':'Available to account owners.'}</p></div>`;
    if(currentRole==='business_owner')void loadServicePurchases();return;
  }
  const kind=serviceKindForView[view];
  el.innerHTML=(kind==='bug'?notice('Bug reports are saved for internal review. No technical team delivery channel is configured yet.'):kind==='cancellation'?notice('A cancellation request does not stop billing or cancel a subscription. Staff must verify the account and process the cancellation with the billing provider.'): '')+`<div class="service-grid">${serviceForm(kind)}<section><h2>${view==='Tickets'?'Customer tickets':view}</h2>${ticketList(kind)}</section></div>`;
}
async function loadServicePurchases(){
  const el=$('#service-purchases');if(!el)return;
  try{const response=await fetch(`/api/admin-insights?tenant_id=${encodeURIComponent(serviceTenantId)}`,{credentials:'same-origin',cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load purchase records.');if(category!=='Customer service'||view!=='Billing overview')return;const purchases=data.purchases||[];el.innerHTML=`<h2>Recorded purchases</h2>${purchases.length?`<div class="service-list">${purchases.slice(0,20).map(item=>`<div class="service-purchase"><strong>${escapeHTML(item.customer_name)}</strong><span>${escapeHTML(item.product_name)} · ${money(item.amount_cents)} · ${escapeHTML(item.purchased_at)}</span></div>`).join('')}</div>`:'<p>No purchases have been recorded yet.</p>'}`}catch(error){el.innerHTML=`<h2>Recorded purchases</h2><p>${escapeHTML(error.message)}</p>`}
}
document.addEventListener('click',event=>{
  const report=event.target.closest('[data-report-tab]');if(report){settingsReportTab=report.dataset.reportTab;renderSettingsReporting();return}
  const social=event.target.closest('[data-social-tab]');if(social){socialTab=social.dataset.socialTab;renderSocialMedia()}
});
document.addEventListener('submit',async event=>{
  const form=event.target.closest('#service-ticket-form');if(!form)return;
  event.preventDefault();const button=form.querySelector('button[type="submit"]');button.disabled=true;
  const data=new FormData(form);
  try{await serviceApi('POST',{kind:form.dataset.kind,title:String(data.get('title')||`Cancellation request: ${data.get('subscription_reference')||''}`).slice(0,180),description:String(data.get('description')||''),priority:String(data.get('priority')||'normal'),customer_name:String(data.get('customer_name')||''),customer_email:String(data.get('customer_email')||''),...(form.dataset.kind==='cancellation'?{subscription_reference:String(data.get('subscription_reference')||''),requested_effective_date:String(data.get('requested_effective_date')||'')}: {})});toast('Request saved.');renderCustomerService()}
  catch(error){toast(error.message||'Could not save the report.');button.disabled=false}
});
document.addEventListener('change',async event=>{
  const control=event.target.closest('[data-service-status]');if(!control)return;
  try{await serviceApi('PATCH',{id:control.dataset.serviceStatus,status:control.value});toast('Ticket updated.');renderCustomerService()}catch(error){toast(error.message||'Could not update the ticket.');renderCustomerService()}
});
