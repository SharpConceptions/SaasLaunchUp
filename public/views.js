const tasks=[
  {id:1,title:'Follow up with Maya Chen',meta:'Today · Jordan Lee · Luma Partners',done:false},
  {id:2,title:'Prepare proposal for Amara Okafor',meta:'Tomorrow · Priya Shah · Northline Health',done:false},
  {id:3,title:'Review qualification notes for Sofia Martinez',meta:'Sep 25 · Jordan Lee · Bright Ledger',done:false},
  {id:4,title:'Confirm discovery call with Marcus Rivera',meta:'Sep 26 · Jordan Lee · Atlas & Co.',done:false}
];
const deals=[
  {name:'Atlas & Co.',contact:'Marcus Rivera',value:'$4,800',stage:'New lead',owner:'Jordan Lee'},
  {name:'Common Ground',contact:'Elliot Park',value:'$6,200',stage:'Contacted',owner:'Priya Shah'},
  {name:'Luma Partners',contact:'Maya Chen',value:'$12,000',stage:'Qualified',owner:'Jordan Lee'},
  {name:'Bright Ledger',contact:'Sofia Martinez',value:'$9,500',stage:'Qualified',owner:'Jordan Lee'},
  {name:'Northline Health',contact:'Amara Okafor',value:'$18,000',stage:'Proposal',owner:'Priya Shah'}
];
const pipelineStages=['New lead','Contacted','Qualified','Proposal'];
const demoPipelineKey='nectcon-demo-pipeline-stages-v1';
let savedPipelineStages={};
try{savedPipelineStages=JSON.parse(localStorage.getItem(demoPipelineKey)||'{}')}catch{}
if(!savedPipelineStages||typeof savedPipelineStages!=='object'||Array.isArray(savedPipelineStages))savedPipelineStages={};
for(const deal of deals){
  const contact=contacts.find(item=>item.name===deal.contact);
  if(contact&&pipelineStages.includes(savedPipelineStages[contact.id])){deal.stage=savedPipelineStages[contact.id];contact.stage=deal.stage}
}
const conversations=[
  {name:'Maya Chen',channel:'Email',excerpt:'Thanks for the overview. Can we talk Thursday?',time:'9:42 AM',unread:true},
  {name:'Sofia Martinez',channel:'SMS',excerpt:'Tuesday afternoon works for me.',time:'Yesterday',unread:false},
  {name:'Amara Okafor',channel:'Email',excerpt:'I received the proposal, thank you.',time:'Sep 20',unread:false}
];
const header=(title,description,action='',label='')=>`<div class="page-header"><div><h1>${escapeHTML(title)}</h1><p>${escapeHTML(description)}</p></div>${action?`<button class="primary" data-action="${action}">${escapeHTML(label)}</button>`:''}</div>`;
const notice=(message,warning=false)=>`<div class="notice ${warning?'warn':''}">${escapeHTML(message)}</div>`;
const simpleEmpty=(title,description)=>`<div class="surface empty-state"><div class="symbol">◇</div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(description)}</p></div>`;
function renderCompanies(){const companies=[...new Map(contacts.map(c=>[c.company,c])).values()];$('#main').innerHTML=header('Sub accounts','Organizations connected to your contacts')+`<div class="cards">${companies.map(c=>`<div class="card surface"><div class="card-top"><h3>${escapeHTML(c.company)}</h3><span class="avatar">${initials(c.company)}</span></div><p>${escapeHTML(c.name)} · ${escapeHTML(c.stage)}</p><div class="small">Owner: ${escapeHTML(c.owner)}</div></div>`).join('')}</div>`}
function renderPipeline(){
  const real=crmDialerContacts.length>0;
  const stageNames=real?crmPipelineStages.map(item=>item.stage_name):pipelineStages;
  const activeDeals=real?crmDialerContacts.map(contact=>({id:contact.id,name:contact.company,contact:contact.name,stage:contact.stage,value:'CRM contact',owner:contact.owner})):deals.filter(deal=>contacts.some(contact=>contact.name===deal.contact)).map(deal=>({...deal,id:contacts.find(contact=>contact.name===deal.contact)?.id}));
  $('#main').innerHTML=header('Pipeline','Click a contact to move them to another stage','demo-disabled','＋ New opportunity')+`<div class="pipeline">${stageNames.map(stage=>`<section class="lane"><h2>${escapeHTML(stage)}<span class="lane-count">${activeDeals.filter(deal=>deal.stage===stage).length}</span></h2>${activeDeals.filter(deal=>deal.stage===stage).map(deal=>`<button class="deal deal-button" type="button" data-pipeline-contact="${escapeHTML(deal.id)}"><strong>${escapeHTML(deal.name)}</strong><p>${escapeHTML(deal.contact)}</p><footer><span>${escapeHTML(deal.value)}</span><span>${escapeHTML(deal.owner)}</span></footer></button>`).join('')}</section>`).join('')}</div>`;
}
function renderTasks(){const open=tasks.filter(t=>!t.done).length;$('#main').innerHTML=header('Tasks',`${open} open follow-ups for your team`,'demo-disabled','＋ New task')+`<div class="surface">${tasks.map(t=>`<label class="list-row"><input class="check" type="checkbox" data-task="${t.id}" ${t.done?'checked':''}><span><h3 style="${t.done?'text-decoration:line-through;color:#91a0ad':''}">${escapeHTML(t.title)}</h3><p>${escapeHTML(t.meta)}</p></span>${t.done?'<span class="status-pill push">Done</span>':''}</label>`).join('')}</div><p class="subtle">Task changes remain in this browser session.</p>`}
let dialpadCollapsed = false;
let dialerNumber = '';
let selectedDialerContactId='1';
let crmDialerContacts=[];
let crmPipelineStages=[];
let crmSalesTenantId=null;
function availableDialerContacts(){return crmDialerContacts.length?crmDialerContacts:contacts}
function currentDialerContact(){const choices=availableDialerContacts();return choices.find(item=>String(item.id)===String(selectedDialerContactId))||choices[0]||null}
async function loadCrmDialerContacts(){
  try{
    const orgResult=await fetch('/api/crm?resource=organizations',{credentials:'same-origin',cache:'no-store'});
    if(!orgResult.ok)return;
    const organizations=(await orgResult.json()).items||[];
    if(!organizations.length)return;
    const salesOrganization=organizations.find(item=>['business_owner','sales_manager','sales_representative'].includes(item.role));
    if(!salesOrganization)return;
    const tenantId=salesOrganization.id;
    crmSalesTenantId=tenantId;
    const [contactsResult,stagesResult]=await Promise.all([
      fetch(`/api/crm?resource=contacts&tenant_id=${encodeURIComponent(tenantId)}`,{credentials:'same-origin',cache:'no-store'}),
      fetch(`/api/crm?resource=pipelines&tenant_id=${encodeURIComponent(tenantId)}`,{credentials:'same-origin',cache:'no-store'}),
    ]);
    if(!contactsResult.ok||!stagesResult.ok)return;
    crmPipelineStages=(await stagesResult.json()).items||[];
    crmDialerContacts=((await contactsResult.json()).items||[]).map(item=>({id:`crm:${item.id}`,contactId:item.id,tenantId,companyId:item.company_id,pipelineId:item.pipeline_id,stageId:item.stage_id,name:item.name,email:item.email||'',company:item.company_name||'No company',phone:item.phone||'',timezone:item.timezone||'Unknown',owner:'Your team',source:item.source||'CRM',stage:item.lifecycle_stage,sms:'Unknown',emailStatus:'Unknown',call:'Review needed',activity:'No activity recorded',companyDomain:item.company_domain,researchSummary:item.company_research_summary,researchSourceUrl:item.company_research_source_url}));
    if(category==='Sales'&&view==='Calls'&&callWorkspaceTab==='Sales dialer'){renderSalesCalls();if(typeof updateCallScriptCompany==='function')updateCallScriptCompany()}
    if(category==='Sales'&&view==='Pipeline')renderPipeline();
    if(category==='Sales'&&view==='Contacts')renderContacts();
    if(category==='Sales'&&view==='My dashboard')renderSalesProfileDashboard();
  }catch{}
}
const companyResearchKey='nectcon-demo-company-research-v1';
let companyResearch={};
try{companyResearch=JSON.parse(localStorage.getItem(companyResearchKey)||'{}')}catch{}
if(!companyResearch||typeof companyResearch!=='object'||Array.isArray(companyResearch))companyResearch={};
function renderDialer(){
  const c=currentDialerContact()||{name:'No contact',company:'—',phone:'—',timezone:'—',owner:'—',source:'—'};
  selectedDialerContactId=String(c.id);
  const scriptAction='<button class="secondary" type="button" data-action="open-call-script" aria-controls="call-script-window" aria-expanded="false">▤ Call script</button>';
  const keys=['1','2','3','4','5','6','7','8','9','+','0','⌫'];
  $('#main').innerHTML=`<div class="page-header"><div><h1>Sales dialer</h1><p>Preview the contact and verify eligibility before calling</p></div>${scriptAction}</div>`+
    notice('Calls are disabled. A live dialer needs authenticated users, consent evidence, suppression screening, and an approved Twilio connection.',true)+
    `<div class="dialer-layout"><div class="dialer-main"><section class="surface section-card"><span class="eyebrow">PREVIEW QUEUE · 1 OF 5</span><h2 style="margin-top:8px">${escapeHTML(c.name)}</h2><p>${escapeHTML(c.company)} · ${escapeHTML(c.phone)} · ${escapeHTML(c.timezone)} time</p><div class="field-list"><div><span>Owner</span><strong>${escapeHTML(c.owner)}</strong></div><div><span>Lead source</span><strong>${escapeHTML(c.source)}</strong></div><div><span>Last activity</span><strong>Replied to email today</strong></div><div><span>Call consent</span><strong>Review needed</strong></div></div><div style="margin-top:23px"><button class="primary" disabled>Call ${escapeHTML(c.name.split(' ')[0])}</button> <button class="secondary" data-action="demo-disabled">Skip for now</button></div></section><section class="surface section-card"><h2>Eligibility checks</h2><p>Every outbound attempt requires a current result.</p><div class="step-list">${['User and campaign authorization','Phone, timezone, and calling window','Consent evidence and call type','DNC and internal suppression','Frequency and quiet period'].map((x,i)=>`<div class="step"><b>${i+1}</b>${x}</div>`).join('')}</div></section></div><section class="surface dialpad" aria-label="Manual phone dialer"><div class="dialpad-head"><div><span class="eyebrow">MANUAL DIALER</span><h2>Phone dialer</h2></div><button class="secondary" type="button" data-action="toggle-dialpad" aria-expanded="${!dialpadCollapsed}" aria-controls="dialpad-content">${dialpadCollapsed?'Expand':'Collapse'}</button></div><div id="dialpad-content" ${dialpadCollapsed?'hidden':''}><label class="dialpad-label" for="manual-number">Phone number</label><input id="manual-number" type="tel" inputmode="tel" autocomplete="off" placeholder="Enter a number" value="${escapeHTML(dialerNumber)}"><div class="dialpad-keys">${keys.map(k=>`<button type="button" data-dial-key="${k}" aria-label="${k==='⌫'?'Delete last digit':k}">${k}</button>`).join('')}</div><button class="primary dialpad-call" disabled>Place call</button><p class="subtle">Calls are unavailable until the Admin center and provider controls are complete.</p></div></section></div>`;
  const storedResearch=companyResearch[c.id]||(c.researchSummary?{description:c.researchSummary,website:c.researchSourceUrl,title:c.company}:null);
  const research=storedResearch&&typeof storedResearch.description==='string'&&/^https:\/\/[a-z0-9.-]+(?:\/[^\s"<>]*)?$/i.test(storedResearch.website)?storedResearch:null;
  document.querySelector('.dialer-main').insertAdjacentHTML('beforeend',`<section class="surface section-card company-research"><span class="eyebrow">COMPANY RESEARCH</span><h2>Know the company before calling</h2><label for="dialer-contact">Contact</label><select id="dialer-contact">${availableDialerContacts().map(item=>`<option value="${escapeHTML(item.id)}" ${String(item.id)===String(c.id)?'selected':''}>${escapeHTML(item.name)} · ${escapeHTML(item.company)}</option>`).join('')}</select><label for="company-website">Company website</label><div class="research-controls"><input id="company-website" type="url" placeholder="https://company.com" value="${escapeHTML(research?.website||c.companyDomain||'')}"><button class="secondary" type="button" data-action="research-company" ${c.id?'':'disabled'}>Research website</button></div><p id="research-status" class="subtle" role="status">${research?'Website description found. Review it before using the script.':'Enter the official website to find a public description.'}</p>${research?`<div class="research-result"><strong>${escapeHTML(research.title||c.company)}</strong><p>${escapeHTML(research.description)}</p><a href="${escapeHTML(research.website)}" target="_blank" rel="noopener noreferrer">View source website</a></div>`:''}</section>`);
}
function renderQueues(){ $('#main').innerHTML=header('Call queues','Campaign queues and eligibility status')+notice('Queues are paused until outbound calling release gates are complete.',true)+`<div class="surface"><div class="list-row"><span><h3>New lead follow-up</h3><p>5 sample contacts · Preview dialer</p></span><span class="status-pill muted push">Paused</span></div><div class="list-row"><span><h3>Scheduled callbacks</h3><p>2 sample contacts · Power dialer</p></span><span class="status-pill muted push">Paused</span></div></div>`}
function renderImport(){ $('#main').innerHTML=header('Import contacts','Validate a file before creating or updating contacts')+notice('Preview only. Files stay on your device in this demo; no contacts are imported.')+`<div class="split"><section class="surface section-card"><h2>Choose a CSV file</h2><p>Select a CSV file with a header row to see a local preview. Excel import requires the secure data service.</p><input id="csv-file" type="file" accept=".csv,text/csv" aria-label="Choose CSV file"><div id="import-preview" style="margin-top:18px" class="subtle">No file selected.</div></section><section class="surface section-card"><h2>Before import</h2><div class="step-list"><div class="step"><b>1</b>Map fields and confirm ownership</div><div class="step"><b>2</b>Validate email, phone, and timezone</div><div class="step"><b>3</b>Review duplicates and consent evidence</div><div class="step"><b>4</b>Confirm create, update, and skip counts</div></div><p style="margin-top:15px">Importing must never start outreach automatically.</p></section></div>`}
let salesDashboard=null, dashboardTenantId=null, dashboardFilter='all';
const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format((Number(cents)||0)/100);
async function loadSalesDashboard(){
  try{
    const orgResponse=await fetch('/api/crm?resource=organizations',{credentials:'same-origin',cache:'no-store'});
    if(!orgResponse.ok)throw new Error('Could not load organizations.');
    const orgs=(await orgResponse.json()).items||[];
    const org=orgs.find(item=>reportRoles.has(item.role));
    if(!org)throw new Error('Manager access is required.');
    dashboardTenantId=org.id;
    const response=await fetch(`/api/sales-dashboard?tenant_id=${encodeURIComponent(org.id)}`,{credentials:'same-origin',cache:'no-store'});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Could not load the dashboard.');
    salesDashboard=result;
    if((category==='Reporting'&&view==='Sales dashboard')||(category==='Sales'&&view==='Dashboard')||(category==='Settings'&&view==='Reporting'&&settingsReportTab==='Sales dashboard')){if(category==='Settings')renderSettingsReporting();else renderReports()}
  }catch(error){if((category==='Reporting'&&view==='Sales dashboard')||(category==='Sales'&&view==='Dashboard')||(category==='Settings'&&view==='Reporting'&&settingsReportTab==='Sales dashboard'))$('#sales-dashboard-content').innerHTML=notice(error.message||'Could not load the dashboard.',true)}
}
function renderReports(){
  $('#main').innerHTML=header('Sales dashboard','Your sales picture at a glance')+`<div id="sales-dashboard-content" aria-live="polite">${salesDashboard?'':'<div class="surface dashboard-loading">Loading sales data…</div>'}</div>`;
  if(!salesDashboard){loadSalesDashboard();return}
  const data=salesDashboard, all=data.opportunities||[];
  const owners=[...new Set(all.map(item=>item.owner))].sort();
  if(dashboardFilter!=='all'&&!owners.includes(dashboardFilter))dashboardFilter='all';
  const rows=dashboardFilter==='all'?all:all.filter(item=>item.owner===dashboardFilter);
  const open=rows.filter(item=>item.status==='open'), won=rows.filter(item=>item.status==='won'), lost=rows.filter(item=>item.status==='lost');
  const openValue=open.reduce((sum,item)=>sum+(Number(item.value_cents)||0),0);
  const wonValue=won.reduce((sum,item)=>sum+(Number(item.value_cents)||0),0);
  const age=item=>Math.max(0,Math.floor((Date.now()-Date.parse(item.created_at))/86400000))||0;
  const stalled=open.filter(item=>Date.now()-Date.parse(item.updated_at)>14*86400000).sort((a,b)=>Number(b.value_cents)-Number(a.value_cents));
  const avgAge=open.length?Math.round(open.reduce((sum,item)=>sum+age(item),0)/open.length):0;
  const stageNames=(data.stages||[]).map(item=>item.name);
  const stages=stageNames.map(name=>({name,count:open.filter(item=>item.stage===name).length,value:open.filter(item=>item.stage===name).reduce((sum,item)=>sum+(Number(item.value_cents)||0),0)}));
  const maxStage=Math.max(1,...stages.map(item=>item.count));
  const ownerRows=owners.map(owner=>({owner,open:all.filter(item=>item.owner===owner&&item.status==='open').length,won:all.filter(item=>item.owner===owner&&item.status==='won').reduce((sum,item)=>sum+(Number(item.value_cents)||0),0)})).sort((a,b)=>b.won-a.won);
  $('#sales-dashboard-content').innerHTML=`<div class="dashboard-top"><span class="dashboard-label">${escapeHTML(dashboardFilter==='all'?'All team members':dashboardFilter)}</span><div class="dashboard-tools"><label>Show <select id="dashboard-owner"><option value="all">Whole team</option>${owners.map(owner=>`<option value="${escapeHTML(owner)}" ${owner===dashboardFilter?'selected':''}>${escapeHTML(owner)}</option>`).join('')}</select></label><button class="secondary" type="button" data-dashboard-refresh>Refresh</button></div></div><div class="dashboard-metrics"><div class="surface dashboard-metric"><span>Open pipeline</span><strong>${money(openValue)}</strong><small>${open.length} open ${open.length===1?'deal':'deals'}</small></div><div class="surface dashboard-metric"><span>Won revenue</span><strong>${money(wonValue)}</strong><small>${won.length} won ${won.length===1?'deal':'deals'}</small></div><div class="surface dashboard-metric"><span>Average open age</span><strong>${avgAge} days</strong><small>From deal creation</small></div><div class="surface dashboard-metric"><span>Needs attention</span><strong>${stalled.length}</strong><small>Open deals idle over 14 days</small></div></div><div class="dashboard-grid"><section class="surface dashboard-panel"><div class="dashboard-panel-head"><div><span class="dashboard-kicker">PIPELINE</span><h2>Where deals stand</h2></div><button class="secondary" type="button" data-dashboard-jump="Pipeline">Open pipeline</button></div>${stages.length?`<div class="dashboard-stage-list">${stages.map(item=>`<div class="dashboard-stage"><div><strong>${escapeHTML(item.name)}</strong><span>${item.count} · ${money(item.value)}</span></div><div class="dashboard-track"><span style="width:${Math.max(3,item.count/maxStage*100)}%"></span></div></div>`).join('')}</div>`:'<p class="dashboard-empty">No pipeline stages yet.</p>'}</section><section class="surface dashboard-panel"><span class="dashboard-kicker">FOLLOW UP</span><h2>Needs attention</h2>${stalled.length?`<div class="dashboard-attention">${stalled.slice(0,5).map(item=>`<div><strong>${escapeHTML(item.company)}</strong><span>${money(item.value_cents)} · ${age(item)} days open</span></div>`).join('')}</div>`:'<p class="dashboard-empty">No open deals have been idle for over 14 days.</p>'}<p class="dashboard-foot">${data.openTasks} open team ${data.openTasks===1?'task':'tasks'}</p></section><section class="surface dashboard-panel"><span class="dashboard-kicker">OUTCOMES</span><h2>Closed deals</h2><div class="dashboard-outcomes"><div><strong>${won.length}</strong><span>Won</span></div><div><strong>${lost.length}</strong><span>Lost</span></div></div><p class="dashboard-foot">${rows.length?'Based on saved opportunities.':'Add opportunities to see deal outcomes.'}</p></section><section class="surface dashboard-panel"><span class="dashboard-kicker">TEAM</span><h2>By team member</h2>${ownerRows.length?`<div class="dashboard-attention">${ownerRows.map(item=>`<div><strong>${escapeHTML(item.owner)}</strong><span>${item.open} open · ${money(item.won)} won</span></div>`).join('')}</div>`:'<p class="dashboard-empty">No opportunities assigned yet.</p>'}</section></div>${data.limited?'<p class="dashboard-foot">Showing the 1,000 most recently updated opportunities.</p>':''}`;
}
document.addEventListener('change',event=>{if(event.target.id==='dashboard-owner'){dashboardFilter=event.target.value;if(category==='Settings')renderSettingsReporting();else renderReports()}});
document.addEventListener('click',event=>{if(event.target.closest('[data-dashboard-jump]')){category='Sales';view='Pipeline';render()}});
document.addEventListener('click',event=>{if(event.target.closest('[data-dashboard-refresh]')){salesDashboard=null;if(category==='Settings')renderSettingsReporting();else renderReports()}});
function renderInbox(){ $('#main').innerHTML=header('Unified inbox','Messages and replies in one place','demo-disabled','＋ New message')+notice('Conversations shown here are sample data. Sending and reply routing are not connected.')+`<div class="surface">${conversations.map(c=>`<div class="list-row"><span class="avatar">${initials(c.name)}</span><span><h3>${escapeHTML(c.name)} ${c.unread?'<span class="status-pill">New</span>':''}</h3><p>${escapeHTML(c.excerpt)}</p></span><span class="push subtle">${c.channel} · ${c.time}</span></div>`).join('')}</div>`}
function renderConsent(){ $('#main').innerHTML=header('Consent center','Channel permissions and suppression status')+notice('Consent evidence is sample data. Live enforcement requires verified records and server-side checks.',true)+`<div class="surface" style="overflow:auto"><table class="contacts-table"><thead><tr><th>Contact</th><th>Calls</th><th>SMS</th><th>Email</th></tr></thead><tbody>${contacts.map(c=>`<tr><td><strong>${escapeHTML(c.name)}</strong></td><td>${status(c.call)}</td><td>${status(c.sms)}</td><td>${status(c.emailStatus)}</td></tr>`).join('')}</tbody></table></div>`}
function renderCalendar(){
  const pageTitle=view==='Availability'?'Availability':view==='Booking pages'?'Book a demo':view==='Appointments'?'Appointments':'Calendar';
  const description=view==='Availability'?'Set the times when your team can accept demos.':view==='Booking pages'?'Schedule a demo linked to a CRM contact.':view==='Appointments'?'Review, reschedule, or cancel CRM-linked demos.':'Appointments and CRM follow-up tasks.';
  $('#main').innerHTML=header(pageTitle,description)+'<div id="calendar-task-list" class="surface section-card">Loading calendar…</div>';
  void (async()=>{
    const root=$('#calendar-task-list');
    try{
      const orgResponse=await fetch('/api/crm?resource=organizations',{credentials:'same-origin',cache:'no-store'});
      const orgs=await orgResponse.json();if(!orgResponse.ok)throw new Error(orgs.error||'Could not load organizations.');
      const organization=(orgs.items||[]).find(item=>['business_owner','sales_manager','sales_representative'].includes(item.role));
      const tenantId=crmSalesTenantId||organization?.id;
      if(!tenantId)throw new Error('No sales workspace is available.');
      crmSalesTenantId=tenantId;
      const [tasksResponse,appointmentsResponse,availabilityResponse,contactsResponse]=await Promise.all([
        fetch(`/api/crm?resource=tasks&tenant_id=${encodeURIComponent(tenantId)}`,{credentials:'same-origin',cache:'no-store'}),
        fetch(`/api/appointments?resource=appointments&tenant_id=${encodeURIComponent(tenantId)}`,{credentials:'same-origin',cache:'no-store'}),
        fetch(`/api/appointments?resource=availability&tenant_id=${encodeURIComponent(tenantId)}`,{credentials:'same-origin',cache:'no-store'}),
        fetch(`/api/crm?resource=contacts&tenant_id=${encodeURIComponent(tenantId)}`,{credentials:'same-origin',cache:'no-store'})
      ]);
      const [taskData,appointmentData,availabilityData,contactData]=await Promise.all([tasksResponse.json(),appointmentsResponse.json(),availabilityResponse.json(),contactsResponse.json()]);
      for(const [response,data,message] of [[tasksResponse,taskData,'Could not load tasks.'],[appointmentsResponse,appointmentData,'Could not load appointments.'],[availabilityResponse,availabilityData,'Could not load availability.'],[contactsResponse,contactData,'Could not load CRM contacts.']])if(!response.ok)throw new Error(data.error||message);
      if(category!=='Calendars'||!$('#calendar-task-list'))return;
      const tasks=(taskData.items||[]).filter(item=>item.due_at&&item.status==='open').sort((a,b)=>String(a.due_at).localeCompare(String(b.due_at)));
      const appointments=appointmentData.items||[], config=availabilityData.availability;
      const people=contactData.items||[];
      const timezone=config?.timezone||organization?.timezone||'America/Chicago';
      if(view==='Availability'){
        const windows=new Map((config?.windows||[]).map(item=>[item.weekday,item]));
        const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        $('#calendar-task-list').innerHTML=`<form id="appointment-availability-form"><input type="hidden" name="tenant_id" value="${escapeHTML(tenantId)}"><label class="field">IANA timezone<input name="timezone" value="${escapeHTML(timezone)}" maxlength="100" required></label><label class="field">Appointment length<select name="duration_minutes">${[15,30,45,60].map(n=>`<option value="${n}" ${Number(config?.duration_minutes||30)===n?'selected':''}>${n} minutes</option>`).join('')}</select></label><div class="field-list">${days.map((day,weekday)=>{const window=windows.get(weekday);return `<div class="list-row"><label><input type="checkbox" name="weekday" value="${weekday}" ${window?'checked':''}> ${day}</label><label>From <input type="time" name="start_${weekday}" value="${escapeHTML(window?.start||'09:00')}"></label><label>To <input type="time" name="end_${weekday}" value="${escapeHTML(window?.end||'17:00')}"></label></div>`}).join('')}</div><p id="appointment-form-message" class="small" role="status"></p><button class="primary" type="submit">Save availability</button></form>`;
      }else{
        const contactOptions=people.map(person=>`<option value="${escapeHTML(person.id)}">${escapeHTML(person.name)}${person.company_name?` · ${escapeHTML(person.company_name)}`:''}</option>`).join('');
        const list=appointments.length?appointments.map(item=>{
          const jobs=(appointmentData.reminder_jobs||[]).filter(job=>job.appointment_id===item.id);
          const rescheduleTimezone=item.reschedule_timezone||item.timezone;
          return `<article class="list-row"><div><strong>${escapeHTML(item.title)} · ${escapeHTML(item.contact_name)}</strong><p>${escapeHTML(new Date(item.starts_at).toLocaleString(undefined,{timeZone:item.timezone}))} · ${escapeHTML(item.timezone)} · ${item.status==='booked'?'Booked':'Cancelled'}</p><p class="small">Reminder schedule: ${jobs.length?jobs.map(job=>`${escapeHTML(job.reminder_kind)} ${escapeHTML(job.channel)} · ${escapeHTML(job.status)}`).join(' · '):'none'}</p></div>${item.status==='booked'?`<form class="appointment-reschedule-form" data-appointment-id="${escapeHTML(item.id)}" data-timezone="${escapeHTML(rescheduleTimezone)}"><label>New start (${escapeHTML(rescheduleTimezone)}) <input type="datetime-local" name="starts_at" required step="900"></label><button class="secondary" type="submit">Reschedule</button><button class="secondary" type="button" data-cancel-appointment="${escapeHTML(item.id)}">Cancel</button></form>`:''}</article>`;
        }).join(''):'<p>No demos booked yet.</p>';
        const bookingForm=view==='Booking pages'?`<form id="appointment-booking-form"><input type="hidden" name="tenant_id" value="${escapeHTML(tenantId)}"><input type="hidden" name="timezone" value="${escapeHTML(timezone)}"><label class="field">CRM contact<select name="contact_id" required><option value="">Choose a contact</option>${contactOptions}</select></label><label class="field">Start time (${escapeHTML(timezone)})<input type="datetime-local" name="starts_at" required step="900"></label><p class="small">${config?`Appointments use ${config.duration_minutes} minutes in ${escapeHTML(timezone)} time.`:'Set team availability before booking.'}</p><p id="appointment-form-message" class="small" role="status"></p><button class="primary" type="submit" ${!config||!people.length?'disabled':''}>Book demo</button></form>`:'';
        $('#calendar-task-list').innerHTML=`${view==='Booking pages'?`<section class="section-card">${config?bookingForm:'<p class="notice warn">Configure team availability before accepting bookings. <button type="button" class="secondary" data-open-availability>Set availability</button></p>'}</section>`:''}<section><h2>Demo appointments</h2>${list}<p class="small">Reminder schedule is dry-run only. No email or SMS is sent. External calendar sync is not connected.</p></section>${view==='Calendar'?`<section><h2>Upcoming follow-ups</h2>${tasks.length?tasks.map(item=>`<div class="list-row"><span><strong>${escapeHTML(item.title)}</strong><p>${escapeHTML(new Date(item.due_at).toLocaleString())}</p></span></div>`).join(''):'<p>No scheduled follow-ups. New website leads receive a follow-up task automatically.</p>'}</section>`:''}`;
      }
    }catch(error){if(root&&root.isConnected)root.textContent=error.message||'Could not load follow-up tasks.'}
  })();
}
function calendarLocalToUtc(value,timezone){
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if(!match)throw new Error('Choose a valid appointment time.');
  const desired=match.slice(1).map(Number),localAsUtc=Date.UTC(desired[0],desired[1]-1,desired[2],desired[3],desired[4]);
  let candidate=localAsUtc;
  for(let i=0;i<4;i++){
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(candidate));
    const get=type=>Number(parts.find(part=>part.type===type)?.value);
    const represented=Date.UTC(get('year'),get('month')-1,get('day'),get('hour'),get('minute'));
    candidate+=localAsUtc-represented;
  }
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(candidate));
  const get=type=>Number(parts.find(part=>part.type===type)?.value);
  if(get('year')!==desired[0]||get('month')!==desired[1]||get('day')!==desired[2]||get('hour')!==desired[3]||get('minute')!==desired[4])throw new Error('That local time does not exist because of a daylight-saving clock change. Choose another time.');
  return new Date(candidate).toISOString();
}
async function appointmentMutation(payload){
  const response=await fetch('/api/appointments',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Could not save the appointment.');
  return data;
}
document.addEventListener('submit',async event=>{
  const form=event.target;
  if(form.id==='appointment-availability-form'){
    event.preventDefault();const button=form.querySelector('button[type="submit"]'),message=form.querySelector('[role="status"]');button.disabled=true;message.textContent='';
    try{
      const values=new FormData(form),windows=[...form.querySelectorAll('input[name="weekday"]:checked')].map(input=>({weekday:Number(input.value),start:values.get(`start_${input.value}`),end:values.get(`end_${input.value}`)}));
      await appointmentMutation({action:'set_availability',tenant_id:values.get('tenant_id'),timezone:values.get('timezone'),duration_minutes:Number(values.get('duration_minutes')),windows});
      toast('Availability saved.');renderCalendar();
    }catch(error){message.textContent=error.message||'Could not save availability.';button.disabled=false}
  }
  if(form.id==='appointment-booking-form'||form.matches('.appointment-reschedule-form')){
    event.preventDefault();const button=form.querySelector('button[type="submit"]'),message=form.querySelector('[role="status"]');if(button)button.disabled=true;if(message)message.textContent='';
    try{
      const values=new FormData(form),tenantId=values.get('tenant_id')||crmSalesTenantId,timezone=values.get('timezone')||form.dataset.timezone;
      const startsAt=calendarLocalToUtc(values.get('starts_at'),timezone);
      if(form.id==='appointment-booking-form')await appointmentMutation({action:'book',tenant_id:tenantId,contact_id:values.get('contact_id'),starts_at:startsAt});
      else await appointmentMutation({action:'reschedule',tenant_id:tenantId,appointment_id:form.dataset.appointmentId,starts_at:startsAt});
      toast(form.id==='appointment-booking-form'?'Demo booked. Reminder jobs are dry-run only.':'Demo rescheduled. Reminder jobs are dry-run only.');renderCalendar();
    }catch(error){if(message)message.textContent=error.message||'Could not save the appointment.';else toast(error.message||'Could not save the appointment.');if(button)button.disabled=false}
  }
});
document.addEventListener('click',async event=>{
  const availability=event.target.closest('[data-open-availability]');
  if(availability){view='Availability';render();return}
  const cancel=event.target.closest('[data-cancel-appointment]');
  if(!cancel)return;
  cancel.disabled=true;
  try{await appointmentMutation({action:'cancel',tenant_id:crmSalesTenantId,appointment_id:cancel.dataset.cancelAppointment});toast('Demo cancelled. Pending reminder jobs skipped.');renderCalendar()}
  catch(error){toast(error.message||'Could not cancel the appointment.');cancel.disabled=false}
});
function renderCompliance(){ $('#main').innerHTML=header('Compliance controls','Outbound safeguards for the organization')+notice('All outbound activity is paused in this demo. Production controls need administrator authorization and an audited server-side pause.',true)+`<div class="split"><section class="surface section-card"><h2>Outbound activity</h2><p>Keep channels paused until policy, providers, identity, consent, suppression, and audit controls are live.</p><div class="field-list"><div><span>Calls</span>${status('Paused')}</div><div><span>SMS</span>${status('Paused')}</div><div><span>Bulk email</span>${status('Paused')}</div><div><span>Recordings</span>${status('Paused')}</div><div><span>Social publishing</span>${status('Paused')}</div><div><span>Ad audience sync</span>${status('Paused')}</div></div></section><section class="surface section-card"><h2>Release checklist</h2><div class="step-list">${['Legal review for target markets','Consent and suppression tests','Audit and retention schedules','Provider agreements and registrations','Administrator emergency controls'].map((x,i)=>`<div class="step"><b>${i+1}</b>${x}</div>`).join('')}</div></section></div>`}
const moduleCopy={
  'Funnels & Automation':{Funnels:['Lead capture funnel','A multi-step route from landing page to booking.'], 'Landing pages':['Landing page library','Pages, versions, and domains for your organization.'], 'Forms & assessments':['Lead intake forms','Field mapping, UTM capture, and lead routing.'],Automations:['Journey builder','Triggers, filters, delays, branches, and approvals.'],'Run history':['Automation runs','Review each action, failure, and version.']},
  'Customer service':{Reviews:['Review inbox','Respond to feedback from connected locations.'],Requests:['Review requests','Approval-based invitations with opt-out checks.'],'Response inbox':['Response inbox','Assign and review responses before posting.'],Widgets:['Review widgets','Display approved reviews on your site.']},
  'Social Media':{'Content calendar':['Content calendar','Plan posts by channel and location.'],Drafts:['Draft posts','Prepare content for review.'],Approvals:['Post approvals','Require a reviewer before publishing.'],Analytics:['Social analytics','Results from authorized accounts.']},
  Ads:{'Ad accounts':['Connected accounts','Authorized advertising accounts by tenant.'],Campaigns:['Campaign performance','Spend, leads, and conversion trends.'],Attribution:['Lead attribution','Trace lead sources to forms and deals.'],Alerts:['Performance alerts','Investigate spend or lead changes.']}
};
function renderModule(){const copy=moduleCopy[category]?.[view]||[view,'This workspace is planned for SaaS Launchup.'];$('#main').innerHTML=header(view,category+' workspace','demo-disabled','＋ Create')+notice('This view is a design preview. Accounts, publishing, automations, and delivery services are not connected.')+`<div class="split"><section class="surface section-card"><span class="eyebrow">${escapeHTML(category.toUpperCase())}</span><h2 style="margin-top:10px">${escapeHTML(copy[0])}</h2><p>${escapeHTML(copy[1])}</p>${simpleEmpty('Nothing here yet','Connect the secure SaaS Launchup services to create and manage records.')}</section><section class="surface section-card"><h2>Before this goes live</h2><div class="step-list"><div class="step"><b>1</b>Set up tenant access and roles</div><div class="step"><b>2</b>Connect approved providers</div><div class="step"><b>3</b>Test consent, audit, and review rules</div></div></section></div>`}
function renderSettings(){
  const adminLink='<a class="secondary settings-link" href="/foundation">Open Admin center</a>';
  if(view==='Domain & DNS'){
    $('#main').innerHTML=header('Domain & DNS','Company domain and email authentication')+notice('Domain changes and automatic DNS setup are not connected yet. No records will be changed from this page.')+`<section class="surface section-card"><h2>Company domain</h2><p>Save your primary domain in the company profile. DNS verification, SPF, DKIM, and DMARC setup will appear here when a domain provider is connected.</p>${adminLink}</section>`;
    return;
  }
  const content={Organization:['Company settings','Manage your company details and workspace records in Admin center.'], 'Team & roles':['Team access','Review workspace roles and permissions before inviting additional users.'], 'Compliance controls':['Outreach controls','Review consent, suppression, and calling requirements before enabling outbound channels.'],Billing:['Subscription & billing','Plans, invoices, and payment methods will appear after billing is connected.']};
  const [title,body]=content[view]||[view,'This area is being prepared.'];
  $('#main').innerHTML=header(view,'Workspace settings')+`<section class="surface section-card"><h2>${title}</h2><p>${body}</p>${view==='Organization'?adminLink:''}</section>`;
}
function renderAudit(){ $('#main').innerHTML=header('Audit history','Events for imports, outreach, roles, and compliance')+notice('These sample events are illustrative. An append-only audit store is required before production use.',true)+`<div class="surface"><div class="list-row"><span><h3>Role assigned</h3><p>Priya Shah assigned Sales manager · Sep 20, 2026</p></span></div><div class="list-row"><span><h3>Contact suppression updated</h3><p>Elliot Park marked Do not call · Sep 19, 2026</p></span></div><div class="list-row"><span><h3>Contact import reviewed</h3><p>12 rows previewed · Sep 17, 2026</p></span></div></div>`}
render=function(){renderNav();if(!accessLoaded){$('#main').innerHTML='<div class="surface dashboard-loading">Loading your workspace…</div>';$('#detail').hidden=true;return}if(!availableCategories().length){$('#main').innerHTML=notice('Your account does not have an active workspace role. Ask your administrator for access.',true);$('#detail').hidden=true;return}if(!availableCategories().includes(category))category=availableCategories()[0];if(!availableViews(category).includes(view))view=availableViews(category)[0];renderNav();const key=category+'/'+view;if(category==='Dashboard'&&currentRole==='business_owner')renderAdminDashboard();else if(category==='Marketing')renderMarketing();else if(key==='Sales/My dashboard')renderSalesProfileDashboard();else if(key==='Sales/Contacts')renderContacts();else if(key==='Sales/Pipeline')renderPipeline();else if(key==='Sales/Tasks')renderTasks();else if(key==='Sales/Sales dialer')renderDialer();else if(key==='Sales/Call queues')renderQueues();else if(key==='Sales/Import contacts')renderImport();else if(key==='Reporting/Sales dashboard'&&canViewSalesReports)renderReports();else if(key==='Communications/Unified inbox'||['SMS','Email','Calls'].includes(view)&&category==='Communications')renderInbox();else if(key==='Communications/Consent center')renderConsent();else if(['Calendars/Calendar','Calendars/Booking pages','Calendars/Availability','Calendars/Appointments'].includes(key))renderCalendar();else if(key==='Settings/Compliance controls')renderCompliance();else if(key==='Reporting/Audit history')renderAudit();else if(category==='Settings')renderSettings();else renderModule();renderDetail()};
let pendingPipelineContactId=null;
document.addEventListener('click',event=>{
  const card=event.target.closest('[data-pipeline-contact]');
  if(!card)return;
  const contact=crmDialerContacts.find(item=>item.id===card.dataset.pipelineContact)||contacts.find(item=>item.id===Number(card.dataset.pipelineContact));
  if(!contact)return;
  pendingPipelineContactId=contact.id;
  $('#pipeline-move-contact').textContent=`${contact.name} · ${contact.company}`;
  $('#pipeline-stage').innerHTML=contact.contactId?crmPipelineStages.filter(item=>item.pipeline_id===pipelineSelectedId&&item.stage_id).map(item=>`<option value="${escapeHTML(item.stage_id)}">${escapeHTML(item.stage_name)}</option>`).join(''):pipelineStages.map(stage=>`<option value="${escapeHTML(stage)}">${escapeHTML(stage)}</option>`).join('');
  $('#pipeline-stage').value=contact.contactId?contact.stageId:contact.stage;
  if(contact.contactId&&contact.pipelineId!==pipelineSelectedId)$('#pipeline-stage').value=crmPipelineStages.find(item=>item.pipeline_id===pipelineSelectedId&&item.stage_id)?.stage_id||'';
  $('#pipeline-move-error').hidden=true;
  $('#pipeline-move-dialog').showModal();
});
$('#pipeline-move-dialog').addEventListener('close',()=>{pendingPipelineContactId=null});
$('#pipeline-move-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(event.submitter?.value==='cancel'){$('#pipeline-move-dialog').close();return}
  const stage=$('#pipeline-stage').value;
  const contact=crmDialerContacts.find(item=>item.id===pendingPipelineContactId)||contacts.find(item=>item.id===pendingPipelineContactId);
  const selectedStage=crmPipelineStages.find(item=>item.stage_id===stage&&item.pipeline_id===pipelineSelectedId);
  const stageId=selectedStage?.stage_id;
  if(!contact||!(contact.contactId?stageId:pipelineStages.includes(stage)))return;
  if(contact.contactId){
    try{
      const response=await fetch(`/api/crm?resource=contacts&tenant_id=${encodeURIComponent(contact.tenantId)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({tenant_id:contact.tenantId,contact_id:contact.contactId,stage_id:stageId})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Could not move this contact.');
    }catch(error){const message=$('#pipeline-move-error');message.textContent=error instanceof Error?error.message:'Could not move this contact.';message.hidden=false;return}
  }
  contact.stage=contact.contactId?selectedStage.stage_name:stage;
  if(contact.contactId){contact.pipelineId=pipelineSelectedId;contact.stageId=stageId}
  if(!contact.contactId){
    const deal=deals.find(item=>item.contact===contact.name);
    if(deal)deal.stage=stage;
    savedPipelineStages[contact.id]=stage;
    try{localStorage.setItem(demoPipelineKey,JSON.stringify(savedPipelineStages))}catch{}
  }
  $('#pipeline-move-dialog').close();
  renderPipeline();
  toast(`${contact.name} moved to ${contact.stage}.`);
});
document.addEventListener('change',event=>{
  if(event.target.id==='dialer-contact'){
    selectedDialerContactId=event.target.value;
    if(category==='Sales'&&view==='Calls')renderSalesCalls();else renderDialer();
    if(typeof updateCallScriptCompany==='function')updateCallScriptCompany();
  }
});
let researchBusy=false;
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action="research-company"]');
  if(!button||researchBusy)return;
  const contact=currentDialerContact();
  const website=$('#company-website')?.value.trim();
  const status=$('#research-status');
  if(!contact||!website){if(status)status.textContent='Enter the official company website first.';return}
  researchBusy=true;button.disabled=true;if(status)status.textContent='Reading the public website…';
  try{
    const payload={website};
    if(contact.tenantId&&contact.companyId){payload.tenant_id=contact.tenantId;payload.company_id=contact.companyId}
    const response=await fetch('/api/company-research',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Company research was unavailable.');
    companyResearch[contact.id]={website:result.website,title:result.title,description:result.description,retrieved_at:result.retrieved_at};
    for(const item of crmDialerContacts)if(item.companyId&&item.companyId===contact.companyId){item.researchSummary=result.description;item.researchSourceUrl=result.website}
    try{localStorage.setItem(companyResearchKey,JSON.stringify(companyResearch))}catch{}
    if(category==='Sales'&&view==='Calls')renderSalesCalls();else renderDialer();
    if(typeof updateCallScriptCompany==='function')updateCallScriptCompany();
    toast(`Company information found for ${contact.company}.`);
  }catch(error){if(status)status.textContent=error instanceof Error?error.message:'Could not research that website.'}
  finally{researchBusy=false;button.disabled=false}
});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.action==='new-contact'){e.stopImmediatePropagation();$('#contact-dialog').showModal()}else if(b.dataset.action==='demo-disabled'){e.stopImmediatePropagation();toast('This action needs secure SaaS Launchup services before it can be enabled.')}},true);
$('#contact-form').addEventListener('submit',e=>{if(e.submitter?.value!=='save')return;e.preventDefault();const f=new FormData(e.target),name=String(f.get('name')).trim();if(!name)return;contacts.unshift({id:Math.max(0,...contacts.map(c=>c.id))+1,name,company:String(f.get('company')||'').trim()||'—',email:String(f.get('email')||'').trim()||'—',phone:String(f.get('phone')||'').trim()||'—',owner:String(f.get('owner')),stage:'New lead',source:String(f.get('source')),timezone:'Unknown',sms:'Unknown',emailStatus:'Unknown',call:'Review needed',activity:'Added in this session · Just now'});$('#contact-dialog').close();e.target.reset();category='Sales';view='Contacts';query='';render();toast('Contact added for this session. No outreach was started.')});
document.addEventListener('change',e=>{if(e.target.matches('[data-task]')){const t=tasks.find(x=>x.id===Number(e.target.dataset.task));if(t){t.done=e.target.checked;renderTasks();toast(t.done?'Task completed for this session.':'Task reopened.')}}if(e.target.id==='csv-file'){const file=e.target.files?.[0];if(!file)return;const result=$('#import-preview');if(file.size>2_000_000){result.textContent='Choose a CSV file smaller than 2 MB for this local preview.';return}file.text().then(text=>{const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean),headers=(lines[0]||'').split(',').map(x=>x.trim().replace(/^"|"$/g,''));result.innerHTML=`<strong>${Math.max(0,lines.length-1)} rows found</strong><br>Fields: ${headers.map(escapeHTML).join(', ')||'none'}<br><br>Preview only — no records were saved or contacted.`}).catch(()=>{result.textContent='Unable to read this file.'})}});
render();
document.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(button?.dataset.action==='toggle-dialpad'){
    dialpadCollapsed=!dialpadCollapsed;
    if(category==='Sales'&&view==='Calls')renderSalesCalls();else renderDialer();
    syncCallScriptButton();
  }
  if(button?.dataset.dialKey){
    const input=document.querySelector('#manual-number');
    if(!input)return;
    input.value=button.dataset.dialKey==='⌫'?input.value.slice(0,-1):(input.value+button.dataset.dialKey).slice(0,32);
    dialerNumber=input.value;
    input.focus();
  }
});
document.addEventListener('input',event=>{
  if(event.target.id==='manual-number')dialerNumber=event.target.value.slice(0,32);
});
void loadCrmDialerContacts();
