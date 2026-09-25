let adminData=null, adminInsights=null, adminPhoneRequests=[], adminTenantId=null, adminOrganizations=[], adminContacts=[], adminLoading=false, adminError='', adminOwner='all';
const sum=(items,key)=>items.reduce((total,item)=>total+(Number(item[key])||0),0);
const countLabel=(value,singular,plural=singular+'s')=>`${value} ${value===1?singular:plural}`;
const fmtNumber=value=>new Intl.NumberFormat('en-US').format(value||0);
const daysSince=value=>value?Math.max(0,Math.floor((Date.now()-Date.parse(value))/86400000)):0;
const adminCard=(label,value,note,action='')=>`<div class="surface admin-kpi${action?' admin-kpi-action':''}" ${action?`role="button" tabindex="0" data-admin-section="${escapeHTML(action)}"`:''}><span>${escapeHTML(label)}</span><strong>${value}</strong><small>${escapeHTML(note)}</small></div>`;
const unavailable=(label,source)=>adminCard(label,'—',`${source} not connected`);
const adminEmpty=(message)=>`<p class="admin-empty">${escapeHTML(message)}</p>`;
const adminPanel=(eyebrow,title,body)=>`<section class="surface admin-panel"><span class="dashboard-kicker">${escapeHTML(eyebrow)}</span><h2>${escapeHTML(title)}</h2>${body}</section>`;
const adminRows=(items,label,value,empty)=>items.length?`<div class="admin-rows">${items.map(item=>`<div><span>${escapeHTML(label(item))}</span><strong>${value(item)}</strong></div>`).join('')}</div>`:adminEmpty(empty);
const adminLink=(label,section)=>`<button type="button" class="secondary" data-admin-section="${escapeHTML(section)}">${escapeHTML(label)}</button>`;

async function loadAdminDashboard(){
  if(adminLoading)return;
  adminLoading=true;adminError='';
  try{
    const orgResult=await fetch('/api/crm?resource=organizations',{credentials:'same-origin',cache:'no-store'});
    if(!orgResult.ok)throw new Error('Could not load your workspace.');
    const orgs=(await orgResult.json()).items||[];
    adminOrganizations=orgs.filter(item=>item.role==='business_owner');
    const org=adminOrganizations.find(item=>item.id===adminTenantId)||adminOrganizations[0];
    if(!org)throw new Error('Admin access is required.');
    adminTenantId=org.id;
    const [result,insightsResponse,phoneResponse]=await Promise.all([
      fetch(`/api/sales-dashboard?tenant_id=${encodeURIComponent(org.id)}`,{credentials:'same-origin',cache:'no-store'}),
      fetch(`/api/admin-insights?tenant_id=${encodeURIComponent(org.id)}`,{credentials:'same-origin',cache:'no-store'}),
      fetch(`/api/phone-number-requests?tenant_id=${encodeURIComponent(org.id)}`,{credentials:'same-origin',cache:'no-store'}),
    ]);
    const data=await result.json();
    if(!result.ok)throw new Error(data.error||'Could not load dashboard data.');
    const insights=await insightsResponse.json();
    if(!insightsResponse.ok)throw new Error(insights.error||'Could not load customer insights.');
    adminData=data;
    adminInsights=insights;
    adminPhoneRequests=phoneResponse.ok?(await phoneResponse.json()).items||[]:[];
  }catch(error){adminError=error.message||'Could not load dashboard data.'}
  adminLoading=false;
  if(category==='Dashboard')renderAdminDashboard();
}

