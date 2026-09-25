let privateTokenTenantId=null,privateTokens=[],privateTokenSecret=null,privateTokenLoad=0,privateTokenError='';
let privateScopeCatalog=[],privateWizardStep=0,privateWizardName='',privateWizardDescription='',privateSelectedScopes=new Set(),privateAllAccess=false;
const privateApiBase='https://api.saaslaunchup.com/api/v1/private';
async function privateTokenApi(method='GET',payload=null){
  const url='/api/private-tokens'+(method==='GET'?`?tenant_id=${encodeURIComponent(integrationTenantId)}`:'');
  const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:payload?{'Content-Type':'application/json'}:undefined,body:payload?JSON.stringify({tenant_id:integrationTenantId,...payload}):undefined});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Could not update private tokens.');
  return data;
}
async function renderPrivateTokensSection(){
  const root=$('#private-tokens-root');if(!root||!integrationTenantId)return;
  const tenant=integrationTenantId,stamp=++privateTokenLoad;
  if(privateTokenTenantId!==tenant){privateTokenTenantId=tenant;privateTokenSecret=null;privateWizardStep=0;privateWizardName='';privateWizardDescription='';privateSelectedScopes=new Set();privateAllAccess=false}
  root.innerHTML='<section class="surface section-card private-token-card"><h2>Custom Integrations</h2><p>Loading integrations…</p></section>';
  try{
    const [result,scopeResponse]=await Promise.all([privateTokenApi(),fetch('/api/integration-scopes',{credentials:'same-origin',cache:'no-store'})]);
    if(!scopeResponse.ok)throw new Error('Could not load the permission catalog.');
    const scopeData=await scopeResponse.json();
    if(stamp!==privateTokenLoad||integrationTenantId!==tenant||category!=='Settings'||view!=='Custom Integrations')return;
    privateTokens=result.items||[];privateScopeCatalog=scopeData.items||[];privateTokenError='';paintPrivateTokens();
  }catch(error){if(stamp===privateTokenLoad){privateTokenError=error.message||'Could not load tokens.';paintPrivateTokens()}}
}
function privateScopeGroups(){
  const groups=new Map();
  for(const item of privateScopeCatalog){if(!groups.has(item.group))groups.set(item.group,[]);groups.get(item.group).push(item)}
  return [...groups].map(([group,items])=>`<div class="private-scope-group"><h4>${escapeHTML(group.replace(/([a-z])([A-Z])/g,'$1 $2'))}</h4>${items.map(item=>`<label class="private-scope-row" data-scope-search="${escapeHTML((group+' '+item.key).toLowerCase())}"><input type="checkbox" name="permission" value="${escapeHTML(item.key)}" ${privateSelectedScopes.has(item.key)?'checked':''}><span><strong>${escapeHTML(item.key)}</strong><small>${item.available?'Available in SaaS Launchup':'Reserved for a future connection'}</small></span></label>`).join('')}</div>`).join('');
}
function paintPrivateTokens(){
  const root=$('#private-tokens-root');if(!root)return;
  const availableCount=privateScopeCatalog.filter(item=>item.available&&privateSelectedScopes.has(item.key)).length;
  root.innerHTML=`<section class="surface section-card private-token-card">
    <div class="private-token-head"><div><span class="eyebrow">SAAS LAUNCHUP BACKEND</span><h2>Custom Integrations</h2><p>Create a private API token with only the permissions this integration needs.</p></div></div>
    <div class="private-integration-types"><span class="private-type-active">Private API token · Available now</span><span>OAuth 2.0 · Authorization setup pending</span></div>
    ${privateTokenError?`<p class="private-token-error" role="alert">${escapeHTML(privateTokenError)}</p>`:''}
    ${privateTokenSecret?`<div class="private-token-secret"><strong>Copy this token now</strong><p>It is shown only once. Store it in your server’s secret settings, never in website page code.</p><label>Private token<input readonly value="${escapeHTML(privateTokenSecret.api_token)}"></label><button class="secondary" type="button" data-private-copy>Copy token</button><button class="ghost" type="button" data-private-dismiss>I saved it</button></div>`:''}
    ${privateWizardStep===0?`<button class="primary private-start" type="button" data-private-start>Create custom integration</button>`:''}
    ${privateWizardStep===1?`<div class="private-wizard-head"><span>Step 1 of 2</span><h3>Name your integration</h3><p>Use a name your team will recognize and describe what it will connect.</p></div><form id="private-details-form" class="private-details-form"><label>Name<input name="name" required maxlength="100" value="${escapeHTML(privateWizardName)}" placeholder="Website lead connector"></label><label>Description<textarea name="description" required maxlength="500" rows="3" placeholder="Receives website leads and creates follow-up tasks">${escapeHTML(privateWizardDescription)}</textarea></label><div class="private-wizard-actions"><button class="secondary" type="button" data-private-cancel>Cancel</button><button class="primary" type="submit">Next: permissions</button></div></form>`:''}
    ${privateWizardStep===2?`<div class="private-wizard-head"><span>Step 2 of 2</span><h3>Choose permissions</h3><p>${escapeHTML(privateWizardName)} · <span id="private-selected-count">${privateSelectedScopes.size} selected, ${availableCount} active in SaaS Launchup today</span></p></div><form id="private-token-form"><label class="private-all-row"><input id="private-all-access" type="checkbox" ${privateAllAccess?'checked':''}><span><strong>Select all access</strong><small>Grant every permission in this catalog</small></span></label>${privateAllAccess?`<div class="private-all-warning" role="alert"><strong>All-access warning</strong><p>This grants broad access to available CRM data and actions, including editing and deleting records. The catalog also includes ads, billing, messaging, and other reserved permissions. Reserved permissions do not work today and require a new approval before SaaS Launchup activates them for this token.</p><label><input name="acknowledge_all_access" type="checkbox" required> I understand and want to grant all access.</label></div>`:''}<label class="private-scope-search">Find a permission<input id="private-scope-search" type="search" placeholder="Search all ${privateScopeCatalog.length} permissions"></label><div class="private-scope-list">${privateScopeGroups()}</div><p class="private-scope-footnote">Permissions marked reserved are saved for your reference but cannot call an API yet. New endpoints require a new or updated integration approval. Tokens expire after 90 days.</p><div class="private-wizard-actions"><button class="secondary" type="button" data-private-back>Back</button><button class="primary" type="submit">Generate private token</button></div></form>`:''}
    <p class="private-token-guide">API base: <code>${privateApiBase}</code>. Send <code>Authorization: Bearer YOUR_TOKEN</code> from your server. <a href="/api-docs.html" target="_blank" rel="noopener">Setup guide</a></p>
    ${privateTokens.length?`<div class="private-token-list">${privateTokens.map(item=>`<div class="private-token-item"><div><strong>${escapeHTML(item.name)}</strong>${item.description?`<p>${escapeHTML(item.description)}</p>`:''}<span>${item.permissions?`${item.permissions.requested.length} selected · ${item.permissions.effective.length} active permissions`:`Legacy token · ${item.scope==='read'?'Read only':item.scope==='read_write_delete'?'Full access':'Read and edit'}`} · ends in ${escapeHTML(item.key_last4)} · ${item.status==='active'?'Active':'Revoked'}</span><small>Expires ${escapeHTML(item.expires_at?.slice(0,10)||'')} ${item.last_used_at?`· Last used ${escapeHTML(item.last_used_at)}`:''}</small></div>${item.status==='active'?`<div class="private-token-actions"><button class="secondary" type="button" data-private-action="rotate" data-token-id="${escapeHTML(item.id)}">Rotate</button><button class="secondary integration-disconnect" type="button" data-private-action="revoke" data-token-id="${escapeHTML(item.id)}">Revoke</button></div>`:''}</div>`).join('')}</div>`:'<p class="private-token-guide">No custom integrations yet.</p>'}
  </section>`;
}
document.addEventListener('submit',async event=>{
  if(event.target.id==='private-details-form'){
    event.preventDefault();privateWizardName=event.target.elements.name.value.trim();privateWizardDescription=event.target.elements.description.value.trim();
    if(!privateWizardName||!privateWizardDescription)return;
    privateWizardStep=2;privateTokenError='';paintPrivateTokens();return;
  }
  if(event.target.id!=='private-token-form')return;
  event.preventDefault();const form=event.target,button=form.querySelector('[type="submit"]');
  if(!privateSelectedScopes.size){privateTokenError='Choose at least one permission.';paintPrivateTokens();return}
  if(!privateScopeCatalog.some(item=>item.available&&privateSelectedScopes.has(item.key))){privateTokenError='Choose at least one permission available in SaaS Launchup today.';paintPrivateTokens();return}
  if(privateAllAccess&&!form.elements.acknowledge_all_access?.checked){privateTokenError='Acknowledge the all-access warning.';paintPrivateTokens();return}
  button.disabled=true;button.textContent='Generating…';
  try{
    privateTokenSecret=await privateTokenApi('POST',{name:privateWizardName,description:privateWizardDescription,permissions:[...privateSelectedScopes],all_access:privateAllAccess,acknowledge_all_access:privateAllAccess});
    privateWizardStep=0;privateWizardName='';privateWizardDescription='';privateSelectedScopes=new Set();privateAllAccess=false;
    await renderPrivateTokensSection();toast('Private token generated. Copy it now.');
  }catch(error){privateTokenError=error.message;paintPrivateTokens()}
});
document.addEventListener('input',event=>{
  if(event.target.id!=='private-scope-search')return;
  const term=event.target.value.toLowerCase().trim();
  document.querySelectorAll('.private-scope-row').forEach(row=>{row.hidden=!row.dataset.scopeSearch.includes(term)});
  document.querySelectorAll('.private-scope-group').forEach(group=>{group.hidden=![...group.querySelectorAll('.private-scope-row')].some(row=>!row.hidden)});
});
document.addEventListener('change',event=>{
  if(event.target.id==='private-all-access'){
    privateAllAccess=event.target.checked;
    privateSelectedScopes=privateAllAccess?new Set(privateScopeCatalog.map(item=>item.key)):new Set();
    privateTokenError='';paintPrivateTokens();return;
  }
  if(event.target.name!=='permission'||!event.target.closest('#private-token-form'))return;
  if(event.target.checked)privateSelectedScopes.add(event.target.value);else privateSelectedScopes.delete(event.target.value);
  const wasAll=privateAllAccess;privateAllAccess=privateSelectedScopes.size===privateScopeCatalog.length;
  privateTokenError='';
  if(wasAll!==privateAllAccess){paintPrivateTokens();return}
  const count=document.querySelector('#private-selected-count');
  if(count)count.textContent=`${privateSelectedScopes.size} selected, ${privateScopeCatalog.filter(item=>item.available&&privateSelectedScopes.has(item.key)).length} active in SaaS Launchup today`;
});
document.addEventListener('click',async event=>{
  if(event.target.closest('[data-private-start]')){privateWizardStep=1;privateTokenError='';paintPrivateTokens();return}
  if(event.target.closest('[data-private-back]')){privateWizardStep=1;paintPrivateTokens();return}
  if(event.target.closest('[data-private-cancel]')){privateWizardStep=0;privateWizardName='';privateWizardDescription='';privateSelectedScopes=new Set();privateAllAccess=false;paintPrivateTokens();return}
  if(event.target.closest('[data-private-copy]')&&privateTokenSecret){try{await navigator.clipboard.writeText(privateTokenSecret.api_token);toast('Token copied.')}catch{toast('Copy failed. Select the token and copy it.')}return}
  if(event.target.closest('[data-private-dismiss]')){privateTokenSecret=null;paintPrivateTokens();return}
  const button=event.target.closest('[data-private-action]');if(!button)return;
  const action=button.dataset.privateAction,tokenId=button.dataset.tokenId;
  if(action==='rotate'&&!confirm('Rotate this private token? The old token will stop working immediately.'))return;
  if(action==='revoke'&&!confirm('Revoke this private token? Connected servers using it will lose access immediately.'))return;
  button.disabled=true;
  try{
    const result=await privateTokenApi(action==='rotate'?'PATCH':'DELETE',action==='rotate'?{action:'rotate',token_id:tokenId}:{token_id:tokenId,confirmation:'revoke'});
    privateTokenSecret=result.api_token?result:null;
    await renderPrivateTokensSection();toast(action==='rotate'?'New token generated. Update your server.':'Private token revoked.');
  }catch(error){privateTokenError=error.message;paintPrivateTokens()}
});
