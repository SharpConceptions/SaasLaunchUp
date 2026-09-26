let integrationTenantId=null;
let integrationTenants=[];
let integrationConnections={twilio:{connected:false},stripe:{connected:false},email:{connected:false}};
let integrationLoad=0;
let integrationFilter='All';
let integrationSearch='';
const connectionCatalog=[
  {key:'twilio',name:'Twilio',category:'Messaging',description:'Verify an existing Twilio account for future voice and SMS setup.',mode:'credential',icon:'T'},
  {key:'stripe',name:'Stripe',category:'Payments',description:'Verify a Stripe account API key for this customer workspace.',mode:'credential',icon:'S'},
  {key:'email',name:'Email sending',category:'Email',description:'Verify a Resend API key and inspect sending-domain readiness.',mode:'credential',icon:'@'},
  {key:'google-workspace',name:'Google Workspace',category:'Email',description:'Connect an authorized mailbox for email and inbox workflows.',mode:'oauth',icon:'G'},
  {key:'google-calendar',name:'Google Calendar',category:'Calendars',description:'Connect a calendar for busy-time checks and event sync.',mode:'oauth',icon:'G'},
  {key:'google-ads',name:'Google Ads',category:'Social & ads',description:'Connect an advertiser account for campaign reporting.',mode:'oauth',icon:'G'},
  {key:'meta',name:'Facebook & Instagram',category:'Social & ads',description:'Connect Meta business assets and authorized social accounts.',mode:'oauth',icon:'M'},
  {key:'linkedin',name:'LinkedIn',category:'Social & ads',description:'Connect an organization for lead forms and publishing.',mode:'oauth',icon:'in'},
  {key:'x',name:'X',category:'Social & ads',description:'Connect an account for authorized social workflows.',mode:'oauth',icon:'X'},
  {key:'reddit',name:'Reddit',category:'Social & ads',description:'Connect an account for approved community and ads workflows.',mode:'oauth',icon:'r'},
  {key:'domains',name:'Domains & DNS',category:'Domains & sites',description:'Any domain you own. Domain ownership verification and DNS changes require an authorized provider connection.',mode:'domain',icon:'↗'},
  {key:'website-forms',name:'Website forms',category:'Domains & sites',description:'Create a secure form connection and route submissions into your CRM.',mode:'website',icon:'↳'},
];
const renderSettingsBeforeIntegrations=renderSettings;
renderSettings=function(){
  if(view==='API connections'){renderIntegrations();return}
  if(view==='Custom Integrations'){renderCustomIntegrations();return}
  renderSettingsBeforeIntegrations();
};
function integrationPage(){
  const filters=['All','Messaging','Payments','Email','Calendars','Social & ads','Domains & sites'];
  $('#main').innerHTML=header('API connections','Connect and verify services for this workspace')+
    `<div class="integration-toolbar"><label class="integration-tenant-row" for="integration-tenant">Company<select id="integration-tenant">${integrationTenants.map(item=>`<option value="${escapeHTML(item.id)}" ${item.id===integrationTenantId?'selected':''}>${escapeHTML(item.name)}</option>`).join('')}</select></label><label class="integration-search-label" for="integration-search">Search connections<input id="integration-search" type="search" value="${escapeHTML(integrationSearch)}" placeholder="Search providers"></label></div>
    <nav class="integration-filters" aria-label="Connection categories">${filters.map(filter=>`<button type="button" class="integration-filter ${integrationFilter===filter?'active':''}" data-integration-filter="${escapeHTML(filter)}" aria-pressed="${integrationFilter===filter}">${escapeHTML(filter)}</button>`).join('')}</nav>
    <section id="integration-card-grid" class="integration-grid" aria-label="Available connections"></section>
    <p class="integration-footnote">Connection status changes only after provider verification or authorization. A verified credential alone does not enable sending, publishing, payments, or calls.</p>
    <dialog id="integration-detail-dialog" class="integration-detail-dialog" aria-labelledby="integration-detail-title"><div id="integration-detail-content"></div></dialog>`;
  renderConnectionCards();
}
function renderConnectionCards(){
  const grid=$('#integration-card-grid');
  if(!grid)return;
  const query=integrationSearch.trim().toLowerCase();
  const visible=connectionCatalog.filter(item=>(integrationFilter==='All'||item.category===integrationFilter)&&`${item.name} ${item.description}`.toLowerCase().includes(query));
  grid.innerHTML=visible.length?visible.map(renderConnectionCard).join(''):'<p class="integration-empty">No connections match this search.</p>';
}
function connectionStatus(item){
  if(item.key==='twilio')return integrationConnections.twilio?.connected?{label:'Credential verified',kind:'connected'}:{label:'Not connected',kind:'empty'};
  if(item.key==='stripe')return integrationConnections.stripe?.connected?{label:'Account verified',kind:'connected'}:{label:'Not connected',kind:'empty'};
  if(item.key==='email')return integrationConnections.email?.connected?{label:'API key verified',kind:'connected'}:{label:'Not connected',kind:'empty'};
  if(item.mode==='oauth'){
    if(integrationConnections.oauth?.[item.key]?.connected)return {label:'Account connected',kind:'connected'};
    if(integrationConnections.oauth_providers?.[item.key]?.configured)return {label:'Ready to connect',kind:'ready'};
    return {label:'App setup required',kind:'setup'};
  }
  if(item.key==='website-forms')return {label:'Available',kind:'ready'};
  return {label:item.mode==='domain'?'Verification required':'App setup required',kind:'setup'};
}
function renderConnectionCard(item){
  const state=connectionStatus(item);
  return `<article class="connection-card"><div class="connection-card-top"><span class="connection-icon" aria-hidden="true">${escapeHTML(item.icon)}</span><span class="connection-status ${state.kind}">${escapeHTML(state.label)}</span></div><div class="connection-card-copy"><p class="connection-category">${escapeHTML(item.category.toUpperCase())}</p><h2>${escapeHTML(item.name)}</h2><p>${escapeHTML(item.description)}</p></div><button class="connection-action" type="button" data-provider-action="${escapeHTML(item.key)}">${state.kind==='connected'?'Manage connection':item.mode==='credential'?'Connect account':item.mode==='website'?'Open setup':item.mode==='domain'?'Domain options':'Connection details'}</button></article>`;
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
function openProviderDetails(providerKey){
  const item=connectionCatalog.find(connection=>connection.key===providerKey);
  if(!item)return;
  if(item.mode==='website'){category='Funnels & Automation';view='Forms & assessments';render();return}
  if(item.mode==='domain'){category='Settings';view='Domain & DNS';render();return}
  const dialog=$('#integration-detail-dialog'),content=$('#integration-detail-content');
  if(!dialog||!content)return;
    const apiProvider=item.key==='email'?'resend':item.key;
    const connected=item.mode==='oauth'?integrationConnections.oauth?.[item.key]:apiProvider==='twilio'?integrationConnections.twilio:apiProvider==='stripe'?integrationConnections.stripe:integrationConnections.email;
  const verified=connected?.last_verified_at?new Date(connected.last_verified_at.replace(' ','T')+'Z').toLocaleString():'Not verified';
  const summary=connected?.connected?`<div class="connection-summary"><span>Status</span><strong>${escapeHTML(connectionStatus(item).label)}</strong><span>Account</span><strong>Ending ${escapeHTML(apiProvider==='twilio'?connected.account_sid_last4:connected.account_last4||'—')}</strong><span>Last verified</span><strong>${escapeHTML(verified)}</strong></div><div class="connection-actions"><button class="secondary" type="button" data-integration-action="verify" data-provider="${escapeHTML(apiProvider)}">Test connection</button><button class="secondary danger" type="button" data-integration-action="disconnect" data-provider="${escapeHTML(apiProvider)}">Disconnect</button></div>`:'';
  let form='';
  if(apiProvider==='twilio')form=`<form id="provider-connect-form" class="integration-form" autocomplete="off"><input type="hidden" name="provider" value="twilio"><label>Account SID<input name="account_sid" required pattern="AC[0-9a-fA-F]{32}" maxlength="34" placeholder="AC…" autocapitalize="off" spellcheck="false"></label><label>API key SID<input name="api_key_sid" required pattern="SK[0-9a-fA-F]{32}" maxlength="34" placeholder="SK…" autocapitalize="off" spellcheck="false"></label><label>API key secret<input name="secret" type="password" required minlength="16" maxlength="256" autocomplete="new-password" placeholder="Paste the key secret"></label><p class="form-note">We verify number-read access and encrypt credentials. Calls and SMS remain off until separately implemented and tested.</p><p class="integration-message" role="status"></p><button class="primary" type="submit">${connected?.connected?'Replace and verify':'Connect and verify'}</button></form><p class="integration-footnote"><a href="https://www.twilio.com/docs/iam/api-keys/keys-in-console" target="_blank" rel="noopener noreferrer">Twilio API key setup</a></p>`;
  else if(apiProvider==='stripe')form=`<form id="provider-connect-form" class="integration-form" autocomplete="off"><input type="hidden" name="provider" value="stripe"><label>Stripe secret key<input name="secret" type="password" required pattern="sk_(test|live)_[A-Za-z0-9]+" autocomplete="new-password" placeholder="sk_test_… or sk_live_…"></label><p class="form-note">Start with a test-mode key. This verifies the Stripe account and encrypts the key. Payment webhooks, checkout, and subscription sync are not included yet.</p><p class="integration-message" role="status"></p><button class="primary" type="submit">${connected?.connected?'Replace and verify':'Connect Stripe'}</button></form><p class="integration-footnote"><a href="https://dashboard.stripe.com/test/apikeys" target="_blank" rel="noopener noreferrer">Open Stripe test API keys</a></p>`;
  else if(apiProvider==='resend')form=`<form id="provider-connect-form" class="integration-form" autocomplete="off"><input type="hidden" name="provider" value="resend"><label>Resend API key<input name="secret" type="password" required pattern="re_[A-Za-z0-9_-]+" autocomplete="new-password" placeholder="re_…"></label><p class="form-note">We verify API access and encrypt the key. Email delivery remains disabled until sender-domain verification, consent/suppression enforcement, and delivery callbacks are implemented.</p><p class="integration-message" role="status"></p><button class="primary" type="submit">${connected?.connected?'Replace and verify':'Connect email provider'}</button></form><p class="integration-footnote"><a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer">Open Resend API keys</a></p>`;
  else if(item.mode==='oauth'){
    const providerStatus=integrationConnections.oauth_providers?.[item.key]||{configured:false,scopes:[]};
    form=`<section class="connection-prerequisites"><h3>${providerStatus.configured?'OAuth account authorization':'OAuth app setup required'}</h3><p>${escapeHTML(item.description)}</p>${providerStatus.configured?`<p>Requested permissions: ${escapeHTML((providerStatus.scopes||[]).join(', '))}</p><p>The account callback is state-bound and uses PKCE where the provider supports it. Tokens are encrypted at rest and are never returned to browser code.</p><p id="oauth-connection-message" class="integration-message" role="status"></p><button type="button" class="primary" data-start-oauth="${escapeHTML(item.key)}">${connected?'Reconnect account':'Connect account'}</button>`:`${providerStatus.app_configured?'':'<p>Register a provider app and configure its client ID and client secret as Cloudflare Worker secrets.</p>'}${providerStatus.credential_storage_configured?'':'<p>Configure the 32-byte base64 <code>INTEGRATION_ENCRYPTION_KEY</code> Worker secret to store OAuth tokens securely.</p>'}<p>Callback URL to register:</p><code class="connection-callback">${escapeHTML(`${location.origin}/api/integrations/oauth?callback=1&provider=${item.key}`)}</code>`}</section>`;
  }else form=`<section class="connection-prerequisites"><h3>Domain verification required</h3><p>${escapeHTML(item.description)}</p><p>Any domain you own is eligible. Ownership proof and DNS changes are not automated here; no records will be changed until provider authorization and review are implemented.</p></section>`;
  content.innerHTML=`<header class="connection-detail-head"><div><span class="connection-category">${escapeHTML(item.category.toUpperCase())}</span><h2 id="integration-detail-title">${escapeHTML(item.name)}</h2><p>${escapeHTML(item.description)}</p></div><button type="button" class="connection-close" data-close-connection aria-label="Close">×</button></header>${summary}${form}`;
  dialog.showModal();
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
      integrationConnections=await integrationApi();
      if(stamp===integrationLoad&&category==='Settings'&&view==='API connections'){
        integrationPage();
        const returnUrl=new URL(location.href),connectedProvider=returnUrl.searchParams.get('provider');
        if(returnUrl.searchParams.get('connection')==='connected'&&connectedProvider){toast(`${connectedProvider} account connected and verified.`);history.replaceState(null,'',`${location.pathname}${location.hash}`)}
        else if(returnUrl.searchParams.has('connection_error')){toast('Provider authorization was not completed.');history.replaceState(null,'',`${location.pathname}${location.hash}`)}
      }
    }catch(error){
      if(stamp===integrationLoad&&category==='Settings'&&view==='API connections')
        $('#main').innerHTML=header('API connections','Connection setup')+notice(error.message||'Could not load connections.',true);
    }
  })();
}
document.addEventListener('change',event=>{
  if(event.target.id==='integration-tenant'){
    integrationTenantId=event.target.value;
    if(view==='Custom Integrations')renderCustomIntegrations();else renderIntegrations();
  }
});
document.addEventListener('input',event=>{
  if(event.target.id!=='integration-search')return;
  integrationSearch=event.target.value;
  if(category==='Settings'&&view==='API connections')renderConnectionCards();
});
document.addEventListener('click',event=>{
  const filter=event.target.closest('[data-integration-filter]');
  if(filter){integrationFilter=filter.dataset.integrationFilter;document.querySelectorAll('[data-integration-filter]').forEach(button=>{const active=button===filter;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});renderConnectionCards();return}
  const provider=event.target.closest('[data-provider-action]');
  if(provider){openProviderDetails(provider.dataset.providerAction);return}
  if(event.target.closest('[data-close-connection]'))$('#integration-detail-dialog')?.close();
  if(event.target.closest('[data-open-domain-connections]')){category='Settings';view='API connections';render()}
});
document.addEventListener('submit',async event=>{
  if(event.target.id!=='provider-connect-form')return;
  event.preventDefault();
  const form=event.target,button=form.querySelector('button[type="submit"]'),status=form.querySelector('.integration-message');
  const provider=form.elements.provider.value;
  button.disabled=true;status.textContent='Verifying provider credentials and saving securely…';
  try{
    const payload=provider==='twilio'?{account_sid:form.elements.account_sid.value.trim(),api_key_sid:form.elements.api_key_sid.value.trim(),api_key_secret:form.elements.secret.value}:{provider,secret:form.elements.secret.value};
    await integrationApi('POST',payload);
    form.reset();
    integrationConnections=await integrationApi();
    openProviderDetails(provider==='resend'?'email':provider);
    toast('Provider credentials verified.');
  }catch(error){status.textContent=error.message||'Could not connect this provider.';button.disabled=false}
});
document.addEventListener('click',async event=>{
  const start=event.target.closest('[data-start-oauth]');
  if(start){
    start.disabled=true;
    const status=$('#oauth-connection-message');
    try{
      const response=await fetch('/api/integrations/oauth',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start',tenant_id:integrationTenantId,provider:start.dataset.startOauth})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not start provider authorization.');
      location.assign(data.authorization_url);
    }catch(error){if(status)status.textContent=error.message||'Could not start provider authorization.';start.disabled=false}
    return;
  }
  const button=event.target.closest('[data-integration-action]');
  if(!button)return;
  const action=button.dataset.integrationAction,provider=button.dataset.provider||'twilio';
  if(action==='disconnect'&&!confirm(`Disconnect ${provider==='resend'?'Resend email':provider} from this company? The saved API key secret will be removed.`))return;
  button.disabled=true;
  try{
    await integrationApi(action==='verify'?'PATCH':'DELETE',action==='verify'?{provider}:{provider,confirmation:'disconnect'});
    integrationConnections=await integrationApi();
    openProviderDetails(provider==='resend'?'email':provider);
    toast(action==='verify'?'Provider connection verified.':'Provider disconnected.');
  }catch(error){button.disabled=false;toast(error.message||'Could not update this connection.')}
});
