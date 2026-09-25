let websiteTenantId=null, websiteConnections=[], websiteStages=[], websiteOwners=[], websiteSecret=null, websiteEditing=null, websiteLoading=0, websiteError='';
let websitePageLoad=0,websitePageTenants=[];
function renderWebsiteFormsPage(){
  const stamp=++websitePageLoad;
  $('#main').innerHTML=header('Forms & assessments','Connect website forms to contacts and the sales pipeline')+'<section class="surface section-card">Loading your websites…</section>';
  void (async()=>{
    try{
      const response=await fetch('/api/crm?resource=organizations',{credentials:'same-origin',cache:'no-store'});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load companies.');
      if(stamp!==websitePageLoad||category!=='Funnels & Automation'||view!=='Forms & assessments')return;
      websitePageTenants=(data.items||[]).filter(item=>item.role==='business_owner');
      if(!websitePageTenants.length){$('#main').innerHTML=header('Forms & assessments','Company owner access is required')+notice('Ask the company owner to set up website forms.',true);return}
      if(!websitePageTenants.some(item=>item.id===integrationTenantId))integrationTenantId=websitePageTenants[0].id;
      $('#main').innerHTML=header('Forms & assessments','Connect website forms to contacts and the sales pipeline')+`<div class="integration-tenant-row"><label for="website-page-tenant">Company</label><select id="website-page-tenant">${websitePageTenants.map(item=>`<option value="${escapeHTML(item.id)}" ${item.id===integrationTenantId?'selected':''}>${escapeHTML(item.name)}</option>`).join('')}</select></div><div id="website-forms-root"></div>`;
      renderWebsiteFormsSection();
    }catch(error){if(stamp===websitePageLoad&&category==='Funnels & Automation'&&view==='Forms & assessments')$('#main').innerHTML=header('Forms & assessments','Website setup')+notice(error.message||'Could not load websites.',true)}
  })();
}
const renderModuleBeforeWebsiteForms=renderModule;
renderModule=function(){if(category==='Funnels & Automation'&&view==='Forms & assessments')renderWebsiteFormsPage();else renderModuleBeforeWebsiteForms()};
document.addEventListener('change',event=>{if(event.target.id==='website-page-tenant'){integrationTenantId=event.target.value;renderWebsiteFormsPage()}});
const websiteMapFields=[['name','Contact name'],['email','Email'],['phone','Phone'],['company','Company name'],['domain','Company website or domain'],['source','Lead source'],['message','Message'],['submission_id','Submission ID']];
function websiteEndpoint(id){return `https://api.saaslaunchup.com/api/v1/forms/${encodeURIComponent(id)}`}
function websiteWebhookUrl(id,key){return `${websiteEndpoint(id)}?key=${encodeURIComponent(key)}`}
function websiteStageName(id){const stage=websiteStages.find(item=>item.stage_id===id);return stage?`${stage.pipeline_name} · ${stage.stage_name}`:'Stage unavailable'}
function websiteOwnerName(id){const member=websiteOwners.find(item=>item.user_id===id);return member?.display_name||member?.email||'Team member'}
async function websiteApi(method='GET',payload=null){
  const url='/api/website-connections'+(method==='GET'?`?tenant_id=${encodeURIComponent(integrationTenantId)}`:'');
  const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:payload?{'Content-Type':'application/json'}:undefined,body:payload?JSON.stringify({tenant_id:integrationTenantId,...payload}):undefined});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Could not update website connections.');
  return data;
}
async function renderWebsiteFormsSection(){
  const root=$('#website-forms-root');if(!root||!integrationTenantId)return;
  const selectedTenant=integrationTenantId,stamp=++websiteLoading;
  if(websiteTenantId!==selectedTenant){websiteTenantId=selectedTenant;websiteSecret=null;websiteEditing=null}
  root.innerHTML='<section class="surface section-card website-card"><h2>Website forms</h2><p>Loading website connections…</p></section>';
  try{
    const [connections,pipelines,memberships]=await Promise.all([
      websiteApi(),
      fetch(`/api/crm?resource=pipelines&tenant_id=${encodeURIComponent(selectedTenant)}`,{credentials:'same-origin',cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Could not load pipelines.');return r.json()}),
      fetch(`/api/crm?resource=memberships&tenant_id=${encodeURIComponent(selectedTenant)}`,{credentials:'same-origin',cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Could not load team members.');return r.json()}),
    ]);
    if(stamp!==websiteLoading||integrationTenantId!==selectedTenant||category!=='Funnels & Automation'||view!=='Forms & assessments')return;
    websiteConnections=connections.items||[];
    websiteStages=(pipelines.items||[]).filter(item=>item.stage_id);
    websiteOwners=(memberships.items||[]).filter(item=>item.status==='active'&&['business_owner','sales_manager','sales_representative'].includes(item.role));
    websiteError='';paintWebsiteForms();
  }catch(error){if(stamp===websiteLoading){websiteError=error.message||'Could not load website forms.';paintWebsiteForms()}}
}
function websiteForm(){
  const current=websiteEditing&&websiteConnections.find(item=>item.id===websiteEditing);
  const mapping=current?.mapping||{};
  return `<form id="website-connection-form" class="website-form" autocomplete="off">
    <div class="website-form-head"><h3>${current?'Edit website':'Connect a website'}</h3><button type="button" class="secondary" data-website-action="cancel">Cancel</button></div>
    <div class="website-fields"><label>Website name<input name="name" required maxlength="120" value="${escapeHTML(current?.name||'')}" placeholder="Your website"></label>
    <label>Send new leads to<select name="stage_id" required>${websiteStages.map(item=>`<option value="${escapeHTML(item.stage_id)}" ${item.stage_id===(current?.stage_id||websiteStages[0]?.stage_id)?'selected':''}>${escapeHTML(websiteStageName(item.stage_id))}</option>`).join('')}</select></label>
    <label>Assign leads to<select name="owner_user_id" required>${websiteOwners.map(item=>`<option value="${escapeHTML(item.user_id)}" ${item.user_id===(current?.owner_user_id||websiteOwners[0]?.user_id)?'selected':''}>${escapeHTML(websiteOwnerName(item.user_id))}</option>`).join('')}</select></label></div>
    <details class="website-mapping" ${current?'open':''}><summary>Match your website form fields</summary><p>Common names such as name, email, phone, company, and website work automatically. Enter a field name here only when your form uses a different name.</p><div class="website-fields">${websiteMapFields.map(([key,label])=>`<label>${label}<input name="map_${key}" maxlength="80" value="${escapeHTML(mapping[key]||'')}" placeholder="${escapeHTML(key)}"></label>`).join('')}</div></details>
    <p class="form-note">New contacts enter the selected stage. An open lead is created or an existing open lead is reused. Text and email consent are not assumed.</p>
    <p class="website-error" role="alert" hidden></p><button class="primary" type="submit" ${websiteStages.length&&websiteOwners.length?'':'disabled'}>${current?'Save website settings':'Generate Site ID and API key'}</button>
  </form>`;
}
function paintWebsiteForms(){
  const root=$('#website-forms-root');if(!root)return;
  const secret=websiteSecret;
  root.innerHTML=`<section class="surface section-card website-card"><div class="website-head"><div><span class="eyebrow">WEBSITE INTAKE</span><h2>Website forms</h2><p>Send form submissions into Contacts and your sales pipeline. SaaS Launchup generates the Site ID here; Twilio credentials are managed separately in API connections.</p></div><button type="button" class="secondary" data-website-action="refresh">Refresh</button></div>
    ${websiteError?`<p class="website-error" role="alert">${escapeHTML(websiteError)}</p>`:''}
    ${secret?`<div class="website-secret"><strong>Copy these now</strong><p>The API key is shown once. Keep it in your website builder’s server-side webhook settings, never in page code.</p><label>Site ID<input readonly value="${escapeHTML(secret.site_id)}"></label><label>One-copy webhook URL<input readonly value="${escapeHTML(websiteWebhookUrl(secret.site_id,secret.api_key))}"></label><button type="button" class="secondary" data-website-copy="url">Copy webhook URL</button><details><summary>Developer API key</summary><label>API key<input readonly value="${escapeHTML(secret.api_key)}"></label><button type="button" class="secondary" data-website-copy="key">Copy API key</button><p>For a server integration, POST to the endpoint with <code>Authorization: Bearer YOUR_API_KEY</code>.</p></details><button type="button" class="ghost" data-website-action="dismiss-secret">I saved these</button></div>`:''}
    <div class="website-steps"><div><b>1</b><span>Create a website connection below.</span></div><div><b>2</b><span>Paste its webhook URL into your website form’s server webhook setting and choose POST.</span></div><div><b>3</b><span>Send a test form. Refresh here to confirm a received submission, then check Sales → Contacts and Pipeline.</span></div></div>
    ${websiteConnections.length?`<div class="website-list">${websiteConnections.map(item=>`<div class="website-item"><div><strong>${escapeHTML(item.name)}</strong><span>${item.status==='active'?'Active':'Revoked'} · Site ID <code>${escapeHTML(item.id)}</code></span><small>${escapeHTML(websiteStageName(item.stage_id))} · ${escapeHTML(websiteOwnerName(item.owner_user_id))} · ${Number(item.submission_count)||0} received${item.last_received_at?` · Last ${escapeHTML(item.last_received_at)}`:''}</small></div>${item.status==='active'?`<div class="website-actions"><button type="button" class="secondary" data-website-action="edit" data-site-id="${escapeHTML(item.id)}">Edit</button><button type="button" class="secondary" data-website-action="rotate" data-site-id="${escapeHTML(item.id)}">Rotate key</button><button type="button" class="secondary website-revoke" data-website-action="revoke" data-site-id="${escapeHTML(item.id)}">Revoke</button></div>`:''}</div>`).join('')}</div>`:'<p class="website-empty">No websites connected yet.</p>'}
    ${websiteEditing!==null?websiteForm():`<button type="button" class="primary website-add" data-website-action="new">Connect website</button>`}
    <details class="website-example"><summary>Fields your form can send</summary><pre>{\n  "name": "Jordan Lee",\n  "email": "jordan@example.com",\n  "phone": "+13125550100",\n  "company": "Example Co",\n  "website": "example.com",\n  "message": "Please call me",\n  "submission_id": "form-123"\n}</pre><p>JSON, URL-encoded, and multipart form posts are accepted. Name plus email or phone is required. Submission ID prevents duplicate retries.</p></details>
  </section>`;
}
document.addEventListener('submit',async event=>{
  if(event.target.id!=='website-connection-form')return;
  event.preventDefault();const form=event.target,button=form.querySelector('button[type="submit"]'),error=form.querySelector('.website-error');
  const mapping={};for(const [key] of websiteMapFields){const value=form.elements[`map_${key}`].value.trim();if(value)mapping[key]=value}
  const payload={name:form.elements.name.value.trim(),stage_id:form.elements.stage_id.value,owner_user_id:form.elements.owner_user_id.value,mapping};
  if(websiteEditing&&websiteEditing!=='new')Object.assign(payload,{action:'update',site_id:websiteEditing});
  button.disabled=true;error.hidden=true;
  try{
    const result=await websiteApi(websiteEditing&&websiteEditing!=='new'?'PATCH':'POST',payload);
    if(result.api_key)websiteSecret=result;
    websiteEditing=null;await renderWebsiteFormsSection();toast(result.api_key?'Website key generated. Copy it now.':'Website settings saved.');
  }catch(cause){error.textContent=cause.message||'Could not save website.';error.hidden=false;button.disabled=false}
});
document.addEventListener('click',async event=>{
  const copy=event.target.closest('[data-website-copy]');
  if(copy&&websiteSecret){
    try{await navigator.clipboard.writeText(copy.dataset.websiteCopy==='url'?websiteWebhookUrl(websiteSecret.site_id,websiteSecret.api_key):websiteSecret.api_key);toast('Copied.')}catch{toast('Copy failed. Select the text and copy it.')}
    return;
  }
  const button=event.target.closest('[data-website-action]');if(!button)return;
  const action=button.dataset.websiteAction,id=button.dataset.siteId;
  if(action==='new'){websiteEditing='new';paintWebsiteForms();$('#website-connection-form input[name="name"]')?.focus();return}
  if(action==='edit'){websiteEditing=id;paintWebsiteForms();$('#website-connection-form input[name="name"]')?.focus();return}
  if(action==='cancel'){websiteEditing=null;paintWebsiteForms();return}
  if(action==='dismiss-secret'){websiteSecret=null;paintWebsiteForms();return}
  if(action==='refresh'){await renderWebsiteFormsSection();return}
  if(action==='rotate'&&!confirm('Rotate this API key? The current webhook URL will stop working immediately.'))return;
  if(action==='revoke'&&!confirm('Revoke this website connection? New form submissions from it will be rejected.'))return;
  button.disabled=true;
  try{
    const result=await websiteApi(action==='rotate'?'PATCH':'DELETE',action==='rotate'?{action:'rotate',site_id:id}:{site_id:id,confirmation:'revoke'});
    websiteSecret=result.api_key?result:null;
    await renderWebsiteFormsSection();toast(action==='rotate'?'New key generated. Update your website webhook URL.':'Website connection revoked.');
  }catch(error){button.disabled=false;toast(error.message||'Could not update website.')}
});
