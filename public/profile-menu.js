const profileMenu=document.querySelector('#profile-menu');
const profileTrigger=document.querySelector('#profile-trigger');
const profileDropdown=document.querySelector('#profile-dropdown');
const hoverProfileMenu=window.matchMedia('(hover:hover)').matches;
let profileIdentity=null;
function syncProfileIdentity(){
  if(!profileIdentity)return;
  profileTrigger.textContent=profileIdentity.initials;
  profileTrigger.setAttribute('aria-label',`Open profile menu for ${profileIdentity.name}`);
  document.querySelector('#profile-menu-name').textContent=profileIdentity.name;
  const nameField=document.querySelector('#profile-name');
  const emailField=document.querySelector('#profile-email');
  if(nameField)nameField.textContent=profileIdentity.name;
  if(emailField)emailField.textContent=profileIdentity.email;
}
void fetch('/api/me',{credentials:'same-origin',cache:'no-store'}).then(response=>response.ok?response.json():null).then(identity=>{
  if(identity?.name&&identity?.email){profileIdentity=identity;syncProfileIdentity()}
}).catch(()=>{});
function openProfileMenu(){
  if(!availableCategories().includes('Settings'))return;
  profileDropdown.hidden=false;
  profileTrigger.setAttribute('aria-expanded','true');
}
function closeProfileMenu(){
  profileDropdown.hidden=true;
  profileTrigger.setAttribute('aria-expanded','false');
}
profileMenu.addEventListener('mouseenter',()=>{if(hoverProfileMenu)openProfileMenu()});
profileMenu.addEventListener('mouseleave',()=>{if(hoverProfileMenu)closeProfileMenu()});
profileTrigger.addEventListener('click',event=>{
  event.stopPropagation();
  if(hoverProfileMenu||profileDropdown.hidden)openProfileMenu();else closeProfileMenu();
});
profileTrigger.addEventListener('keydown',event=>{
  if(event.key==='ArrowDown'){
    event.preventDefault();
    openProfileMenu();
    profileDropdown.querySelector('[role="menuitem"]:not([hidden])')?.focus();
  }
});
profileMenu.addEventListener('focusout',event=>{
  if(!profileMenu.contains(event.relatedTarget))closeProfileMenu();
});
document.addEventListener('click',event=>{
  const destination=event.target.closest('[data-settings-view]');
  if(destination&&profileMenu.contains(destination)){
    const targetView=destination.dataset.settingsView;
    if(!availableViews('Settings').includes(targetView))return;
    category='Settings';
    view=targetView;
    selected=null;
    closeProfileMenu();
    render();
    return;
  }
  if(!profileMenu.contains(event.target))closeProfileMenu();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!profileDropdown.hidden){
    closeProfileMenu();
    profileTrigger.focus();
  }
});
const renderNavBeforeProfileMenu=renderNav;
renderNav=function(){
  renderNavBeforeProfileMenu();
  const settingsAvailable=availableCategories().includes('Settings');
  profileTrigger.hidden=!settingsAvailable;
  profileTrigger.classList.toggle('active',category==='Settings');
  for(const item of profileDropdown.querySelectorAll('[data-settings-view]')){
    item.hidden=!settingsAvailable||!availableViews('Settings').includes(item.dataset.settingsView);
  }
  for(const item of profileDropdown.querySelectorAll('[data-owner-only]')){
    item.hidden=currentRole!=='business_owner';
  }
  if(!settingsAvailable)closeProfileMenu();
};