function adminOverview(data){
  const deals=data.opportunities||[],open=deals.filter(item=>item.status==='open'),won=deals.filter(item=>item.status==='won');
  const purchases=adminInsights?.purchases||[],active=purchases.filter(item=>item.subscription_status==='active');
  const contactsTotal=sum(data.contacts||[],'count');
  const phases=[
    ['Awareness','Who is finding you','Ads, social mentions, and lead sources'],
    ['Consideration','Who is exploring','Website behavior and qualified leads'],
    ['Purchase','Who became a customer','Verified payments and closed deals'],
    ['Experience','How customers use the product','Usage, support, and satisfaction'],
    ['Loyalty','Who stays and grows','MRR, retention, and renewals'],
  ];
  return `<div class="admin-kpis">${adminCard('Open pipeline',money(sum(open,'value_cents')),countLabel(open.length,'open deal'),'Pipeline')}${adminCard('Won deal value',money(sum(won,'value_cents')),countLabel(won.length,'won deal'),'Pipeline')}${adminCard('Verified purchases',fmtNumber(purchases.length),'Manually recorded','Purchase')}${adminCard('Recorded MRR',money(sum(active,'monthly_amount_cents')),'Active recorded subscriptions','Loyalty')}</div>${adminPanel('CUSTOMER JOURNEY','Follow the customer from discovery to loyalty',`<div class="admin-journey">${phases.map(([name,heading,description],index)=>`<button type="button" class="admin-journey-step" data-admin-section="${name}"><span>${String(index+1).padStart(2,'0')} · ${name}</span><strong>${heading}</strong><small>${description}</small><b aria-hidden="true">›</b></button>`).join('')}</div>`)}<div class="admin-grid">${adminPanel('NEXT ACTION','Pipeline decisions',`<p>${open.length?`${countLabel(open.length,'deal')} are open. Review their stage, value, and owner.`:'Add opportunities to see deal value and stage movement here.'}</p>${adminLink('Review pipeline','Pipeline')}`)}${adminPanel('CRM','Customer progress',`<div class="admin-rows"><div><span>Contacts</span><strong>${fmtNumber(contactsTotal)}</strong></div><div><span>Open follow-ups</span><strong>${fmtNumber(data.openTasks)}</strong></div><div><span>Feedback check-ins</span><strong>${fmtNumber(adminInsights?.feedback?.length||0)}</strong></div></div>`)}${adminPanel('PHONE NUMBERS','White-label number requests',`<p>Customer → white-label partner → SaaS Launchup. Record the need here for partner review. No request is sent or purchase made yet.</p><button type="button" class="secondary" data-admin-number-request>Record number need</button>${adminPhoneRequests.length?`<div class="admin-rows admin-number-requests">${adminPhoneRequests.slice(0,5).map(item=>`<div><span>${escapeHTML(item.partner_name)} · ${escapeHTML(item.country)}${item.region?` / ${escapeHTML(item.region)}`:''}<small>${escapeHTML(item.number_type==='toll_free'?'Toll-free':'Local')} · ${escapeHTML(item.capabilities.replace('_',' + '))}</small></span><strong>For partner review</strong></div>`).join('')}</div>`:''}<p class="dashboard-foot">Pricing, payment, partner forwarding, and Twilio provisioning will be added later.</p>`)}</div>`;
}

