const scriptPanel = document.querySelector('#call-script-window');
const scriptHandle = document.querySelector('#call-script-handle');
const scriptClose = document.querySelector('#call-script-close');
const oldRenderNav = renderNav;

renderNav = function () {
  oldRenderNav();
  if (category === 'Sales') {
    document.querySelector('#workspace-nav').insertAdjacentHTML('beforeend', '<button class="nav-btn call-script-nav" type="button" data-action="open-call-script" aria-controls="call-script-window" aria-expanded="false"><span class="nav-icon" aria-hidden="true">▤</span><span class="nav-text">Call script</span></button>');
  } else {
    closeCallScript();
  }
  syncCallScriptButton();
};

function syncCallScriptButton() {
  const button = document.querySelector('[data-action="open-call-script"]');
  if (button) button.setAttribute('aria-expanded', String(!scriptPanel.hidden));
}

function positionCallScript() {
  const width = scriptPanel.offsetWidth;
  const left = Math.max(12, window.innerWidth - width - 24);
  scriptPanel.style.left = `${left}px`;
  scriptPanel.style.top = `${Math.min(100, Math.max(12, window.innerHeight - scriptPanel.offsetHeight - 12))}px`;
}

function openCallScript() {
  scriptPanel.hidden = false;
  if (!scriptPanel.dataset.positioned) {
    positionCallScript();
    scriptPanel.dataset.positioned = 'true';
  }
  syncCallScriptButton();
  scriptClose.focus();
}

function closeCallScript() {
  scriptPanel.hidden = true;
  syncCallScriptButton();
}

function clampCallScript(left, top) {
  const maxLeft = Math.max(12, window.innerWidth - scriptPanel.offsetWidth - 12);
  const maxTop = Math.max(12, window.innerHeight - scriptPanel.offsetHeight - 12);
  scriptPanel.style.left = `${Math.max(12, Math.min(maxLeft, left))}px`;
  scriptPanel.style.top = `${Math.max(12, Math.min(maxTop, top))}px`;
}

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button?.dataset.action === 'open-call-script') {
    event.stopImmediatePropagation();
    scriptPanel.hidden ? openCallScript() : closeCallScript();
  }
}, true);
scriptClose.addEventListener('click', closeCallScript);

let drag = null;
scriptHandle.addEventListener('pointerdown', event => {
  if (event.target.closest('button')) return;
  drag = { x: event.clientX, y: event.clientY, left: scriptPanel.offsetLeft, top: scriptPanel.offsetTop };
  scriptHandle.setPointerCapture(event.pointerId);
});
scriptHandle.addEventListener('pointermove', event => {
  if (!drag) return;
  clampCallScript(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
});
scriptHandle.addEventListener('pointerup', () => { drag = null; });
scriptHandle.addEventListener('pointercancel', () => { drag = null; });
scriptHandle.addEventListener('keydown', event => {
  const directions = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
  if (!directions[event.key]) return;
  event.preventDefault();
  const [dx, dy] = directions[event.key];
  clampCallScript(scriptPanel.offsetLeft + dx, scriptPanel.offsetTop + dy);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !scriptPanel.hidden) closeCallScript();
});
window.addEventListener('resize', () => {
  if (!scriptPanel.hidden) clampCallScript(scriptPanel.offsetLeft, scriptPanel.offsetTop);
});
render();
