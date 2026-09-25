const nav = {
  Dashboard: ['Overview','Pipeline','Awareness','Consideration','Purchase','Experience','Loyalty'],
  Sales: ['My dashboard','Contacts','Pipeline','Tasks','Calls','Import contacts'],
  Marketing: ['Email marketing','Email templates','Email inbox','Email consent','Idea board','Media studio','SEO · GEO · AEO scan','Blog studio','Social Media'],
  'Funnels & Automation': ['Funnels','Landing pages','Forms & assessments','Automations','Run history'],
  Calendars: ['Calendar','Booking pages','Availability','Appointments'],
  'Customer service': ['Tickets','Cancellation requests','Billing overview','Billing issues','Bug reports','Reviews','Requests','Response inbox','Widgets'],
  Ads: ['Ad accounts','Campaigns','Attribution','Alerts'],
  Settings: ['Profile','Organization','Team & roles','Custom Integrations','API connections','Domain & DNS','Compliance controls','Billing','Reporting']
};
const contacts = [
  {id:1,name:'Maya Chen',company:'Luma Partners',email:'maya@lumapartners.example',phone:'(312) 555-0148',owner:'Jordan Lee',stage:'Qualified',source:'Website form',timezone:'Central',sms:'Consented',emailStatus:'Consented',call:'Review needed',activity:'Replied to email · Today, 9:42 AM'},
  {id:2,name:'Marcus Rivera',company:'Atlas & Co.',email:'marcus@atlasco.example',phone:'(415) 555-0191',owner:'Jordan Lee',stage:'New lead',source:'Referral',timezone:'Pacific',sms:'Unknown',emailStatus:'Consented',call:'Review needed',activity:'Contact created · Yesterday'},
  {id:3,name:'Amara Okafor',company:'Northline Health',email:'amara@northline.example',phone:'(646) 555-0127',owner:'Priya Shah',stage:'Proposal',source:'Booking page',timezone:'Eastern',sms:'Consented',emailStatus:'Consented',call:'Review needed',activity:'Meeting booked · Sep 20'},
  {id:4,name:'Elliot Park',company:'Common Ground',email:'elliot@commonground.example',phone:'(206) 555-0184',owner:'Priya Shah',stage:'Contacted',source:'Import',timezone:'Pacific',sms:'Opted out',emailStatus:'Unknown',call:'Do not call',activity:'SMS opt-out · Sep 19'},
  {id:5,name:'Sofia Martinez',company:'Bright Ledger',email:'sofia@brightledger.example',phone:'(512) 555-0163',owner:'Jordan Lee',stage:'Qualified',source:'Assessment',timezone:'Central',sms:'Consented',emailStatus:'Consented',call:'Review needed',activity:'Assessment completed · Sep 18'}
];
const sampleLeadUpdates={
  1:{sales:'Replied to sales email',salesWhen:'Today, 9:42 AM',marketing:'Lead captured through website form',marketingWhen:'Date not recorded'},
  2:{sales:null,salesWhen:null,marketing:'Referral lead recorded',marketingWhen:'Date not recorded'},
  3:{sales:'Meeting booked',salesWhen:'Sep 20',marketing:'Lead captured through booking page',marketingWhen:'Date not recorded'},
  4:{sales:null,salesWhen:null,marketing:'Contact imported',marketingWhen:'Date not recorded'},
  5:{sales:null,salesWhen:null,marketing:'Assessment completed',marketingWhen:'Sep 18'},
};
const deletedContactKey='nectcon-demo-deleted-contacts-v1';
let deletedSampleIds=[];
try { const stored=JSON.parse(localStorage.getItem(deletedContactKey)||'[]'); if(Array.isArray(stored)) deletedSampleIds=stored.filter(Number.isInteger); } catch {}
for(let i=contacts.length-1;i>=0;i--) if(deletedSampleIds.includes(contacts[i].id)) contacts.splice(i,1);
let category='Dashboard', view='Overview', selected=null, query='';
let accessLoaded=false, currentRole=null, canViewSalesReports=false;
const reportRoles=new Set(['business_owner','sales_manager']);
function availableCategories(){
  if(!accessLoaded)return [];
  if(currentRole==='business_owner')return Object.keys(nav);
  if(currentRole==='sales_manager')return ['Sales','Funnels & Automation','Customer service','Settings'];
  if(currentRole==='sales_representative')return ['Sales','Settings'];
  if(currentRole==='marketing_manager')return ['Marketing','Funnels & Automation','Ads','Settings'];
  if(currentRole==='support_readonly')return ['Customer service','Settings'];
  return [];
}
function availableViews(section){return (nav[section]||[]).filter(item=>section!=='Settings'||currentRole==='business_owner'||item==='Profile'||item==='Reporting'&&currentRole==='sales_manager').filter(item=>section!=='Funnels & Automation'||currentRole!=='sales_manager'||item==='Automations')}
async function loadReportAccess(){
  try{
    const response=await fetch('/api/crm?resource=organizations',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new Error('Could not load access.');
    const data=await response.json();
    const roles=(Array.isArray(data.items)?data.items:[]).map(item=>item.role);
    currentRole=['business_owner','sales_manager','sales_representative','marketing_manager','support_readonly'].find(role=>roles.includes(role))||null;
    canViewSalesReports=reportRoles.has(currentRole);
    accessLoaded=true;
    if(currentRole!=='business_owner'){
      category=availableCategories()[0]||'Sales';
      view=availableViews(category)[0]||'Contacts';
    }
    render();
  }catch{accessLoaded=true;currentRole=null;render()}
}
const $=s=>document.querySelector(s);
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials=s=>s.split(' ').map(x=>x[0]).slice(0,2).join('');
const contactMark='<span class="contact-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.1"/><path d="M5.5 19c.4-3.5 2.8-5.2 6.5-5.2s6.1 1.7 6.5 5.2"/></svg></span>';
function toast(message){const t=$('#toast');t.textContent=message;t.classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>t.classList.remove('show'),3400)}
function renderNav(){document.querySelectorAll('.category').forEach(b=>{b.hidden=!availableCategories().includes(b.dataset.category);b.classList.toggle('active',b.dataset.category===category)});$('#workspace-nav').setAttribute('aria-label',category+' views');$('#workspace-nav').innerHTML=accessLoaded&&availableCategories().includes(category)?availableViews(category).map(n=>`<button class="nav-btn ${n===view?'active':''}" data-view="${escapeHTML(n)}" ${n===view?'aria-current="page"':''}><span class="nav-text">${escapeHTML(n)}</span></button>`).join(''):''}
function status(s){const kind=s==='Opted out'||s==='Do not call'?'muted':s==='Unknown'||s==='Review needed'?'warn':'';return `<span class="status-pill ${kind}">${escapeHTML(s)}</span>`}
function renderContacts(){const filtered=contacts.filter(c=>[c.name,c.company,c.email,c.owner,c.stage].join(' ').toLowerCase().includes(query.toLowerCase()));$('#main').innerHTML=`<div class="page-header"><div><h1>Contacts</h1><p>People and conversations across your sales workspace</p></div><button class="primary" data-action="new-contact">＋ New contact</button></div><div class="summary-grid"><div class="metric surface"><span>TOTAL CONTACTS</span><strong>${contacts.length}</strong><small>In this demo workspace</small></div><div class="metric surface"><span>OPEN OPPORTUNITIES</span><strong>5</strong><small>Across active stages</small></div><div class="metric surface"><span>FOLLOW-UPS DUE</span><strong>4</strong><small>Assigned to your team</small></div></div><div class="toolbar"><label class="search"><span aria-hidden="true">⌕</span><input id="search" type="search" value="${escapeHTML(query)}" placeholder="Search contacts" aria-label="Search contacts"></label><div class="toolbar-actions"><button class="secondary" data-view-jump="Import contacts">Import</button><button class="secondary" data-view-jump="Pipeline">View pipeline</button></div></div><div class="surface" style="overflow:auto"><table class="contacts-table"><thead><tr><th>Contact</th><th>Stage</th><th>Owner</th><th>SMS status</th><th>Recent activity</th></tr></thead><tbody>${filtered.map(c=>`<tr data-contact="${c.id}" tabindex="0"><td><div class="name-cell">${contactMark}<span>${escapeHTML(c.name)}<span class="company-sub" style="display:block">${escapeHTML(c.company)}</span></span></div></td><td>${status(c.stage)}</td><td>${escapeHTML(c.owner)}</td><td>${status(c.sms)}</td><td class="muted">${escapeHTML(c.activity)}</td></tr>`).join('')}</tbody></table>${filtered.length?'':'<div class="empty">No contacts match your search.</div>'}</div>`}
function renderDetail(){const el=$('#detail');if(!selected){el.hidden=true;return}const c=contacts.find(x=>x.id===selected);if(!c){selected=null;el.hidden=true;return}const update=sampleLeadUpdates[c.id]||{};el.hidden=false;el.innerHTML=`<div class="detail-inner"><div class="detail-top"><button class="close" data-action="close-detail" aria-label="Close details">×</button></div><h2>${escapeHTML(c.name)}</h2><p>${escapeHTML(c.company)}</p><div class="detail-actions"><button class="secondary" data-action="call">Call</button><button class="secondary" data-action="message">Message</button></div><div class="detail-section"><h3>Contact details</h3><div class="field-row"><span>Email</span><strong>${escapeHTML(c.email)}</strong></div><div class="field-row"><span>Phone</span><strong>${escapeHTML(c.phone)}</strong></div><div class="field-row"><span>Owner</span><strong>${escapeHTML(c.owner)}</strong></div><div class="field-row"><span>Timezone</span><strong>${escapeHTML(c.timezone)}</strong></div></div><div class="detail-section"><h3>Outreach status</h3><div class="field-row"><span>Calls</span>${status(c.call)}</div><div class="field-row"><span>Text</span>${status(c.sms)}</div><div class="field-row"><span>Email</span>${status(c.emailStatus)}</div><p>Consent and suppression must be verified before outbound activity.</p></div><div class="detail-section lead-updates"><h3>Latest sales & marketing</h3><p class="lead-updates-note">Sample workspace activity</p><div class="lead-update"><span class="lead-update-kind">Sales</span><strong>${escapeHTML(update.sales||'No sales activity recorded')}</strong><small>${escapeHTML(update.salesWhen||'No completed sales action logged')}</small></div><div class="lead-update"><span class="lead-update-kind">Marketing</span><strong>${escapeHTML(update.marketing||'No marketing activity recorded')}</strong><small>${escapeHTML(update.marketingWhen||'No date recorded')}</small></div><div class="lead-update-stage"><span>Current stage</span>${status(c.stage)}</div></div><div class="detail-section"><h3>Timeline</h3><div class="activity"><span class="activity-dot"></span><span>${escapeHTML(c.activity)}</span></div><div class="activity"><span class="activity-dot"></span><span>Source: ${escapeHTML(c.source)}</span></div></div><div class="detail-section"><button class="delete-contact-button" type="button" data-action="delete-contact">Delete contact</button></div></div>`}
function render(){renderNav();if(category==='Sales'&&view==='Contacts')renderContacts();else $('#main').innerHTML=`<div class="page-header"><div><h1>${escapeHTML(view)}</h1><p>${escapeHTML(category)} workspace</p></div></div><div class="surface placeholder"><h2>Coming next</h2><p>This area is planned in the SaaS Launchup product brief. Live services are not connected in this demo.</p></div>`;renderDetail()}
let pendingDeleteId=null;
document.addEventListener('click',e=>{
  if(e.target.closest('[data-action="delete-contact"]')){
    const contact=contacts.find(c=>c.id===selected)||(typeof crmDialerContacts!=='undefined'?crmDialerContacts.find(c=>c.id===selected):null);
    if(!contact)return;
    pendingDeleteId=contact.id;
    $('#delete-contact-name').textContent=contact.name;
    $('#delete-confirmation').value='';
    $('#confirm-delete-contact').disabled=true;
    $('#delete-contact-dialog').showModal();
    $('#delete-confirmation').focus();
  }
},true);
$('#delete-confirmation').addEventListener('input',e=>{$('#confirm-delete-contact').disabled=e.target.value!=='delete'});
$('#delete-contact-dialog').addEventListener('close',()=>{pendingDeleteId=null;$('#delete-confirmation').value='';$('#confirm-delete-contact').disabled=true});
$('#delete-contact-form').addEventListener('submit',async e=>{
  e.preventDefault();
  if(e.submitter?.value==='cancel'){$('#delete-contact-dialog').close();return}
  if(e.submitter?.value!=='delete'||$('#delete-confirmation').value!=='delete')return;
  if(String(pendingDeleteId).startsWith('crm:')){
    const contact=crmDialerContacts.find(c=>c.id===pendingDeleteId);
    if(!contact)return;
    const button=$('#confirm-delete-contact');button.disabled=true;
    try{
      const response=await fetch(`/api/crm?resource=contacts&tenant_id=${encodeURIComponent(contact.tenantId)}`,{method:'DELETE',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({tenant_id:contact.tenantId,contact_id:contact.contactId,confirmation:'delete'})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not delete contact.');
      crmDialerContacts=crmDialerContacts.filter(item=>item.id!==contact.id);
      $('#delete-contact-dialog').close();selected=null;render();toast(`${contact.name} was deleted.`);
    }catch(error){button.disabled=false;toast(error.message||'Could not delete contact.')}
    return;
  }
  const index=contacts.findIndex(c=>c.id===pendingDeleteId);
  if(index<0){$('#delete-contact-dialog').close();return}
  const removed=contacts.splice(index,1)[0];
  if(removed.id<=5){deletedSampleIds.push(removed.id);try{localStorage.setItem(deletedContactKey,JSON.stringify(deletedSampleIds))}catch{}}
  $('#delete-contact-dialog').close();
  selected=null;
  render();
  toast(`${removed.name} was deleted.`);
});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(b?.dataset.category){if(!availableCategories().includes(b.dataset.category))return;category=b.dataset.category;view=availableViews(category)[0];selected=null;query='';render();return}if(b?.dataset.view){if(!availableViews(category).includes(b.dataset.view))return;view=b.dataset.view;selected=null;render();return}if(b?.dataset.viewJump){if(!availableViews(category).includes(b.dataset.viewJump))return;view=b.dataset.viewJump;selected=null;render();return}const row=e.target.closest('[data-contact]');if(row){selected=row.dataset.contact.startsWith('crm:')?row.dataset.contact:Number(row.dataset.contact);renderDetail();return}if(b?.dataset.action==='close-detail'){selected=null;renderDetail();return}if(b?.dataset.action==='new-contact')toast('Contact creation will be available when secure data storage is connected.');if(b?.dataset.action==='call'||b?.dataset.action==='message')toast('Outbound communications are disabled in this demo.');});
document.addEventListener('input',e=>{if(e.target.id==='search'){query=e.target.value;const pos=e.target.selectionStart;renderContacts();$('#search').focus();$('#search').setSelectionRange(pos,pos)}});
document.addEventListener('keydown',e=>{const row=e.target.closest('[data-contact]');if(row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selected=row.dataset.contact.startsWith('crm:')?row.dataset.contact:Number(row.dataset.contact);renderDetail()}if(e.key==='Escape'&&selected){selected=null;renderDetail()}});
render();
void loadReportAccess();