function adminPipeline(data){
  const all=data.opportunities||[],owners=[...new Set(all.map(item=>item.owner))].sort();
  if(adminOwner!=='all'&&!owners.includes(adminOwner))adminOwner='all';
  const deals=adminOwner==='all'?all:all.filter(item=>item.owner===adminOwner);
  const open=deals.filter(item=>item.status==='open'),won=deals.filter(item=>item.status==='won'),lost=deals.filter(item=>item.status==='lost');
  const stalled=open.filter(item=>daysSince(item.updated_at)>14).sort((a,b)=>b.value_cents-a.value_cents);
  const avgAge=open.length?Math.round(sum(open.map(item=>({age:daysSince(item.created_at)})),'age')/open.length):0;
  const stages=(data.stages||[]).map(stage=>({name:`${stage.pipeline_name} · ${stage.name}`,items:open.filter(item=>item.stage_id===stage.id)}));
  const sourceMap=new Map(),typeMap=new Map(),reasonMap=new Map();
  for(const item of deals){
    const source=item.source||'Unattributed';sourceMap.set(source,(sourceMap.get(source)||0)+Number(item.value_cents||0));
    const type=item.deal_type||'Not recorded';typeMap.set(type,(typeMap.get(type)||0)+1);
    if(item.status!=='open'){const reason=item.outcome_reason||'Not recorded';reasonMap.set(`${item.status}: ${reason}`,(reasonMap.get(`${item.status}: ${reason}`)||0)+1)}
  }
  const ownerMap=new Map();for(const item of all){const entry=ownerMap.get(item.owner)||{owner:item.owner,open:0,won:0,pipeline:0};if(item.status==='open'){entry.open++;entry.pipeline+=Number(item.value_cents||0)}if(item.status==='won')entry.won+=Number(item.value_cents||0);ownerMap.set(item.owner,entry)}
  const closedMonths=Array.from({length:12},(_,i)=>{const date=new Date();date.setUTCMonth(date.getUTCMonth()-11+i);return {key:date.toISOString().slice(0,7),label:date.toLocaleString('en-US',{month:'short',year:'2-digit',timeZone:'UTC'})}});
  const timeline=closedMonths.map(month=>({label:month.label,items:deals.filter(item=>item.closed_at?.startsWith(month.key))}));
  const maxMonthly=Math.max(1,...timeline.map(item=>sum(item.items.filter(deal=>deal.status==='won'),'value_cents')));
  return `<div class="admin-toolbar"><label>Team member <select id="admin-owner"><option value="all">Whole team</option>${owners.map(owner=>`<option value="${escapeHTML(owner)}" ${adminOwner===owner?'selected':''}>${escapeHTML(owner)}</option>`).join('')}</select></label><button type="button" class="primary" data-admin-edit="new">＋ Opportunity</button></div><div class="admin-kpis">${adminCard('Open pipeline',money(sum(open,'value_cents')),countLabel(open.length,'deal'))}${adminCard('Won amount',money(sum(won,'value_cents')),countLabel(won.length,'closed deal'))}${adminCard('Average open age',`${avgAge} days`,'Since deal creation')}${adminCard('Stalled deals',fmtNumber(stalled.length),'No update in 14 days')}</div><div class="admin-grid">${adminPanel('12 MONTHS','Closed amount and deals',`<div class="admin-timeline">${timeline.map(month=>`<div title="${escapeHTML(month.label)}: ${money(sum(month.items.filter(item=>item.status==='won'),'value_cents'))} won, ${month.items.length} closed"><span style="height:${Math.max(3,sum(month.items.filter(item=>item.status==='won'),'value_cents')/maxMonthly*100)}%"></span><small>${escapeHTML(month.label)}</small></div>`).join('')}</div><p class="dashboard-foot">Won value; hover a month for closed deal count.</p>`)}${adminPanel('TEAM','Best and worst by won amount',adminRows([...ownerMap.values()].sort((a,b)=>b.won-a.won),item=>item.owner,item=>`${money(item.won)} won`,'No owner results yet.'))}${adminPanel('STAGES','Open pipeline by stage',adminRows(stages,item=>item.name,item=>`${item.items.length} · ${money(sum(item.items,'value_cents'))}`,'No stages.'))}${adminPanel('OWNERS','Pipeline by owner',adminRows([...ownerMap.values()].sort((a,b)=>b.pipeline-a.pipeline),item=>item.owner,item=>`${item.open} open · ${money(item.pipeline)}`,'No owner results yet.'))}${adminPanel('OUTCOMES','Won and lost reasons',adminRows([...reasonMap].sort((a,b)=>b[1]-a[1]),item=>item[0],item=>item[1],'No closed deal reasons recorded.'))}${adminPanel('AT RISK','Top stalled deals',adminRows(stalled.slice(0,5),item=>item.company,item=>`${money(item.value_cents)} · ${daysSince(item.updated_at)}d idle`,'No stalled deals.'))}${adminPanel('CUSTOMERS','Top won deals',adminRows([...won].sort((a,b)=>b.value_cents-a.value_cents).slice(0,5),item=>item.company,item=>money(item.value_cents),'No won deals yet.'))}${adminPanel('SOURCES','Deal amount by source',adminRows([...sourceMap].sort((a,b)=>b[1]-a[1]),item=>item[0],item=>money(item[1]),'No source data yet.'))}${adminPanel('DEAL MIX','Pipeline by deal type',adminRows([...typeMap].sort((a,b)=>b[1]-a[1]),item=>item[0],item=>item[1],'No deal types recorded.'))}${adminPanel('OPPORTUNITIES','Open a deal to adjust it',deals.length?`<div class="admin-rows admin-deal-list">${deals.slice(0,40).map(item=>`<button type="button" data-admin-edit="${escapeHTML(item.id)}"><span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.stage)} · ${escapeHTML(item.owner)}</small></span><b>${money(item.value_cents)}</b></button>`).join('')}</div>`:adminEmpty('No opportunities yet. Add one to start tracking the pipeline.'))}</div>${data.limited?'<p class="dashboard-foot">Showing the 1,000 most recently updated opportunities.</p>':''}`;
}

