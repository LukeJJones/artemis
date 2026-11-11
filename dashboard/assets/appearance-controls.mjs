export function initAppearance(api = window.artemisAppearance) {
  const $ = id => document.getElementById(id);
  const trigger = $('accent-trigger'), panel = $('accent-popover');
  const inputs = [...panel.querySelectorAll('input[name=accent]')];
  const native = typeof panel.showPopover === 'function';
  if (!native) panel.hidden = true;
  const isOpen = () => native ? panel.matches(':popover-open') : !panel.hidden;
  function update() {
    const { theme, accent, storageAvailable } = api.snapshot();
    $('theme').setAttribute('aria-checked', String(theme === 'dark'));
    $('appearance-storage-note').hidden = storageAvailable;
    $('accent-name').textContent = accent[0].toUpperCase() + accent.slice(1);
    $('accent-current').style.backgroundColor = api.ACCENTS[accent].solid || api.ACCENTS[accent][theme][0];
    for (const input of inputs) {
      input.checked = input.value === accent;
      const swatch = input.parentElement.querySelector('.accent-swatch');
      const color = api.ACCENTS[input.value].solid || api.ACCENTS[input.value][theme][0];
      swatch.style.backgroundColor = color; swatch.style.color = api.foreground(color);
    }
  }
  function close(restore = false) {
    if (!isOpen()) return;
    if (native) panel.hidePopover(); else panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restore) trigger.focus({ preventScroll: true });
  }
  function position() {
    const r = trigger.getBoundingClientRect(), viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = Math.min(r.width, (viewport?.width || innerWidth) - 28);
    const availableBelow = top + (viewport?.height || innerHeight) - r.bottom - 14;
    const availableAbove = r.top - top - 14;
    const below = availableBelow >= Math.min(340, availableAbove);
    const height = Math.max(44, Math.min(360, below ? availableBelow : availableAbove));
    panel.style.setProperty('--popover-left', `${Math.max(left + 14, Math.min(r.left, left + (viewport?.width || innerWidth) - width - 14))}px`);
    panel.style.setProperty('--popover-top', `${below ? r.bottom + 6 : Math.max(top + 14, r.top - height - 6)}px`);
    panel.style.setProperty('--popover-width', `${width}px`); panel.style.setProperty('--popover-height', `${height}px`);
  }
  function open() {
    trigger.focus({ preventScroll: true }); position();
    if (native) panel.showPopover(); else panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    inputs.find(input => input.checked)?.focus({ preventScroll: true });
    inputs.find(input => input.checked)?.scrollIntoView({ block: 'nearest' });
  }
  trigger.onclick = () => isOpen() ? close(true) : open();
  trigger.onkeydown = event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); if (!isOpen()) open(); } };
  $('theme').onclick = () => api.setTheme(api.snapshot().theme === 'dark' ? 'light' : 'dark');
  for (const input of inputs) input.addEventListener('change', () => { if (input.checked) api.setAccent(input.value); });
  let pointerSelection = false;
  panel.addEventListener('pointerdown', event => { pointerSelection = Boolean(event.isPrimary && event.button === 0 && event.target.closest('label')); });
  panel.addEventListener('pointercancel', () => { pointerSelection = false; });
  panel.addEventListener('click', event => { if (pointerSelection && event.target.closest('label')) { pointerSelection = false; queueMicrotask(() => close(true)); } });
  panel.addEventListener('keydown', event => {
    pointerSelection = false;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); const input = document.activeElement; if (inputs.includes(input)) api.setAccent(input.value); close(true); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); (event.key === 'Home' ? inputs[0] : inputs.at(-1)).focus(); }
  });
  panel.addEventListener('toggle', () => trigger.setAttribute('aria-expanded', String(isOpen())));
  // Native radio navigation can run microtasks between blur and the next focus.
  // Use the declared destination, not the transient BODY activeElement.
  panel.addEventListener('focusout', event => { if (!pointerSelection && event.relatedTarget && !panel.contains(event.relatedTarget)) close(); });
  document.addEventListener('pointerdown', event => { if (isOpen() && !panel.contains(event.target) && !trigger.contains(event.target)) close(); });
  $('navigation').addEventListener('close', () => close());
  for (const target of [window, window.visualViewport].filter(Boolean)) target.addEventListener('resize', () => { if (isOpen()) position(); });
  api.subscribe(update); update();
  return { close };
}
