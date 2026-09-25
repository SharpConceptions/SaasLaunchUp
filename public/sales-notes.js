const demoNotesKey='nectcon-demo-contact-notes-v1';
const demoTasksKey='nectcon-demo-note-tasks-v1';
function readDemoItems(key){try{const items=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(items)?items:[]}catch{return []}}
function writeDemoItems(key,items){localStorage.setItem(key,JSON.stringify(items))}
const dateLabel=value=>value?new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'No date';
const isCrmContact=id=>String(id).startsWith('crm:');
function currentNotes(){return readDemoItems(demoNotesKey).filter(note=>contacts.some(c=>c.id===note.contactId))}
function taskTitle(body){const firstLine=body.trim().split('\n')[0];return `Follow up: ${firstLine.slice(0,225)}`}
async function crmNotesRequest(resource,method='GET',payload=null,params={}){
  if(!crmSalesTenantId)throw new Error('The CRM workspace is still loading. Try again in a moment.');
  const query=new URLSearchParams({resource,tenant_id:crmSalesTenantId,...params});
  const response=await fetch(`/api/crm?${query}`,{method,credentials:'same-origin',cache:'no-store',headers:payload?{'Content-Type':'application/json'}:undefined,body:payload?JSON.stringify(payload):undefined});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||result.message||'Could not save your changes.');
  return result;
}
const originalRenderContacts=renderContacts;
renderContacts=function(){
  originalRenderContacts();
  const matched=crmDialerContacts.filter(c=>[c.name,c.company,c.email,c.stage].join(' ').toLowerCase().includes(query.toLowerCase()));
  if(!crmDialerContacts.length)return;
  $('#main').insertAdjacentHTML('beforeend',`<section class="surface crm-contact-list"><h2>Saved CRM contacts</h2><p>Notes and follow-up tasks for these contacts are saved to the workspace.</p><div class="crm-contact-rows">${matched.map(c=>`<button type="button" class="crm-contact-row" data-contact="${escapeHTML(c.id)}">${contactMark}<span><strong>${escapeHTML(c.name)}</strong><small>${escapeHTML(c.company)}</small></span><span class="crm-contact-stage">${escapeHTML(c.stage||'New lead')}</span></button>`).join('')||'<p class="subtle">No saved contacts match your search.</p>'}</div></section>`);
};
const originalRenderDetail=renderDetail;
let noteLoadSerial=0;
function notesMarkup(c,real){return `<section class="detail-section contact-notes" data-notes-contact="${escapeHTML(c.id)}"><h3>Sales notes</h3><p>${real?'Your notes are saved to this CRM contact and appear on My dashboard.':'Demo notes are saved in this browser and appear on My dashboard.'}</p><form id="contact-note-form"><label for="contact-note-body">New note</label><textarea id="contact-note-body" name="body" rows="4" maxlength="10000" required placeholder="What happened? What should happen next?"></textarea><label for="contact-note-due">Task due date (optional)</label><input id="contact-note-due" name="due_at" type="date"><div class="note-form-actions"><button type="submit" class="secondary" name="intent" value="note">Save note</button><button type="submit" class="primary" name="intent" value="task">Save and make task</button></div><p class="note-error" role="alert" hidden></p></form><div class="contact-notes-list" aria-live="polite">${real?'<p class="subtle">Loading notes…</p>':demoNotesMarkup(c.id)}</div></section>`}
function demoNotesMarkup(contactId){const notes=currentNotes().filter(n=>String(n.contactId)===String(contactId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));const tasks=readDemoItems(demoTasksKey);return notes.length?notes.map(n=>noteCard(n,tasks.some(t=>t.sourceNoteId===n.id),true)).join(''):'<p class="subtle">No notes yet.</p>'}
function noteCard(note,hasTask,demo){return `<article class="contact-note"><p>${escapeHTML(note.body)}</p><small>${dateLabel(note.created_at||note.createdAt)}${demo?' · Demo':''}</small>${hasTask?'<span class="note-task-label">Task created</span>':`<button class="secondary" type="button" data-note-task="${escapeHTML(note.id)}">Make task</button>`}</article>`}
function renderDetailNotes(){
  const stamp=++noteLoadSerial;
  if(!selected){originalRenderDetail();return}
  const real=isCrmContact(selected);
  const c=real?crmDialerContacts.find(x=>x.id===selected):contacts.find(x=>x.id===selected);
  if(!c){originalRenderDetail();return}
  if(real){
    const el=$('#detail');el.hidden=false;
    el.innerHTML=`<div class="detail-inner"><div class="detail-top"><button class="close" data-action="close-detail" aria-label="Close details">×</button></div><h2>${escapeHTML(c.name)}</h2><p>${escapeHTML(c.company)}</p><div class="detail-actions"><button class="secondary" data-action="call">Call</button><button class="secondary" data-action="message">Message</button></div><div class="detail-section"><h3>Contact details</h3><div class="field-row"><span>Email</span><strong>${escapeHTML(c.email||'—')}</strong></div><div class="field-row"><span>Phone</span><strong>${escapeHTML(c.phone||'—')}</strong></div><div class="field-row"><span>Owner</span><strong>${escapeHTML(c.owner)}</strong></div><div class="field-row"><span>Timezone</span><strong>${escapeHTML(c.timezone)}</strong></div></div><div class="detail-section"><h3>Outreach status</h3><p>Check consent and suppression before contacting this lead.</p></div><div class="detail-section lead-updates"><h3>Latest sales & marketing</h3><p>No activity recorded yet.</p><div class="lead-update-stage"><span>Current stage</span>${status(c.stage||'New lead')}</div></div><div class="detail-section"><h3>Timeline</h3><div class="activity"><span class="activity-dot"></span><span>Source: ${escapeHTML(c.source)}</span></div></div><div class="detail-section"><button class="delete-contact-button" type="button" data-action="delete-contact">Delete contact</button></div></div>`;
  }else originalRenderDetail();
  const inner=$('#detail .detail-inner');
  const timeline=[...inner.querySelectorAll('.detail-section')].find(section=>section.querySelector('h3')?.textContent==='Timeline');
  timeline?.insertAdjacentHTML('beforebegin',notesMarkup(c,real));
  if(real)void loadContactNotes(c,stamp);
}
async function loadContactNotes(c,stamp){
  const list=$('#detail .contact-notes-list');
  if(!list)return;
  try{const result=await crmNotesRequest('notes','GET',null,{contact_id:c.contactId,mine:'1'});if(stamp!==noteLoadSerial||selected!==c.id)return;list.innerHTML=result.items.length?result.items.map(n=>noteCard(n,Boolean(n.task_id),false)).join(''):'<p class="subtle">No notes yet.</p>'}catch(error){if(stamp===noteLoadSerial)list.innerHTML=`<p class="note-error">${escapeHTML(error.message)}</p>`}
}
renderDetail=renderDetailNotes;
async function makeTaskFromNote(note,contact,real,dueAt){
  if(real){await crmNotesRequest('tasks','POST',{tenant_id:crmSalesTenantId,contact_id:contact.contactId,source_note_id:note.id,title:taskTitle(note.body),...(dueAt?{due_at:`${dueAt}T17:00:00`}:{})});return}
  const tasks=readDemoItems(demoTasksKey);
  if(tasks.some(task=>task.sourceNoteId===note.id))return;
  tasks.unshift({id:crypto.randomUUID(),sourceNoteId:note.id,contactId:contact.id,title:taskTitle(note.body),dueAt:dueAt||null,status:'open',createdAt:new Date().toISOString()});
  writeDemoItems(demoTasksKey,tasks);
}
document.addEventListener('submit',async event=>{
  if(event.target.id!=='contact-note-form')return;
  event.preventDefault();
  const form=event.target,body=form.elements.body.value.trim(),dueAt=form.elements.due_at.value;
  const intent=event.submitter?.value||'note',real=isCrmContact(selected);
  const contact=real?crmDialerContacts.find(c=>c.id===selected):contacts.find(c=>c.id===selected);
  if(!contact||!body)return;
  const error=form.querySelector('.note-error');error.hidden=true;
  form.querySelectorAll('button').forEach(button=>button.disabled=true);
  let note;
  try{
    if(real){const result=await crmNotesRequest('notes','POST',{tenant_id:crmSalesTenantId,contact_id:contact.contactId,body});note={id:result.id,body}}
    else{note={id:crypto.randomUUID(),contactId:contact.id,body,createdAt:new Date().toISOString()};writeDemoItems(demoNotesKey,[note,...readDemoItems(demoNotesKey)])}
    if(intent==='task')await makeTaskFromNote(note,contact,real,dueAt);
    if(selected===contact.id){renderDetail();toast(intent==='task'?'Note saved and task added to My dashboard.':'Note saved to My dashboard.')}
  }catch(failure){
    if(note){renderDetail();toast('Note saved. The task could not be created; use Make task on the saved note.');return}
    error.textContent=failure.message;error.hidden=false;form.querySelectorAll('button').forEach(button=>button.disabled=false)
  }
});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-note-task]');if(!button)return;
  const real=isCrmContact(selected),contact=real?crmDialerContacts.find(c=>c.id===selected):contacts.find(c=>c.id===selected);
  if(!contact)return;
  button.disabled=true;
  try{
    const note=real?(await crmNotesRequest('notes','GET',null,{contact_id:contact.contactId,mine:'1'})).items.find(n=>n.id===button.dataset.noteTask):currentNotes().find(n=>n.id===button.dataset.noteTask);
    if(!note)throw new Error('Note no longer available.');
    await makeTaskFromNote(note,contact,real);
    if(selected===contact.id){renderDetail();toast('Task added to My dashboard.')}
  }catch(error){toast(error.message);button.disabled=false}
});
function dashboardNoteRow(note,demo){const contactId=demo?note.contactId:`crm:${note.contact_id}`;return `<button class="personal-item" type="button" data-open-note-contact="${escapeHTML(contactId)}"><span><strong>${escapeHTML(note.contact_name||contacts.find(c=>c.id===note.contactId)?.name||'Contact')}</strong><small>${dateLabel(note.created_at||note.createdAt)}${demo?' · Demo':''}</small><span>${escapeHTML(note.body)}</span></span>${note.task_id?'<em>Task created</em>':''}</button>`}
function dashboardTaskRow(task,demo){const contactId=demo?task.contactId:task.contact_id?`crm:${task.contact_id}`:'';return `<div class="personal-item"><span><strong>${escapeHTML(task.title)}</strong><small>${task.due_at||task.dueAt?`Due ${dateLabel(task.due_at||task.dueAt)}`:'No due date'}${demo?' · Demo':''}</small></span>${contactId?`<button class="secondary" type="button" data-open-note-contact="${escapeHTML(contactId)}">Open contact</button>`:''}</div>`}
function renderSalesProfileDashboard(){
  $('#main').innerHTML=`${header('My dashboard','Your recent contact notes and follow-up tasks')}<div class="personal-grid"><section class="surface personal-panel"><h2>My notes</h2><p>Notes you entered in contact panels.</p><div id="personal-notes"><p class="subtle">Loading notes…</p></div></section><section class="surface personal-panel"><h2>My tasks</h2><p>Follow-ups created from your notes and assigned to you.</p><div id="personal-tasks"><p class="subtle">Loading tasks…</p></div></section></div>`;
  void loadSalesProfileDashboard();
}
let dashboardLoadSerial=0;
async function loadSalesProfileDashboard(){
  const stamp=++dashboardLoadSerial;
  const demoNotes=currentNotes().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const demoTasks=readDemoItems(demoTasksKey).filter(t=>contacts.some(c=>c.id===t.contactId)&&t.status!=='done');
  let realNotes=[],realTasks=[],error='';
  if(crmSalesTenantId){try{const [notesResult,tasksResult]=await Promise.all([crmNotesRequest('notes','GET',null,{mine:'1'}),crmNotesRequest('tasks','GET',null,{mine:'1'})]);realNotes=notesResult.items||[];realTasks=(tasksResult.items||[]).filter(t=>t.status!=='done')}catch(failure){error=failure.message}}
  if(stamp!==dashboardLoadSerial||category!=='Sales'||view!=='My dashboard')return;
  $('#personal-notes').innerHTML=(error?`<p class="note-error">${escapeHTML(error)}</p>`:'')+realNotes.map(n=>dashboardNoteRow(n,false)).join('')+demoNotes.map(n=>dashboardNoteRow(n,true)).join('')||'<p class="subtle">No notes yet. Open a contact to add one.</p>';
  $('#personal-tasks').innerHTML=realTasks.map(t=>dashboardTaskRow(t,false)).join('')+demoTasks.map(t=>dashboardTaskRow(t,true)).join('')||'<p class="subtle">No open follow-ups yet.</p>';
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-open-note-contact]');if(!button)return;category='Sales';view='Contacts';selected=String(button.dataset.openNoteContact).startsWith('crm:')?button.dataset.openNoteContact:Number(button.dataset.openNoteContact);render()});
const originalRenderTasks=renderTasks;
renderTasks=function(){
  originalRenderTasks();
  $('#main').insertAdjacentHTML('afterbegin',`<section class="surface personal-panel saved-task-panel"><h2>My tasks from notes</h2><p>Follow-ups assigned to your profile.</p><div id="saved-note-tasks"><p class="subtle">Loading tasks…</p></div></section>`);
  void loadTasksFromNotes();
};
async function loadTasksFromNotes(){
  const demo=readDemoItems(demoTasksKey).filter(t=>contacts.some(c=>c.id===t.contactId)&&t.status!=='done');
  let real=[],error='';
  if(crmSalesTenantId){try{real=(await crmNotesRequest('tasks','GET',null,{mine:'1'})).items.filter(t=>t.status!=='done')}catch(failure){error=failure.message}}
  if(category!=='Sales'||view!=='Tasks'||!$('#saved-note-tasks'))return;
  $('#saved-note-tasks').innerHTML=(error?`<p class="note-error">${escapeHTML(error)}</p>`:'')+real.map(t=>dashboardTaskRow(t,false)).join('')+demo.map(t=>dashboardTaskRow(t,true)).join('')||'<p class="subtle">No tasks from notes yet.</p>';
}