function adminExternalSection(section,data){
  const stageCounts=new Map((data.contacts||[]).map(item=>[item.stage,Number(item.count)||0]));
  const leadSources=(data.contactSources||[]).map(item=>({name:item.source,count:Number(item.count)||0}));
  const won=(data.opportunities||[]).filter(item=>item.status==='won');
  const purchases=adminInsights?.purchases||[],feedback=adminInsights?.feedback||[];
  const active=purchases.filter(item=>item.subscription_status==='active'),cancelled=purchases.filter(item=>item.subscription_status==='cancelled');
  const avgRating=feedback.length?(sum(feedback,'rating')/feedback.length).toFixed(1):'—';
  if(section==='Awareness')return `<div class="admin-kpis">${adminCard('CRM leads',fmtNumber(sum(leadSources,'count')),'Contacts with a recorded source')}${unavailable('Ad spend','Ad accounts')}${unavailable('Cost per lead','Ad accounts')}${unavailable('Social mentions','Social accounts')}</div><div class="admin-grid">${adminPanel('CRM','Lead sources',adminRows(leadSources,item=>item.name,item=>fmtNumber(item.count),'No lead sources recorded.'))}${adminPanel('CONNECT','Marketing reach',`<p>Connect ad accounts and social channels to see impressions, clicks, CPC, campaign spend, reach, mentions, and leads by channel.</p>${adminLink('Open ad accounts','Ads')}`)}${adminPanel('AUTOMATION','Turn interest into follow up',`<p>Draft rules can pair a form signup, ad lead, or awareness event with a saved text or email template. These sources and delivery are not connected yet.</p><button type="button" class="secondary" data-comm-open-automation>Open automations</button>`)}</div>`;
  if(section==='Consideration')return `<div class="admin-kpis">${adminCard('Qualified contacts',fmtNumber(stageCounts.get('Qualified')||0),'CRM stage')}${adminCard('Proposal contacts',fmtNumber(stageCounts.get('Proposal')||0),'CRM stage')}${unavailable('Website visitors','Google Analytics 4')}${unavailable('Form conversion','Website analytics')}</div><div class="admin-grid">${adminPanel('CRM','Contacts through the funnel',adminRows(data.contacts||[],item=>item.stage,item=>fmtNumber(item.count),'No contacts in pipeline stages.'))}${adminPanel('BEHAVIOR','Website and email',`<p>Connect Google Analytics 4 and a consent-aware heatmap provider for traffic, channel mix, geography, page engagement, form conversion, and page behavior. Email delivery data will add opens, clicks, and bounces.</p><p class="dashboard-foot">Heatmaps require appropriate privacy notices and consent.</p>`)}</div>`;
  if(section==='Purchase')return `<div class="admin-kpis">${adminCard('Recorded purchases',fmtNumber(purchases.length),'Verified manually')}${adminCard('Recorded revenue',money(sum(purchases,'amount_cents')),'From verified orders')}${adminCard('Won CRM deals',fmtNumber(won.length),'Sales outcome, not a payment confirmation')}${adminCard('Won deal value',money(sum(won,'value_cents')),'CRM value, not collected revenue')}</div><div class="admin-grid">${adminPanel('PAYMENTS','Confirm a purchase',`<p>Record an order from your checkout or billing system using its unique transaction ID. Add Stripe later for automatic confirmation.</p><button type="button" class="primary" data-admin-record="purchase">＋ Record purchase</button>`)}${adminPanel('ORDERS','Verified purchase records',adminRows(purchases.slice(0,20),item=>`${item.customer_name} · ${item.product_name}`,item=>money(item.amount_cents),'No verified purchases recorded.'))}${adminPanel('CRM','Won deals',adminRows([...won].sort((a,b)=>b.value_cents-a.value_cents).slice(0,10),item=>item.company,item=>money(item.value_cents),'No won deals yet.'))}</div>`;
  if(section==='Experience')return `<div class="admin-kpis">${adminCard('Customer check-ins',fmtNumber(feedback.length),'Feedback recorded')}${adminCard('Average rating',avgRating==='—'?'—':`${avgRating} / 5`,'From recorded check-ins')}${unavailable('Active customers','Product events')}${unavailable('Feature adoption','Product events')}</div><div class="admin-grid">${adminPanel('FEEDBACK','How customers feel',`<p>Record a customer check-in after a call or survey. This is a manual rating, separate from product usage.</p><button type="button" class="primary" data-admin-record="feedback">＋ Record check-in</button>${adminRows(feedback.slice(0,10),item=>item.customer_name,item=>`${item.rating}/5`,'No feedback recorded.')}`)}${adminPanel('PRODUCT','Usage and onboarding',`<p>Connect product events to see active accounts, active seats, time to first value, onboarding completion, and feature adoption. Connect support tickets for resolution time, CSAT, and NPS.</p>`)}</div>`;
  return `<div class="admin-kpis">${adminCard('Recorded MRR',money(sum(active,'monthly_amount_cents')),'Active manually recorded subscriptions')}${adminCard('Active subscriptions',fmtNumber(active.length),'Verified records')}${adminCard('Cancelled subscriptions',fmtNumber(cancelled.length),'Verified records')}${unavailable('Retention rate','Billing history')}</div><div class="admin-grid">${adminPanel('RECURRING REVENUE','Subscriptions',`<p>MRR is the sum of active monthly amounts entered from verified orders. Mark cancellations to keep it current.</p>${purchases.some(item=>item.monthly_amount_cents>0)?`<div class="admin-rows admin-subscriptions">${purchases.filter(item=>item.monthly_amount_cents>0).map(item=>`<div><span>${escapeHTML(item.customer_name)}<small>${money(item.monthly_amount_cents)}/mo · ${escapeHTML(item.subscription_status)}</small></span><button type="button" class="secondary" data-admin-subscription="${escapeHTML(item.id)}" data-status="${item.subscription_status==='active'?'cancelled':'active'}">${item.subscription_status==='active'?'Mark cancelled':'Reactivate'}</button></div>`).join('')}</div>`:adminEmpty('No subscriptions recorded.')}<button type="button" class="primary" data-admin-record="purchase">＋ Record subscription</button>`)}${adminPanel('GROWTH','More loyalty signals',`<p>Connect full billing history and product events to calculate retention, churn rate, lifetime value, expansion MRR, renewals, repeat purchases, and referrals.</p>`)}</div>`;
}

