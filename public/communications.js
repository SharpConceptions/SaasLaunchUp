let templateTenantId=null,templateItems=[],templateSelectedId=null,templatePageSerial=0,automationTemplateCache=null,automationCampaignCache=[],automationTemplateTenant=null,automationTemplateLoading=false,automationTemplateError='';
let callWorkspaceTab='Sales dialer';
const primaryCallTabs=['Sales dialer','Inbound calls','SMS','SMS inbox'];
const callTabGroup={'Call queues':'Sales dialer','Recordings & notes':'Sales dialer','Text templates':'SMS','Consent center':'SMS'};
function callsTabActive(name){return callTabGroup[callWorkspaceTab]===name||callWorkspaceTab===name}
function callsTabBar(){return `<nav class="calls-tabs" role="tablist" aria-label="Calls and text sections">${primaryCallTabs.map(name=>`<button type="button" role="tab" class="${callsTabActive(name)?'active':''}" aria-selected="${callsTabActive(name)}" aria-controls="calls-panel" data-call-tab="${escapeHTML(name)}">${escapeHTML(name)}</button>`).join('')}</nav>`}
function mountCallsShell(){
  const content=document.createElement('div');content.innerHTML=$('#main').innerHTML;
  const heading=content.querySelector('.page-header');
  const scriptButton=heading?.querySelector('[data-action="open-call-script"]')?.outerHTML||'';
  heading?.remove();content.querySelector('.notice')?.remove();
  const back=primaryCallTabs.includes(callWorkspaceTab)?'':`<button type="button" class="secondary calls-back" data-call-tab="${escapeHTML(callTabGroup[callWorkspaceTab]||'Sales dialer')}">← Back to ${escapeHTML(callTabGroup[callWorkspaceTab]||'Sales dialer')}</button>`;
  const extras=callWorkspaceTab==='Sales dialer'?'<div class="calls-shortcuts"><button type="button" class="secondary" data-call-tab="Call queues">Call queues</button><button type="button" class="secondary" data-call-tab="Recordings & notes">Recordings & notes</button></div>':'';
  $('#main').innerHTML=header('Calls','Your calling and text workspace')+notice('Twilio calling and recording are not connected. Calls remain paused.')+callsTabBar()+`<section id="calls-panel" role="tabpanel" class="calls-panel" aria-label="${escapeHTML(callWorkspaceTab)}"><div class="calls-section-heading">${back}<h2>${escapeHTML(callWorkspaceTab)}</h2>${scriptButton}</div>${extras}${content.innerHTML}</section>`;
}
async function ensureTemplateTenant(){
  if(templateTenantId)return templateTenantId;
  const response=await fetch('/api/crm?resource=organizations',{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw new Error('Could not load your company workspace.');
  const data=await response.json(),org=(data.items||[]).find(item=>['business_owner','sales_manager','sales_representative','marketing_manager'].includes(item.role));
  if(!org)throw new Error('Create a company in Admin center before saving templates.');
  templateTenantId=org.id;return templateTenantId;
}
async function templateApi(method='GET',payload=null,channel=null,tenant=null){
  const tenantId=tenant||await ensureTemplateTenant();
  const response=await fetch(`/api/templates?tenant_id=${encodeURIComponent(tenantId)}${channel?`&channel=${encodeURIComponent(channel)}`:''}`,{method,credentials:'same-origin',cache:'no-store',headers:payload?{'Content-Type':'application/json'}:undefined,body:payload?JSON.stringify({tenant_id:tenantId,...payload}):undefined});
  const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Could not load templates.');return result;
}
const previousMarketingRender=renderMarketing;
renderMarketing=function(){if(view==='Email templates'){renderTemplatePage('email');return}if(view==='Email inbox'){renderChannelInbox('Email');return}if(view==='Email consent'){renderEmailConsent();return}previousMarketingRender()};
const previousEmailEditor=renderEmailEditor;
renderEmailEditor=function(doc){
  previousEmailEditor(doc);
  const form=$('#marketing-form[data-kind="email"]');if(!form)return;
  const selector=document.createElement('label');selector.innerHTML='Start from an email template<select data-campaign-template><option value="">Keep this draft</option></select>';
  form.querySelector('label')?.after(selector);
  form.querySelector('.marketing-actions')?.insertAdjacentHTML('beforeend','<button type="button" class="secondary" data-campaign-automation>Use in automation</button>');
  form.insertAdjacentHTML('beforeend','<p class="comm-automation-note">Campaigns are saved as drafts. Cold outreach requires verified consent or another valid basis, suppression checks, and a connected email provider before any send.</p>');
  void templateApi('GET',null,'email').then(result=>{if(!selector.isConnected)return;const select=selector.querySelector('select');select.insertAdjacentHTML('beforeend',(result.items||[]).map(item=>`<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)}</option>`).join(''));selector._templates=result.items||[]}).catch(()=>{if(selector.isConnected)selector.remove()});
};
const previousModuleRender=renderModule;
renderModule=function(){
  if(category==='Sales'){
    if(view==='Calls'){renderSalesCalls();return}
  }
  previousModuleRender();
};
function renderChannelInbox(channel){
  const rows=conversations.filter(item=>item.channel===channel);
  $('#main').innerHTML=header(`${channel} inbox`,channel==='SMS'?'Sales text conversations':'Marketing email conversations')+notice('These conversations are sample data. Reply routing and sending are not connected.')+`<div class="surface">${rows.length?rows.map(item=>`<div class="list-row"><span class="avatar">${initials(item.name)}</span><span><h3>${escapeHTML(item.name)}</h3><p>${escapeHTML(item.excerpt)}</p></span><span class="push subtle">${escapeHTML(item.time)}</span></div>`).join(''):'<div class="section-card">No conversations yet.</div>'}</div>`;
}
function renderEmailConsent(){
  $('#main').innerHTML=header('Email consent','Review permission before creating outreach')+notice('These contact permissions are sample data. Live campaigns require saved evidence, suppression checks, and an email provider.')+`<div class="surface" style="overflow:auto"><table class="contacts-table"><thead><tr><th>Contact</th><th>Email status</th></tr></thead><tbody>${contacts.map(item=>`<tr><td>${escapeHTML(item.name)}</td><td>${status(item.emailStatus)}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderSalesSms(){
  $('#main').innerHTML=header('Sales SMS','Text conversations and approved follow ups')+notice('Twilio sending is not connected. Text messages cannot be sent from this workspace yet.')+`<div class="comm-grid"><section class="surface section-card"><h2>New text</h2><label>Phone number<input type="tel" disabled placeholder="Connect Twilio to text a contact"></label><label>Message<textarea rows="5" disabled placeholder="Choose a saved text template or write a message after SMS is connected."></textarea></label><button class="secondary" type="button" data-comm-jump="Text templates">Manage text templates</button><button class="primary" disabled>Send text</button></section><section class="surface section-card"><h2>Text conversations</h2><p>Replies and message status will appear here after Twilio and consent checks are connected.</p><button class="secondary" type="button" data-comm-jump="Consent center">Review consent</button></section></div>`;
}
function renderSalesCalls(){
  if(callWorkspaceTab==='Sales dialer')renderDialer();
  else if(callWorkspaceTab==='Inbound calls')renderInboundCalls();
  else if(callWorkspaceTab==='SMS')renderSalesSms();
  else if(callWorkspaceTab==='SMS inbox')renderChannelInbox('SMS');
  else if(callWorkspaceTab==='Text templates')renderTemplatePage('sms');
  else if(callWorkspaceTab==='Consent center')renderConsent();
  else if(callWorkspaceTab==='Call queues')renderQueues();
  else if(callWorkspaceTab==='Recordings & notes')$('#main').innerHTML=header('Recordings & notes','Call records and notes')+notice('Call recording requires a connected provider and applicable consent.')+`<div class="surface section-card"><h2>No call recordings yet</h2><p>Recordings and call notes will appear after calling, recording permissions, and retention controls are connected.</p></div>`;
  else{callWorkspaceTab='Sales dialer';renderDialer()}
  mountCallsShell();
}
let inboundLoadSerial=0;
async function inboundApi(method='GET',payload=null){
  const tenantId=crmSalesTenantId||await ensureTemplateTenant();
  const response=await fetch(`/api/inbound-calls?tenant_id=${encodeURIComponent(tenantId)}`,{method,credentials:'same-origin',cache:'no-store',headers:payload?{'Content-Type':'application/json'}:undefined,body:payload?JSON.stringify({tenant_id:tenantId,...payload}):undefined});
  const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Could not load inbound call settings.');return result;
}
function renderInboundCalls(){
  const stamp=++inboundLoadSerial;$('#detail').hidden=true;
  $('#main').innerHTML=header('Inbound calls','Decide how incoming Sales calls should be handled')+`<div id="inbound-content" class="surface section-card">Loading inbound call setup…</div>`;
  void(async()=>{try{const result=await inboundApi();if(stamp!==inboundLoadSerial||category!=='Sales'||view!=='Calls'||callWorkspaceTab!=='Inbound calls')return;drawInboundCalls(result)}catch(error){if(stamp===inboundLoadSerial&&view==='Calls'&&callWorkspaceTab==='Inbound calls'){const target=$('#inbound-content');if(target)target.innerHTML=`<h2>Inbound calls unavailable</h2><p>${escapeHTML(error.message)}</p>`}}})();
}
function drawInboundCalls(data){
  const target=$('#inbound-content');if(!target)return;
  const settings=data.settings||{},editable=['business_owner','sales_manager'].includes(currentRole);
  const choices=[['sales_queue','Sales queue'],['voicemail','Voicemail']];
  const select=(name,value)=>`<select name="${name}">${choices.map(([id,label])=>`<option value="${id}" ${value===id?'selected':''}>${label}</option>`).join('')}</select>`;
  target.className='inbound-layout';
  target.innerHTML=`<section class="surface section-card"><span class="eyebrow">NUMBER & PROVIDER</span><h2>Inbound line</h2><p class="inbound-status">No Twilio number connected</p><p>Connect a company phone number and configure Twilio voice webhooks before calls can reach this workspace. This page saves routing preferences only.</p><div class="inbound-cards"><div><strong>Incoming calls</strong><span>Unavailable until connected</span></div><div><strong>Voicemail</strong><span>Unavailable until connected</span></div></div></section><section class="surface section-card"><span class="eyebrow">CALL HANDLING</span><h2>Routing preferences</h2><p>Hours use ${escapeHTML(data.timezone||'the company timezone')}.</p>${editable?`<form id="inbound-form"><div class="form-grid"><label>Business day starts<input name="business_hours_start" type="time" required value="${escapeHTML(settings.business_hours_start||'09:00')}"></label><label>Business day ends<input name="business_hours_end" type="time" required value="${escapeHTML(settings.business_hours_end||'17:00')}"></label><label>During business hours${select('during_hours',settings.during_hours)}</label><label>After hours${select('after_hours',settings.after_hours)}</label></div><label>Greeting<textarea name="greeting" required minlength="5" maxlength="500" rows="3">${escapeHTML(settings.greeting||'')}</textarea></label><label>Voicemail message<textarea name="voicemail_message" required minlength="5" maxlength="500" rows="3">${escapeHTML(settings.voicemail_message||'')}</textarea></label><p class="form-note">Saving these preferences will not activate routing, receive calls, or record voicemail.</p><button class="primary" type="submit">Save routing draft</button><p id="inbound-status-message" role="status" aria-live="polite"></p></form>`:`<div class="inbound-cards"><div><strong>Business hours</strong><span>${escapeHTML(settings.business_hours_start||'09:00')}–${escapeHTML(settings.business_hours_end||'17:00')}</span></div><div><strong>During hours</strong><span>${escapeHTML(settings.during_hours==='voicemail'?'Voicemail':'Sales queue')}</span></div><div><strong>After hours</strong><span>${escapeHTML(settings.after_hours==='sales_queue'?'Sales queue':'Voicemail')}</span></div></div><p>Managers can edit these routing preferences.</p>`}</section><section class="surface section-card inbound-wide"><h2>Incoming call activity</h2><p>No live inbound calls are available yet. Once Twilio is connected, unanswered calls, voicemails, and assigned follow ups can appear here.</p></section>`;
}
function renderTemplatePage(channel){
  const stamp=++templatePageSerial;
  $('#detail').hidden=true;
  $('#main').innerHTML=header(channel==='sms'?'Text templates':'Email templates',channel==='sms'?'Reusable Sales messages':'Reusable Marketing email content')+`<div id="template-workspace" class="surface section-card">Loading templates…</div>`;
  void(async()=>{try{const result=await templateApi('GET',null,channel);if(stamp!==templatePageSerial||(channel==='sms'?!isCallsTab('Text templates'):view!=='Email templates'))return;templateItems=result.items||[];if(!templateItems.some(item=>item.id===templateSelectedId))templateSelectedId=null;drawTemplatePage(channel)}catch(error){if(stamp===templatePageSerial){const target=$('#template-workspace');if(target)target.innerHTML=`<h2>Templates unavailable</h2><p>${escapeHTML(error.message)}</p>`}}})();
}
function isCallsTab(name){return category==='Sales'&&view==='Calls'&&callWorkspaceTab===name}
function drawTemplatePage(channel){
  const item=templateItems.find(row=>row.id===templateSelectedId),target=$('#template-workspace');if(!target)return;
  target.className='comm-template-workspace';
  target.innerHTML=`<aside class="surface comm-template-list"><div class="comm-template-head"><h2>Saved ${channel==='sms'?'texts':'emails'}</h2><button type="button" class="secondary" data-template-new>＋ New</button></div>${templateItems.length?templateItems.map(row=>`<button type="button" class="comm-template-choice ${row.id===templateSelectedId?'active':''}" data-template-open="${escapeHTML(row.id)}"><strong>${escapeHTML(row.name)}</strong><small>${escapeHTML(row.updated_at||row.created_at)}</small></button>`).join(''):'<p>No templates saved yet.</p>'}</aside><section class="surface section-card"><span class="eyebrow">${channel==='sms'?'SALES TEXT':'MARKETING EMAIL'} TEMPLATE</span><h2>${item?'Edit template':'New template'}</h2><form id="template-form" data-channel="${channel}"><label>Template name<input name="name" required maxlength="160" value="${escapeHTML(item?.name||'')}" placeholder="${channel==='sms'?'New lead follow up':'Welcome to our service'}"></label>${channel==='email'?`<label>Email subject<input name="subject" required maxlength="180" value="${escapeHTML(item?.subject||'')}" placeholder="A quick introduction"></label>`:''}<label>${channel==='sms'?'Text message':'Email body'}<textarea name="body" required maxlength="5000" rows="9" placeholder="Write the reusable message…">${escapeHTML(item?.body||'')}</textarea></label><p class="form-note">Use {{contact.name}} as a placeholder. Saving a template does not send a message.</p><div class="comm-actions"><button class="primary" type="submit">Save template</button>${item?'<button class="secondary" type="button" data-template-delete>Delete</button>':''}${currentRole==='sales_representative'?'':'<button class="secondary" type="button" data-template-automation>Use in automation</button>'}</div><p class="comm-form-status" role="status" aria-live="polite"></p></form></section>`;
}
const previousDrawAutomation=drawPipelineAutomations;
drawPipelineAutomations=function(){
  previousDrawAutomation();const form=$('#automation-rule-form');if(!form)return;
  const trigger=form.elements.trigger_kind,rule=automationRules.find(item=>item.id===automationSelectedId);
  for(const [value,label] of [['form_submitted','New signup from a form'],['ad_lead_captured','Lead captured from an ad'],['awareness_engaged','Awareness engagement recorded']])trigger.add(new Option(label,value));
  trigger.value=rule?.trigger_kind||'contact_entered_stage';
  form.elements.action_kind.add(new Option('Create a Sales call task','call_task'));
  form.elements.action_kind.value=rule?.action_kind||'email';
  for(const [channel,sectionName] of [['email','Email'],['sms','Text']]){
    const section=form.querySelector(`[data-automation-action="${channel}"]`);
    if(!section)continue;
    const options=automationTemplateCache&&automationTemplateTenant===crmSalesTenantId?automationTemplateCache.filter(item=>item.channel===channel):[];
    section.insertAdjacentHTML('afterbegin',`<label>Use a saved ${sectionName.toLowerCase()} template<select name="${channel}_template_id"><option value="">Write a one-off draft</option>${options.map(item=>`<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)}</option>`).join('')}</select></label>`);
    const select=form.elements[`${channel}_template_id`];if(rule?.action_kind===channel&&rule.config?.template_id&&options.some(item=>item.id===rule.config.template_id))select.value=rule.config.template_id;
  }
  const emailSection=form.querySelector('[data-automation-action="email"]');
  emailSection?.querySelector('label')?.insertAdjacentHTML('afterend',`<label>Use a saved email campaign draft<select name="email_campaign_id"><option value="">Choose a template or write a draft</option>${automationCampaignCache.map(item=>`<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)}</option>`).join('')}</select></label>`);
  if(rule?.action_kind==='email'&&rule.config?.campaign_id&&automationCampaignCache.some(item=>item.id===rule.config.campaign_id))form.elements.email_campaign_id.value=rule.config.campaign_id;
  form.querySelector('.automation-warning')?.insertAdjacentHTML('beforebegin',`<div class="automation-action" data-automation-action="call_task" hidden><label>Call task instructions<textarea name="call_task_body" rows="4" maxlength="5000" placeholder="What should the sales rep discuss?">${escapeHTML(rule?.action_kind==='call_task'?rule.config?.body||'':'')}</textarea></label></div>`);
  const marker=form.querySelector('.automation-warning');if(marker)marker.insertAdjacentHTML('beforebegin',`<p class="comm-automation-note">Form signups, ad leads, and awareness engagement need connected capture or analytics sources. Saved rules are drafts and do not react to events yet. ${escapeHTML(automationTemplateError)}</p>`);
  updateAutomationFields();
  if((automationTemplateCache===null||automationTemplateTenant!==crmSalesTenantId)&&!automationTemplateLoading){
    automationTemplateLoading=true;const tenant=crmSalesTenantId;
    void templateApi('GET',null,null,tenant).then(result=>{automationTemplateCache=result.items||[];automationCampaignCache=result.campaigns||[];automationTemplateTenant=tenant;automationTemplateError='';if(category==='Funnels & Automation'&&view==='Automations'&&crmSalesTenantId===tenant)drawPipelineAutomations()}).catch(error=>{automationTemplateCache=[];automationCampaignCache=[];automationTemplateTenant=tenant;automationTemplateError=error.message;if(category==='Funnels & Automation'&&view==='Automations')drawPipelineAutomations()}).finally(()=>{automationTemplateLoading=false});
  }
};
const previousAutomationRender=renderPipelineAutomations;
renderPipelineAutomations=function(){automationTemplateCache=null;automationCampaignCache=[];previousAutomationRender()};
const previousAutomationFields=updateAutomationFields;
updateAutomationFields=function(){
  previousAutomationFields();const form=$('#automation-rule-form');if(!form)return;
  for(const channel of ['email','sms']){
    const selected=form.elements[`${channel}_template_id`]?.value||'',campaign=channel==='email'?form.elements.email_campaign_id?.value||'':'';
    const fields=channel==='email'?[form.elements.subject,form.elements.email_body]:[form.elements.sms_body];
    for(const field of fields)if(field)field.readOnly=Boolean(selected||campaign);
  }
};
const previousTriggerLabel=ruleTriggerLabel;
ruleTriggerLabel=function(value){return ({form_submitted:'New signup from a form',ad_lead_captured:'Lead captured from an ad',awareness_engaged:'Awareness engagement recorded'})[value]||previousTriggerLabel(value)};
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.callTab){callWorkspaceTab=button.dataset.callTab;category='Sales';view='Calls';selected=null;render();return}
  if(button.dataset.commJump){callWorkspaceTab=button.dataset.commJump;category='Sales';view='Calls';render();return}
  if(button.hasAttribute('data-comm-open-automation')){category='Funnels & Automation';view='Automations';render();return}
  if(button.hasAttribute('data-campaign-automation')){category='Funnels & Automation';view='Automations';render();return}
  if(button.hasAttribute('data-template-new')){templateSelectedId=null;drawTemplatePage(isCallsTab('Text templates')?'sms':'email');return}
  if(button.dataset.templateOpen){templateSelectedId=button.dataset.templateOpen;drawTemplatePage(isCallsTab('Text templates')?'sms':'email');return}
  if(button.hasAttribute('data-template-automation')){category='Funnels & Automation';view='Automations';selected=null;render();return}
  if(button.hasAttribute('data-template-delete')){const item=templateItems.find(row=>row.id===templateSelectedId);if(!item||!confirm(`Delete template “${item.name}”? Existing automation drafts retain their saved message snapshot.`))return;button.disabled=true;try{await templateApi('DELETE',{id:item.id,confirmation:'delete'});templateSelectedId=null;automationTemplateCache=null;if(isCallsTab('Text templates'))renderSalesCalls();else renderTemplatePage(item.channel);toast('Template deleted.')}catch(error){toast(error.message);button.disabled=false}}
});
document.addEventListener('change',event=>{
  const campaign=event.target.closest('[data-campaign-template]');if(campaign){const item=campaign.closest('label')._templates?.find(row=>row.id===campaign.value),form=$('#marketing-form[data-kind="email"]');if(item&&form){form.elements.subject.value=item.subject||'';form.elements.body.value=item.body;campaign.value=''}return}
  const select=event.target.closest('[name="email_template_id"],[name="sms_template_id"]');if(!select)return;
  if(select.name==='email_template_id'&&select.value){const campaign=$('#automation-rule-form')?.elements.email_campaign_id;if(campaign)campaign.value=''}
  const item=automationTemplateCache?.find(row=>row.id===select.value),form=$('#automation-rule-form');
  if(!form)return;
  if(item?.channel==='email'){form.elements.subject.value=item.subject||'';form.elements.email_body.value=item.body}
  if(item?.channel==='sms')form.elements.sms_body.value=item.body;
  updateAutomationFields();
});
document.addEventListener('change',event=>{
  const select=event.target.closest('[name="email_campaign_id"]');if(!select)return;
  const form=$('#automation-rule-form'),item=automationCampaignCache.find(row=>row.id===select.value);if(!form)return;
  if(item){form.elements.email_template_id.value='';form.elements.subject.value=item.subject||'';form.elements.email_body.value=item.body||''}
  updateAutomationFields();
});
document.addEventListener('submit',async event=>{
  const inboundForm=event.target.closest('#inbound-form');if(inboundForm){event.preventDefault();const button=inboundForm.querySelector('button[type="submit"]'),message=$('#inbound-status-message');button.disabled=true;message.textContent='Saving…';const data=Object.fromEntries(new FormData(inboundForm));try{await inboundApi('POST',data);toast('Inbound routing draft saved.');renderSalesCalls()}catch(error){message.textContent=error.message||'Could not save routing.';button.disabled=false}return}
  const form=event.target.closest('#template-form');if(!form)return;event.preventDefault();
  const channel=form.dataset.channel,item=templateItems.find(row=>row.id===templateSelectedId),button=form.querySelector('[type="submit"]');button.disabled=true;
  try{const result=await templateApi('POST',{...(item?{id:item.id}:{}),channel,name:form.elements.name.value.trim(),...(channel==='email'?{subject:form.elements.subject.value.trim()}:{}),body:form.elements.body.value.trim()});templateSelectedId=result.id;automationTemplateCache=null;if(isCallsTab('Text templates'))renderSalesCalls();else renderTemplatePage(channel);toast('Template saved.')}catch(error){form.querySelector('.comm-form-status').textContent=error.message;button.disabled=false}
});
