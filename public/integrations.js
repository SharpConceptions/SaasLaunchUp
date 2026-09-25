let integrationTenantId=null;
let integrationTenants=[];
let integrationConnection=null;
let integrationLoad=0;
const renderSettingsBeforeIntegrations=renderSettings;
renderSettings=function(){
  if(view==='API connections'){renderIntegrations();return}
  if(view==='Custom Integrations'){renderCustomIntegrations();return}
  renderSettingsBeforeIntegrations();
};
function integrationPage(){
  const tenant=integrationTenants.find(item=>item.id===integrationTenantId);
  const connected=Boolean(integrationConnection?.connected);
  const status=connected?'Connected':'Not connected';
  const statusClass=connected?'':'muted';
  const verified=connected&&integrationConnection.last_verified_at
    ?new Date(integrationConnection.last_verified_at.replace(' ','T')+'Z').toLocaleString()
    :'Never';
  $('#main').innerHTML=header('API connections','Connect approved services to your company workspace')+
    `<div class="integration-tenant-row"><label for="integration-tenant">Company</label><select id="integration-tenant">${integrationTenants.map(item=>`<option value="${escapeHTML(item.id)}" ${item.id===integrationTenantId?'selected':''}>${escapeHTML(item.name)}</option>`).join('')}</select></div>
    <section class="surface section-card integration-card">
      <div class="integration-card-head"><div><span class="eyebrow">PHONE & MESSAGING</span><h2>Twilio</h2><p>Connect your existing Twilio account with an API key.</p></div><span class="status-pill ${statusClass}">${status}</span></div>
      ${connected?`<div class="integration-summary"><div><span>Account SID</span><strong>Ends in ${escapeHTML(integrationConnection.account_sid_last4)}</strong></div><div><span>API key SID</span><strong>Ends in ${escapeHTML(integrationConnection.api_key_sid_last4)}</strong></div><div><span>Last verified</span><strong>${escapeHTML(verified)}</strong></div></div><div class="integration-actions"><button class="secondary" type="button" data-integration-action="verify">Check connection</button><button class="secondary integration-disconnect" type="button" data-integration-action="disconnect">Disconnect</button></div>`:''}
      <details class="integration-details" ${connected?'':'open'}><summary>${connected?'Replace Twilio credentials':'Connect Twilio'}</summary>
        <form id="twilio-connection-form" class="integration-form" autocomplete="off">
          <label>Account SID<input name="account_sid" type="text" required pattern="AC[0-9a-fA-F]{32}" maxlength="34" placeholder="AC…" autocapitalize="off" spellcheck="false"></label>
          <label>API key SID<input name="api_key_sid" type="text" required pattern="SK[0-9a-fA-F]{32}" maxlength="34" placeholder="SK…" autocapitalize="off" spellcheck="false"></label>
          <label>API key secret<input name="api_key_secret" type="password" required minlength="16" maxlength="256" autocomplete="new-password" placeholder="Paste the key secret"></label>
          <p class="form-note">Use a Twilio API key with permission to list incoming phone numbers. The secret is encrypted before storage and is never shown again.</p>
          <p id="integration-form-status" class="integration-message" role="status"></p>
          <button class="primary" type="submit">${connected?'Replace and verify':'Connect and verify'}</button>
        </form>
      </details>
      <p class="integration-footnote">Connecting verifies access only. Calling, SMS, number purchases, and company registration remain paused until their own setup is complete. <a href="https://www.twilio.com/docs/iam/api-keys/keys-in-console" target="_blank" rel="noopener noreferrer">How to create a Twilio API key</a></p>
    </section>
    <div class="settings-provider-grid integration-next">
      ${[['DNS management','Manage DNS records for authorized domains'],['Domains','Connect and manage purchased domains'],['Websites','Connect sites and receive form leads'],['Email','Connect email sending and inbox accounts'],['Products','Manage the products you sell'],['Stripe','Payments and subscriptions'],['Google products','Ads, analytics, lead forms, and calendars'],['Facebook & Instagram','Lead ads and social accounts'],['LinkedIn','Lead forms and company pages'],['X','Social account access'],['Reddit','Community and advertising accounts']].map(([name,purpose])=>`<section class="surface section-card"><h2>${name}</h2><p>${purpose}</p><span class="status-pill muted">${name==='Websites'?'Form setup in Funnels & Automation':'Not connected yet'}</span></section>`).join('')}
    </div><p class="integration-footnote">Each outside account needs its own approved connection before SaaS Launchup can read, publish, or manage it.</p>`;
  if(tenant)document.querySelector('#integration-tenant').value=tenant.id;
}
function renderCustomIntegrations(){
  const stamp=++integrationLoad;
  $('#detail').hidden=true;
  $('#main').innerHTML=header('Custom Integrations','Create and manage private integrations for your workspace')+'<section class="surface section-card">Loading your companies…</section>';
  void (async()=>{
    try{
      const response=await fetch('/api/crm?resource=organizations',{credentials:'same-origin',cache:'no-store'});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load companies.');
      if(stamp!==integrationLoad||category!=='Settings'||view!=='Custom Integrations')return;
      integrationTenants=(data.items||[]).filter(item=>item.role==='business_owner');
      if(!integrationTenants.length){$('#main').innerHTML=header('Custom Integrations','Company owner access is required')+notice('Create a company workspace or ask the owner for access.',true);return}
      if(!integrationTenants.some(item=>item.id===integrationTenantId))integrationTenantId=integrationTenants[0].id;
      $('#main').innerHTML=header('Custom Integrations','Create and manage private integrations for your workspace')+`<div class="integration-tenant-row"><label for="integration-tenant">Company</label><select id="integration-tenant">${integrationTenants.map(item=>`<option value="${escapeHTML(item.id)}" ${item.id===integrationTenantId?'selected':''}>${escapeHTML(item.name)}</option>`).join('')}</select></div><div id="private-tokens-root"></div>`;
      renderPrivateTokensSection();
    }catch(error){if(stamp===integrationLoad&&category==='Settings'&&view==='Custom Integrations')$('#main').innerHTML=header('Custom Integrations','Integration setup')+notice(error.message||'Could not load integrations.',true)}
  })();
}
async function integrationApi(method='GET',payload=null){
  const url='/api/integrations'+(method==='GET'?`?tenant_id=${encodeURIComponent(integrationTenantId)}`:'');
  const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',
    headers:payload?{'Content-Type':'application/json'}:undefined,
    body:payload?JSON.stringify({tenant_id:integrationTenantId,...payload}):undefined});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Could not update this connection.');
  return data;
}
function renderIntegrations(){
  const stamp=++integrationLoad;
  $('#detail').hidden=true;
  $('#main').innerHTML=header('API connections','Connect approved services to your company workspace')+'<section class="surface section-card">Loading your companies…</section>';
  void (async()=>{
    try{
      const response=await fetch('/api/crm?resource=organizations',{credentials:'same-origin',cache:'no-store'});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not load companies.');
      if(stamp!==integrationLoad||category!=='Settings'||view!=='API connections')return;
      integrationTenants=(data.items||[]).filter(item=>item.role==='business_owner');
      if(!integrationTenants.length){
        $('#main').innerHTML=header('API connections','Company owner access is required')+notice('Create a company workspace or ask the owner for access.',true);
        return;
      }
      if(!integrationTenants.some(item=>item.id===integrationTenantId))integrationTenantId=integrationTenants[0].id;
      integrationConnection=(await integrationApi()).twilio;
      if(stamp===integrationLoad&&category==='Settings'&&view==='API connections')integrationPage();
    }catch(error){
      if(stamp===integrationLoad&&category==='Settings'&&view==='API connections')
        $('#main').innerHTML=header('API connections','Connection setup')+notice(error.message||'Could not load connections.',true);
    }
  })();
}
document.addEventListener('change',event=>{
  if(event.target.id!=='integration-tenant')return;
  integrationTenantId=event.target.value;
  if(view==='Custom Integrations')renderCustomIntegrations();else renderIntegrations();
});
document.addEventListener('submit',async event=>{
  if(event.target.id!=='twilio-connection-form')return;
  event.preventDefault();
  const form=event.target,button=form.querySelector('button[type="submit"]'),status=form.querySelector('#integration-form-status');
  button.disabled=true;status.textContent='Checking Twilio and saving the connection…';
  try{
    const result=await integrationApi('POST',{
      account_sid:form.elements.account_sid.value.trim(),
      api_key_sid:form.elements.api_key_sid.value.trim(),
      api_key_secret:form.elements.api_key_secret.value
    });
    form.reset();
    integrationConnection=result.twilio;
    integrationPage();
    toast('Twilio connected and verified.');
  }catch(error){status.textContent=error.message||'Could not connect Twilio.';button.disabled=false}
});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-integration-action]');
  if(!button)return;
  const action=button.dataset.integrationAction;
  if(action==='disconnect'&&!confirm('Disconnect Twilio from this company? The saved API key secret will be removed.'))return;
  button.disabled=true;
  try{
    const result=await integrationApi(action==='verify'?'PATCH':'DELETE',action==='verify'?{}:{confirmation:'disconnect'});
    integrationConnection=result.twilio;
    integrationPage();
    toast(action==='verify'?'Twilio connection verified.':'Twilio disconnected.');
  }catch(error){button.disabled=false;toast(error.message||'Could not update Twilio.')}
});