function renderAdminDashboard(){
  $('#detail').hidden=true;
  const title=view==='Overview'?'Dashboard':view;
  $('#main').innerHTML=`<div class="page-header admin-page-header"><div><h1>${escapeHTML(title)}</h1><p>${view==='Overview'?'Your customer journey in one place':view==='Pipeline'?'Sales performance and deal decisions':'Customer journey analytics'}</p></div><div class="admin-header-actions">${adminOrganizations.length>1?`<label>Company <select id="admin-tenant">${adminOrganizations.map(item=>`<option value="${escapeHTML(item.id)}" ${item.id===adminTenantId?'selected':''}>${escapeHTML(item.name)}</option>`).join('')}</select></label>`:''}<button class="secondary" type="button" data-admin-refresh>Refresh</button></div></div><div id="admin-dashboard-content" aria-live="polite"></div>`;
  const target=$('#admin-dashboard-content');
  if(adminError){target.innerHTML=notice(adminError,true);return}
  if(!adminData){target.innerHTML='<div class="surface dashboard-loading">Loading dashboard…</div>';if(!adminLoading)loadAdminDashboard();return}
  const data=adminData;
  target.innerHTML=view==='Overview'?adminOverview(data):view==='Pipeline'?adminPipeline(data):adminExternalSection(view,data);
}

async function openOpportunityEditor(id){
  const item=id==='new'?null:(adminData?.opportunities||[]).find(row=>row.id===id);
  if(id!=='new'&&!item)return;
  const stages=adminData?.stages||[];
  if(!stages.length){toast('Add a pipeline stage before creating an opportunity.');return}
  let companies=[];
  try{
    const [contactsResponse,companiesResponse]=await Promise.all([
      fetch(`/api/crm?resource=contacts&tenant_id=${encodeURIComponent(adminTenantId)}`,{credentials:'same-origin',cache:'no-store'}),
      fetch(`/api/crm?resource=companies&tenant_id=${encodeURIComponent(adminTenantId)}`,{credentials:'same-origin',cache:'no-store'}),
    ]);
    if(!contactsResponse.ok||!companiesResponse.ok)throw new Error('Could not load contacts and companies.');
    adminContacts=(await contactsResponse.json()).items||[];
    companies=(await companiesResponse.json()).items||[];
  }catch(error){toast(error.message||'Could not load contacts and companies.');return}
  const dialog=$('#admin-opportunity-dialog'),form=$('#admin-opportunity-form');
  form.reset();form.elements.id.value=item?.id||'';
  form.elements.title.value=item?.title||'';
  form.elements.value.value=item?String((Number(item.value_cents)||0)/100):'';
  form.elements.stage_id.innerHTML=stages.map(stage=>`<option value="${escapeHTML(stage.id)}">${escapeHTML(stage.pipeline_name)} · ${escapeHTML(stage.name)}</option>`).join('');
  form.elements.stage_id.value=item?.stage_id||stages[0].id;
  form.elements.status.value=item?.status||'open';
  form.elements.deal_type.value=item?.deal_type||'';
  form.elements.outcome_reason.value=item?.outcome_reason||'';
  form.elements.contact_id.innerHTML='<option value="">No linked contact</option>'+adminContacts.map(contact=>`<option value="${escapeHTML(contact.id)}">${escapeHTML(contact.name)}</option>`).join('')+(item?.contact_id&&!adminContacts.some(contact=>contact.id===item.contact_id)?`<option value="${escapeHTML(item.contact_id)}">Current contact</option>`:'');
  form.elements.company_id.innerHTML='<option value="">No linked company</option>'+companies.map(company=>`<option value="${escapeHTML(company.id)}">${escapeHTML(company.name)}</option>`).join('')+(item?.company_id&&!companies.some(company=>company.id===item.company_id)?`<option value="${escapeHTML(item.company_id)}">Current company</option>`:'');
  form.elements.contact_id.value=item?.contact_id||'';
  form.elements.company_id.value=item?.company_id||'';
  $('#admin-opportunity-title').textContent=item?'Edit opportunity':'New opportunity';
  $('#admin-opportunity-error').hidden=true;
  dialog.showModal();
}
function openInsightEditor(type){
  if(!['purchase','feedback'].includes(type))return;
  const dialog=$('#admin-insight-dialog'),form=$('#admin-insight-form');
  form.reset();form.elements.type.value=type;
  const now=new Date(),localDate=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
  form.elements.purchased_at.value=localDate;
  form.elements.observed_at.value=localDate;
  $('#admin-insight-title').textContent=type==='purchase'?'Record verified purchase':'Record customer check-in';
  $('#admin-purchase-fields').hidden=type!=='purchase';
  $('#admin-feedback-fields').hidden=type!=='feedback';
  for(const input of form.querySelectorAll('[data-required]'))input.required=input.closest('[data-insight-fields]').dataset.insightFields===type;
  $('#admin-insight-error').hidden=true;dialog.showModal();
}

document.addEventListener('click',event=>{
  const jump=event.target.closest('[data-admin-section]');
  if(jump&&category==='Dashboard'){
    const section=jump.dataset.adminSection;
    if(section==='Ads'){category='Ads';view='Ad accounts'}else if(availableViews('Dashboard').includes(section))view=section;
    render();return;
  }
  const edit=event.target.closest('[data-admin-edit]');
  if(edit&&category==='Dashboard'){openOpportunityEditor(edit.dataset.adminEdit);return}
  const record=event.target.closest('[data-admin-record]');
  if(record&&category==='Dashboard'){openInsightEditor(record.dataset.adminRecord);return}
  const subscription=event.target.closest('[data-admin-subscription]');
  if(subscription&&category==='Dashboard'){updateSubscription(subscription);return}
  if(event.target.closest('[data-admin-number-request]')&&category==='Dashboard'){
    $('#admin-number-form').reset();$('#admin-number-error').hidden=true;$('#admin-number-dialog').showModal();return;
  }
  if(event.target.closest('[data-admin-refresh]')&&category==='Dashboard'){adminData=null;adminError='';renderAdminDashboard()}
});
document.addEventListener('keydown',event=>{const jump=event.target.closest('[data-admin-section]');if(jump&&(event.key==='Enter'||event.key===' ')){event.preventDefault();jump.click()}});
document.addEventListener('change',event=>{if(event.target.id==='admin-owner'){adminOwner=event.target.value;renderAdminDashboard()}if(event.target.id==='admin-tenant'){adminTenantId=event.target.value;adminData=null;adminInsights=null;adminPhoneRequests=[];adminOwner='all';renderAdminDashboard()}if(event.target.name==='contact_id'&&event.target.closest('#admin-opportunity-form')){const contact=adminContacts.find(item=>item.id===event.target.value);if(contact?.company_id)$('#admin-opportunity-form').elements.company_id.value=contact.company_id}});
$('#admin-number-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(event.submitter?.value==='cancel'){$('#admin-number-dialog').close();return}
  const form=event.currentTarget,button=event.submitter;
  const payload={tenant_id:adminTenantId,partner_name:form.elements.partner_name.value.trim(),country:form.elements.country.value.trim().toUpperCase(),region:form.elements.region.value.trim()||null,number_type:form.elements.number_type.value,capabilities:form.elements.capabilities.value,notes:form.elements.notes.value.trim()||null};
  button.disabled=true;
  try{
    const response=await fetch('/api/phone-number-requests',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not save the request.');
    $('#admin-number-dialog').close();adminData=null;renderAdminDashboard();toast('Number need saved for partner review.');
  }catch(error){$('#admin-number-error').textContent=error.message||'Could not save the request.';$('#admin-number-error').hidden=false}finally{button.disabled=false}
});
$('#admin-opportunity-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(event.submitter?.value==='cancel'){$('#admin-opportunity-dialog').close();return}
  const form=event.currentTarget,amount=Number(form.elements.value.value);
  if(!Number.isFinite(amount)||amount<0||Math.round(amount*100)!==amount*100){$('#admin-opportunity-error').textContent='Enter a valid amount with no more than two decimals.';$('#admin-opportunity-error').hidden=false;return}
  const payload={tenant_id:adminTenantId,title:form.elements.title.value.trim(),stage_id:form.elements.stage_id.value,contact_id:form.elements.contact_id.value||null,company_id:form.elements.company_id.value||null,value_cents:Math.round(amount*100),status:form.elements.status.value,deal_type:form.elements.deal_type.value.trim()||null,outcome_reason:form.elements.outcome_reason.value.trim()||null};
  if(form.elements.id.value)payload.id=form.elements.id.value;
  const button=event.submitter;button.disabled=true;
  try{
    const response=await fetch(`/api/crm?resource=opportunities&tenant_id=${encodeURIComponent(adminTenantId)}`,{method:payload.id?'PATCH':'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not save opportunity.');
    $('#admin-opportunity-dialog').close();adminData=null;renderAdminDashboard();toast('Opportunity saved.');
  }catch(error){$('#admin-opportunity-error').textContent=error.message||'Could not save opportunity.';$('#admin-opportunity-error').hidden=false}finally{button.disabled=false}
});
$('#admin-insight-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(event.submitter?.value==='cancel'){$('#admin-insight-dialog').close();return}
  const form=event.currentTarget,type=form.elements.type.value;
  const payload={tenant_id:adminTenantId,type};
  if(type==='purchase'){
    const amount=Number(form.elements.amount.value),monthly=Number(form.elements.monthly_amount.value||0);
    if(!Number.isFinite(amount)||!Number.isFinite(monthly)||amount<0||monthly<0){$('#admin-insight-error').textContent='Enter valid purchase amounts.';$('#admin-insight-error').hidden=false;return}
    Object.assign(payload,{customer_name:form.elements.purchase_customer.value.trim(),product_name:form.elements.product_name.value.trim(),reference:form.elements.reference.value.trim(),amount_cents:Math.round(amount*100),monthly_amount_cents:Math.round(monthly*100),purchased_at:form.elements.purchased_at.value});
  }else Object.assign(payload,{customer_name:form.elements.feedback_customer.value.trim(),rating:Number(form.elements.rating.value),note:form.elements.note.value.trim()||null,observed_at:form.elements.observed_at.value});
  const button=event.submitter;button.disabled=true;
  try{
    const response=await fetch('/api/admin-insights',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not save this record.');
    $('#admin-insight-dialog').close();adminData=null;adminInsights=null;renderAdminDashboard();toast(type==='purchase'?'Purchase recorded.':'Check-in recorded.');
  }catch(error){$('#admin-insight-error').textContent=error.message||'Could not save this record.';$('#admin-insight-error').hidden=false}finally{button.disabled=false}
});
async function updateSubscription(button){
  button.disabled=true;
  try{
    const response=await fetch('/api/admin-insights',{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({tenant_id:adminTenantId,type:'subscription',id:button.dataset.adminSubscription,status:button.dataset.status})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not update subscription.');
    adminData=null;adminInsights=null;renderAdminDashboard();toast('Subscription updated.');
  }catch(error){button.disabled=false;toast(error.message||'Could not update subscription.')}
}
