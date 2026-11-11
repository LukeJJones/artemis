import { PageIdentity, parseProfile } from './routing.mjs';
import { PresentationGateway as ProfileGateway, emptyPresentation } from './view-state.mjs';
import { initAppearance } from './appearance-controls.mjs';
import { Conversation } from './conversation.mjs';
import { RpcError } from './gateway.mjs';
import { canonicalMessage } from './canonical.mjs';
import { signInTargets, configuredOpenURL, OPEN_CONFIG_PATH, OPEN_QR_PATH } from './signin.mjs';

const $ = id => document.getElementById(id);
const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
let gateway = { connected: false, close() {} };
let activeEntry = null; let selectionEpoch = 0;
const pageIdentity = new PageIdentity(); let metadataEpoch = 0;
let identityFence = false;
let pendingSelection = null;
// Opening paint only: never feeds connection, recovery, creation or send policy.
let openingView = null;
const openingProfiles = new Set();
const openingLabels = new Map();
let rosterPhase = 'idle'; let initialRosterAttempted = false; let discoveryBusy = false;
const entries = new Map();
const sender = () => model?.settings.sender || 'Choose bot';
let model; let renderedRows = ''; let lastReply = ''; let lastDelivery = ''; let initialHistory = true;
let reconnectTimer = null; let failures = 0;
const APP_DIAGNOSTIC_REVISION = 'a-diag1-r10';
let diagnosticRecorder = null; let diagnosticOwner = null; let diagnosticUI = null; let diagnosticCopySerial = 0;

let lastWorking = false;
let view = 'chat'; let booting = false; let identityRejected = false;


const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
function prepareSignIn() {
  try {
    const url = new URL(location.href);
    if (pendingSelection) url.searchParams.set('artemis_profile', pendingSelection.profile);
    $('login').href = signInTargets(url.href).login; return true;
  }
  catch { $('login').removeAttribute('href'); return false; }
}
let openCodeEpoch = 0;
async function loadScanToOpen() {
  const request = ++openCodeEpoch;
  $('open-qr').hidden = true; $('open-url').hidden = true;
  text($('open-code-status'), 'Checking configured scan-to-open address…');
  try {
    const response = await fetch(new URL(OPEN_CONFIG_PATH, location.origin), { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error('Not configured');
    const url = configuredOpenURL(await response.json(), location.origin);
    if (request !== openCodeEpoch) return;
    $('open-url').href = url; text($('open-url'), url); $('open-url').hidden = false;
    $('open-qr').onload = () => { if (request !== openCodeEpoch) return; $('open-qr').hidden = false; text($('open-code-status'), 'Scan to open Artemis. This QR contains only the address; sign-in is still required.'); };
    $('open-qr').onerror = () => { if (request !== openCodeEpoch) return; $('open-qr').hidden = true; text($('open-code-status'), 'The QR image is unavailable. Use the Artemis address instead.'); };
    $('open-qr').src = new URL(OPEN_QR_PATH, location.origin).href;
  } catch { if (request === openCodeEpoch) text($('open-code-status'), 'Scan-to-open is not configured for this HTTPS origin. Ask the host owner for the verified Artemis address.'); }
}
// Single chat scroll owner; anchors hold IDs/offsets in page memory, never text.
class FeedScroll {
  constructor(area, button) {
    this.area = area; this.button = button; this.following = true; this.jumping = false;
    this.expected = null; this.saved = null; this.frame = 0; this.userIntent = false;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.motion.addEventListener('change', () => { if (this.motion.matches && this.jumping) this.latest(); });
    area.addEventListener('scroll', () => this.scrolled(), { passive: true });
    for (const type of ['focusin', 'focusout']) area.addEventListener(type, () => this.updateButton());
    const interrupt = () => {
      this.userIntent = true;
      if (this.jumping) {
        this.jumping = false; this.following = false; this.expected = null;
        area.scrollTo({ top: area.scrollTop, behavior: 'auto' }); this.updateButton();
      }
    };
    for (const event of ['wheel', 'touchstart', 'pointerdown']) area.addEventListener(event, interrupt, { passive: true });
    area.addEventListener('keydown', event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) interrupt(); });
    // A blur/keyboard resize can move this button between pointer-up and the
    // compatibility click. Complete the same cancellable gesture on pointer-up;
    // keep keyboard/assistive/programmatic click activation independent.
    let tap = null; let pointerClickHandled = false; this.pointerGesture = false;
    button.addEventListener('pointerdown', event => {
      pointerClickHandled = true;
      if (!event.isPrimary || event.button !== 0) { tap = null; this.pointerGesture = false; return; }
      tap = { id: event.pointerId, x: event.clientX, y: event.clientY };
      this.pointerGesture = true;
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener('pointermove', event => {
      if (tap?.id === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 10) { tap = null; this.pointerGesture = false; this.updateButton(); }
    });
    for (const event of ['pointercancel', 'lostpointercapture']) button.addEventListener(event, () => { tap = null; this.pointerGesture = false; this.updateButton(); });
    button.addEventListener('pointerup', event => {
      const activate = tap?.id === event.pointerId && event.button === 0 && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= 10;
      tap = null; this.pointerGesture = false;
      if (activate) { $('draft').blur(); this.latest(true); } else this.updateButton();
    });
    button.onclick = event => {
      if (event.detail > 0 && pointerClickHandled) { pointerClickHandled = false; return; }
      pointerClickHandled = false; this.latest(true);
    };
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => this.schedule());
      for (const el of [area, $('messages'), document.querySelector('.nav-head'), document.querySelector('.composer-zone')]) this.observer.observe(el);
    }
    this.schedule();
  }
  distance() { return Math.max(0, this.area.scrollHeight - this.area.clientHeight - this.area.scrollTop); }
  nodes() { return [...this.area.querySelectorAll('[data-scroll-key],#bot-activity,.conversation-info,#preview-notice')].filter(el => el.getClientRects().length); }
  key(el) { return el.dataset.scrollKey || el.id || 'system-notice'; }
  capture() {
    const top = this.area.getBoundingClientRect().top;
    const readableTop = top + document.querySelector('.nav-head').getBoundingClientRect().height;
    return { top: this.area.scrollTop, anchors: this.nodes().filter(el => el.getBoundingClientRect().bottom > readableTop).slice(0, 4).map(el => ({ key: this.key(el), offset: el.getBoundingClientRect().top - top })) };
  }
  setTop(top) { this.area.scrollTo({ top, behavior: 'auto' }); this.expected = this.area.scrollTop; }
  restore(snapshot) {
    if (view !== 'chat') { this.updateButton(); return; }
    if (this.jumping) this.area.scrollTo({ top: this.area.scrollHeight, behavior: 'smooth' });
    else if (this.following) this.setTop(this.area.scrollHeight);
    else if (snapshot) {
      const nodes = this.nodes(); let restored = false;
      for (const anchor of snapshot.anchors) {
        const node = nodes.find(el => this.key(el) === anchor.key);
        if (!node) continue;
        this.setTop(this.area.scrollTop + node.getBoundingClientRect().top - this.area.getBoundingClientRect().top - anchor.offset); restored = true; break;
      }
      if (!restored) this.setTop(snapshot.top);
    }
    this.saved = this.capture(); this.updateButton();
  }
  scrolled() {
    if (view !== 'chat') { this.updateButton(); return; }
    const atEnd = this.distance() <= 2;
    if (this.jumping) {
      if (atEnd) { this.jumping = false; this.following = true; if (document.activeElement === this.button) this.area.focus({ preventScroll: true }); }
    } else if (this.expected !== null && Math.abs(this.area.scrollTop - this.expected) <= 1) {
      this.expected = null; if (atEnd) this.following = true;
    } else {
      this.expected = null;
      if (!this.frame || this.userIntent || !this.following) this.following = atEnd;
    }
    this.userIntent = false; this.saved = this.capture(); this.updateButton();
  }
  updateButton() {
    const zone = document.querySelector('.composer-zone');
    const readable = this.area.clientHeight - document.querySelector('.nav-head').offsetHeight - zone.offsetHeight;
    // In a short reading band, put Jump in the unused middle of the controls
    // row instead of over recovery actions. Never relocate during capture.
    if (!this.pointerGesture) {
      const actionHeight = Math.max(44, ...[...this.area.querySelectorAll('.actions button,.actions a')]
        .filter(el => el.getClientRects().length).map(el => el.getBoundingClientRect().height));
      const actionFocused = Boolean(this.area.querySelector('.actions :focus'));
      // Existing 8px floating gap plus 4px reading clearance on either side.
      const needsDock = actionFocused || readable < Math.max(44, this.button.offsetHeight) + actionHeight + 16;
      this.button.classList.toggle('dock-in-controls', needsDock);
      const rowBottom = document.querySelector('.composer-controls').getBoundingClientRect().bottom;
      const bottom = `${zone.getBoundingClientRect().bottom - rowBottom}px`;
      if (this.button.style.getPropertyValue('--jump-row-bottom') !== bottom) this.button.style.setProperty('--jump-row-bottom', bottom);
    }
    const away = Math.min(80, Math.max(40, readable * .4)); const distance = this.distance();
    let show = !this.button.hidden;
    if (this.jumping || this.pointerGesture) show = true;
    else if (this.following || distance <= Math.min(24, away * .3)) show = false;
    else if (distance >= away) show = true;
    const hidden = view !== 'chat' || !show;
    if (hidden && view === 'chat' && document.activeElement === this.button) this.area.focus({ preventScroll: true });
    if (this.button.hidden !== hidden) this.button.hidden = hidden;
  }
  latest(smooth = false) {
    const animate = smooth && !this.motion.matches;
    this.following = !animate; this.jumping = animate; this.userIntent = false;
    if (animate) this.area.scrollTo({ top: this.area.scrollHeight, behavior: 'smooth' });
    else { this.setTop(this.area.scrollHeight); if (document.activeElement === this.button) this.area.focus({ preventScroll: true }); }
    this.saved = this.capture(); this.updateButton();
  }
  reveal(el) {
    el.focus({ preventScroll: true });
    const r = el.getBoundingClientRect(), a = this.area.getBoundingClientRect();
    const low = a.bottom - document.querySelector('.composer-zone').offsetHeight - 4;
    const high = a.top + document.querySelector('.nav-head').offsetHeight + 4;
    if (r.bottom > low) this.setTop(this.area.scrollTop + r.bottom - low);
    else if (r.top < high) this.setTop(this.area.scrollTop + r.top - high);
    this.saved = this.capture(); this.updateButton();
  }
  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (view !== 'chat') return;
      if (window.visualViewport && Math.abs(window.visualViewport.scale - 1) > .01) return;
      const snapshot = this.saved || this.capture(); const style = document.documentElement.style;
      const header = document.querySelector('.nav-head').getBoundingClientRect().height;
      const dock = document.querySelector('.composer-zone').getBoundingClientRect().height;
      const input = $('draft').getBoundingClientRect().height;
      for (const [name, n] of [['--top-overlay-height', header], ['--composer-height', dock], ['--composer-chrome-height', dock - input]]) {
        const value = `${Math.ceil(n)}px`; if (style.getPropertyValue(name) !== value) style.setProperty(name, value);
      }
      this.restore(snapshot);
    });
  }
}
const feed = new FeedScroll($('transcript'), $('jump-latest'));
// TEMPORARY review affordance. Set false (or remove item/handlers) before release.
// This is presentation only: never pass it into Conversation or Gateway.
const ERROR_PREVIEW_ENABLED = true;
let lastAttention = '';
function suspendConnection() {
  clearTimeout(reconnectTimer); reconnectTimer = null;
  reconnectTask = null;
  model?.background?.();
}
let reconnectTask = null;
function cancelForegroundRetry(owner, episode) {
  if (reconnectTask?.owner !== owner || reconnectTask.episode !== episode) return;
  clearTimeout(reconnectTask.timer); reconnectTimer = null; reconnectTask = null;
}
function foregroundCurrent(owner, episode, epoch, generation) {
  return model === owner && !identityFence && owner.lifecycle === epoch && owner.foregroundState === episode &&
    episode.generation === generation && !episode.hidden && !document.hidden && owner.canRecoverAutomatically();
}
function foregroundBudget(episode) {
  return episode.remaining - (episode.startedAt === null ? 0 : performance.now() - episode.startedAt);
}
async function connectForeground(owner, s, epoch, generation) {
  s.attempted = true; s.retryable = false;
  diagnosticEvent('recovery_begin');
  const verified = await owner.connect();
  diagnosticEvent('connect_completion', 'none', { lifecycle_captured: epoch, generation_captured: generation,
    model_matches: model === owner, lifecycle_matches: owner.lifecycle === epoch, episode_matches: owner.foregroundState === s, generation_matches: s.generation === generation });
  // Preserve the accepted failure ownership fence. Protected evidence remains canonical model state.
  if (model === owner && !identityFence && owner.lifecycle === epoch && owner.foregroundState === s &&
      s.generation === generation && !s.hidden && !document.hidden && !verified) {
    if (typeof owner.attemptFailedForeground === 'function') owner.attemptFailedForeground();
    else owner.failForeground('current_connect'); // Unsupported older module: retain its existing behavior.
  }
  diagnosticEvent('connect_completion', 'none', { lifecycle_captured: epoch, generation_captured: generation,
    model_matches: model === owner, lifecycle_matches: owner.lifecycle === epoch, episode_matches: owner.foregroundState === s, generation_matches: s.generation === generation });
}
function armForegroundRetry(owner, s) {
  const reservation = s.reservation;
  if (!reservation || s.queued || reconnectTask?.reservation === reservation || s.failed || document.hidden) return;
  const epoch = owner.lifecycle, generation = s.generation;
  const task = { owner, episode: s, reservation, timer: null };
  task.timer = setTimeout(() => {
    if (reconnectTask !== task || reconnectTimer !== task.timer) return;
    reconnectTask = null; reconnectTimer = null;
    if (!foregroundCurrent(owner, s, epoch, generation) || s.reservation !== reservation) return;
    s.queued = true;
    owner.whenIdle().then(() => {
      if (!foregroundCurrent(owner, s, epoch, generation) || s.reservation !== reservation) {
        if (s.generation === generation) { s.queued = false; if (model === owner) owner.emit(); }
        return;
      }
      s.queued = false;
      if (foregroundBudget(s) <= 0) { owner.failForeground('foreground_deadline'); return; }
      s.reservation = null; // Consume the already-counted slot; do not increment again.
      connectForeground(owner, s, epoch, generation);
    });
  }, Math.max(0, reservation.due - performance.now()));
  reconnectTask = task; reconnectTimer = task.timer;
}
function foregroundRetry(owner) {
  const s = owner?.foregroundState;
  if (!s?.checking) { if (s?.verified) cancelForegroundRetry(owner, s); return; }
  if (s.failed || !owner.canRecoverAutomatically()) {
    cancelForegroundRetry(owner, s); s.reservation = null; s.retryable = false; return;
  }
  if (document.hidden) return;
  if (s.reservation) { armForegroundRetry(owner, s); return; }
  if (!s.retryable || owner.connecting || owner.refreshing || gateway.connected || !['offline', 'unknown'].includes(owner.state.phase)) return;
  if (foregroundBudget(s) <= 0) { owner.failForeground('foreground_deadline'); return; }
  if (failures >= 5) { owner.failForeground('retry_cap'); return; }
  const delay = Math.min(15000, 1000 * 2 ** failures++);
  s.reservation = { due: performance.now() + delay }; s.retryable = false;
  armForegroundRetry(owner, s);
}
function diagnosticEvent(event, origin = 'none', context = {}) {
  try {
    if (typeof diagnosticRecorder === 'undefined' || !diagnosticRecorder?.recording) return;
    if (diagnosticOwner && model !== diagnosticOwner) {
      diagnosticOwner.traceDiagnostic('capture_stopped', 'none', { model_matches: false }); diagnosticRecorder.stop(); return;
    }
    const owner = diagnosticOwner || model;
    if (!owner) return;
    owner.diagnosticRetryCount = () => failures;
    owner.traceDiagnostic(event, origin, context);
  } catch { /* Local diagnostics cannot interrupt the application. */ }
}
function updateDiagnosticUI() {
  try {
    if (!diagnosticUI) return;
    const build = diagnosticRecorder?.build;
    diagnosticUI.version.textContent = `Loaded UI: ${APP_DIAGNOSTIC_REVISION}; Conversation: ${build?.conversation_revision || 'unsupported'}; pair: ${build?.build_pair_status || 'unsupported'}.`;
    diagnosticUI.field.value = diagnosticRecorder?.text() || JSON.stringify({ schema: 1, app_revision: APP_DIAGNOSTIC_REVISION,
      conversation_revision: 'unsupported', build_pair_status: 'unsupported', recording: false, truncated: false, saturated: false, first_failure: null, final_state: null, events: [] });
    diagnosticUI.arm.disabled = !model || build?.build_pair_status !== 'matched';
    diagnosticUI.stop.disabled = !diagnosticRecorder?.recording;
    diagnosticUI.status.textContent = diagnosticRecorder?.recording ? 'Recording this return locally. Nothing is sent.' : 'Not recording. Diagnostic text stays only in this page.';
  } catch { /* Optional diagnostic surface only. */ }
}
function initConnectionDiagnostics() {
  try {
    diagnosticRecorder = typeof Conversation.createDiagnostics === 'function'
      ? Conversation.createDiagnostics(APP_DIAGNOSTIC_REVISION, Conversation.diagnosticRevision) : null;
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Connection diagnostics (local only)'; summary.setAttribute('tabindex', '0');
    summary.style.minHeight = '44px'; summary.style.paddingBlock = '12px'; summary.style.cursor = 'pointer';
    const version = document.createElement('p'); const status = document.createElement('p'); status.setAttribute('role', 'status');
    const policy = document.createElement('p'); policy.textContent = 'No chat text, personal identifiers, addresses or credentials. Nothing is sent automatically. Reloading discards the recording.';
    const field = document.createElement('textarea'); field.readOnly = true; field.rows = 6; field.maxLength = 16384;
    field.setAttribute('aria-label', 'Local connection diagnostic text'); field.setAttribute('tabindex', '0'); field.style.width = '100%'; field.style.maxWidth = '100%';
    const arm = document.createElement('button'); arm.type = 'button'; arm.className = 'secondary'; arm.textContent = 'Record one return';
    const stop = document.createElement('button'); stop.type = 'button'; stop.className = 'secondary'; stop.textContent = 'Stop recording';
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'secondary'; copy.textContent = 'Copy diagnostics';
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'secondary'; clear.textContent = 'Clear recording';
    details.append(summary, version, policy, status, arm, stop);
    const provenance = initMessageProvenance(details);
    details.append(field, copy, clear); $('connection-access').append(details);
    diagnosticUI = { details, version, status, field, arm, stop, copy, clear, provenance };
    details.addEventListener('toggle', updateDiagnosticUI);
    arm.onclick = event => {
      try {
        if (!event.isTrusted || !model || !diagnosticRecorder) return;
        ++diagnosticCopySerial; if (diagnosticOwner) diagnosticOwner.diagnostics = null;
        diagnosticOwner = model;
        if (diagnosticRecorder.arm()) { diagnosticOwner.diagnostics = diagnosticRecorder; diagnosticEvent('arm'); }
        updateDiagnosticUI();
      } catch { /* Diagnostic action only. */ }
    };
    stop.onclick = () => { try { diagnosticEvent('capture_stopped'); diagnosticRecorder?.stop(); updateDiagnosticUI(); } catch { /* Diagnostic action only. */ } };
    clear.onclick = event => { try { ++diagnosticCopySerial; diagnosticRecorder?.clear(); if (event?.isTrusted) provenance?.clear(); if (diagnosticOwner) diagnosticOwner.diagnostics = null; diagnosticOwner = null; updateDiagnosticUI(); } catch { /* Diagnostic action only. */ } };
    copy.onclick = async event => {
      if (!event.isTrusted) return;
      const request = ++diagnosticCopySerial; updateDiagnosticUI();
      try {
        if (!navigator.clipboard?.writeText) throw new Error();
        await navigator.clipboard.writeText(field.value);
        if (request === diagnosticCopySerial) status.textContent = 'Diagnostics copied. Nothing was sent automatically.';
      } catch { if (request === diagnosticCopySerial) status.textContent = 'Copy unavailable. Select the diagnostics text and copy it.'; }
    };
    updateDiagnosticUI();
  } catch { /* An unavailable diagnostic UI must not prevent boot. */ }
}
function initMessageProvenance(parent) {
  try {
    const recorder = typeof Conversation.createMessageDiagnostics === 'function'
      ? Conversation.createMessageDiagnostics(APP_DIAGNOSTIC_REVISION, Conversation.diagnosticRevision) : null;
    const details = document.createElement('details'), summary = document.createElement('summary');
    summary.textContent = 'Message provenance (current view)'; summary.setAttribute('tabindex', '0');
    summary.style.minHeight = '44px'; summary.style.paddingBlock = '12px'; summary.style.cursor = 'pointer';
    const policy = document.createElement('p');
    policy.textContent = 'Optional snapshot, including after reload. Last 8 articles, oldest to newest. Saved means supplied history, not proof of a durable write. No message text or identifiers. Same-chat updates do not update the snapshot; switching chats clears it. Inspect again when needed.';
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    const inspect = document.createElement('button'); inspect.type = 'button'; inspect.className = 'secondary'; inspect.textContent = 'Inspect current messages';
    const label = document.createElement('label'); label.textContent = 'Extra article in captured tail (optional)';
    label.style.display = 'block'; label.style.marginBlock = '12px';
    const select = document.createElement('select'); select.setAttribute('aria-label', 'Extra article in captured tail'); select.setAttribute('tabindex', '0');
    select.style.width = '100%'; select.style.minHeight = '44px'; select.style.font = 'inherit';
    select.style.background = 'var(--surface)'; select.style.color = 'var(--fg)'; select.style.border = '1px solid var(--border)'; select.style.borderRadius = '12px';
    const options = [];
    for (let i = 0; i <= 8; i++) { const option = document.createElement('option'); option.value = String(i); option.textContent = i ? `Article ${i} (oldest to newest)` : 'No article selected'; options.push(option); select.append(option); }
    label.append(select);
    const field = document.createElement('textarea'); field.readOnly = true; field.rows = 6; field.maxLength = 8192;
    field.setAttribute('aria-label', 'Local message provenance text'); field.setAttribute('tabindex', '0'); field.style.width = '100%'; field.style.maxWidth = '100%';
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'secondary'; copy.textContent = 'Copy message provenance';
    const clearButton = document.createElement('button'); clearButton.type = 'button'; clearButton.className = 'secondary'; clearButton.textContent = 'Clear message snapshot';
    let serial = 0;
    let capturedOwner = null;
    const invalidateOwner = () => {
      if (!capturedOwner || capturedOwner.has(model)) return false;
      ++serial; capturedOwner = null; recorder?.clear(); return true;
    };
    const update = () => {
      invalidateOwner();
      field.value = recorder?.text() || '{"schema":2,"diagnostic":"message_provenance","status":"unsupported"}';
      const snapshot = recorder?.snapshot(), captured = snapshot?.status === 'captured';
      inspect.disabled = !model || recorder?.build.build_pair_status !== 'matched';
      select.disabled = !captured; select.value = String(snapshot?.selected_ordinal || 0);
      for (let i = 1; i <= 8; i++) options[i].disabled = !captured || i > snapshot.dom_tail.length;
      status.textContent = captured ? 'Snapshot captured locally. Select the extra article by its position, then copy manually.'
        : snapshot?.status === 'unavailable' ? 'Snapshot unavailable. Nothing was sent or changed.' : 'Not inspecting. No message metadata snapshot is retained.';
    };
    const clear = () => { ++serial; capturedOwner = null; recorder?.clear(); update(); };
    inspect.onclick = event => {
      if (!event.isTrusted || !model || !recorder) return;
      const owner = model;
      try {
        ++serial;
        const children = $('messages').children, count = children.length, nodes = [], roles = [];
        for (let index = Math.max(0, count - 8); index < count; index++) {
          const article = children[index], className = article.className;
          nodes.push(article); roles.push(className === 'message user' ? 'user' : className === 'message reply' ? 'reply' : className === 'message system_notice' ? 'system_notice' : 'unknown');
        }
        const captured = recorder.capture(owner, { count, nodes, roles });
        capturedOwner = captured ? new WeakSet([owner]) : null; update();
      } catch { clear(); }
    };
    select.onchange = event => { if (event.isTrusted) { recorder?.select(Number(select.value)); update(); } };
    clearButton.onclick = event => { if (event.isTrusted) clear(); };
    copy.onclick = async event => {
      if (!event.isTrusted) return;
      update(); const request = ++serial;
      try {
        if (!navigator.clipboard?.writeText) throw new Error();
        await navigator.clipboard.writeText(field.value);
        if (request === serial) status.textContent = 'Message provenance copied. Nothing was sent automatically.';
      } catch { if (request === serial) status.textContent = 'Copy unavailable. Select the provenance text and copy it.'; }
    };
    details.append(summary, policy, inspect, label, status, field, copy, clearButton); parent.append(details); update();
    return { details, inspect, select, field, copy, clearButton, status, clear,
      syncOwner() {
        if (invalidateOwner()) update();
        else inspect.disabled = !model || recorder?.build.build_pair_status !== 'matched';
      } };
  } catch { return null; }
}
function resumeConnection(online = false) {
  if (identityFence || !model || !model.canRecoverAutomatically?.()) return;
  const owner = model;
  if (!owner.foregroundState) {
    if (online && !gateway.connected && failures < 5 && !owner.connecting) { ++failures; owner.connect(); }
    return;
  }
  const queue = owner.beginForeground();
  const s = owner.foregroundState; const generation = s.generation; const epoch = owner.lifecycle;
  if (s.reservation) { armForegroundRetry(owner, s); return; }
  if (!queue) return;
  clearTimeout(reconnectTimer); reconnectTimer = null;
  reconnectTask = null;
  diagnosticEvent('recovery_queued');
  owner.whenIdle().then(async () => {
    if (!foregroundCurrent(owner, s, epoch, generation)) {
      if (s.generation === generation) { s.queued = false; if (model === owner) owner.emit(); }
      return;
    }
    s.queued = false;
    if (foregroundBudget(s) <= 0) { owner.failForeground('foreground_deadline'); return; }
    if (failures >= 5) { diagnosticEvent('recovery_begin'); owner.failForeground('retry_cap'); return; }
    ++failures;
    await connectForeground(owner, s, epoch, generation);
  });
}
function renderNotice(phase, notice) {
  const routine = (phase === 'ready' && notice === 'Connected. History is saved by Hermes.') ||
    (phase === 'sending' && notice === 'Sending to Hermes…') ||
    (phase === 'waiting' && notice === `Delivered to Hermes. Waiting for ${sender()}…`);
  const informational = ['ready', 'waiting'].includes(phase) &&
    ['Hermes finished. Syncing the saved reply…', 'Hermes finished. Syncing the saved conversation…'].includes(notice);
  const attention = ['offline', 'unknown', 'failed', 'auth', 'error'].includes(phase) ||
    !informational && /^Hermes (finished processing|needs attention)/.test(notice);

  const noticeNode = $('notice');
  // Decoration follows the existing presentation only; never drives recovery.
  if (phase === 'connecting' && notice === 'Reconnecting…') {
    if (noticeNode.dataset.activity !== 'reconnecting') {
      const label = document.createElement('span'); label.textContent = 'Reconnecting';
      const accessible = document.createElement('span'); accessible.className = 'sr-only'; accessible.textContent = '…'; label.append(accessible);
      const dots = document.createElement('span'); dots.className = 'activity-dots'; dots.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 3; i++) dots.append(document.createElement('span'));
      noticeNode.replaceChildren(label, dots); noticeNode.dataset.activity = 'reconnecting';
    }
  } else { delete noticeNode.dataset.activity; text(noticeNode, notice); }
  text($('access-state'), notice);
  const opening = renderEmptyState(phase, notice);
  document.querySelector('.conversation-info').hidden = routine || opening;
  document.querySelector('.conversation-info').dataset.attention = String(attention);
  const key = notice;
  if (opening) {
    if (openingView.label && !openingView.announced) {
      openingView.announced = true;
      text($('system-announcement'), `Waking up ${openingView.label}`);
    }
  } else if (routine) { lastAttention = ''; text($('system-announcement'), ''); }
  else if ((attention || informational || /^(Text restored|Held message dismissed)/.test(notice)) && key !== lastAttention) { lastAttention = key; text($('system-announcement'), notice); }
  if (typeof renderHomeToast === 'function') renderHomeToast();
}
function renderEmptyState(phase, notice) {
  const presentation = emptyPresentation({ phase, notice, selected: Boolean(model || pendingSelection), sender: model?.settings.sender || pendingSelection?.profile || 'this bot', malformed: Boolean(gateway.historyMalformed), rosterReady: rosterPhase === 'ready' });
  // identity() paints a new controller's neutral offline placeholder synchronously
  // before its first connect(). It belongs to this same opening paint, not recovery.
  const preparing = Boolean(phase === 'offline' && openingView && !openingView.started && model && !model.connecting);
  if (phase === 'connecting' && model?.connecting && openingView) openingView.started = true;
  if (phase !== 'connecting' && !preparing) openingView = null;
  const opening = Boolean(openingView && (phase === 'connecting' || preparing) && openingView.epoch === selectionEpoch &&
    pendingSelection?.profile === openingView?.profile && !identityFence && !identityRejected &&
    !model?.identityRejected && !model?.foregroundState?.checking && !model?.state?.pending &&
    !model?.state?.rows?.length && !model?.gateway?.canonicalAttempted);
  const title = $('empty-title');
  // A blank paint projection is not proof of empty history: tool/system/hidden
  // rows can disappear upstream. Require the current raw snapshot's zero rows.
  const connectedEmpty = Boolean(phase === 'ready' && model && model.settings.kind === 'canonical' &&
    model.settings.sessionIds?.includes(model.state.sessionId) && gateway.hasEmptySnapshot?.(model.state.sessionId) === true &&
    model.state.phase === 'ready' && model.refreshVersion > 0 && gateway.connected && model.gateway === gateway &&
    activeEntry?.model === model && activeEntry.gateway === gateway && !identityFence && !identityRejected &&
    !model.identityRejected && !model.connecting && !model.foregroundState?.checking && !model.warning &&
    !gateway.historyMalformed && !model.state.pending && !model.busy && model.replyGaps?.size === 0 &&
    Array.isArray(model.state.rows) && model.state.rows.length === 0 && notice === 'Connected. History is saved by Hermes.');
  if (phase === 'ready' && model && !gateway.historyMalformed) {
    presentation.title = connectedEmpty ? `Connected to ${model.settings.sender}` : 'Conversation history.';
    if (connectedEmpty) presentation.body = 'No messages yet. Say hello!';
  }
  title.dataset.connectedEmpty = String(connectedEmpty);
  if (opening) {
    const label = `Waking up ${openingView.label || 'your bot'}`;
    if (title.dataset.opening !== 'true' || title.firstElementChild?.textContent !== label) {
      const caption = document.createElement('span'); caption.textContent = label;
      const dots = document.createElement('span'); dots.className = 'activity-dots'; dots.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 3; i++) dots.append(document.createElement('span'));
      title.replaceChildren(caption, dots); title.dataset.opening = 'true';
    }
  } else { delete title.dataset.opening; text(title, presentation.title); }
  text($('empty-description'), presentation.body);
  $('empty-description').hidden = opening;
  $('empty-eyebrow').hidden = opening || connectedEmpty;
  text($('empty-eyebrow'), model || pendingSelection ? 'YOUR CONVERSATION, WITHIN REACH' : 'YOUR BOTS, WITHIN REACH');
  $('chooser-bots').hidden = !presentation.chooser;
  $('empty').hidden = Boolean(model?.visibleRows().length);
  return opening;
}
function syncMessageProvenanceOwner() {
  try {
    if (typeof diagnosticUI !== 'undefined') diagnosticUI?.provenance?.syncOwner();
  } catch { /* Clearing optional diagnostics cannot interrupt owner transitions. */ }
}
function renderHomeToast() {
  const toast = $('home-connection-status');
  if (!toast || typeof view === 'undefined') return;
  if (view !== 'home') { toast.hidden = true; return; }
  // Derive from current ownership/state, never a late notice argument or its wording.
  const current = Boolean(model && activeEntry?.model === model && activeEntry.gateway === gateway &&
    model.gateway === gateway && gateway.isCurrent?.() !== false &&
    (!pendingSelection || pendingSelection.profile === gateway.profile));
  let label = '', details = false, transient = false;
  if (identityFence || identityRejected || model?.identityRejected) { label = 'Connection needs verification'; details = true; }
  else if (current) {
    const phase = model.presentation?.().phase || model.state.phase;
    transient = Boolean((model.connecting || model.foregroundState?.checking) && !['auth', 'unknown', 'failed', 'error', 'empty'].includes(phase));
    if (['auth', 'unknown', 'failed', 'error', 'empty'].includes(phase)) {
      label = { auth: 'Sign in needed', unknown: 'Message outcome unknown', failed: 'Message failed', error: 'Connection needs attention', empty: 'Bot Chat required' }[phase]; details = true;
    } else if (model.foregroundState?.checking) {
      label = model.foregroundState.failed ? 'Connection not restored' : 'Reconnecting…'; details = Boolean(model.foregroundState.failed);
    } else if (phase === 'connecting' || model.connecting) label = 'Connecting…';
    else if (phase === 'offline') { label = 'Offline'; details = true; }
    else if (model.warning || model.diagnosticHostAttention || model.replyGaps?.size > 0 || gateway.historyMalformed) { label = 'Conversation needs attention'; details = true; }
  } else if (!model && ['auth', 'error', 'blocked'].includes(rosterPhase)) {
    label = rosterPhase === 'auth' ? 'Sign in needed' : rosterPhase === 'blocked' ? 'Connection needs verification' : 'Bot list unavailable'; details = true;
  }
  const wasVisible = !toast.hidden;
  const ownedFocus = wasVisible && toast.contains(document.activeElement);
  const info = document.querySelector('.conversation-info');
  toast.hidden = !label; info.hidden = !label;
  text($('home-toast-caption'), label);
  $('home-toast-details').hidden = !details;
  // Reconnect controls may hide during a check. Keep their focus in this region
  // until recovery clears it, then return to the selected card without scrolling.
  if (label && transient && ownedFocus) toast.focus({ preventScroll: true });
  if (!label && ownedFocus) {
    (document.querySelector('#home-bots [aria-current=page]') || $('home-view')).focus({ preventScroll: true });
  }
}
function renderHome() {
  // A previously cached document may not have the new Home controls yet.
  const filter = $('home-view')?.dataset?.filter;
  if (!['all', 'bots', 'rooms'].includes(filter)) return;
  const rooms = filter === 'rooms';
  const blocked = identityFence || identityRejected || model?.identityRejected;
  const phase = blocked ? 'blocked' : model?.state.phase === 'auth' ? 'auth' : rosterPhase;
  const available = phase === 'ready' && $('home-bots').children.length > 0;
  for (const kind of ['all', 'bots', 'rooms']) $('home-' + kind + '-filter').setAttribute('aria-pressed', String(filter === kind));
  $('home-rooms').hidden = !rooms;
  $('home-bots').hidden = rooms || !available;
  $('home-summary').hidden = true;
  text($('home-summary'), filter === 'all' ? 'All currently shows bots only.' : 'Bots from this Hermes host. Choose one to open its private conversation.');
  const status = { idle: 'Finding your bots…', loading: 'Finding bots on this host…', auth: 'Hermes sign-in is needed. Use the connection controls below.', error: 'Bot discovery failed. Use Retry bot list in navigation.', blocked: 'Host or bot identity needs verification. Use the connection controls below.', ready: 'No verified bots to display.' };
  text($('home-status'), status[phase] || status.idle);
  $('home-status').hidden = rooms || available;
  paintHomeConnection();
  if (typeof renderHomeToast === 'function') renderHomeToast();
}
function paintHomeConnection() {
  // Presentation only: selection is not a connectivity signal.
  for (const link of $('home-bots')?.querySelectorAll?.('a[data-profile]') || []) {
    const status = link.querySelector('.bot-status');
    if (!status) continue;
    const selected = Boolean(model && activeEntry?.model === model && link.dataset.profile === activeEntry?.gateway.profile);
    const connected = Boolean(selected && gateway === activeEntry.gateway && model.gateway === gateway && gateway.connected &&
      model.settings.kind === 'canonical' && model.settings.sessionIds?.includes(model.state.sessionId) && model.refreshVersion > 0 &&
      ['ready', 'waiting'].includes(model.state.phase) && !model.connecting && !model.foregroundState?.checking &&
      !identityFence && !identityRejected && !model.identityRejected && !model.warning && !model.diagnosticHostAttention && model.replyGaps?.size === 0);
    link.dataset.connection = connected ? 'connected' : selected ? 'selected' : 'idle';
    status.querySelector('.connection-dot').hidden = !connected;
    text(status.querySelector('.connection-label'), connected ? 'Connected' : selected ? 'Selected' : '');
  }
}
function setHomeFilter(filter) {
  if (!['all', 'bots', 'rooms'].includes(filter)) return;
  $('home-view').dataset.filter = filter;
  renderHome();
}
function setRosterState(phase, notice) {
  rosterPhase = phase; text($('roster-status'), notice);
  $('load-bots').hidden = phase !== 'error';
  $('load-bots').disabled = phase === 'loading';
  renderHome();
}
function render(state) {
  renderHome();
  syncMessageProvenanceOwner();
  // A queued close can run before visibilitychange on return. Activate the same
  // episode from the actual document visibility, never from an offline guess.
  if (!document.hidden && model?.foregroundState?.hidden) resumeConnection();
  const shown = model?.presentation?.() || state;
  const scrollSnapshot = feed.capture();
  const blocked = identityFence || model?.identityRejected;
  document.body.dataset.phase = shown.phase;
  const checking = model?.foregroundState?.checking;
  text($('connection'), shown.phase === 'auth' ? 'Sign in needed' : blocked ? 'Not connected' : checking ? model.foregroundState.failed ? 'Connection not restored' : gateway.connected ? 'Checking connection…' : 'Reconnecting…' : model?.connecting ? 'Connecting to Hermes…' : gateway.connected && !['offline', 'error'].includes(state.phase) ? 'Connected to Hermes' : 'Not connected');
  renderNotice(shown.phase, shown.notice);
  $('send').disabled = blocked || checking || model?.connecting || view !== 'chat' || state.phase !== 'ready' || !state.draft.trim();
  $('draft').readOnly = false;
  if ($('draft').value !== state.draft) { $('draft').value = state.draft; fitDraft(); }
  $('connect').hidden = !['offline', 'error', 'auth'].includes(shown.phase);
  $('connect').disabled = Boolean(model?.connecting || model?.refreshing || model?.foregroundState?.queued);
  text($('connect'), blocked ? 'Verify original connection' : gateway.canonicalAttempted ? 'Check Bot Chat' : state.sessionId ? 'Reconnect' : 'Connect');
  $('start').hidden = blocked || state.phase !== 'empty';
  $('start').disabled = Boolean(model?.connecting || model?.refreshing);
  text($('start'), gateway.canonicalAttempted ? 'Check Bot Chat' : 'Open or create Bot Chat');
  $('check').hidden = !['unknown', 'failed'].includes(state.phase);
  $('discard').hidden = state.phase !== 'failed';
  $('recover').hidden = !['unknown', 'failed'].includes(state.phase) || !state.pending;
  $('recover').disabled = state.draft.length > 0;
  $('recover').title = state.draft.length ? 'Your newer draft will not be overwritten. Clear it explicitly before restoring.' : 'Restore the held text without resending';
  $('login').hidden = state.phase !== 'auth' || !prepareSignIn();
  const rows = model?.visibleRows() || state.rows;
  const serialized = JSON.stringify(rows);
  const rowsChanged = serialized !== renderedRows;
  if (rowsChanged) {
    renderedRows = serialized;
    // Reuse unchanged message nodes: streaming another row must not detach an
    // existing link/code/table reader, steal focus or reset local horizontal scroll.
    const host = $('messages'); const previous = new Map(); const next = [];
    for (const article of host.children) {
      const key = article.dataset.scrollKey;
      if (!previous.has(key)) previous.set(key, []);
      previous.get(key).push(article);
    }
    for (const [index, row] of rows.entries()) {
      const presentation = Conversation.displayPresentation?.(row) || { kind: 'message' };
      const systemNotice = presentation.kind === 'system_notice';
      const article = document.createElement('article'); article.className = `message ${systemNotice ? 'system_notice' : row.role === 'user' ? 'user' : 'reply'}`;
      const id = row.role === 'user' ? row.submission_id || row.display_metadata?.submission_id : null;
      article.dataset.scrollKey = id ? `submission:${id}` : Number.isSafeInteger(row.row_id) ? `row:${row.row_id}` : `position:${row.role}:${index}`;
      const signature = JSON.stringify([sender(), row]);
      const old = previous.get(article.dataset.scrollKey)?.shift();
      if (old?.markdownSignature === signature) { next.push(old); continue; }
      article.markdownSignature = signature;
      if (!systemNotice && row.role === 'assistant') { const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.textContent = [...sender()][0]; avatar.setAttribute('aria-hidden', 'true'); article.append(avatar); }
      const content = document.createElement('div'); content.className = 'content';
      const byline = document.createElement('div'); byline.className = 'byline'; byline.textContent = systemNotice ? 'System' : row.role === 'user' ? 'You' : sender();
      if (!systemNotice && row.role === 'assistant') { const role = document.createElement('span'); role.textContent = 'Bot'; byline.append(role); }
      const body = !systemNotice && row.role === 'assistant' ? renderBotBody(row.content) : document.createElement('p');
      if (systemNotice) body.textContent = presentation.text;
      else if (row.role !== 'assistant') body.textContent = row.content;
      content.append(byline, body);
      if (!systemNotice && row.delivery) {
        const status = document.createElement('span'); status.className = 'message-status';
        status.setAttribute('aria-live', 'off');
        status.dataset.delivery = row.delivery;
        if (row.delivery === 'Delivered') {
          status.title = 'Delivered to Hermes';
          const visible = document.createElement('span'); visible.textContent = 'Delivered'; visible.setAttribute('aria-hidden', 'true');
          const accessible = document.createElement('span'); accessible.className = 'sr-only'; accessible.textContent = 'Delivered to Hermes';
          status.append(visible, accessible);
        } else if (row.delivery === 'Sending…') {
          const label = document.createElement('span'); label.textContent = 'Sending';
          const accessible = document.createElement('span'); accessible.className = 'sr-only'; accessible.textContent = '…'; label.append(accessible);
          const dots = document.createElement('span'); dots.className = 'activity-dots'; dots.setAttribute('aria-hidden', 'true');
          for (let i = 0; i < 3; i++) dots.append(document.createElement('span'));
          status.append(label, dots);
        } else status.textContent = row.delivery;
        content.append(status);
      }
      article.append(content); next.push(article);
    }
    const retained = new Set(next);
    for (const child of [...host.children]) if (!retained.has(child)) child.remove();
    for (const [index, article] of next.entries()) {
      if (host.children[index] !== article) host.insertBefore(article, host.children[index] || null);
    }
    $('empty').hidden = rows.length > 0;
    const delivery = rows.filter(row => row.delivery && Conversation.displayPresentation?.(row).kind !== 'system_notice').at(-1);
    const deliveryKey = delivery ? `${delivery.submission_id || delivery.display_metadata?.submission_id}:${delivery.delivery}` : '';
    if (deliveryKey && deliveryKey !== lastDelivery) text($('announcement'), delivery.deliveryTitle || delivery.delivery);
    lastDelivery = deliveryKey;
    const reply = rows.filter(row => row.role === 'assistant' && Conversation.displayPresentation?.(row).kind !== 'system_notice').at(-1);
    const key = reply ? `${reply.row_id || ''}:${reply.content}` : '';
    if (!initialHistory && key && key !== lastReply) text($('announcement'), `New reply from ${sender()}.`);
    lastReply = key; initialHistory = false;
  }
  // Numeric correspondence for the bounded diagnostic tail only. No flags or
  // content are inspected here; unchanged/orphan DOM nodes are not adopted.
  try {
    const articles = $('messages').children;
    for (let index = Math.max(0, rows.length - 8); index < rows.length; index++) {
      if (articles[index]) model?.rememberDiagnosticArticle?.(articles[index], index, rowsChanged);
    }
  } catch { /* Optional diagnostics cannot interrupt presentation or recovery. */ }
  const working = Boolean(model?.isWorking());
  if ($('bot-activity').hidden === working) {
    $('bot-activity').hidden = !working;
  }
  if (working && !lastWorking) text($('announcement'), `${sender()} is working on this request.`);
  lastWorking = working;
  feed.restore(scrollSnapshot);
  if (!checking && !model?.connecting && ['ready', 'waiting', 'empty'].includes(state.phase)) failures = 0;
  if (typeof foregroundRetry === 'function') foregroundRetry(model);
  if (!checking && !blocked && !model?.connecting && ['offline', 'unknown'].includes(state.phase) && !gateway.connected && !reconnectTimer && failures < 5 && !document.hidden && model?.canRecoverAutomatically?.() !== false) {
    const delay = Math.min(15000, 1000 * 2 ** failures++);
    const owner = model; const epoch = owner.lifecycle;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; if (!document.hidden && !identityFence && model === owner && owner.lifecycle === epoch && owner.canRecoverAutomatically?.() !== false) { diagnosticEvent('recovery_begin'); owner.connect(); } }, delay);
  }
}
function renderBotBody(source) {
  if (!renderBotBody.renderer) {
    // BEGIN GENERATED SAFE MARKDOWN RUNTIME
    /*!
    Vendored markdown-it 15.0.3 browser ESM. Publisher artifact is unmodified.

    markdown-it LICENSE
    Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin.

    Permission is hereby granted, free of charge, to any person
    obtaining a copy of this software and associated documentation
    files (the "Software"), to deal in the Software without
    restriction, including without limitation the rights to use,
    copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the
    Software is furnished to do so, subject to the following
    conditions:

    The above copyright notice and this permission notice shall be
    included in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
    EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
    OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
    NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
    HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
    WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
    FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
    OTHER DEALINGS IN THE SOFTWARE.



    mdurl 2.1.0 (https://registry.npmjs.org/mdurl/-/mdurl-2.1.0.tgz)

    Copyright (c) 2015 Vitaly Puzrin, Alex Kocharin.

    Permission is hereby granted, free of charge, to any person
    obtaining a copy of this software and associated documentation
    files (the "Software"), to deal in the Software without
    restriction, including without limitation the rights to use,
    copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the
    Software is furnished to do so, subject to the following
    conditions:

    The above copyright notice and this permission notice shall be
    included in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
    EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
    OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
    NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
    HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
    WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
    FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
    OTHER DEALINGS IN THE SOFTWARE.

    --------------------------------------------------------------------------------

    .parse() is based on Joyent's node.js `url` code:

    Copyright Joyent, Inc. and other Node contributors. All rights reserved.
    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to
    deal in the Software without restriction, including without limitation the
    rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
    sell copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in
    all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
    FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
    IN THE SOFTWARE.



    uc.micro 3.0.0 (https://registry.npmjs.org/uc.micro/-/uc.micro-3.0.0.tgz)

    Copyright Mathias Bynens <https://mathiasbynens.be/>

    Permission is hereby granted, free of charge, to any person obtaining
    a copy of this software and associated documentation files (the
    "Software"), to deal in the Software without restriction, including
    without limitation the rights to use, copy, modify, merge, publish,
    distribute, sublicense, and/or sell copies of the Software, and to
    permit persons to whom the Software is furnished to do so, subject to
    the following conditions:

    The above copyright notice and this permission notice shall be
    included in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
    EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
    MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
    NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
    LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
    OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
    WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.



    entities 8.1.0 (https://registry.npmjs.org/entities/-/entities-8.1.0.tgz)

    Copyright (c) Felix Böhm
    All rights reserved.

    Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

    Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

    Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

    THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
    EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.



    linkify-it 6.1.0 (https://registry.npmjs.org/linkify-it/-/linkify-it-6.1.0.tgz)

    Copyright (c) 2015 Vitaly Puzrin.

    Permission is hereby granted, free of charge, to any person
    obtaining a copy of this software and associated documentation
    files (the "Software"), to deal in the Software without
    restriction, including without limitation the rights to use,
    copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the
    Software is furnished to do so, subject to the following
    conditions:

    The above copyright notice and this permission notice shall be
    included in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
    EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
    OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
    NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
    HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
    WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
    FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
    OTHER DEALINGS IN THE SOFTWARE.



    punycode.js 2.3.1 (https://registry.npmjs.org/punycode.js/-/punycode.js-2.3.1.tgz)

    Copyright Mathias Bynens <https://mathiasbynens.be/>

    Permission is hereby granted, free of charge, to any person obtaining
    a copy of this software and associated documentation files (the
    "Software"), to deal in the Software without restriction, including
    without limitation the rights to use, copy, modify, merge, publish,
    distribute, sublicense, and/or sell copies of the Software, and to
    permit persons to whom the Software is furnished to do so, subject to
    the following conditions:

    The above copyright notice and this permission notice shall be
    included in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
    EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
    MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
    NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
    LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
    OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
    WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

    */
    var ArtemisMarkdown = (() => {
      var __defProp = Object.defineProperty;
      var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
      var __getOwnPropNames = Object.getOwnPropertyNames;
      var __hasOwnProp = Object.prototype.hasOwnProperty;
      var __export = (target, all) => {
        for (var name in all)
          __defProp(target, name, { get: all[name], enumerable: true });
      };
      var __copyProps = (to, from, except, desc) => {
        if (from && typeof from === "object" || typeof from === "function") {
          for (let key of __getOwnPropNames(from))
            if (!__hasOwnProp.call(to, key) && key !== except)
              __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
        }
        return to;
      };
      var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

      // tools/markdown/render.mjs
      var render_exports = {};
      __export(render_exports, {
        MARKDOWN_LIMITS: () => MARKDOWN_LIMITS,
        renderBotMarkdown: () => renderBotMarkdown,
        safeMarkdownURL: () => safeMarkdownURL
      });

      // tools/markdown/vendor/markdown-it-15.0.3.mjs
      /*! markdown-it 15.0.3 https://github.com/markdown-it/markdown-it @license MIT */
      var e = Object.defineProperty;
      var t = (t2, n2) => {
        let r2 = {};
        for (var i2 in t2) e(r2, i2, {
          get: t2[i2],
          enumerable: true
        });
        return n2 || e(r2, Symbol.toStringTag, { value: "Module" }), r2;
      };
      var n = {};
      function r(e2) {
        let t2 = n[e2];
        if (t2) return t2;
        t2 = n[e2] = [];
        for (let e3 = 0; e3 < 128; e3++) {
          let n2 = String.fromCharCode(e3);
          t2.push(n2);
        }
        for (let n2 = 0; n2 < e2.length; n2++) {
          let r2 = e2.charCodeAt(n2);
          t2[r2] = "%" + ("0" + r2.toString(16).toUpperCase()).slice(-2);
        }
        return t2;
      }
      function i(e2, t2) {
        typeof t2 != "string" && (t2 = i.defaultChars);
        let n2 = r(t2);
        return e2.replace(/(%[a-f0-9]{2})+/gi, function(e3) {
          let t3 = "";
          for (let r2 = 0, i2 = e3.length; r2 < i2; r2 += 3) {
            let a2 = parseInt(e3.slice(r2 + 1, r2 + 3), 16);
            if (a2 < 128) t3 += n2[a2];
            else {
              if ((a2 & 224) == 192 && r2 + 3 < i2) {
                let n3 = parseInt(e3.slice(r2 + 4, r2 + 6), 16);
                if ((n3 & 192) == 128) {
                  let e4 = a2 << 6 & 1984 | n3 & 63;
                  t3 += e4 < 128 ? "��" : String.fromCharCode(e4), r2 += 3;
                  continue;
                }
              }
              if ((a2 & 240) == 224 && r2 + 6 < i2) {
                let n3 = parseInt(e3.slice(r2 + 4, r2 + 6), 16), i3 = parseInt(e3.slice(r2 + 7, r2 + 9), 16);
                if ((n3 & 192) == 128 && (i3 & 192) == 128) {
                  let e4 = a2 << 12 & 61440 | n3 << 6 & 4032 | i3 & 63;
                  t3 += e4 < 2048 || e4 >= 55296 && e4 <= 57343 ? "���" : String.fromCharCode(e4), r2 += 6;
                  continue;
                }
              }
              if ((a2 & 248) == 240 && r2 + 9 < i2) {
                let n3 = parseInt(e3.slice(r2 + 4, r2 + 6), 16), i3 = parseInt(e3.slice(r2 + 7, r2 + 9), 16), o2 = parseInt(e3.slice(r2 + 10, r2 + 12), 16);
                if ((n3 & 192) == 128 && (i3 & 192) == 128 && (o2 & 192) == 128) {
                  let e4 = a2 << 18 & 1835008 | n3 << 12 & 258048 | i3 << 6 & 4032 | o2 & 63;
                  e4 < 65536 || e4 > 1114111 ? t3 += "����" : (e4 -= 65536, t3 += String.fromCharCode(55296 + (e4 >> 10), 56320 + (e4 & 1023))), r2 += 9;
                  continue;
                }
              }
              t3 += "�";
            }
          }
          return t3;
        });
      }
      i.defaultChars = ";/?:@&=+$,#", i.componentChars = "";
      var a = {};
      function o(e2) {
        let t2 = a[e2];
        if (t2) return t2;
        t2 = a[e2] = [];
        for (let e3 = 0; e3 < 128; e3++) {
          let n2 = String.fromCharCode(e3);
          /^[0-9a-z]$/i.test(n2) ? t2.push(n2) : t2.push("%" + ("0" + e3.toString(16).toUpperCase()).slice(-2));
        }
        for (let n2 = 0; n2 < e2.length; n2++) t2[e2.charCodeAt(n2)] = e2[n2];
        return t2;
      }
      function s(e2, t2, n2) {
        typeof t2 != "string" && (n2 = t2, t2 = s.defaultChars), n2 === void 0 && (n2 = true);
        let r2 = o(t2), i2 = "";
        for (let t3 = 0, a2 = e2.length; t3 < a2; t3++) {
          let o2 = e2.charCodeAt(t3);
          if (n2 && o2 === 37 && t3 + 2 < a2 && /^[0-9a-f]{2}$/i.test(e2.slice(t3 + 1, t3 + 3))) i2 += e2.slice(t3, t3 + 3), t3 += 2;
          else if (o2 < 128) i2 += r2[o2];
          else if (o2 >= 55296 && o2 <= 57343) {
            if (o2 >= 55296 && o2 <= 56319 && t3 + 1 < a2) {
              let n3 = e2.charCodeAt(t3 + 1);
              if (n3 >= 56320 && n3 <= 57343) {
                i2 += encodeURIComponent(e2[t3] + e2[t3 + 1]), t3++;
                continue;
              }
            }
            i2 += "%EF%BF%BD";
          } else i2 += encodeURIComponent(e2[t3]);
        }
        return i2;
      }
      s.defaultChars = ";/?:@&=+$,-_.!~*'()#", s.componentChars = "-_.!~*'()";
      function c(e2) {
        let t2 = "";
        return t2 += e2.protocol || "", t2 += e2.slashes ? "//" : "", t2 += e2.auth ? e2.auth + "@" : "", e2.hostname && e2.hostname.indexOf(":") !== -1 ? t2 += "[" + e2.hostname + "]" : t2 += e2.hostname || "", t2 += e2.port ? ":" + e2.port : "", t2 += e2.pathname || "", t2 += e2.search || "", t2 += e2.hash || "", t2;
      }
      function l() {
        this.protocol = null, this.slashes = null, this.auth = null, this.port = null, this.hostname = null, this.hash = null, this.search = null, this.pathname = null;
      }
      var u = /^([a-z0-9.+-]+:)/i;
      var d = /:[0-9]*$/;
      var f = /^(\/\/?(?!\/)[^\?\s]*)(\?[^\s]*)?$/;
      var p = [
        "%",
        "/",
        "?",
        ";",
        "#",
        "'",
        "{",
        "}",
        "|",
        "\\",
        "^",
        "`",
        "<",
        ">",
        '"',
        "`",
        " ",
        "\r",
        "\n",
        "	"
      ];
      var m = [
        "/",
        "?",
        "#"
      ];
      var h = 255;
      var g = /^[+a-z0-9A-Z_-]{0,63}$/;
      var _ = /^([+a-z0-9A-Z_-]{0,63})(.*)$/;
      var v = {
        javascript: true,
        "javascript:": true
      };
      var y = {
        http: true,
        https: true,
        ftp: true,
        gopher: true,
        file: true,
        "http:": true,
        "https:": true,
        "ftp:": true,
        "gopher:": true,
        "file:": true
      };
      function b(e2, t2) {
        if (e2 && e2 instanceof l) return e2;
        let n2 = new l();
        return n2.parse(e2, t2), n2;
      }
      l.prototype.parse = function(e2, t2) {
        let n2, r2, i2, a2 = e2;
        if (a2 = a2.trim(), !t2 && e2.split("#").length === 1) {
          let e3 = f.exec(a2);
          if (e3) return this.pathname = e3[1], e3[2] && (this.search = e3[2]), this;
        }
        let o2 = u.exec(a2);
        if (o2 && (o2 = o2[0], n2 = o2.toLowerCase(), this.protocol = o2, a2 = a2.substr(o2.length)), (t2 || o2 || a2.match(/^\/\/[^@\/]+@[^@\/]+/)) && (i2 = a2.substr(0, 2) === "//", i2 && !(o2 && v[o2]) && (a2 = a2.substr(2), this.slashes = true)), !v[o2] && (i2 || o2 && !y[o2])) {
          let e3 = -1;
          for (let t4 = 0; t4 < m.length; t4++) r2 = a2.indexOf(m[t4]), r2 !== -1 && (e3 === -1 || r2 < e3) && (e3 = r2);
          let t3, n3;
          n3 = e3 === -1 ? a2.lastIndexOf("@") : a2.lastIndexOf("@", e3), n3 !== -1 && (t3 = a2.slice(0, n3), a2 = a2.slice(n3 + 1), this.auth = t3), e3 = -1;
          for (let t4 = 0; t4 < p.length; t4++) r2 = a2.indexOf(p[t4]), r2 !== -1 && (e3 === -1 || r2 < e3) && (e3 = r2);
          e3 === -1 && (e3 = a2.length), a2[e3 - 1] === ":" && e3--;
          let i3 = a2.slice(0, e3);
          a2 = a2.slice(e3), this.parseHost(i3), this.hostname = this.hostname || "";
          let o3 = this.hostname[0] === "[" && this.hostname[this.hostname.length - 1] === "]";
          if (!o3) {
            let e4 = this.hostname.split(/\./);
            for (let t4 = 0, n4 = e4.length; t4 < n4; t4++) {
              let n5 = e4[t4];
              if (n5 && !n5.match(g)) {
                let r3 = "";
                for (let e5 = 0, t5 = n5.length; e5 < t5; e5++) n5.charCodeAt(e5) > 127 ? r3 += "x" : r3 += n5[e5];
                if (!r3.match(g)) {
                  let r4 = e4.slice(0, t4), i4 = e4.slice(t4 + 1), o4 = n5.match(_);
                  o4 && (r4.push(o4[1]), i4.unshift(o4[2])), i4.length && (a2 = i4.join(".") + a2), this.hostname = r4.join(".");
                  break;
                }
              }
            }
          }
          this.hostname.length > h && (this.hostname = ""), o3 && (this.hostname = this.hostname.substr(1, this.hostname.length - 2));
        }
        let s2 = a2.indexOf("#");
        s2 !== -1 && (this.hash = a2.substr(s2), a2 = a2.slice(0, s2));
        let c2 = a2.indexOf("?");
        return c2 !== -1 && (this.search = a2.substr(c2), a2 = a2.slice(0, c2)), a2 && (this.pathname = a2), y[n2] && this.hostname && !this.pathname && (this.pathname = ""), this;
      }, l.prototype.parseHost = function(e2) {
        let t2 = d.exec(e2);
        t2 && (t2 = t2[0], t2 !== ":" && (this.port = t2.substr(1)), e2 = e2.substr(0, e2.length - t2.length)), e2 && (this.hostname = e2);
      };
      var x = /* @__PURE__ */ t({
        decode: () => i,
        encode: () => s,
        format: () => c,
        parse: () => b
      });
      var S = /* @__PURE__ */ t({
        Any: () => C,
        Cc: () => ee,
        Cf: () => te,
        P: () => ne,
        S: () => re,
        Z: () => ie
      });
      var C = /[\0-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
      var ee = /[\0-\x1F\x7F-\x9F]/;
      var te = /[\xAD\u0600-\u0605\u061C\u06DD\u070F\u0890\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]|\uD804[\uDCBD\uDCCD]|\uD80D[\uDC30-\uDC3F]|\uD82F[\uDCA0-\uDCA3]|\uD834[\uDD73-\uDD7A]|\uDB40[\uDC01\uDC20-\uDC7F]/;
      var ne = /[!-#%-\*,-\/:;\?@\[-\]_\{\}\xA1\xA7\xAB\xB6\xB7\xBB\xBF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061D-\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u09FD\u0A76\u0AF0\u0C77\u0C84\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B4E\u1B4F\u1B5A-\u1B60\u1B7D-\u1B7F\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2308-\u230B\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E4F\u2E52-\u2E5D\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA8FC\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]|\uD800[\uDD00-\uDD02\uDF9F\uDFD0]|\uD801\uDD6F|\uD802[\uDC57\uDD1F\uDD3F\uDE50-\uDE58\uDE7F\uDEF0-\uDEF6\uDF39-\uDF3F\uDF99-\uDF9C]|\uD803[\uDD6E\uDEAD\uDED0\uDF55-\uDF59\uDF86-\uDF89]|\uD804[\uDC47-\uDC4D\uDCBB\uDCBC\uDCBE-\uDCC1\uDD40-\uDD43\uDD74\uDD75\uDDC5-\uDDC8\uDDCD\uDDDB\uDDDD-\uDDDF\uDE38-\uDE3D\uDEA9\uDFD4\uDFD5\uDFD7\uDFD8]|\uD805[\uDC4B-\uDC4F\uDC5A\uDC5B\uDC5D\uDCC6\uDDC1-\uDDD7\uDE41-\uDE43\uDE60-\uDE6C\uDEB9\uDF3C-\uDF3E]|\uD806[\uDC3B\uDD44-\uDD46\uDDE2\uDE3F-\uDE46\uDE9A-\uDE9C\uDE9E-\uDEA2\uDF00-\uDF09\uDFE1]|\uD807[\uDC41-\uDC45\uDC70\uDC71\uDEF7\uDEF8\uDF43-\uDF4F\uDFFF]|\uD809[\uDC70-\uDC74]|\uD80B[\uDFF1\uDFF2]|\uD81A[\uDE6E\uDE6F\uDEF5\uDF37-\uDF3B\uDF44]|\uD81B[\uDD6D-\uDD6F\uDE97-\uDE9A\uDFE2]|\uD82F\uDC9F|\uD836[\uDE87-\uDE8B]|\uD839\uDDFF|\uD83A[\uDD5E\uDD5F]/;
      var re = /[\$\+<->\^`\|~\xA2-\xA6\xA8\xA9\xAC\xAE-\xB1\xB4\xB8\xD7\xF7\u02C2-\u02C5\u02D2-\u02DF\u02E5-\u02EB\u02ED\u02EF-\u02FF\u0375\u0384\u0385\u03F6\u0482\u058D-\u058F\u0606-\u0608\u060B\u060E\u060F\u06DE\u06E9\u06FD\u06FE\u07F6\u07FE\u07FF\u0888\u09F2\u09F3\u09FA\u09FB\u0AF1\u0B70\u0BF3-\u0BFA\u0C7F\u0D4F\u0D79\u0E3F\u0F01-\u0F03\u0F13\u0F15-\u0F17\u0F1A-\u0F1F\u0F34\u0F36\u0F38\u0FBE-\u0FC5\u0FC7-\u0FCC\u0FCE\u0FCF\u0FD5-\u0FD8\u109E\u109F\u1390-\u1399\u166D\u17DB\u1940\u19DE-\u19FF\u1B61-\u1B6A\u1B74-\u1B7C\u1FBD\u1FBF-\u1FC1\u1FCD-\u1FCF\u1FDD-\u1FDF\u1FED-\u1FEF\u1FFD\u1FFE\u2044\u2052\u207A-\u207C\u208A-\u208C\u20A0-\u20C1\u2100\u2101\u2103-\u2106\u2108\u2109\u2114\u2116-\u2118\u211E-\u2123\u2125\u2127\u2129\u212E\u213A\u213B\u2140-\u2144\u214A-\u214D\u214F\u218A\u218B\u2190-\u2307\u230C-\u2328\u232B-\u2429\u2440-\u244A\u249C-\u24E9\u2500-\u2767\u2794-\u27C4\u27C7-\u27E5\u27F0-\u2982\u2999-\u29D7\u29DC-\u29FB\u29FE-\u2B73\u2B76-\u2BFF\u2CE5-\u2CEA\u2E50\u2E51\u2E80-\u2E99\u2E9B-\u2EF3\u2F00-\u2FD5\u2FF0-\u2FFF\u3004\u3012\u3013\u3020\u3036\u3037\u303E\u303F\u309B\u309C\u3190\u3191\u3196-\u319F\u31C0-\u31E5\u31EF\u3200-\u321E\u322A-\u3247\u3250\u3260-\u327F\u328A-\u32B0\u32C0-\u33FF\u4DC0-\u4DFF\uA490-\uA4C6\uA700-\uA716\uA720\uA721\uA789\uA78A\uA828-\uA82B\uA836-\uA839\uAA77-\uAA79\uAB5B\uAB6A\uAB6B\uFB29\uFBB2-\uFBD2\uFD40-\uFD4F\uFD90\uFD91\uFDC8-\uFDCF\uFDFC-\uFDFF\uFE62\uFE64-\uFE66\uFE69\uFF04\uFF0B\uFF1C-\uFF1E\uFF3E\uFF40\uFF5C\uFF5E\uFFE0-\uFFE6\uFFE8-\uFFEE\uFFFC\uFFFD]|\uD800[\uDD37-\uDD3F\uDD79-\uDD89\uDD8C-\uDD8E\uDD90-\uDD9C\uDDA0\uDDD0-\uDDFC]|\uD802[\uDC77\uDC78\uDEC8]|\uD803[\uDD8E\uDD8F\uDED1-\uDED8]|\uD805\uDF3F|\uD807[\uDFD5-\uDFF1]|\uD81A[\uDF3C-\uDF3F\uDF45]|\uD82F\uDC9C|\uD833[\uDC00-\uDCEF\uDCFA-\uDCFC\uDD00-\uDEB3\uDEBA-\uDED0\uDEE0-\uDEF0\uDF50-\uDFC3]|\uD834[\uDC00-\uDCF5\uDD00-\uDD26\uDD29-\uDD64\uDD6A-\uDD6C\uDD83\uDD84\uDD8C-\uDDA9\uDDAE-\uDDEA\uDE00-\uDE41\uDE45\uDF00-\uDF56]|\uD835[\uDEC1\uDEDB\uDEFB\uDF15\uDF35\uDF4F\uDF6F\uDF89\uDFA9\uDFC3]|\uD836[\uDC00-\uDDFF\uDE37-\uDE3A\uDE6D-\uDE74\uDE76-\uDE83\uDE85\uDE86]|\uD838[\uDD4F\uDEFF]|\uD83B[\uDCAC\uDCB0\uDD2E\uDEF0\uDEF1]|\uD83C[\uDC00-\uDC2B\uDC30-\uDC93\uDCA0-\uDCAE\uDCB1-\uDCBF\uDCC1-\uDCCF\uDCD1-\uDCF5\uDD0D-\uDDAD\uDDE6-\uDE02\uDE10-\uDE3B\uDE40-\uDE48\uDE50\uDE51\uDE60-\uDE65\uDF00-\uDFFF]|\uD83D[\uDC00-\uDED8\uDEDC-\uDEEC\uDEF0-\uDEFC\uDF00-\uDFD9\uDFE0-\uDFEB\uDFF0]|\uD83E[\uDC00-\uDC0B\uDC10-\uDC47\uDC50-\uDC59\uDC60-\uDC87\uDC90-\uDCAD\uDCB0-\uDCBB\uDCC0\uDCC1\uDCD0-\uDCD8\uDD00-\uDE57\uDE60-\uDE6D\uDE70-\uDE7C\uDE80-\uDE8A\uDE8E-\uDEC6\uDEC8\uDECD-\uDEDC\uDEDF-\uDEEA\uDEEF-\uDEF8\uDF00-\uDF92\uDF94-\uDFEF\uDFFA]/;
      var ie = /[ \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/;
      var ae = [
        8364,
        0,
        8218,
        402,
        8222,
        8230,
        8224,
        8225,
        710,
        8240,
        352,
        8249,
        338,
        0,
        381,
        0,
        0,
        8216,
        8217,
        8220,
        8221,
        8226,
        8211,
        8212,
        732,
        8482,
        353,
        8250,
        339,
        0,
        382,
        376
      ];
      function oe(e2) {
        return e2 === 0 || e2 >= 55296 && e2 <= 57343 || e2 > 1114111;
      }
      function se(e2) {
        return oe(e2) ? 65533 : e2 >= 128 && e2 <= 159 && ae[e2 - 128] || e2;
      }
      function ce(e2) {
        return e2 - 1 >>> 0 < 127 || e2 - 160 >>> 0 < 55136 ? String.fromCharCode(e2) : String.fromCodePoint(se(e2));
      }
      var w = /* @__PURE__ */ (() => {
        let e2 = /* @__PURE__ */ new Uint8Array(127), t2 = 0;
        for (let n2 = 33; n2 <= 126; n2++) n2 !== 34 && n2 !== 36 && n2 !== 92 && (e2[n2] = t2++);
        return e2;
      })();
      function le(e2, t2, n2, r2, i2, a2) {
        let o2 = e2.length, s2 = a2 * 90, c2 = 0, l2 = () => {
          let t3 = w[e2.charCodeAt(c2++)];
          return t3 < a2 ? t3 : t3 * 91 - s2 + w[e2.charCodeAt(c2++)];
        }, u2 = n2 - r2, d2 = n2 + i2, f2 = new Int32Array(d2);
        f2.fill(-1, r2, a2), f2.fill(-1, a2 + u2, d2);
        let p2 = new Int32Array(d2), m2 = new Int32Array(d2);
        function h2(t3, n3) {
          let r3 = 0, i3 = n3, a3 = n3 + t3;
          for (; i3 < a3; ) {
            let t4 = w[e2.charCodeAt(c2++)];
            if (t4 < 89) r3 += t4, f2[i3++] = r3;
            else if (t4 === 89) {
              let t5 = w[e2.charCodeAt(c2++)] + 2;
              for (; t5--; ) f2[i3++] = ++r3;
            } else {
              let t5 = w[e2.charCodeAt(c2++)];
              r3 += 89 + (t5 < 90 ? t5 * 91 + w[e2.charCodeAt(c2++)] : w[e2.charCodeAt(c2++)] * 8281 + w[e2.charCodeAt(c2++)] * 91 + w[e2.charCodeAt(c2++)]), f2[i3++] = r3;
            }
          }
        }
        h2(r2, 0), h2(u2, a2);
        let g2 = new Int32Array(i2 * 2), _2 = 0, v2 = 0;
        function y2(e3, t3) {
          for (let n3 = 0; n3 < e3; n3++) {
            let e4 = t3 + n3, r3 = l2(), i3 = l2();
            g2[v2 * 2] = r3, g2[v2 * 2 + 1] = i3, v2 += 1, p2[e4] = _2;
            let a3 = (f2[r3] < 0 ? m2[r3] : 1) + (f2[i3] < 0 ? m2[i3] : 1);
            m2[e4] = a3, _2 += a3;
          }
        }
        y2(i2 - a2 + r2, a2 + u2), y2(a2 - r2, r2);
        let b2 = new Uint16Array(_2), x2 = 0;
        for (let e3 = 0; e3 < v2; e3++) for (let t3 = 0; t3 < 2; t3++) {
          let n3 = g2[e3 * 2 + t3], r3 = f2[n3];
          if (r3 < 0) {
            let e4 = p2[n3], t4 = e4 + m2[n3];
            for (; e4 < t4; ) b2[x2++] = b2[e4++];
          } else b2[x2++] = r3;
        }
        let S2 = new Uint16Array(t2), C2 = 0;
        for (; c2 < o2; ) {
          let t3 = w[e2.charCodeAt(c2++)];
          t3 >= a2 && (t3 = t3 * 91 - s2 + w[e2.charCodeAt(c2++)]);
          let n3 = f2[t3];
          if (n3 < 0) {
            let e3 = p2[t3], n4 = e3 + m2[t3];
            for (; e3 < n4; ) S2[C2++] = b2[e3++];
          } else S2[C2++] = n3;
        }
        return S2;
      }
      var ue = /* @__PURE__ */ le("!}.&u%}'&}*'~!6*)%&,~!J~!J~%L~y<~!R,~~%Lu~~#GD~~#|)1#%}^%}2%+#.##%##%}&%##%'#%##&%#%#'%#&#%#&#'#%%#&#%##%#)%''%&%#%#'%#%%#%%}%%%#%#&(23#%%#&-%0%('1#(##%#'##+%'*.:1}#%#6-+(%'%%#%%%}#L'2351&('%}&/N'(0(/*-%(%%}#'+&T%7.2}#&%&#%#36/5##%&%%#&#%%#))2%%##%&&'0~!#*+&'%1~!%).'3q?&%'1~!.##%6(~!+%%%(Gw'rT~!E#<nA%#jZ~!H%(~!42##~!*31&~!G%U~#)5~#`3~!J~!Z~%]~%Y~%C~!q~!u~#kz~%#~!6'~!D~!U~!?~#T~!c%~!G#'~%7|~!G~!J~!G&~#pb~(Df}#%}*&}#%##%##%##&#-}&'#'&%#.++}%mI,#,@&(}*%}*'%&##&#%##%}&0}#.},U},%}+%}&%}#%##&}B%(}(%}+%)})%##%#&}&%##%&}<%}>%#%&}*%}(%}9%}/%})%}*%}*%}?&}&%}3%}&*#%})%#%#)}#&#-#+*%E%%'%'#%}#*V##&##I}#&&##%&%#&&Qf%%))w/0+&%#(#.%-''''++++7}>%4'',##1,#%#&%##&#'##&#*#9)%&%}#*}%,#+P(%A&%#'&##wSD',9E00#y#@}(+}&%&>~!#~!X}#*}(&&}(&}(,%}%&#+&}#&}I%#%}%)#(},'%#*}4%%#%}(''}#/##(##),%-##%%)#&}(.}&%#&}%%}*&#%},&&}&%}#%*'#%})%}D&}&%}-&}6&#&}-,%}#%})-(~+`~,=?~I9'9%~!,#%})%})%}@%}?%}(~!?~#<~#pP~#BG~#=1#%K+~#?#~%;)~#A~#mF1~#A'~'X%'~#lR~#N~'N~#r~#m#-~#i'?%#'%~#B%##%,%#~#_%#0%~#]732~,w~2+#:&#%&'0%&>%}#>##F+)#%&&#(+_}4&}-%}(&}@&}O7Fdf0@+/v4}&WU##&/0#&'('B#%}.%}'+#%}#%%&#&%#%##+#&#)#6#'#.},%}c%},%#%##%&#&%#&~#>'*-.%##%##%}#%%}%'~#)D1}#%*&~#_%%'(~#S2%'.}#~#=##*'*-%}&'%'##&&~'E%.#&~#M4}%%##&'%#~#O1##%&#'+~#<B%##%%'%+~#;#@%}#&%#&&%#(~#H1}'%'##&&~#?A}&'~#D#%32}'&&&&~#[}'(#%}'~#;C})&}%%#%~#=&%,3}%'(#%%~#^'#&&)#%'~#Y%-~#d-%'~#^%%&#&&&}#~#b~2t*&'~&(~&@~0%~e~3}%*''0})&}+~!9##-}#%-hD*)1fC#%/&/fB#40~!+#)*4~!+~!K'&:~!/*7~!.#~!H~!L':~%x&~!H#~!*~%1~!I#~!+A~#p'~!F~~#-#~,,(~.Z~!V~%;'B'mq-W~!N~%I%#&&#&}#%},%%}'%}+X#%}#&}(%}'%}<%}#%}%%'}'%}:~![)9@~%>~#UA%-%##&~!C%~!-.9:~!1~!-^2/:a~!y,D*J#-5)/4~%23,~#G~!L1~!0X3`~!2+~!!0-~&E~!W~!o,>Y&]~%cZx_&~#O*9#A#'#+I'%#)~!0B*-5A+-((F&*M#)(-7-5+'-3a5Vi~!Y~!?+[)%3),ERHm~!+:D,VG.+)?fB%%*(%)'(#&80%1'8`K8?`+'Z#&O&'H5#*9)A%%5&3))0%39+.*7#()&&*=4@**L)<'_&*+..;(#*+)./&0#3)%')-8(4ixD(&.}%,('aI:,)%,k2231T)I'#/-W7,/'Q#.'Y24+h')37</31&83##&0#),H(?'&?/1##%#&&#%''-%&&&#(&''&#.-'%#%%(,')*'&#&#'##%(%(#%('#&##%%%%('%#%#%%#%#&%##h>w+v<ayvyvcg.uuhKr}g/v|g>u9i[~>g5uI~=RvdwEg;v/g;uk!!TTSx]@RT!U!#!@VBRUU!'UTe-d0c`e&gSdicedFcrdTaqb.kYcAohdYd@a3e+d}dMdtd.aJ#bqcK`dle/e.e'dwdPdodddjbEb}ogd^ofdpduc6j?l%d{drdqc)d7bacOdQ%T#Y)X.sR[yH>6Vyv3[xwLu>vo'!*.[yBacahoj>6Rew3[xqdZa#!a&#^(X-[yG>6Vyu3[xvg3sEr|g.u/Ri9db0T#^(Xa)!-[y;>6Vylg4wKs{JwNZt3@3r=c4Z([xlg;wKt!cpq's@v7A'*a(a+!-a#[y<3Dt?3Dt'>6Vym3[xmg9rxsNJwLZt4~?r?db1T#`-!(Xa,!0[yS>6Vz%NuQs.g4wKtnJwNZtS@3r>c4Z([y%g;wKtrdga8!a(!#&T*Y-Xa#!a0<or[yc3Dtq>6Vz43[y3JwNZtf@3s!Ju}!%Dti:pm3c_%X#tjB5pkd6q!r]u?voC'*-a.a2!0a&a+[yI3DtI3Ds~3DtH>6Vyw3[xx;:s#~<5pKJwNZtE@3r~d`a)!a2T#a.(!+U.X1[yT3Dt`3Dtv>6Vz&3[y&g9rxwzcxstPu.<rAJwLZtT~?r@dZa%!a.&^*Za(/Reu[ya>6Vz23[y1g3sEr}wkg{NuQRg{ci(U#5@b`~,cg#U(2WnH5wugcRh7dX#T(Y,a'Ta!!a,[yZ<]mj>6Vz,3[y+Pv#5ReZKu+=,%!H}7ABwkaS?Rh:BcW(X#<]mrj:ubv/ARekdg%!(!a.*Ta(Y.X1!#sP>Rl*Dt6[y>>6Vyo3Wf*jOvuumvuRgRJuq*!:9<B@bX~3jVv&v@s@5Re[d/rQt{uAvo&a&a*)a2!,0Wf!3Dt0=Bs'>6Re}3[xy~<5s%JwJZt1~Gs)c;&!#2sJkNuXvzq7rxu,Re8dka4!a8(aEZ+a@Y.X1Xa)[yd=Bs(3DtP>6Vz53[y4cX#X&Re:avRe9~<5s&JwJZtQ~Gs*i^rzvdRg+Jv{%!2sbB@bX}kdga,!Za?&^*T1/!a'Dt+[y6>6Vyf3Wf%g/u;s4hGu6?Rh-JvZ,!c%#&RoX54Rivj7uyvf8RgTKvZB%*!2sGh<vu5Rgq<=C::9bb~#dZ#T&Ta6Y.X*Dt>[y93Wf)coZ(T,6VyifluvRgC@95@B@bX~/hFu34cC#T,k/unq8w8Q5RkUklwQuzunq8w8Q5Rk8d/rJu?v8w9)-&!a0a;a&aIWejg3sEr/h1s<DtDJvyZqY5aws3Jvy!&Wei~Hr1:au5@Bag>23E~5c:Z&bX};kKv?w&unuVu5Rjc;>bs)#~@:Rh.=ay<a]C;b`}Vd6s/t{uAvoaxa()!a,a7%-a#a2Dt,[yF2Wo[>6Vyt3[xuNuPRi&NuPwpi#RoWh?vf8Ri%Jv]!%Ri:KvxD!.'2WeAjZu`q9rxu,Re7woeAg-unLq(qA_/*2Wg_g3u5q^9:4E}/jTrxrzv=Wkkd~0UX#^^Xa-a1a5T&a=U1a'*aEa]!a*aPaA-adok[y54Rn>;:p3~Dp5g9rpsFNvZqjg3uJp4~<5p0Pw;5qlJwNZt*@3p1Pw:5p/Ou!5p2JvG'!6Vye=<qnJvh_[xhg3v,Rh3kOwOw-sDuev/Re^dha[a%!%!a+#Ta7)-5TaCaO!aka!a)sf[yb2>Rl!9ARiq5E}Qg=ucRkBE|oJrJ_@Wk~@Wk{JrJ_@Wk|@WkyJrJ_@Wk}@WkzJvO_[y2g-vMRmiKuYC!)&>Ri;>Ri<@3RkNc](X#@9Rk=g5vuRmhKvDB!+'=]meg3u4Rmgd)#Y'Vz3CARmfd`a+!%T'!+#Ta1Ta6TaM-sTDt9[yA9sYd'%Y#s[[xpj:ueunaXRgEjRq,v-vuqdd2'`#6Rev<32@5>:2<E}5xIo9a*X#Y(;5RePJvD_g>vyRgNj8w)v8<wggs:RgXiZt|vjx,hSq3ah!-(~@:Ro/Ou!5RhWj^v(pyw8unRhUdx-UY#^Ua.a3a70!)%UX1TaDa)'omRiRRhE[y:3Dsz=Br,>6Vyj3[xkg6ruwjcqsrPw;5r*Ku]D'Zt-@3r(~?r.i[vwv]dU1a--U#`a4(g/vsRhPOu!5RhLj:rmu9Wo!~@:wdh@g/vsRiTjXuvvNr}:RhBj^v(pyw8unRn]dz1UYa'a+^Y(!aETZalaRY.Ta?a4[yDJw1!#qLsW>6Vyrfzq-pLflpwRe|Js>%!Dt@3Dt&Jvy_[xs~HrnjMuwpsw'RecKu+D#'!t<~Grl~?rjg5u-x,gwp{ah!-(~@:Rg~Ou!5Rh'jXuvvNr}:Rh#cW#X/c;&!#2sLi[v7u7RgpJv)(!iLrxu,Re6j7v@s@5Se[e7d`aW!Za(a`T.a#!a3!&aDa-!9)Dt_=6s+3[x~~DR|h~DS6avhGun5RkZj3w)v-]mkKunB!&*]kb97R|i<ARk<c:Z(6Vy}Juh'!wziMRoS:F|vkLuauJv5vtvQRh1d='T+Y#VyO~DR|jcF#T'7R|g97R|kJv3'!ay<Rj,Jvh&!:ReXcsa6*a+#a#_aIRf9aLRf?c,Z&Rf5Rf7c.Z&Rf;Rf>cQ#%T'p-Rf8Rf=ct#%'(*!,p,Rf4p+Rf6Rf:Rf<d~'Ua%U*^UYa(!a,-!#a4YaTalaEX0a8a<Weo3Dt/3Dsx=Br93Wen~Dr;~<5p<JwNZt2@3p=Pw:5p;Ou!5r3c7&!#:p>3Ds}KvGB)_6Vyk2sM=<r7x'eovA(!hFu1ARf}cV#X&@r5j6rvwQa^Rf3c=Za'wkghJv__g;unRggA53B9=b^}%j6uduo5Jq;!(hIv%2Re`Ou4ARe_e%a#^^^Xa&!a*a2!&a6YaP!*ad!#a:aE/5Rn?[y@>6Vyp;:pE~DrY~<5pBJwNZt8@3pCh=rt3rWPw:5pAJup_[xoNuPpF9c!#'45pD5ARn)d8#X'X*3@rU72s]h>v<<sSjJpqvewOJq/(!hNw'5ReBk0s2u3w/w'5ReE5@Jq.!a+JQ!&WeU23d(#Y&RjG5]jBk!u7w&u0udARjEe#+^^^Ub#!a2/a`Z(agT1!a-a;|@TaG!aS[yV=Re~fow'RguNuPRe?bz#'>RoUWeL>:Cbb|?JwPZtVg6ruRmzJvD'!6Vz(g/vmRh~Jvy_[y(g9voRgyx*cy(#2>Ri2B9b]~9kIw9u7rluJu3Rg]dI#a%UY'@=p%CAx.gQZ&RhwwygtRm{x5g_Z'+ABqR9Woa=Bp&dV#^*Xa'!&@o{g4v]Rk;Jv{!%Rk[wkkiA5RkiwwfUB=x,fUuqC&*!>RfTg8v0RfV~ARfSd;rJsAuAv9wR'ae+/aO!a@aza/a#[yQ@Wg!2Wemg3sEr0JvB_g>uvReWg2v+Re=KupB_+[y!2AbY~-~Hr2AJwD!(h<~El>h<~El?Kun@+_:9b`}Kg-v/Ri3g;vtwyk_9]k_d=&T#*U.6qh@Ab`|K9:H|CJv[!&3Dtex'fDwC%!Rf[9WlMd[(^X,!a%Z06Vz!@WgBg=v~Rgvg,QRe@awd,#Y+jTv|Q~EfWj]uNr|~FRfXdy#Y&^Ua%!aO.!(a)Ua;=!a@aKap!a-,a!Ta]a[rSa]p?[y82sK=Bq~;:p:~<5p8Pw:5p7d'#Y'Wf(;RnRi[u4w&RgJJvG'!6Vyh=<r#ijuuv/sIKuYD'ZtG@3p9~Gr&d2#`(g<vtRgFj`u5w&rqpxRf2CJuY!+:wfnTOu!5Rg}jNs1ucv&RfwJvA!&3@q|BDcC#T,k/unq8w8Q5RkTklwQuzunq8w8Q5Rk9dga#!a'!a=#a0!:+Tb*b@aO.a4!aba8aFJv^}?!VyR~Dr<g;u%Rn.~<5p[x'e`wNZtR@3p]Pw:5pZhNvjBp.woe_g5u-r4JwF!%DtO3:ooc7&!#:p^3DtpLuGw(!+%)Dtk6Vz#2sd=<r8d'#Y([y#<x3gJt`w@!)%}MRiowzikRij=]ilxAf3,U(#B2Rf#g0v-Rm[ck{`U#]giKv3>)!&6Ri154s,KuGB_%@r68r:dJ|t`#X(9<E|u2@H|rx3gJu?w'!+'1Nu7Reg4=H~+9<wxgY95Rm]xLggZ-`(X}U2:Ri4h<uOawRmsJv__5@bb{jbV~3dka#a'a]!,#a+U=a>b6a3b%!/aKa/)!arwve^VyJ;:pR~DpTg3uJpS~<5pOPw;5qmPw:5pNOu!5pQJvG'!6Vyx=<qoJvA!{~Jup!%@qk7Rn/KvyD!}''[xz;>wkh'?Rh,x8gyt`w5D!&),(SgyccRgztJ@3pPB5p#d'(Y#<]mmifubw&RgoJvE&!82s^JvF&!8Rf,ADb]~;x=h'rNu]vK!,%'*0RnORh)4Rh*AqQg-vaRnNg;wHwkh'ba~4cE#Ta*x3gctyw@'!+%RnFRnD<4Rn@hFvK5RnCxWg[#`&a0Ua()`1Rm75Rg[c]%X#qi8Rg^NvdRj>BwzgZauwji7Rm6A4wgg]d1#&(*,.0a#Rm;Rm<Rm=Rm>Rm?Rm@RmARmBe%#^^^Xaea?aC/b+(,!a+a#!a/!>a&Ta<aKbD!2wphBRnk[yPw}hE|.=Br-3Dtm>6Vy~g6urRf.x,hPrNav!%'RnqRo%Ro#Nu;q[Pw;5r+JwNZtM@3r)d'#Y'Weh;xChL#`&RnmRnoKu}>%(!Rne~Bs-;2wjcussJv+'!aYSO}6@B<5?ba~8LrNvj!.%*ROwungw~ng~:9;Ri^>wtnig;wHRnixDh@|(UZ.x1h@|)!#:2<H|*xHn]#-UX'3Ro)z=iT}6ARns=Bwsn_wpnaRncw]aR(#UXa&Ua*a/=]iPd'#Y&Ro'WnXf{QRm2hNvj]nZd`'T~&1`{|`#9b]{}c:'!#Wl{>@=be}]?cl{{U#:5Abb}Jds#^YaF!a*b4a#a3aPa>&Tb!bH!*a_!Eau?/a&RjY<]gj>6Vz*;:pe~DrZg,QRj1JwNZtX@wihspcJvZ&!VyX9WmOJu|!|N2WmHJvh&!]ht~Bpbcn&T(!#RmQ<s7Nu;padH#X'`+WmJ@>RmKCARhnKup=!)&Wf+:RhqNuPpf9c!#'45pd5AwghpARn(Ls@w!%,)!RmP@Wfe<E|IJva!&WmNg8vsRmLd`*.`#Y'Xa!axRn*]hrA8Rhug5s@rXg8u!RmMd8#X'X*3@rV72smdI*#UY&RmICARho~GsgxVgd)Ta'U-Y&Xa!T#RnEWnA@Wffg1uDRi0hFvK5RnBxGnG&#`%owp)@wsf+bX}Ze-*1!a*^^^Ua|!#a.aq&Ya2!a>.a6!a:aO`aJDtL[y`@Wg#>6Vz12@wzoYRoZNuPRi!NuPRhzg=ucRi,@=b`{Yg=ucRi-ACJvB!&Sh[ebSh]ebi`wUuFRm4Jw2_[y0JvB!.<Ju(!&SoG}6Shd}6<Ju(!&SoH}6She}6Kur@._g5vHRieJvx!{L2G{Kx6gd'T#?Rh82Wi5cZ#X(g1w)Rm5dW-Y(Ta#!a)!#aYa=wnfE=su2>>bU{0j9udv:<svj8uQv-7RgHdE%#^'sq9sp=>Bb_{TJv`!&g/r|snj6v(us5d,#Y(56H}[978H}]Jw5!&g1rushJvB!+j;v{u5?zDhd}6}bj;v{u5?zDhe}6}ce*#`(^^^a[aea!=!a6a*aoXb1a.!aAbL!b>,b'aL!aV@Wf|2Wlg3[y/JwNZt^@3piPw:5pgJunZou3@rsJva&!Vy_g<v~Rm#JvG'!6Vz0=<r{Ju{%!:pj@WfsiXuJu3Rm:JvZ&!WfA~Bph@c4Z&Dtwax5rubx(#:awRk1@d,#Y&RfjRfid1#,Y(@Wfp2Wlrg5s@ryKu[@!,'=]ig9wlk?Rk>g5u-rqJvy'!@9RkQcH(T#=>Ri~@<wkj(Wj(KuZB*!&<7rw@9RkRcH(T#=>Ri}@<wkj)Wj)dg(Ta2Xa9X#`-!a*CARhg@@=I}d9x;c~#X%so=<sj>2@@=aybb}XjWv0Q~EfEj3vLv;<d,#Y(56H}`978H}_dgaPaFa'a/!#a3Y0a_a;a|!1(a7-[yE3[xt;:pJNvZrrg3uJrvJwNZt=@3pIh=rt3rxPw:5pGOu!5rpJvG'!6Vys=<rz@c4Z&Dt(ax5rtJvZ!&~BpH@wsfNg-vaRlNci*U#=<wei<F}a5@Jq.!a*JQ!%@qZ23d(#Y&RjH5]jCk!u7w&u0udARjFd/prq=tyvpaEa(a:.!a1aZ(@@=I}:9wpd%=<sX55w_h}@@=I{t=ay<aU@@=I}T=ay<2@@=I})?C9:9au@9Cb]}DP~=x-fAZ(2Wl1=ay<aU@@=I}>5@d##Y+jTv|vV~EfFj]uNpn~FRfGdgaK!Z2&!a8a-Tb({E!acTbM*!a(DtY[yYd'%Y#sl[y*hHvh>Re5x2c{Z}.j4uCvcawRiMd+#X+_x&d!},<5RkX;2Hzw@x,gavfB-!{CcF&T#Roe;RodwWbBg5urRgaKvHC*_6Vz+<4opieuew&Rmq@d]&Y)X,T#X0Rh}<BqP=4qS9:ReMg/ujReNJw0!/<Jui%!bd{kawwnemRelAxUa?a3#*.&UX(Ya+a/RhvRnQ<o}9Wmtd-#Y&RgSRmw9;Rmxay=Rmyg-vaRmuxEhSrNu,v-voC!%(aR.a(a7+1Ro1>Ro5CE{A9b]{@;5x#eO{:g;urRi+KrNA!%(Ro3>Ro79;Ri_Ku@>{;&!x%gX|{KunA_+g5QRj/g3u5Rj#g>uERj%wio/xRhS&!,!#^1U}wba{8>>@=be}qC@:D5ba{7Ku+A&!}x?ba}t>>@=be}se(aA^^^Uat!b0#{pa+awUazbGa#aLb9bgaWac'a5TbS=Br!d1#`%scp_Jvl!#rT>Re0JvX&!VyN=H{Fcm#U&:pY=ReaJv2&!]h0=]nUJvG'!6Vy|=<r%JrM_=]h2@Wlud'#)U'Wf'b]{i=]h/Jvh!&~BpWg=v]RnMx+ny#'Nu;pVwjnu=]nwxJnx,T#`&Reqwjnt=]nvieu9vrRjLLuYwP(#+!th@wih5pX~Gr'g5v/Rh4KunA'!-CARnP@wwiN:Rm_9x'cvw>!|l=<saKvAA!0&3@q}>w^e1bp#&Re2Re3BDx7gH#T|f5H|eKuZ>!%(:qNAH{]Jv6!+3B2B9=b^{X<5<B92:E{ZLvhwA(a;a%!igQuyRmad+#Y}m@3Rh5d8#X'X*:AqUAHzmaxwbh<aXRnVcF}RT#Nw&cj#U(BWnug/vsRntdka)(a3+.Zb7aYYan1!bVa@Xa}[y^@b[{G=H{+hFu73Rj&Pv#5ReQcK%T#sig1v{Rj'Ku+D#'!t]~Grm~?rkKuMB!01d5#`'Vy.ta3Dtu~Hroc8#'{^45s85AwZbP&!#Rn!wghxWn#KvEA!)&2RlA2RlBx:h|#(T,=]j09Wobz>x]z/@awRoTd+#Y(az]hFhCrm4d,#Y+jTv|Q~EfMj]uNr|~FRfOdCa!Xa9_X#@<plJvf!%b`{(9;Rgwc;.!#2x7cw#T|UDb]|T5Ju={(!=@E{&Jv)&!Ab`{'awJvf!~*>>@=be{#KuY>!+&4Ezyi[ugv&RjIdea+T)#UXa&T-T&a!Rh9auRmW=]kLg5vuRn+g3u4Rn-Ow6ARn,hHus5xNk?#UX(U~)/g8v0RkD~AwkkF?Ri.OuNBwkkA?Ri/d|a2`a*^UYa.!aBTZaTa'Xa;!(!2!-a#b2[yC>6Vyq3[xr2Wi?g1rusVh%s?DtF~<5rbJs;%!DtBfswKtCj[uvuSsEu3RgVx3o:u+wN'*Zt;@3rd~Grh~?rfg8w)Lq)qE&-a%!>bI|`jWv0vV~EfCjTv|vV~Ef@j]uNpn~FRfBcK#T']gWNu7x,k7q4ai(0!hHv8<RhmkMu9vrsBuev/RhlCJvB!,g<v{wchh~@:Rhji[vrv{wchi~@:RhkdS&a5UY#Ta!RgPwwiI5BwciI~@:Rh`x'iJvj'!5]iJPu8Bwch]~@:Rhach)U#h3rp]gLh@t|Ax,hTq3ah!-(~@:Ro0Ou!5RhXj^v(pyw8unRhVd|)`,^UYas!a?/a2Z'a^Ta{Tb7Ta(a#!a,Wf&9sZ3DtAadamov=Bqt3[xig8vsRm~>waiL2b`{QJv*_Ouv2qgj<v]v2BqfdR'X*X#Y-@3qr~Gqv~?p6hHv-]glPup5Lq+q?_%*b_{qF{n9b^{rOu4ARhpKvCD!+&~Bqp:5Dbb}nwoiKl&unuTuBv]v+ueunaXRf0=Jvh!0nKufu8v1w&w7q%w&uHrz:Rgnj5w,uxDJq/(!hNw'5ReCk0s2u3w/w'5ReFd>Za&!*UaA=<wkgsRnSJv^!%Refifw3vyRgOKu_B'!,<]gkiiu:w&Rh<=C@a^<B57@2F{[<B5@aW:=3away9A5aW=<B=C@a^<B57@2F{Ie-#`(^^^bCara.b8aza6!/bZ,!adTbnTbOb+aFaS!aAT9@Wf~2Wli3Dtl2@d,#Y&RfnRfmJwJZtN~GqyJva&!VyMg<v~Rm%iXuJu3Rm9Jv[_=]ih9wlkDRkCd1#`(@Wg>2Wls3cH#T(@<Rj*=>Ri|b~'#23s9h<~El.d'#Y&Dtxi^rzvdRl#d*#U%(o|B2s`hJwSaxRmDKv4B&!1:Rmdd5#`'Vx}to~Hq{x'f1v3(!BA5ba|bJv_&!Wfug1v]ReIdO+U/Y#&G}-8wze=Rh{g1v]ReHg/uQRf/by#)ibQwERl/cH#T(@<Rj+=>Ri{cNu+vlax-!(#a0qa9<Rii2;;bU{H;x<i=&X#Rk`<4wwi=C9H~8xAI(Y#<azRi@45wXI<B9;5bb~7dL(X#Xa(+!aL6Vy{g5QqOau:5au2@ay547EzbxOcU(UX-T#Ta#:Cbb|A?wjh/b_|SOw6ARgtihr}u7Rhy<d1#T)X1@@=I|~=ay<2@@=aybb}Sj3vLv;<d,#Y(56H}A978H}@dGpvs@uAu`vcw9*!aFa+ai%(b!aXa8.a?a[ozWey=sU2@G}Nch&U#Rf_WexKu+D#'!t:~Gr`~?r^j]uNr|~FRg*j^psurwJt|RmcKv)@&!)7Rkv~Br[@wxfO:Rl3co#U'6Rezj_q#vIuavjRltwzeyh@vr5JqD0!>aY?C9:9au@9Cb]}9cl#U*5;5<H||jbuus1ucv&Rfvg1v~d/pppzqFr^a--a~!aMat1(hFv;Wiz@@=Izoj5uuv-7Rix~Cw`fk2WlVcZ#X,k)u3vWs@u2]ktg;wEx'fBq(_2Wg/jTv|vV~EfoJv]!15x'hzqG!(P~EfU~CRl_j6v(us5x4i-#T(2WmZ?C2F|d>Kq<aj1!*jTqIsBv=Wl`~Cw`fi2WlWj`v0u*~>RlR=c>Z,k#u3vWs@u2]kr<c1Z+jTqIsBv=Wla~Cw`fm2WlXdmb3!a{(arZa`bkTa%TbQTa-a9+c'!aM!/[yL=Bqug.w'RifhFvyDRj.g>vgwyk^9]k^Jv3_@WfbAARkhJw2_[x|JvB_wkoIRoKwkoJRoLd'(Y#<]gm=<9<H|yd'%_X#skDtb3awwqkgNulRkgdB#^',9:p'hJwSaxRmEBwVb8@4=H|qLu+w50&!)@3qs~?pU>Awwn;;Rn=c:Z'ARn<=<qwKvC@!/&~BqqJv6!&]eVb^z^xRge'/a%+^`#Sge}6<4Rn3=]n0Pw2>Rn8Jw0!&>Rn:>Rn6cY#a7+!a&=<wkaNw~h3z_c5Z{=wjh#=]nLKv^D!&)Vyz=bW|swYb<WetcG#T(2wxa@qVx@gD#Y&b^|V5JwG&!5bb|pg/w&RgD@x=kHs=uAvn!a%%/'+RmSRh694Ro`g-vaRmRhHv-]mlxCcS#`&ba~.5cD#Ta)P~=d,#Y(56H{>978H{Dd_#{2^Y%_+qbbb{6g3sERhsbU{?dfa.,`a(Xa<!aiX#(55RiG54RiHcI#T'WiU3RiVNvdwtfcRlKNvdd,#Y&RlHRlExQgf.1*^T'X#Sgf}6Wn4=]hfPrk>Rn7Jw0!&>Rn5>Rn9Lunw?&a2!,5<oq@@wqfdRlJj5Q~=d,#Y(~ARfcOuN]fdDKw;ay(}i!547E}j?cI#T(@5bV}iCbV}hdv(^^Tb?a40,b##Tbo!a*bR!a<b|a/!aKai!aU[yK=]o^g:v>ReGJwPZtK<7Rh+h<~El,Pv#5ReR@awwxjCg,ulRjDJv6&!]j!z?aQeeg>w=Sh<eeJw;!&axEzOg,Qosc!#*:wkeJ]eJ>x'h-u(!%Ro.w~h.zPdNZ(X,Ya![x{;9ReY;wkgxRiF:x?ap#Y&RmUg<s2Rkod]+UY0TZ'!a&A9sw<=bczLNvuw{gqzNhJwSaxRmCKuLay!#&s_Rf-55b^{uJvZa!!c%#(55Ri654wmiu5RiuawLu,vp!+}^%b_}Y9;wkgxba}o>A9:=b^}zKuh=a''!3awRk3c*'!#aHRk6c+Z&Rk5Rk4Jv)&!awRjSawd9*`#0?C2@EzMj8u<uJ5RmbjQrquJu3x,k>uq@_+=ayb^|W~ARkEOuN]k@7dhzV^X/X&a-#zRzSb`zXcJzTT#2WkVKvDBzW!%FzY9;5bbzWjQrquJu3Jw3%!b`zU=ayb^zQd:#X(T-a!6Vyywxh}=b]{Jg=u1RiAdGp~qHtzv!w(wA+a+a;<!aJaYai'anasb(=azRmV:Cbb{MLq2vb!%')RjuRjrRjtRjqx3jnqCw3!%')Rk(Rk+Rk&Rk)Lq2vb!%')Rj{RjxRjzRjwLq2vb!%')RjsRjpRjfRjex3jcqCw3!%')Rk'Rk*RjkRjl9<CbbzfOu4ARhxLq2vb!%')RjyRjvRjhRjgx=joq*uKvb!%')+-Rk.Rk%Rj~Rk-Rk#Rj}x=jdq*uKvb!%')+-Rk,Rk!Rj|RjmRjjRjidAq&qKs@uAv8Aa.'*-a@a&0!aM@a5[y73Dsy3Ds|3Dt):wxgI2sHJwJZt.~Gqxwsf0ikrzt}Rl0Jvy_[xj~HqzKv_A|D!&WfP8axRoVcf,U#k(v]v+ueunaXRf1Ju}'!g8u#Ri=jQw!sCunLprq>!,')~<5qeGzq9F{W=c##%s5au:5aU3CBE|;d4#X(D!a&6Vygx(b;#(=]ed?C2F{N<capoq2r[a&!aPa9,'Pw;5s:@@=I|,55w_h|@@=IzcP~=x'fCqB_2Wl2>aU@@=I|1OuNBc1Z+jTqIsBv=Wlc~Cw`fl2WlZ~AcTa%!Z+jTqIsBv=Wlb~Cw`fh2WlYk+uNqJsBv=WlSg,u3dca3#UXaMYa)TaB-=cM|7T#<bI}l5@B932:aV2G{BOuNBJq:|M!5Ezt=<B=C@a^<B57@2F{v>cB{/T#=ay<bI{3Jv6!a.6BKq0ah&+!5E}HP~Ef{978BaU@@=Iza<7d#.Y#978BaU@@=IzH~AJq0!(@@=IzG978BaU@@=IzFe,aU*Y&^^^bvJb,b:bFad!a,c2Ta>aL.bo6!a#CbTa'T#Re{2Wlh2@G{yg6t~Ro_NvdRfticuRQRllJv3&!x&c|zs@Jw3!%RflwpfkRlpKuL;%(!Re<@G|C2GzdhIvuBwgjAg-u0RjAKQB%!(GzZ@G|5NuuRl7d='T+Y#Vy[g<v~Rm!==G|>JvA!)@wma=]m1ifuaw&RmnLs@vT'!|/+[y,g:v>ReTJw1!#qX=x!eC{bLu+wT&)ZtZauq_~Graci&U#F|89:r_Lupvq!.)&2RlG8RfaC=x!eF{_h?rpWlmd&'!#X|&]k::xJey#`'T|+<E|&2@H|%dE#(^,g;u.RiEg6vjRiC9xCkA{O|zY#g=ucRmXKs0@!&*@G|m@awRknJuh!,3d(}gY}eJvj!%Rm):Jw3!%Rm+Rm-Ls0w(&!a(a#@b[|6cZ#X'7RkxWgAOu4ARn'dH'U#Y*Vz-Wm'CARm}d]*#a%^a*T'aK!a<9bV{PC=p*Jw4!&SgxcbB5r]idw(wBRmF7xFkt#&`(Rm/Rm8E|!JuY_9:Rl5=wrgr2:bbxd@xXfB(a*#T+!.X0X1Ta/a'T&RlDRfL>RlyARl9b[z[>RfZ:RlL:RfRwlg/ARl;9;RlxKv,A/!%7s69<74=BA5ba{-8Bde#`a<XaKYa1,a'P~=wxfB2bZ}}?C972@@=I}r8@55B9;5bb}G978B2@@=aybb}3j3vLv;<Jw3&!>Rfk=ayb^}4~Ad1#`*@@=aybb{w2@>==<bbz]dx+UY#^UaF!a9!bB'Ya1.!ajXa#%olRhD[y=3Dt#Ov5BrHKuMB%!(Rf^Wep~HrJwkiQjKr|~FRg)Ku+D#'!t5~GrF~?rDdV)UY,Z/_7RkuG{<~BrBg,rlsO:235B@bX}|d?a1!#`(6Vyn5@d##Y+jTv|vV~EfIj]uNpn~FRfH7Lq2vb1!a9-978BaU@@=Iz9978BbU}#~AJq0!(@@=Iz8978BaU@@=Iz7~AJQ|}!978BbU}!JvkaK!AdUa21-U#`a+(g/vsRn~Ou!5RPj:rmu9WhOjXuvvNr}:RhAj^v(pyw8unRn[kPr}p|u7vwv]RiSBd;pppzq@qHQa?(b.!a.a`@.|xa(hFv;Wiyj5uuv-7Riw~Cw`fg2WlU978BbU|wOuNBJqG!(P~EfD~CRlQcZ#X,k)u3vWs@u2]ksg;wEx'f@q1_2Wg.j]uNpn~FRfqJv]!15x'h{qG!(@@=IzK~CRl^j6v(us5x4i,#T(2WmY?C2F{1>Kq<aj1!*jTqIsBv=Wld~Cw`fj2Wl[j`v0u*~>RlT=c>Z,k#u3vWs@u2]kq<c1Z+jTqIsBv=Wle~Cw`fn2Wl]dn1#c(a(b^a2!b/bAT(bj!aDa7bu,a_a{c0!2T0g:v>ReD2@G{42@G{5~DpM~<5rc=Bx6i>{RT#RnI@zCx]y]z:2Jv[!zr5Awyk]9]k]dD(Y+X#6Vz.g=wKtgwhaCwgmTWj2Lu,w%_+/[y-B;b^xeg3u3Rj-2@bX{*KrJ<!+'@Wg(g?QRlC@Jv`!%b[zIwsfII}8JQ_@w|kW|=Jv(%!AqcOuNBJvEzh!bYzjLs@wP#(0!oy@>RkdJwMZtc3Dtd@BcG#T'9bWxg2@2Fznd*#Y+;2x'c}w<zizixNgwa#Z'U+!/!a'!a+w~g~z6wcn{Rn}wcnzRn|5Rh%=]nJg5vuRmvNvdRlvcprJu}w*az*a#!%.a.'Bot9qT]kj@Wg'ay2Gzv@Jv`!%b[zEwsfHI}1;ck#Ux`<Cbbx_Lu+w!a&0*!wko*wwo,So,}6Juqxf!E}PigQuyRm`d3(`#8>Rn%:A5B;bZ~%KvhCa!a2!x>k7#Uxb@b{#xaRk7Jw0!)>wwhlShl}6>wwhmShm}6CJvB!.x'hhvj{!!5Bwkhhbaz}x'hivjz~!5Bwkhibaz|xEhTrNu,v-vpD!a%&/)a3a.,%Ro2t[CE{)@3re9b]{%wjo09:rgc:Z&Ro6=<riifuaw&RmoKrNA!%(Ro4>Ro89;Ri`dSaL'UYzxZb)7Rka3xRhT&!,!#^1U}vbaz{>>@=be}yC@:D5bazzKu+A&!}{?ba}y>>@=be}wxBh[t`u~vJvr!%a!a()a,a0a4RoC=]o;Ju(!%RoGRhdwjh`=]oAg>w#Ro?g5vuRo=NvdRl|Ku]C.!&;RoEJvB!%RoORoMBx'h[v+_?w~h`}~5?w~hd~!xKh]oiptu-utv.vp!#%&a30a@a'a+(a/aOp(o~p!RoDJu(!%RoHRhewjha=]oBNvdRl}g>w#Ro@g5vuRo>c[#X']o<CauRoRAd-#Y':RkpauRoQKu]C.!&;RoFJvB!%RoNRoPBx'h]v+_?w~ha}t5?w~he}ue!/UbhYacXaW^Tc&a;b:a-c/#b&aja1(!cL+!bKbt!bmcRc9aIc?8[yW3Dtt94Rg`Jv}!&SiRMzBhEebShEMNuPRe>x7gL#TzuwjirRipc<Z&>on;>z=h-MSh.Mwqczx'a7vj&!>Re4@=ResJt__NuPRi*NuPRi)j]uNr|~FRfzKrJ>_+@Wfy@Wf]2WocKrJ<!+'@Wg%g/QRl@@Jv`!&awRl<wsfFIzgLu(w*!.*&ShBMwvhIRhI9;RhNx1hK'!#Sn]Mx1hK~0!#:2<H~7cNu+w7D*'1ZtW>Rn1~?rOc:Z&Rn2=<rQ<7wjh&=BSnLMc]#X(6Vz)w[b=a!U#9wzgMc3#&(RgMRitRis<x,gKt`ax!&+SioM=BSilMc3#&(RgKRinRimKurB,!&SiQMzBhDebShDM6BJQ!(P~Efx978B2@@=I}WLrJw!!,a*&@G}O@9wkibRid@@x'fKwC!&SlDMSfLMjUv~Q~EfKKv3@a+!(hFv-]mpx/hYZ(C5RiWz<o/MwkhY?So/M@x,gbvfB*&!SgEM:SoeeehFu3:Rgbda(,^TZa)X/7Sg[eb:2RgI~BrMC@wgkc:wwkcRerx3h(uUvK!&*,SnOM4Sh*MArRg;wHRh(x=h;rJvPwI!a4',a'0@Wg&=BSh/Mg>w=Rh=g3w*wwgGRgGcW(X#;Sg}M2Gzk@Jv`!&awRl=wsfGIz`dKZ*T'Y-:RhR7RhQg5u-p`j6v(us5d,#Y+~Awkia?RicOuNBwkibba}Ld6p~tyu_vbAa'a+!a/'a3aEa8a!>Sh,ebJv{!&Sh@ebSaReb9;SgwebNuPRi(NvdRl)NuPRi'hHu^<Rm^Jvv_@Wl(g;u1Si/ebKu'B&!*Sh?eb@Wl'z@aPeb95Si.ebcpputyvjB)!,&a+0a%ShAMWeK@G}C@WfJ9;RhMwvhH9w{ia}ix,hJvRA1(!zAn[MRhHx1hJ~*!#hFv(BSn[MBJQ!(@@=I~'978B2@@=I}2db.Ua<'X}+T#a0XaG2G}E;wkg|wuh!Rh!x,hZu,@)!&So0MVy)C5RiXACJvB!&5RiY5RiZg8w)cG}*T#2@bU}=KsA>(!a.3wkhZba~(x,h^u(A!&(SoCMRhb5Bz=h[eb?w~hb~6x,h_u(A!&(SoDMRhc5Bz=h]eb?w~hc~6e)aA1T#T,^^^c-bMb&blcPaP(a/!0!bA=b5c@a(!bfbrc#2afwmhARnjwchORnp2Wlf3DtsNvdRl-2@wpa<]m0bx(#:awRk2@Jw3!%RfhwpfgRlnKQB%!(G{V@G|'NuuRl6d='T+Y#VyUg<v~Rl~==G|<Jv+'!aYShC}6@B<5?ba~8@Jw3'!g2QRljhLrpWlOd+#Y'g.w'rIg>w*wgj@g-u0Rj@Lu+wT&)ZtUauq]~GrGci&U#F|39:rELrNvj!.%*RhCwunfw~nf~:9;Ri]>wtnhg;wHRnhx3hDs@v~!/+'@Wfr@9RkSNu&Rlo=@<5GzoKs0@_+@Wl+@awRkmJuh!-3d(}pY#qWJvj!%Rm(:Jw3!%Rm,Rm*de&!1U-U#`)Re;@G|.@9Ri82@wjfvRlq=@<5GzpLvOvr!).&2RlF8Rf`C=x!eE{.Jw3_g2QRlkhLrpWlPde(!#U{s,UXa*Ta'[y'g:v>ReS;x0PZ&RnlRnn~HrKJw1}f!=x!eB|2w]aP(#Xa&a*Ta.Ua2a7=]iOd'#Y&Ro&WnWg;u.RiDg6vjRiBNvdRlzhNvj]nYJuW_2Wm3x)kFze{9d])!a.!,Y01!#&aC!a3RndC=ox~BrC@2b^{pg,rlse7x'ksuq!%Rm.E{xidw(wBRmGx9o+)X#wwo-So-}69:Rl4@xSf@a#XZ'X)X,Ta(/ARl8b[xc>RfY:RlI:RfQwlg.ARl:9;Rlwdn'#^XafaQa1X1TaHTa)@b[{zcZ#X'7RkwWg@Ou4ARn&x)kG#{,g7u/RkGdH'U#Y*Vz'Wm&CARm|bx#(A]gUbUzJj9Q~=d,#Y(56H}l978H{U7d,0#U*2>ABb_xZ978BbU{e~AJQ{g!978BbU{hxMh?ad{oUYZ.x1h?{l!#:2<H{mx3n[t{vl!,&a%3Ro(z=iS}6ARnr=Bwsn^wvn`Rnbd`*T}B0!#^X'BG{c9b]{a>>@=be}F?JvS!&BG{d7BG}(Bde#`a1X,Ya@!a'P~=wxf@2bZ}I56B2@@=aybb}08@55B9;5bb}<j3vLv;<Jw3&!>Rfg=ayb^}&OuNBKuLA!)a!P~=x#fD{f2@>==<bbzl?C972@@=Ix^d6rSu,v7w*C(0a)a6#B+a%!sQ[y?3Dt%3[xn~<5rLOu!5p@Ku+D#'!t7~GrP~?rNKvlaya7'!h+v-5qMg=t|cd,U#5AAaa5Abb{S@52B5@a[@52B5Gx[iXueu;d<#`a(!/549C;ag>23ExY5@Dah89b^~689Jv)!~2b[~1Lv'w(%*!a#bX|aPrmawRe]keu7uhv-q6rxu,q`xTo]/a5aU!bNaDXbi!b-!ao!b<bwA!#5@B932:aV2G|:d-)Y#hJrL>RhG<7@C5<H|_=Cau:5aj5@B932:bJ|ng>vIbs)#?C2F|9jPv0w.vISh-MKvUaz(.!9ABbb|[5;5<H|Eg>unwfh;9:4E|YjQsBt|vjx'hYq3!(?C2F|J:2<BaY?C2F|GOu!5x,g|p{ah!-(?C2F|c9:4E|OjXuvvNr}:Rh&i[w*t|cd+U#jJvsu)vsSn~Mkfrmu9p}u7vwv]So!McW#Xa!ax5@A5aY:5;5<H|>kJv~vYrquJu3x4ib#T)2@SmZM?C2F|Bj:rmu9@xPhI(a*a#U#`a3-5Abb|L~@:RhK9:4E|0@52B5G|#C::aY?C2F|-:2<BaY?C2F|.5Jvk!a)javYrquJu3x4ia#T)2@SmYM?C2F|HAxPhH(!a#U#`a*-5Abb|4~@:RhJ9:4E|R@52B5G|F:2<BaY?C2F|Sc^#Xa2j=Qq5CJvB!-g<v{z;hhM?C2F|Zi[vrv{z;hiM?C2F|XKsA>!a)-g<v{z;h[eb?C2F|]i[vrv{z;h]eb?C2F|^iZu.vix,hZq3ah!.(?C2F|QOu!5ShXM:2<BaY?C2F|P", 13494, 2713, 49, 25, 61);
      var T;
      (function(e2) {
        e2[e2.VALUE_LENGTH = 49152] = "VALUE_LENGTH", e2[e2.FLAG13 = 8192] = "FLAG13", e2[e2.BRANCH_LENGTH = 8064] = "BRANCH_LENGTH", e2[e2.JUMP_TABLE = 127] = "JUMP_TABLE", e2[e2.VALUE_MASK = 8191] = "VALUE_MASK";
      })(T || (T = {}));
      function E(e2) {
        "@babel/helpers - typeof";
        return E = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(e3) {
          return typeof e3;
        } : function(e3) {
          return e3 && typeof Symbol == "function" && e3.constructor === Symbol && e3 !== Symbol.prototype ? "symbol" : typeof e3;
        }, E(e2);
      }
      function de(e2, t2) {
        if (E(e2) != "object" || !e2) return e2;
        var n2 = e2[Symbol.toPrimitive];
        if (n2 !== void 0) {
          var r2 = n2.call(e2, t2 || "default");
          if (E(r2) != "object") return r2;
          throw TypeError("@@toPrimitive must return a primitive value.");
        }
        return (t2 === "string" ? String : Number)(e2);
      }
      function fe(e2) {
        var t2 = de(e2, "string");
        return E(t2) == "symbol" ? t2 : t2 + "";
      }
      function D(e2, t2, n2) {
        return (t2 = fe(t2)) in e2 ? Object.defineProperty(e2, t2, {
          value: n2,
          enumerable: true,
          configurable: true,
          writable: true
        }) : e2[t2] = n2, e2;
      }
      var O;
      (function(e2) {
        e2[e2.AMP = 38] = "AMP", e2[e2.NUM = 35] = "NUM", e2[e2.SEMI = 59] = "SEMI", e2[e2.EQUALS = 61] = "EQUALS", e2[e2.ZERO = 48] = "ZERO", e2[e2.NINE = 57] = "NINE", e2[e2.LOWER_A = 97] = "LOWER_A", e2[e2.LOWER_X = 120] = "LOWER_X";
      })(O || (O = {}));
      var k = 32;
      var pe = 21;
      var me = 2097151;
      var he = 2047;
      var ge = 0;
      function _e(e2) {
        let t2 = e2 >>> pe;
        return t2 === he ? ge : t2;
      }
      function ve(e2) {
        return e2 - O.ZERO >>> 0 <= 9;
      }
      function ye(e2) {
        return (e2 | k) - O.LOWER_A >>> 0 <= 5;
      }
      function be(e2) {
        return (e2 | k) - O.LOWER_A >>> 0 <= 25;
      }
      function xe(e2) {
        return e2 === O.EQUALS || be(e2) || ve(e2);
      }
      var Se;
      (function(e2) {
        e2[e2.EntityStart = 0] = "EntityStart", e2[e2.NumericStart = 1] = "NumericStart", e2[e2.NumericDecimal = 2] = "NumericDecimal", e2[e2.NumericHex = 3] = "NumericHex", e2[e2.NamedEntity = 4] = "NamedEntity";
      })(Se || (Se = {}));
      var Ce;
      (function(e2) {
        e2[e2.Legacy = 0] = "Legacy", e2[e2.Strict = 1] = "Strict", e2[e2.Attribute = 2] = "Attribute";
      })(Ce || (Ce = {}));
      function we(e2, t2, n2, r2) {
        let i2 = (t2 & T.BRANCH_LENGTH) >> 7, a2 = t2 & T.JUMP_TABLE;
        if (a2) {
          if (i2 === 0) return r2 === a2 ? n2 : -1;
          let t3 = r2 - a2;
          if (t3 >>> 0 >= i2) return -1;
          let o3 = e2[n2 + t3];
          return o3 === 0 ? -1 : n2 + i2 + o3 - 1 & 65535;
        }
        if (i2 === 0) return -1;
        let o2 = i2 + 1 >> 1, s2 = n2 + o2 + i2;
        for (let t3 = 0; t3 < i2; t3++) {
          let i3 = e2[n2 + (t3 >> 1)] >> ((t3 & 1) << 3) & 255;
          if (i3 === r2) return s2 + e2[n2 + o2 + t3] & 65535;
          if (i3 > r2) return -1;
        }
        return -1;
      }
      function Te(e2, t2, n2) {
        return n2 === 1 ? String.fromCharCode(e2[t2] & T.VALUE_MASK) : n2 === 2 ? String.fromCharCode(e2[t2 + 1]) : String.fromCharCode(e2[t2 + 1], e2[t2 + 2]);
      }
      function Ee(e2, t2, n2) {
        let r2 = t2 + 1, i2 = 0, a2 = r2;
        if (r2 < n2 && (e2.charCodeAt(r2) | k) === O.LOWER_X) for (r2 += 1, a2 = r2; r2 < n2; ) {
          let t3 = e2.charCodeAt(r2);
          if (ve(t3)) i2 = i2 * 16 + (t3 - O.ZERO);
          else if (ye(t3)) i2 = i2 * 16 + ((t3 | k) - O.LOWER_A + 10);
          else break;
          r2 += 1;
        }
        else for (; r2 < n2; ) {
          let t3 = e2.charCodeAt(r2) - O.ZERO;
          if (t3 >>> 0 > 9) break;
          i2 = i2 * 10 + t3, r2 += 1;
        }
        if (r2 === a2) return 0;
        r2 < n2 && e2.charCodeAt(r2) === O.SEMI && (r2 += 1), i2 > 1114111 && (i2 = 1114112);
        let o2 = r2 - t2;
        return o2 >= he && (ge = o2, o2 = he), o2 << pe | i2;
      }
      function De(e2, t2, n2) {
        let r2 = ue, i2 = e2.indexOf("&");
        if (i2 < 0) return e2;
        let a2 = e2.length, o2 = 0, s2 = "", c2 = r2[0], l2 = c2 & T.JUMP_TABLE, u2 = (c2 & T.BRANCH_LENGTH) >> 7;
        do {
          let c3 = i2 + 1, d2 = e2.charCodeAt(c3), f2, p2;
          if (d2 === O.NUM) {
            let n3 = Ee(e2, c3, a2);
            f2 = _e(n3), t2 && f2 > 0 && e2.charCodeAt(c3 + f2 - 1) !== O.SEMI && (f2 = 0), p2 = f2 === 0 ? "" : ce(n3 & me);
          } else if (be(d2)) {
            f2 = 0, p2 = "";
            let n3 = d2 - l2, i3;
            if (n3 >>> 0 < u2) {
              let e3 = r2[1 + n3];
              i3 = e3 === 0 ? -1 : u2 + e3 & 65535;
            } else i3 = -1;
            let o3 = 0, s3 = 0, m2 = i3 < 0 ? 0 : r2[i3], h2 = c3 + 1;
            trie: for (; h2 < a2; ) {
              for (; (m2 & (T.VALUE_LENGTH | T.FLAG13)) === 0 && (m2 & T.JUMP_TABLE) !== 0; ) {
                let t3 = m2 & T.JUMP_TABLE, n5 = (m2 & T.BRANCH_LENGTH) >> 7;
                if (n5 === 0) {
                  if (e2.charCodeAt(h2) !== t3) break trie;
                  i3 += 1;
                } else {
                  let a3 = e2.charCodeAt(h2) - t3;
                  if (a3 >>> 0 >= n5) break trie;
                  let o4 = r2[i3 + 1 + a3];
                  if (o4 === 0) break trie;
                  i3 = i3 + n5 + o4 & 65535;
                }
                if (m2 = r2[i3], h2 += 1, h2 >= a2) break trie;
              }
              if ((m2 & (T.VALUE_LENGTH | T.FLAG13)) === T.FLAG13) {
                let t3 = (m2 & T.BRANCH_LENGTH) >> 7;
                if (e2.charCodeAt(h2) !== (m2 & T.JUMP_TABLE)) break;
                h2 += 1;
                let n5 = t3 - 1, a3 = i3 + 1, o4 = 0;
                for (; o4 + 1 < n5; o4 += 2) {
                  let t4 = r2[a3];
                  if (e2.charCodeAt(h2) !== (t4 & 255) || (h2 += 1, e2.charCodeAt(h2) !== (t4 >> 8 & 255))) break trie;
                  h2 += 1, a3 += 1;
                }
                if (o4 < n5) {
                  if (e2.charCodeAt(h2) !== (r2[a3] & 255)) break;
                  h2 += 1;
                }
                i3 += 1 + (t3 >> 1), m2 = r2[i3];
                continue;
              }
              let n4 = m2 >>> 14, l3 = e2.charCodeAt(h2);
              if (n4 !== 0) {
                if (l3 === O.SEMI) {
                  f2 = h2 - c3 + 1, p2 = n4 === 1 ? String.fromCharCode(m2 & T.VALUE_MASK) : Te(r2, i3, n4);
                  break;
                }
                if (!t2 && (m2 & T.FLAG13) === 0 && (f2 = h2 - c3, o3 = i3, s3 = n4), n4 === 1) break;
              }
              let u3 = we(r2, m2, i3 + (n4 || 1), l3);
              if (u3 < 0) break;
              i3 = u3, m2 = r2[i3], h2 += 1;
            }
            if (p2 === "") {
              let e3 = m2 >>> 14;
              e3 !== 0 && !t2 && (m2 & T.FLAG13) === 0 && (f2 = h2 - c3, o3 = i3, s3 = e3), f2 > 0 && (p2 = Te(r2, o3, s3));
            }
          } else f2 = 0, p2 = "";
          f2 === 0 || n2 && d2 !== O.NUM && e2.charCodeAt(c3 + f2 - 1) !== O.SEMI && c3 + f2 < a2 && xe(e2.charCodeAt(c3 + f2)) ? i2 = c3 : (o2 < i2 && (s2 += e2.slice(o2, i2)), s2 += p2, i2 = o2 = c3 + f2), e2.charCodeAt(i2) !== O.AMP && (i2 = e2.indexOf("&", i2));
        } while (i2 >= 0);
        return s2 + e2.slice(o2);
      }
      function Oe(e2) {
        return De(e2, true, false);
      }
      var ke = /* @__PURE__ */ t({
        arrayReplaceAt: () => je,
        asciiTrim: () => R,
        callable: () => Ae,
        escapeHtml: () => M,
        escapeRE: () => Ue,
        fromCodePoint: () => A,
        isMdAsciiPunct: () => I,
        isPunctChar: () => We,
        isPunctCharCode: () => F,
        isSpace: () => N,
        isValidEntityCode: () => Me,
        isWhiteSpace: () => P,
        lib: () => Ke,
        normalizeReference: () => L,
        unescapeAll: () => j,
        unescapeMd: () => Le
      });
      function Ae(e2) {
        let t2 = function(...n2) {
          return Reflect.construct(e2, n2, new.target && new.target !== t2 ? new.target : e2);
        };
        return Object.defineProperty(t2, "name", { value: e2.name }), Object.setPrototypeOf(t2, e2), t2.prototype = e2.prototype, t2;
      }
      function je(e2, t2, n2) {
        return [].concat(e2.slice(0, t2), n2, e2.slice(t2 + 1));
      }
      function Me(e2) {
        return !(e2 >= 55296 && e2 <= 57343 || e2 >= 64976 && e2 <= 65007 || (e2 & 65535) == 65535 || (e2 & 65535) == 65534 || e2 >= 0 && e2 <= 8 || e2 === 11 || e2 >= 14 && e2 <= 31 || e2 >= 127 && e2 <= 159 || e2 > 1114111);
      }
      function A(e2) {
        if (e2 > 65535) {
          e2 -= 65536;
          let t2 = 55296 + (e2 >> 10), n2 = 56320 + (e2 & 1023);
          return String.fromCharCode(t2, n2);
        }
        return String.fromCharCode(e2);
      }
      var Ne = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;
      var Pe = RegExp(`${Ne.source}|&([a-z#][a-z0-9]{1,31});`, "gi");
      var Fe = /^#((?:x[a-f0-9]{1,8}|[0-9]{1,8}))$/i;
      function Ie(e2, t2) {
        if (t2.charCodeAt(0) === 35 && Fe.test(t2)) {
          let n3 = t2[1].toLowerCase() === "x" ? parseInt(t2.slice(2), 16) : parseInt(t2.slice(1), 10);
          return Me(n3) ? A(n3) : e2;
        }
        let n2 = Oe(e2);
        return n2 === e2 ? e2 : n2;
      }
      function Le(e2) {
        return e2.indexOf("\\") < 0 ? e2 : e2.replace(Ne, "$1");
      }
      function j(e2) {
        return e2.indexOf("\\") < 0 && e2.indexOf("&") < 0 ? e2 : e2.replace(Pe, function(e3, t2, n2) {
          return t2 || Ie(e3, n2);
        });
      }
      var Re = /[&<>"]/;
      var ze = /[&<>"]/g;
      var Be = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;"
      };
      function Ve(e2) {
        return Be[e2];
      }
      function M(e2) {
        return Re.test(e2) ? e2.replace(ze, Ve) : e2;
      }
      var He = /[.?*+^$[\]\\(){}|-]/g;
      function Ue(e2) {
        return e2.replace(He, "\\$&");
      }
      function N(e2) {
        switch (e2) {
          case 9:
          case 32:
            return true;
        }
        return false;
      }
      function P(e2) {
        if (e2 >= 8192 && e2 <= 8202) return true;
        switch (e2) {
          case 9:
          case 10:
          case 11:
          case 12:
          case 13:
          case 32:
          case 160:
          case 5760:
          case 8239:
          case 8287:
          case 12288:
            return true;
        }
        return false;
      }
      function We(e2) {
        return ne.test(e2) || re.test(e2);
      }
      function F(e2) {
        return We(A(e2));
      }
      function I(e2) {
        switch (e2) {
          case 33:
          case 34:
          case 35:
          case 36:
          case 37:
          case 38:
          case 39:
          case 40:
          case 41:
          case 42:
          case 43:
          case 44:
          case 45:
          case 46:
          case 47:
          case 58:
          case 59:
          case 60:
          case 61:
          case 62:
          case 63:
          case 64:
          case 91:
          case 92:
          case 93:
          case 94:
          case 95:
          case 96:
          case 123:
          case 124:
          case 125:
          case 126:
            return true;
          default:
            return false;
        }
      }
      function L(e2) {
        return e2 = e2.trim().replace(/\s+/g, " "), e2.toLowerCase().toUpperCase();
      }
      function Ge(e2) {
        return e2 === 32 || e2 === 9 || e2 === 10 || e2 === 13;
      }
      function R(e2) {
        let t2 = 0;
        for (; t2 < e2.length && Ge(e2.charCodeAt(t2)); t2++) ;
        let n2 = e2.length - 1;
        for (; n2 >= t2 && Ge(e2.charCodeAt(n2)); n2--) ;
        return e2.slice(t2, n2 + 1);
      }
      var Ke = {
        mdurl: x,
        ucmicro: S
      };
      function qe(e2, t2, n2) {
        let r2, i2, a2, o2, s2 = e2.posMax, c2 = e2.pos;
        for (e2.pos = t2 + 1, r2 = 1; e2.pos < s2; ) {
          if (a2 = e2.src.charCodeAt(e2.pos), a2 === 93 && (r2--, r2 === 0)) {
            i2 = true;
            break;
          }
          if (o2 = e2.pos, e2.md.inline.skipToken(e2), a2 === 91) {
            if (o2 === e2.pos - 1) r2++;
            else if (n2) return e2.pos = c2, -1;
          }
        }
        let l2 = -1;
        return i2 && (l2 = e2.pos), e2.pos = c2, l2;
      }
      function Je(e2, t2, n2) {
        let r2, i2 = t2, a2 = {
          ok: false,
          pos: 0,
          str: ""
        };
        if (e2.charCodeAt(i2) === 60) {
          for (i2++; i2 < n2; ) {
            if (r2 = e2.charCodeAt(i2), r2 === 10 || r2 === 60) return a2;
            if (r2 === 62) return a2.pos = i2 + 1, a2.str = j(e2.slice(t2 + 1, i2)), a2.ok = true, a2;
            r2 === 92 && i2 + 1 < n2 ? i2 += 2 : i2++;
          }
          return a2;
        }
        let o2 = 0;
        for (; i2 < n2 && (r2 = e2.charCodeAt(i2), !(r2 === 32 || r2 < 32 || r2 === 127)); ) if (r2 === 92 && i2 + 1 < n2) {
          if (e2.charCodeAt(i2 + 1) === 32) {
            i2++;
            continue;
          }
          i2 += 2;
        } else {
          if (r2 === 40 && (o2++, o2 > 32)) return a2;
          if (r2 === 41) {
            if (o2 === 0) break;
            o2--;
          }
          i2++;
        }
        return t2 === i2 || o2 !== 0 || (a2.str = j(e2.slice(t2, i2)), a2.pos = i2, a2.ok = true), a2;
      }
      function Ye(e2, t2, n2, r2) {
        let i2, a2 = t2, o2 = {
          ok: false,
          can_continue: false,
          pos: 0,
          str: "",
          marker: 0
        };
        if (r2) o2.str = r2.str, o2.marker = r2.marker;
        else {
          if (a2 >= n2) return o2;
          let r3 = e2.charCodeAt(a2);
          if (r3 !== 34 && r3 !== 39 && r3 !== 40) return o2;
          t2++, a2++, r3 === 40 && (r3 = 41), o2.marker = r3;
        }
        for (; a2 < n2; ) {
          if (i2 = e2.charCodeAt(a2), i2 === o2.marker) return o2.pos = a2 + 1, o2.str += j(e2.slice(t2, a2)), o2.ok = true, o2;
          if (i2 === 40 && o2.marker === 41) return o2;
          i2 === 92 && a2 + 1 < n2 && a2++, a2++;
        }
        return o2.can_continue = true, o2.str += j(e2.slice(t2, a2)), o2;
      }
      var Xe = /* @__PURE__ */ t({
        parseLinkDestination: () => Je,
        parseLinkLabel: () => qe,
        parseLinkTitle: () => Ye
      });
      var z = class {
        constructor(e2, t2, n2) {
          D(this, "map", null), D(this, "level", 0), D(this, "children", null), D(this, "content", ""), D(this, "markup", ""), D(this, "info", ""), D(this, "block", false), D(this, "hidden", false), this.type = e2, this.tag = t2, this.attrs = null, this.nesting = n2, this.meta = null;
        }
        attrIndex(e2) {
          if (!this.attrs) return -1;
          let t2 = this.attrs;
          for (let n2 = 0, r2 = t2.length; n2 < r2; n2++) if (t2[n2][0] === e2) return n2;
          return -1;
        }
        attrPush(e2) {
          this.attrs ? this.attrs.push(e2) : this.attrs = [e2];
        }
        attrSet(e2, t2) {
          let n2 = this.attrIndex(e2), r2 = [e2, t2];
          n2 < 0 ? this.attrPush(r2) : this.attrs[n2] = r2;
        }
        attrGet(e2) {
          let t2 = this.attrIndex(e2), n2 = null;
          return t2 >= 0 && (n2 = this.attrs[t2][1]), n2;
        }
        attrJoin(e2, t2) {
          let n2 = this.attrIndex(e2);
          n2 < 0 ? this.attrPush([e2, t2]) : this.attrs[n2][1] = `${this.attrs[n2][1]} ${t2}`;
        }
      };
      var B = class {
        constructor() {
          D(this, "__rules__", []), D(this, "__cache__", null);
        }
        __find__(e2) {
          for (let t2 = 0; t2 < this.__rules__.length; t2++) if (this.__rules__[t2].name === e2) return t2;
          return -1;
        }
        __compile__() {
          let e2 = /* @__PURE__ */ new Set();
          this.__rules__.forEach((t2) => {
            t2.enabled && t2.alt.forEach((t3) => {
              t3 && e2.add(t3);
            });
          }), this.__cache__ = /* @__PURE__ */ Object.create(null), this.__cache__[""] = [], this.__rules__.forEach((e3) => {
            e3.enabled && this.__cache__[""].push(e3.fn);
          }), e2.forEach((e3) => {
            this.__cache__[e3] = [], this.__rules__.forEach((t2) => {
              t2.enabled && t2.alt.indexOf(e3) >= 0 && this.__cache__[e3].push(t2.fn);
            });
          });
        }
        at(e2, t2, n2 = {}) {
          let r2 = this.__find__(e2);
          if (r2 === -1) throw Error(`Parser rule not found: ${e2}`);
          this.__rules__[r2].fn = t2, this.__rules__[r2].alt = n2.alt || [], this.__cache__ = null;
        }
        before(e2, t2, n2, r2 = {}) {
          let i2 = this.__find__(e2);
          if (i2 === -1) throw Error(`Parser rule not found: ${e2}`);
          this.__rules__.splice(i2, 0, {
            name: t2,
            enabled: true,
            fn: n2,
            alt: r2.alt || []
          }), this.__cache__ = null;
        }
        after(e2, t2, n2, r2 = {}) {
          let i2 = this.__find__(e2);
          if (i2 === -1) throw Error(`Parser rule not found: ${e2}`);
          this.__rules__.splice(i2 + 1, 0, {
            name: t2,
            enabled: true,
            fn: n2,
            alt: r2.alt || []
          }), this.__cache__ = null;
        }
        push(e2, t2, n2 = {}) {
          this.__rules__.push({
            name: e2,
            enabled: true,
            fn: t2,
            alt: n2.alt || []
          }), this.__cache__ = null;
        }
        enable(e2, t2 = false) {
          Array.isArray(e2) || (e2 = [e2]);
          let n2 = [];
          return e2.forEach((e3) => {
            let r2 = this.__find__(e3);
            if (r2 < 0) {
              if (t2) return;
              throw Error(`Rules manager: invalid rule name ${e3}`);
            }
            this.__rules__[r2].enabled = true, n2.push(e3);
          }), this.__cache__ = null, n2;
        }
        enableOnly(e2, t2 = false) {
          Array.isArray(e2) || (e2 = [e2]), this.__rules__.forEach((e3) => {
            e3.enabled = false;
          }), this.enable(e2, t2);
        }
        disable(e2, t2 = false) {
          Array.isArray(e2) || (e2 = [e2]);
          let n2 = [];
          return e2.forEach((e3) => {
            let r2 = this.__find__(e3);
            if (r2 < 0) {
              if (t2) return;
              throw Error(`Rules manager: invalid rule name ${e3}`);
            }
            this.__rules__[r2].enabled = false, n2.push(e3);
          }), this.__cache__ = null, n2;
        }
        getRules(e2) {
          return this.__cache__ || this.__compile__(), this.__cache__[e2] || [];
        }
      };
      var V = {};
      V.code_inline = function(e2, t2, n2, r2, i2) {
        let a2 = e2[t2];
        return `<code${i2.renderAttrs(a2)}>${M(a2.content)}</code>`;
      }, V.code_block = function(e2, t2, n2, r2, i2) {
        let a2 = e2[t2];
        return `<pre${i2.renderAttrs(a2)}><code>${M(e2[t2].content)}</code></pre>
    `;
      }, V.fence = function(e2, t2, n2, r2, i2) {
        let a2 = e2[t2], o2 = a2.info ? j(a2.info).trim() : "", s2 = "", c2 = "";
        if (o2) {
          let e3 = o2.split(/(\s+)/g);
          s2 = e3[0], c2 = e3.slice(2).join("");
        }
        let l2;
        if (l2 = n2.highlight && n2.highlight(a2.content, s2, c2) || M(a2.content), l2.indexOf("<pre") === 0) return l2 + "\n";
        if (o2) {
          let e3 = a2.attrIndex("class"), t3 = a2.attrs ? a2.attrs.slice() : [];
          e3 < 0 ? t3.push(["class", `${n2.langPrefix}${s2}`]) : (t3[e3] = [t3[e3][0], t3[e3][1]], t3[e3][1] += ` ${n2.langPrefix}${s2}`);
          let r3 = { attrs: t3 };
          return `<pre><code${i2.renderAttrs(r3)}>${l2}</code></pre>
    `;
        }
        return `<pre><code${i2.renderAttrs(a2)}>${l2}</code></pre>
    `;
      }, V.image = function(e2, t2, n2, r2, i2) {
        let a2 = e2[t2];
        return a2.attrs[a2.attrIndex("alt")][1] = i2.renderInlineAsText(a2.children, n2, r2), i2.renderToken(e2, t2, n2);
      }, V.hardbreak = function(e2, t2, n2) {
        return n2.xhtmlOut ? "<br />\n" : "<br>\n";
      }, V.softbreak = function(e2, t2, n2) {
        return n2.breaks ? n2.xhtmlOut ? "<br />\n" : "<br>\n" : "\n";
      }, V.text = function(e2, t2) {
        return M(e2[t2].content);
      }, V.html_block = function(e2, t2) {
        return e2[t2].content;
      }, V.html_inline = function(e2, t2) {
        return e2[t2].content;
      };
      var Ze = class {
        constructor() {
          D(this, "rules", Object.assign({}, V));
        }
        renderAttrs(e2) {
          let t2, n2, r2;
          if (!e2.attrs) return "";
          for (r2 = "", t2 = 0, n2 = e2.attrs.length; t2 < n2; t2++) r2 += ` ${M(e2.attrs[t2][0])}="${M(String(e2.attrs[t2][1]))}"`;
          return r2;
        }
        renderToken(e2, t2, n2) {
          let r2 = e2[t2], i2 = "";
          if (r2.hidden) return "";
          let a2 = t2 - 1;
          for (; a2 >= 0 && e2[a2].hidden && e2[a2].nesting === 0; ) a2--;
          r2.block && r2.nesting !== -1 && a2 >= 0 && e2[a2].hidden && e2[a2].nesting === -1 && (i2 += "\n"), i2 += (r2.nesting === -1 ? "</" : "<") + r2.tag, i2 += this.renderAttrs(r2), r2.nesting === 0 && n2.xhtmlOut && (i2 += " /");
          let o2 = false;
          if (r2.block && (o2 = true, r2.nesting === 1)) {
            let n3 = t2 + 1;
            for (; n3 < e2.length && e2[n3].hidden && e2[n3].nesting === 0; ) n3++;
            if (n3 < e2.length) {
              let t3 = e2[n3];
              (t3.type === "inline" || t3.hidden || t3.nesting === -1 && t3.tag === r2.tag) && (o2 = false);
            }
          }
          return i2 += o2 ? ">\n" : ">", i2;
        }
        renderInline(e2, t2, n2) {
          let r2 = "", i2 = this.rules;
          for (let a2 = 0, o2 = e2.length; a2 < o2; a2++) {
            let o3 = e2[a2].type;
            i2[o3] === void 0 ? r2 += this.renderToken(e2, a2, t2) : r2 += i2[o3](e2, a2, t2, n2, this);
          }
          return r2;
        }
        renderInlineAsText(e2, t2, n2) {
          let r2 = "";
          for (let i2 = 0, a2 = e2.length; i2 < a2; i2++) switch (e2[i2].type) {
            case "text":
            case "code_inline":
              r2 += e2[i2].content;
              break;
            case "image":
              r2 += this.renderInlineAsText(e2[i2].children, t2, n2);
              break;
            case "html_inline":
            case "html_block":
              r2 += e2[i2].content;
              break;
            case "softbreak":
            case "hardbreak":
              r2 += "\n";
          }
          return r2;
        }
        render(e2, t2, n2) {
          let r2 = "", i2 = this.rules;
          for (let a2 = 0, o2 = e2.length; a2 < o2; a2++) {
            let o3 = e2[a2].type;
            o3 === "inline" ? r2 += this.renderInline(e2[a2].children, t2, n2) : i2[o3] === void 0 ? r2 += this.renderToken(e2, a2, t2) : r2 += i2[o3](e2, a2, t2, n2, this);
          }
          return r2;
        }
      };
      var Qe = class {
        constructor(e2, t2, n2) {
          D(this, "tokens", []), D(this, "inlineMode", false), D(this, "Token", z), this.src = e2, this.env = n2, this.md = t2;
        }
      };
      var $e = /\r\n?/g;
      var et = /\0/g;
      function tt(e2) {
        let t2;
        t2 = e2.src.replace($e, "\n"), t2 = t2.replace(et, "�"), e2.src = t2;
      }
      function nt(e2) {
        let t2;
        e2.inlineMode ? (t2 = new e2.Token("inline", "", 0), t2.content = e2.src, t2.map = [0, 1], t2.children = [], e2.tokens.push(t2)) : e2.md.block.parse(e2.src, e2.md, e2.env, e2.tokens);
      }
      function rt(e2) {
        let t2 = e2.tokens, n2 = 0;
        for (let e3 = 0; e3 < t2.length; e3++) t2[e3].type !== "reference_definition" && (e3 !== n2 && (t2[n2] = t2[e3]), n2++);
        t2.length !== n2 && (t2.length = n2);
      }
      function it(e2) {
        let t2 = e2.tokens;
        for (let n2 = 0, r2 = t2.length; n2 < r2; n2++) {
          let r3 = t2[n2];
          r3.type === "inline" && e2.md.inline.parse(r3.content, e2.md, e2.env, r3.children);
        }
      }
      function at(e2) {
        return /^<a[>\s]/i.test(e2);
      }
      function ot(e2) {
        return /^<\/a\s*>/i.test(e2);
      }
      function st(e2) {
        let t2 = e2.tokens;
        if (e2.md.options.linkify) for (let n2 = 0, r2 = t2.length; n2 < r2; n2++) {
          if (t2[n2].type !== "inline" || !e2.md.linkify.test(t2[n2].content)) continue;
          let r3 = t2[n2].children, i2 = [], a2 = 0;
          for (let t3 = r3.length - 1; t3 >= 0; t3--) {
            let n3 = r3[t3];
            if (n3.type === "link_close") for (t3--; r3[t3].level !== n3.level && r3[t3].type !== "link_open"; ) t3--;
            else if (n3.type === "html_inline" && (at(n3.content) && a2 > 0 && a2--, ot(n3.content) && a2++), !(a2 > 0) && n3.type === "text" && e2.md.linkify.test(n3.content)) {
              let a3 = n3.content, o2 = e2.md.linkify.match(a3), s2 = [], c2 = n3.level, l2 = 0;
              o2.length > 0 && o2[0].index === 0 && t3 > 0 && r3[t3 - 1].type === "text_special" && (o2 = o2.slice(1));
              for (let t4 = 0; t4 < o2.length; t4++) {
                let n4 = o2[t4].url, r4 = e2.md.normalizeLink(n4);
                if (!e2.md.validateLink(r4)) continue;
                let i3 = o2[t4].text;
                i3 = o2[t4].schema ? o2[t4].schema === "mailto:" && !/^mailto:/i.test(i3) ? e2.md.normalizeLinkText(`mailto:${i3}`).replace(/^mailto:/, "") : e2.md.normalizeLinkText(i3) : e2.md.normalizeLinkText(`http://${i3}`).replace(/^http:\/\//, "");
                let u2 = o2[t4].index;
                if (u2 > l2) {
                  let t5 = new e2.Token("text", "", 0);
                  t5.content = a3.slice(l2, u2), t5.level = c2, s2.push(t5);
                }
                let d2 = new e2.Token("link_open", "a", 1);
                d2.attrs = [["href", r4]], d2.level = c2++, d2.markup = "linkify", d2.info = "auto", s2.push(d2);
                let f2 = new e2.Token("text", "", 0);
                f2.content = i3, f2.level = c2, s2.push(f2);
                let p2 = new e2.Token("link_close", "a", -1);
                p2.level = --c2, p2.markup = "linkify", p2.info = "auto", s2.push(p2), l2 = o2[t4].lastIndex;
              }
              if (l2 < a3.length) {
                let t4 = new e2.Token("text", "", 0);
                t4.content = a3.slice(l2), t4.level = c2, s2.push(t4);
              }
              i2.push({
                index: t3,
                nodes: s2
              });
            }
          }
          if (i2.length > 0) {
            let e3 = r3.length;
            for (let t3 of i2) e3 += t3.nodes.length - 1;
            let a3 = Array(e3), o2 = 0, s2 = 0;
            i2.reverse();
            for (let e4 = 0; e4 < r3.length; e4++) {
              let t3 = i2[o2];
              if ((t3 == null ? void 0 : t3.index) === e4) {
                for (let e5 of t3.nodes) a3[s2++] = e5;
                o2++;
              } else a3[s2++] = r3[e4];
            }
            t2[n2].children = a3;
          }
        }
      }
      var ct = /\+-|\.\.|\?\?\?\?|!!!!|,,|--/;
      var lt = /\((c|tm|r)\)/i;
      var ut = /\((c|tm|r)\)/gi;
      var dt = {
        c: "©",
        r: "®",
        tm: "™"
      };
      function ft(e2, t2) {
        return dt[t2.toLowerCase()];
      }
      function pt(e2) {
        let t2 = 0;
        for (let n2 = e2.length - 1; n2 >= 0; n2--) {
          let r2 = e2[n2];
          r2.type === "text" && !t2 && (r2.content = r2.content.replace(ut, ft)), r2.type === "link_open" && r2.info === "auto" && t2--, r2.type === "link_close" && r2.info === "auto" && t2++;
        }
      }
      function mt(e2) {
        let t2 = 0;
        for (let n2 = e2.length - 1; n2 >= 0; n2--) {
          let r2 = e2[n2];
          r2.type === "text" && !t2 && ct.test(r2.content) && (r2.content = r2.content.replace(/\+-/g, "±").replace(/\.{2,}/g, "…").replace(/([?!])…/g, "$1..").replace(/([?!]){4,}/g, "$1$1$1").replace(/,{2,}/g, ",").replace(/(^|[^-])---(?=[^-]|$)/gm, "$1—").replace(/(^|\s)--(?=\s|$)/gm, "$1–").replace(/(^|[^-\s])--(?=[^-\s]|$)/gm, "$1–")), r2.type === "link_open" && r2.info === "auto" && t2--, r2.type === "link_close" && r2.info === "auto" && t2++;
        }
      }
      function ht(e2) {
        let t2;
        if (e2.md.options.typographer) for (t2 = e2.tokens.length - 1; t2 >= 0; t2--) e2.tokens[t2].type === "inline" && (lt.test(e2.tokens[t2].content) && pt(e2.tokens[t2].children), ct.test(e2.tokens[t2].content) && mt(e2.tokens[t2].children));
      }
      var gt = /['"]/;
      var _t = /['"]/g;
      var vt = "’";
      var yt = 1e3;
      function bt(e2, t2, n2) {
        for (; e2.length > n2; ) {
          let n3 = e2.pop();
          n3.isSingleQuote ? t2.single = n3.prevSameQuoteIdx : t2.double = n3.prevSameQuoteIdx;
        }
      }
      function H(e2, t2, n2, r2) {
        e2[t2] || (e2[t2] = []), e2[t2].push({
          pos: n2,
          ch: r2
        });
      }
      function xt(e2, t2) {
        let n2 = "", r2 = 0;
        t2.sort((e3, t3) => e3.pos - t3.pos);
        for (let i2 = 0; i2 < t2.length; i2++) {
          let a2 = t2[i2];
          n2 += e2.slice(r2, a2.pos) + a2.ch, r2 = a2.pos + 1;
        }
        return n2 + e2.slice(r2);
      }
      function St(e2, t2) {
        let n2, r2 = [], i2 = {
          single: -1,
          double: -1
        }, a2 = {};
        for (let o2 = 0; o2 < e2.length; o2++) {
          let s2 = e2[o2], c2 = e2[o2].level;
          for (n2 = r2.length - 1; n2 >= 0 && !(r2[n2].level <= c2); n2--) ;
          if (bt(r2, i2, n2 + 1), s2.type !== "text") continue;
          let l2 = s2.content, u2 = 0, d2 = l2.length;
          OUTER: for (; u2 < d2; ) {
            _t.lastIndex = u2;
            let s3 = _t.exec(l2);
            if (!s3) break;
            let f2 = true, p2 = true;
            u2 = s3.index + 1;
            let m2 = s3[0] === "'", h2 = 32;
            if (s3.index - 1 >= 0) h2 = l2.charCodeAt(s3.index - 1);
            else for (n2 = o2 - 1; n2 >= 0 && e2[n2].type !== "softbreak" && e2[n2].type !== "hardbreak"; n2--) if (e2[n2].content) {
              h2 = e2[n2].content.charCodeAt(e2[n2].content.length - 1);
              break;
            }
            let g2 = 32;
            if (u2 < d2) g2 = l2.charCodeAt(u2);
            else for (n2 = o2 + 1; n2 < e2.length && e2[n2].type !== "softbreak" && e2[n2].type !== "hardbreak"; n2++) if (e2[n2].content) {
              g2 = e2[n2].content.charCodeAt(0);
              break;
            }
            let _2 = I(h2) || F(h2), v2 = I(g2) || F(g2), y2 = P(h2), b2 = P(g2);
            if (b2 ? f2 = false : v2 && (y2 || _2 || (f2 = false)), y2 ? p2 = false : _2 && (b2 || v2 || (p2 = false)), g2 === 34 && s3[0] === '"' && h2 >= 48 && h2 <= 57 && (p2 = f2 = false), f2 && p2 && (f2 = _2, p2 = v2), !f2 && !p2) m2 && H(a2, o2, s3.index, vt);
            else {
              if (p2 && (n2 = m2 ? i2.single : i2.double, n2 >= 0 && r2[n2].level === c2)) {
                let e3 = r2[n2], c3, l3;
                m2 ? (c3 = t2.md.options.quotes[2], l3 = t2.md.options.quotes[3]) : (c3 = t2.md.options.quotes[0], l3 = t2.md.options.quotes[1]), H(a2, o2, s3.index, l3), H(a2, e3.tokenIdx, e3.contentPos, c3), bt(r2, i2, n2);
                continue OUTER;
              }
              if (f2) {
                if (r2.length >= yt) return;
                r2.push({
                  tokenIdx: o2,
                  contentPos: s3.index,
                  isSingleQuote: m2,
                  level: c2,
                  prevSameQuoteIdx: m2 ? i2.single : i2.double
                }), m2 ? i2.single = r2.length - 1 : i2.double = r2.length - 1;
              } else p2 && m2 && H(a2, o2, s3.index, vt);
            }
          }
        }
        Object.keys(a2).forEach(function(t3) {
          let n3 = Number(t3);
          e2[n3].content = xt(e2[n3].content, a2[t3]);
        });
      }
      function Ct(e2) {
        if (e2.md.options.typographer) for (let t2 = e2.tokens.length - 1; t2 >= 0; t2--) e2.tokens[t2].type === "inline" && gt.test(e2.tokens[t2].content) && St(e2.tokens[t2].children, e2);
      }
      function wt(e2) {
        let t2, n2, r2 = e2.length;
        for (t2 = 0; t2 < r2; t2++) e2[t2].type === "text_special" && (e2[t2].type = "text");
        for (t2 = n2 = 0; t2 < r2; t2++) e2[t2].type === "text" && t2 + 1 < r2 && e2[t2 + 1].type === "text" ? e2[t2 + 1].content = e2[t2].content + e2[t2 + 1].content : (t2 !== n2 && (e2[n2] = e2[t2]), n2++);
        t2 !== n2 && (e2.length = n2);
      }
      function Tt(e2) {
        let t2, n2, r2 = e2.tokens, i2 = r2.length;
        for (let e3 = 0; e3 < i2; e3++) {
          if (r2[e3].type !== "inline") continue;
          let i3 = r2[e3].children, a2 = i3.length;
          for (t2 = 0; t2 < a2; t2++) i3[t2].type === "text_special" && (i3[t2].type = "text"), i3[t2].children && wt(i3[t2].children);
          for (t2 = n2 = 0; t2 < a2; t2++) i3[t2].type === "text" && t2 + 1 < a2 && i3[t2 + 1].type === "text" ? i3[t2 + 1].content = i3[t2].content + i3[t2 + 1].content : (t2 !== n2 && (i3[n2] = i3[t2]), n2++);
          t2 !== n2 && (i3.length = n2);
        }
      }
      var U = [
        ["normalize", tt],
        ["block", nt],
        ["strip_references", rt],
        ["inline", it],
        ["linkify", st],
        ["replacements", ht],
        ["smartquotes", Ct],
        ["text_join", Tt]
      ];
      var Et = class {
        constructor() {
          D(this, "ruler", new B()), D(this, "State", Qe);
          for (let e2 = 0; e2 < U.length; e2++) this.ruler.push(U[e2][0], U[e2][1]);
        }
        process(e2) {
          let t2 = this.ruler.getRules("");
          for (let n2 = 0, r2 = t2.length; n2 < r2; n2++) t2[n2](e2);
        }
      };
      var Dt = class {
        constructor(e2, t2, n2, r2) {
          D(this, "bMarks", []), D(this, "eMarks", []), D(this, "tShift", []), D(this, "sCount", []), D(this, "bsCount", []), D(this, "blkIndent", 0), D(this, "line", 0), D(this, "lineMax", 0), D(this, "tight", false), D(this, "listIndent", -1), D(this, "parentType", "root"), D(this, "level", 0), D(this, "Token", z), this.src = e2, this.md = t2, this.env = n2, this.tokens = r2;
          let i2 = this.src;
          for (let e3 = 0, t3 = 0, n3 = 0, r3 = 0, a2 = i2.length, o2 = false; t3 < a2; t3++) {
            let s2 = i2.charCodeAt(t3);
            if (!o2) {
              if (N(s2)) {
                n3++, s2 === 9 ? r3 += 4 - r3 % 4 : r3++;
                continue;
              }
              o2 = true;
            }
            (s2 === 10 || t3 === a2 - 1) && (s2 !== 10 && t3++, this.bMarks.push(e3), this.eMarks.push(t3), this.tShift.push(n3), this.sCount.push(r3), this.bsCount.push(0), o2 = false, n3 = 0, r3 = 0, e3 = t3 + 1);
          }
          this.bMarks.push(i2.length), this.eMarks.push(i2.length), this.tShift.push(0), this.sCount.push(0), this.bsCount.push(0), this.lineMax = this.bMarks.length - 1;
        }
        push(e2, t2, n2) {
          let r2 = new z(e2, t2, n2);
          return r2.block = true, n2 < 0 && this.level--, r2.level = this.level, n2 > 0 && this.level++, this.tokens.push(r2), r2;
        }
        isEmpty(e2) {
          return this.bMarks[e2] + this.tShift[e2] >= this.eMarks[e2];
        }
        skipEmptyLines(e2) {
          for (let t2 = this.lineMax; e2 < t2 && !(this.bMarks[e2] + this.tShift[e2] < this.eMarks[e2]); e2++) ;
          return e2;
        }
        skipSpaces(e2) {
          for (let t2 = this.src.length; e2 < t2 && N(this.src.charCodeAt(e2)); e2++) ;
          return e2;
        }
        skipSpacesBack(e2, t2) {
          if (e2 <= t2) return e2;
          for (; e2 > t2; ) if (!N(this.src.charCodeAt(--e2))) return e2 + 1;
          return e2;
        }
        skipChars(e2, t2) {
          for (let n2 = this.src.length; e2 < n2 && this.src.charCodeAt(e2) === t2; e2++) ;
          return e2;
        }
        skipCharsBack(e2, t2, n2) {
          if (e2 <= n2) return e2;
          for (; e2 > n2; ) if (t2 !== this.src.charCodeAt(--e2)) return e2 + 1;
          return e2;
        }
        getLines(e2, t2, n2, r2) {
          if (e2 >= t2) return "";
          let i2 = Array(t2 - e2);
          for (let a2 = 0, o2 = e2; o2 < t2; o2++, a2++) {
            let e3 = 0, s2 = this.bMarks[o2], c2 = s2, l2;
            for (l2 = o2 + 1 < t2 || r2 ? this.eMarks[o2] + 1 : this.eMarks[o2]; c2 < l2 && e3 < n2; ) {
              let t3 = this.src.charCodeAt(c2);
              if (N(t3)) t3 === 9 ? e3 += 4 - (e3 + this.bsCount[o2]) % 4 : e3++;
              else if (c2 - s2 < this.tShift[o2]) e3++;
              else break;
              c2++;
            }
            e3 > n2 ? i2[a2] = Array(e3 - n2 + 1).join(" ") + this.src.slice(c2, l2) : i2[a2] = this.src.slice(c2, l2);
          }
          return i2.join("");
        }
      };
      var Ot = 65536;
      function kt(e2, t2) {
        let n2 = e2.bMarks[t2] + e2.tShift[t2], r2 = e2.eMarks[t2];
        return e2.src.slice(n2, r2);
      }
      function At(e2) {
        let t2 = [], n2 = e2.length, r2 = 0, i2 = e2.charCodeAt(r2), a2 = false, o2 = 0, s2 = "";
        for (; r2 < n2; ) i2 === 124 && (a2 ? (s2 += e2.substring(o2, r2 - 1), o2 = r2) : (t2.push(s2 + e2.substring(o2, r2)), s2 = "", o2 = r2 + 1)), a2 = i2 === 92, r2++, i2 = e2.charCodeAt(r2);
        return t2.push(s2 + e2.substring(o2)), t2;
      }
      function jt(e2, t2, n2, r2) {
        if (t2 + 2 > n2) return false;
        let i2 = t2 + 1;
        if (e2.sCount[i2] < e2.blkIndent || e2.sCount[i2] - e2.blkIndent >= 4) return false;
        let a2 = e2.bMarks[i2] + e2.tShift[i2];
        if (a2 >= e2.eMarks[i2]) return false;
        let o2 = e2.src.charCodeAt(a2++);
        if (o2 !== 124 && o2 !== 45 && o2 !== 58 || a2 >= e2.eMarks[i2]) return false;
        let s2 = e2.src.charCodeAt(a2++);
        if (s2 !== 124 && s2 !== 45 && s2 !== 58 && !N(s2) || o2 === 45 && N(s2)) return false;
        for (; a2 < e2.eMarks[i2]; ) {
          let t3 = e2.src.charCodeAt(a2);
          if (t3 !== 124 && t3 !== 45 && t3 !== 58 && !N(t3)) return false;
          a2++;
        }
        let c2 = kt(e2, t2 + 1), l2 = c2.split("|"), u2 = [];
        for (let e3 = 0; e3 < l2.length; e3++) {
          let t3 = l2[e3].trim();
          if (!t3) {
            if (e3 === 0 || e3 === l2.length - 1) continue;
            return false;
          }
          if (!/^:?-+:?$/.test(t3)) return false;
          t3.charCodeAt(t3.length - 1) === 58 ? u2.push(t3.charCodeAt(0) === 58 ? "center" : "right") : t3.charCodeAt(0) === 58 ? u2.push("left") : u2.push("");
        }
        if (c2 = kt(e2, t2).trim(), c2.indexOf("|") === -1 || e2.sCount[t2] - e2.blkIndent >= 4) return false;
        l2 = At(c2), l2.length && l2[0] === "" && l2.shift(), l2.length && l2[l2.length - 1] === "" && l2.pop();
        let d2 = l2.length;
        if (d2 === 0 || d2 !== u2.length) return false;
        if (r2) return true;
        let f2 = e2.parentType;
        e2.parentType = "table";
        let p2 = e2.md.block.ruler.getRules("blockquote"), m2 = e2.push("table_open", "table", 1), h2 = [t2, 0];
        m2.map = h2;
        let g2 = e2.push("thead_open", "thead", 1);
        g2.map = [t2, t2 + 1];
        let _2 = e2.push("tr_open", "tr", 1);
        _2.map = [t2, t2 + 1];
        for (let t3 = 0; t3 < l2.length; t3++) {
          let n3 = e2.push("th_open", "th", 1);
          u2[t3] && (n3.attrs = [["style", `text-align:${u2[t3]}`]]);
          let r3 = e2.push("inline", "", 0);
          r3.content = l2[t3].trim(), r3.children = [], e2.push("th_close", "th", -1);
        }
        e2.push("tr_close", "tr", -1), e2.push("thead_close", "thead", -1);
        let v2, y2 = 0;
        for (i2 = t2 + 2; i2 < n2 && !(e2.sCount[i2] < e2.blkIndent); i2++) {
          let r3 = false;
          for (let t3 = 0, a4 = p2.length; t3 < a4; t3++) if (p2[t3](e2, i2, n2, true)) {
            r3 = true;
            break;
          }
          if (r3 || (c2 = kt(e2, i2).trim(), !c2) || e2.sCount[i2] - e2.blkIndent >= 4 || (l2 = At(c2), l2.length && l2[0] === "" && l2.shift(), l2.length && l2[l2.length - 1] === "" && l2.pop(), y2 += d2 - l2.length, y2 > Ot)) break;
          if (i2 === t2 + 2) {
            let n3 = e2.push("tbody_open", "tbody", 1);
            n3.map = v2 = [t2 + 2, 0];
          }
          let a3 = e2.push("tr_open", "tr", 1);
          a3.map = [i2, i2 + 1];
          for (let t3 = 0; t3 < d2; t3++) {
            let n3 = e2.push("td_open", "td", 1);
            u2[t3] && (n3.attrs = [["style", `text-align:${u2[t3]}`]]);
            let r4 = e2.push("inline", "", 0);
            r4.content = l2[t3] ? l2[t3].trim() : "", r4.children = [], e2.push("td_close", "td", -1);
          }
          e2.push("tr_close", "tr", -1);
        }
        return v2 && (e2.push("tbody_close", "tbody", -1), v2[1] = i2), e2.push("table_close", "table", -1), h2[1] = i2, e2.parentType = f2, e2.line = i2, true;
      }
      function Mt(e2, t2, n2) {
        if (e2.sCount[t2] - e2.blkIndent < 4) return false;
        let r2 = t2 + 1, i2 = r2;
        for (; r2 < n2; ) if (e2.isEmpty(r2)) r2++;
        else if (e2.sCount[r2] - e2.blkIndent >= 4) r2++, i2 = r2;
        else break;
        e2.line = i2;
        let a2 = e2.push("code_block", "code", 0);
        return a2.content = e2.getLines(t2, i2, 4 + e2.blkIndent, false) + "\n", a2.map = [t2, e2.line], true;
      }
      function Nt(e2, t2, n2, r2) {
        let i2 = e2.bMarks[t2] + e2.tShift[t2], a2 = e2.eMarks[t2];
        if (e2.sCount[t2] - e2.blkIndent >= 4 || i2 + 3 > a2) return false;
        let o2 = e2.src.charCodeAt(i2);
        if (o2 !== 126 && o2 !== 96) return false;
        let s2 = i2;
        i2 = e2.skipChars(i2, o2);
        let c2 = i2 - s2;
        if (c2 < 3) return false;
        let l2 = e2.src.slice(s2, i2), u2 = e2.src.slice(i2, a2);
        if (o2 === 96 && u2.indexOf(String.fromCharCode(o2)) >= 0) return false;
        if (r2) return true;
        let d2 = t2, f2 = false;
        for (; d2++, !(d2 >= n2 || (i2 = s2 = e2.bMarks[d2] + e2.tShift[d2], a2 = e2.eMarks[d2], i2 < a2 && e2.sCount[d2] < e2.blkIndent)); ) if (e2.src.charCodeAt(i2) === o2 && !(e2.sCount[d2] - e2.blkIndent >= 4) && (i2 = e2.skipChars(i2, o2), !(i2 - s2 < c2) && (i2 = e2.skipSpaces(i2), !(i2 < a2)))) {
          f2 = true;
          break;
        }
        c2 = e2.sCount[t2], e2.line = d2 + +!!f2;
        let p2 = e2.push("fence", "code", 0);
        return p2.info = u2, p2.content = e2.getLines(t2 + 1, d2, c2, true), p2.markup = l2, p2.map = [t2, e2.line], true;
      }
      function Pt(e2, t2, n2, r2) {
        let i2 = e2.bMarks[t2] + e2.tShift[t2], a2 = e2.eMarks[t2], o2 = e2.lineMax;
        if (e2.sCount[t2] - e2.blkIndent >= 4 || e2.src.charCodeAt(i2) !== 62) return false;
        if (r2) return true;
        let s2 = [], c2 = [], l2 = [], u2 = [], d2 = e2.md.block.ruler.getRules("blockquote"), f2 = e2.parentType;
        e2.parentType = "blockquote";
        let p2 = false, m2;
        for (m2 = t2; m2 < n2; m2++) {
          let t3 = e2.sCount[m2] < e2.blkIndent;
          if (i2 = e2.bMarks[m2] + e2.tShift[m2], a2 = e2.eMarks[m2], i2 >= a2) break;
          if (e2.src.charCodeAt(i2++) === 62 && !t3) {
            let t4 = e2.sCount[m2] + 1, n3, r4;
            e2.src.charCodeAt(i2) === 32 ? (i2++, t4++, r4 = false, n3 = true) : e2.src.charCodeAt(i2) === 9 ? (n3 = true, (e2.bsCount[m2] + t4) % 4 == 3 ? (i2++, t4++, r4 = false) : r4 = true) : n3 = false;
            let o3 = t4;
            for (s2.push(e2.bMarks[m2]), e2.bMarks[m2] = i2; i2 < a2; ) {
              let t5 = e2.src.charCodeAt(i2);
              if (N(t5)) t5 === 9 ? o3 += 4 - (o3 + e2.bsCount[m2] + +!!r4) % 4 : o3++;
              else break;
              i2++;
            }
            p2 = i2 >= a2, c2.push(e2.bsCount[m2]), e2.bsCount[m2] = e2.sCount[m2] + 1 + +!!n3, l2.push(e2.sCount[m2]), e2.sCount[m2] = o3 - t4, u2.push(e2.tShift[m2]), e2.tShift[m2] = i2 - e2.bMarks[m2];
            continue;
          }
          if (p2) break;
          let r3 = false;
          for (let t4 = 0, i3 = d2.length; t4 < i3; t4++) if (d2[t4](e2, m2, n2, true)) {
            r3 = true;
            break;
          }
          if (r3) {
            e2.lineMax = m2, e2.blkIndent !== 0 && (s2.push(e2.bMarks[m2]), c2.push(e2.bsCount[m2]), u2.push(e2.tShift[m2]), l2.push(e2.sCount[m2]), e2.sCount[m2] -= e2.blkIndent);
            break;
          }
          s2.push(e2.bMarks[m2]), c2.push(e2.bsCount[m2]), u2.push(e2.tShift[m2]), l2.push(e2.sCount[m2]), e2.sCount[m2] = -1;
        }
        let h2 = e2.blkIndent;
        e2.blkIndent = 0;
        let g2 = e2.push("blockquote_open", "blockquote", 1);
        g2.markup = ">";
        let _2 = [t2, 0];
        g2.map = _2, e2.md.block.tokenize(e2, t2, m2);
        let v2 = e2.push("blockquote_close", "blockquote", -1);
        v2.markup = ">", e2.lineMax = o2, e2.parentType = f2, _2[1] = e2.line;
        for (let n3 = 0; n3 < u2.length; n3++) e2.bMarks[n3 + t2] = s2[n3], e2.tShift[n3 + t2] = u2[n3], e2.sCount[n3 + t2] = l2[n3], e2.bsCount[n3 + t2] = c2[n3];
        return e2.blkIndent = h2, true;
      }
      function Ft(e2, t2, n2, r2) {
        let i2 = e2.eMarks[t2];
        if (e2.sCount[t2] - e2.blkIndent >= 4) return false;
        let a2 = e2.bMarks[t2] + e2.tShift[t2], o2 = e2.src.charCodeAt(a2++);
        if (o2 !== 42 && o2 !== 45 && o2 !== 95) return false;
        let s2 = 1;
        for (; a2 < i2; ) {
          let t3 = e2.src.charCodeAt(a2++);
          if (t3 !== o2 && !N(t3)) return false;
          t3 === o2 && s2++;
        }
        if (s2 < 3) return false;
        if (r2) return true;
        e2.line = t2 + 1;
        let c2 = e2.push("hr", "hr", 0);
        return c2.map = [t2, e2.line], c2.markup = Array(s2 + 1).join(String.fromCharCode(o2)), true;
      }
      function It(e2, t2) {
        let n2 = e2.eMarks[t2], r2 = e2.bMarks[t2] + e2.tShift[t2], i2 = e2.src.charCodeAt(r2++);
        return i2 !== 42 && i2 !== 45 && i2 !== 43 || r2 < n2 && !N(e2.src.charCodeAt(r2)) ? -1 : r2;
      }
      function Lt(e2, t2) {
        let n2 = e2.bMarks[t2] + e2.tShift[t2], r2 = e2.eMarks[t2], i2 = n2;
        if (i2 + 1 >= r2) return -1;
        let a2 = e2.src.charCodeAt(i2++);
        if (a2 < 48 || a2 > 57) return -1;
        for (; ; ) {
          if (i2 >= r2) return -1;
          if (a2 = e2.src.charCodeAt(i2++), a2 >= 48 && a2 <= 57) {
            if (i2 - n2 >= 10) return -1;
          } else {
            if (a2 === 41 || a2 === 46) break;
            return -1;
          }
        }
        return i2 < r2 && (a2 = e2.src.charCodeAt(i2), !N(a2)) ? -1 : i2;
      }
      function Rt(e2, t2) {
        let n2 = e2.level + 2;
        for (let r2 = t2 + 2, i2 = e2.tokens.length - 2; r2 < i2; r2++) e2.tokens[r2].level === n2 && e2.tokens[r2].type === "paragraph_open" && (e2.tokens[r2 + 2].hidden = true, e2.tokens[r2].hidden = true, r2 += 2);
      }
      function zt(e2, t2, n2, r2) {
        let i2, a2, o2, s2, c2 = t2, l2 = true;
        if (e2.sCount[c2] - e2.blkIndent >= 4 || e2.listIndent >= 0 && e2.sCount[c2] - e2.listIndent >= 4 && e2.sCount[c2] < e2.blkIndent) return false;
        let u2 = false;
        r2 && e2.parentType === "paragraph" && e2.sCount[c2] >= e2.blkIndent && (u2 = true);
        let d2, f2, p2;
        if ((p2 = Lt(e2, c2)) >= 0) {
          if (d2 = true, o2 = e2.bMarks[c2] + e2.tShift[c2], f2 = Number(e2.src.slice(o2, p2 - 1)), u2 && f2 !== 1) return false;
        } else if ((p2 = It(e2, c2)) >= 0) d2 = false;
        else return false;
        if (u2 && e2.skipSpaces(p2) >= e2.eMarks[c2]) return false;
        if (r2) return true;
        let m2 = e2.src.charCodeAt(p2 - 1), h2 = e2.tokens.length;
        d2 ? (s2 = e2.push("ordered_list_open", "ol", 1), f2 !== 1 && (s2.attrs = [["start", f2]])) : s2 = e2.push("bullet_list_open", "ul", 1);
        let g2 = [c2, 0];
        s2.map = g2, s2.markup = String.fromCharCode(m2);
        let _2 = false, v2 = e2.md.block.ruler.getRules("list"), y2 = e2.parentType;
        for (e2.parentType = "list"; c2 < n2; ) {
          a2 = p2, i2 = e2.eMarks[c2];
          let t3 = e2.sCount[c2] + p2 - (e2.bMarks[c2] + e2.tShift[c2]), r3 = t3;
          for (; a2 < i2; ) {
            let t4 = e2.src.charCodeAt(a2);
            if (t4 === 9) r3 += 4 - (r3 + e2.bsCount[c2]) % 4;
            else if (t4 === 32) r3++;
            else break;
            a2++;
          }
          let u3 = a2, f3;
          f3 = u3 >= i2 ? 1 : r3 - t3, f3 > 4 && (f3 = 1);
          let h3 = t3 + f3;
          s2 = e2.push("list_item_open", "li", 1), s2.markup = String.fromCharCode(m2);
          let g3 = [c2, 0];
          s2.map = g3, d2 && (s2.info = e2.src.slice(o2, p2 - 1));
          let y3 = e2.tight, b2 = e2.tShift[c2], x2 = e2.sCount[c2], S2 = e2.listIndent;
          if (e2.listIndent = e2.blkIndent, e2.blkIndent = h3, e2.tight = true, e2.tShift[c2] = u3 - e2.bMarks[c2], e2.sCount[c2] = r3, u3 >= i2 && e2.isEmpty(c2 + 1) ? e2.line = Math.min(e2.line + 2, n2) : e2.md.block.tokenize(e2, c2, n2), (!e2.tight || _2) && (l2 = false), _2 = e2.line - c2 > 1 && e2.isEmpty(e2.line - 1), e2.blkIndent = e2.listIndent, e2.listIndent = S2, e2.tShift[c2] = b2, e2.sCount[c2] = x2, e2.tight = y3, s2 = e2.push("list_item_close", "li", -1), s2.markup = String.fromCharCode(m2), c2 = e2.line, g3[1] = c2, c2 >= n2 || e2.sCount[c2] < e2.blkIndent || e2.sCount[c2] - e2.blkIndent >= 4) break;
          let C2 = false;
          for (let t4 = 0, r4 = v2.length; t4 < r4; t4++) if (v2[t4](e2, c2, n2, true)) {
            C2 = true;
            break;
          }
          if (C2) break;
          if (d2) {
            if (p2 = Lt(e2, c2), p2 < 0) break;
            o2 = e2.bMarks[c2] + e2.tShift[c2];
          } else if (p2 = It(e2, c2), p2 < 0) break;
          if (m2 !== e2.src.charCodeAt(p2 - 1)) break;
        }
        return s2 = d2 ? e2.push("ordered_list_close", "ol", -1) : e2.push("bullet_list_close", "ul", -1), s2.markup = String.fromCharCode(m2), g2[1] = c2, e2.line = c2, e2.parentType = y2, l2 && Rt(e2, h2), true;
      }
      var Bt = 999;
      function Vt(e2) {
        let t2 = e2.length;
        for (let n2 = 0; n2 < e2.length - 1; n2++) {
          let r2 = e2.charCodeAt(n2);
          if (r2 < 55296 || r2 > 56319) continue;
          let i2 = e2.charCodeAt(n2 + 1);
          i2 >= 56320 && i2 <= 57343 && (t2--, n2++);
        }
        return t2;
      }
      function W(e2, t2) {
        return Math.min(e2.eMarks[t2] + 1, e2.src.length);
      }
      function G(e2, t2) {
        let n2 = e2.lineMax;
        if (t2 >= n2 || e2.isEmpty(t2)) return -1;
        let r2 = false;
        if (e2.sCount[t2] - e2.blkIndent > 3 && (r2 = true), e2.sCount[t2] < 0 && (r2 = true), !r2) {
          let r3 = e2.md.block.ruler.getRules("reference"), i2 = e2.parentType;
          e2.parentType = "reference";
          let a2 = false;
          for (let i3 = 0, o2 = r3.length; i3 < o2; i3++) if (r3[i3](e2, t2, n2, true)) {
            a2 = true;
            break;
          }
          if (e2.parentType = i2, a2) return -1;
        }
        return e2.bMarks[t2] + e2.tShift[t2];
      }
      function Ht(e2, t2, n2, r2) {
        let i2 = e2.src, a2 = e2.bMarks[t2] + e2.tShift[t2], o2 = t2 + 1;
        if (e2.sCount[t2] - e2.blkIndent >= 4 || i2.charCodeAt(a2) !== 91) return false;
        let s2 = W(e2, t2), c2 = "", l2 = -1, u2 = ++a2;
        for (; a2 < s2; ) {
          if (c2.length + a2 - u2 > Bt * 2) return false;
          let t3 = i2.charCodeAt(a2);
          if (t3 === 91) return false;
          if (t3 === 93) {
            l2 = a2;
            break;
          }
          if (t3 === 92 && (t3 = i2.charCodeAt(++a2)), t3 === 10 && a2 < s2) {
            let t4 = G(e2, o2);
            if (t4 < 0) return false;
            c2 += i2.slice(u2, s2), a2 = u2 = t4, s2 = W(e2, o2++);
          } else a2++;
        }
        if (l2 < 0 || i2.charCodeAt(l2 + 1) !== 58 || (c2 += i2.slice(u2, l2), c2.length > Bt && Vt(c2) > Bt)) return false;
        for (a2 = l2 + 2; a2 < s2; ) {
          let t3 = i2.charCodeAt(a2);
          if (t3 === 10) {
            let t4 = G(e2, o2);
            if (t4 < 0) break;
            a2 = t4, s2 = W(e2, o2++);
          } else if (N(t3)) a2++;
          else break;
        }
        let d2 = e2.md.helpers.parseLinkDestination(i2, a2, s2);
        if (!d2.ok) return false;
        let f2 = e2.md.normalizeLink(d2.str);
        if (!e2.md.validateLink(f2)) return false;
        a2 = d2.pos;
        let p2 = a2, m2 = s2, h2 = o2;
        for (; a2 < s2; ) {
          let t3 = i2.charCodeAt(a2);
          if (t3 === 10) {
            let t4 = G(e2, o2);
            if (t4 < 0) break;
            a2 = t4, s2 = W(e2, o2++);
          } else if (N(t3)) a2++;
          else break;
        }
        let g2 = a2, _2 = e2.md.helpers.parseLinkTitle(i2, a2, s2);
        for (; _2.can_continue; ) {
          let t3 = G(e2, o2);
          if (t3 < 0) break;
          a2 = t3, s2 = W(e2, o2++), _2 = e2.md.helpers.parseLinkTitle(i2, a2, s2, _2);
        }
        let v2;
        for (g2 !== p2 && _2.ok ? (v2 = _2.str, a2 = _2.pos) : (v2 = "", a2 = p2, s2 = m2, o2 = h2); a2 < s2 && N(i2.charCodeAt(a2)); ) a2++;
        if (a2 < s2 && i2.charCodeAt(a2) !== 10 && v2) for (v2 = "", a2 = p2, s2 = m2, o2 = h2; a2 < s2 && N(i2.charCodeAt(a2)); ) a2++;
        if (a2 < s2 && i2.charCodeAt(a2) !== 10) return false;
        let y2 = L(c2);
        if (!y2) return false;
        if (r2) return true;
        e2.env.references === void 0 && (e2.env.references = {}), e2.env.references[y2] === void 0 && (e2.env.references[y2] = {
          title: v2,
          href: f2
        });
        let b2 = e2.push("reference_definition", "", 0);
        b2.map = [t2, o2], b2.hidden = true;
        let x2 = /* @__PURE__ */ Object.create(null);
        return x2.label = y2, b2.meta = x2, e2.line = o2, true;
      }
      var Ut = /* @__PURE__ */ "address.article.aside.base.basefont.blockquote.body.caption.center.col.colgroup.dd.details.dialog.dir.div.dl.dt.fieldset.figcaption.figure.footer.form.frame.frameset.h1.h2.h3.h4.h5.h6.head.header.hr.html.iframe.legend.li.link.main.menu.menuitem.nav.noframes.ol.optgroup.option.p.param.search.section.summary.table.tbody.td.tfoot.th.thead.title.tr.track.ul".split(".");
      var Wt = `<[A-Za-z][A-Za-z0-9\\-]*(?:\\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\\s*=\\s*(?:[^"'=<>\`\\x00-\\x20]+|'[^']*'|"[^"]*"))?)*\\s*\\/?>`;
      var Gt = "<\\/[A-Za-z][A-Za-z0-9\\-]*\\s*>";
      RegExp(`^(?:${Wt}|${Gt}|<!---?>|<!--(?:[^-]|-[^-]|--[^>])*-->|<[?][\\s\\S]*?[?]>|<![A-Za-z][^>]*>|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>)`);
      var Kt = RegExp(`^(?:${Wt}|${Gt})`);
      var K = [
        [
          /^<(script|pre|style|textarea)(?=(\s|>|$))/i,
          /<\/(script|pre|style|textarea)>/i,
          true
        ],
        [
          /^<!--/,
          /-->/,
          true
        ],
        [
          /^<\?/,
          /\?>/,
          true
        ],
        [
          /^<![A-Za-z]/,
          />/,
          true
        ],
        [
          /^<!\[CDATA\[/,
          /\]\]>/,
          true
        ],
        [
          RegExp(`^</?(${Ut.join("|")})(?=(\\s|/?>|$))`, "i"),
          /^$/,
          true
        ],
        [
          RegExp(`${Kt.source}\\s*$`),
          /^$/,
          false
        ]
      ];
      function qt(e2, t2, n2, r2) {
        let i2 = e2.bMarks[t2] + e2.tShift[t2], a2 = e2.eMarks[t2];
        if (e2.sCount[t2] - e2.blkIndent >= 4 || !e2.md.options.html || e2.src.charCodeAt(i2) !== 60) return false;
        let o2 = e2.src.slice(i2, a2), s2 = 0;
        for (; s2 < K.length && !K[s2][0].test(o2); s2++) ;
        if (s2 === K.length) return false;
        if (r2) return K[s2][2];
        let c2 = t2 + 1, l2 = K[s2][1].test("");
        if (!K[s2][1].test(o2)) {
          for (; c2 < n2 && !(e2.sCount[c2] < e2.blkIndent && (l2 || !e2.isEmpty(c2))); c2++) if (i2 = e2.bMarks[c2] + e2.tShift[c2], a2 = e2.eMarks[c2], o2 = e2.src.slice(i2, a2), K[s2][1].test(o2)) {
            o2.length !== 0 && c2++;
            break;
          }
        }
        e2.line = c2;
        let u2 = e2.push("html_block", "", 0);
        return u2.map = [t2, c2], u2.content = e2.getLines(t2, c2, e2.blkIndent, true), true;
      }
      function Jt(e2, t2, n2, r2) {
        let i2 = e2.bMarks[t2] + e2.tShift[t2], a2 = e2.eMarks[t2];
        if (e2.sCount[t2] - e2.blkIndent >= 4) return false;
        let o2 = e2.src.charCodeAt(i2);
        if (o2 !== 35 || i2 >= a2) return false;
        let s2 = 1;
        for (o2 = e2.src.charCodeAt(++i2); o2 === 35 && i2 < a2 && s2 <= 6; ) s2++, o2 = e2.src.charCodeAt(++i2);
        if (s2 > 6 || i2 < a2 && !N(o2)) return false;
        if (r2) return true;
        a2 = e2.skipSpacesBack(a2, i2);
        let c2 = e2.skipCharsBack(a2, 35, i2);
        c2 > i2 && N(e2.src.charCodeAt(c2 - 1)) && (a2 = c2), e2.line = t2 + 1;
        let l2 = e2.push("heading_open", `h${s2}`, 1);
        l2.markup = "########".slice(0, s2), l2.map = [t2, e2.line];
        let u2 = e2.push("inline", "", 0);
        u2.content = R(e2.src.slice(i2, a2)), u2.map = [t2, e2.line], u2.children = [];
        let d2 = e2.push("heading_close", `h${s2}`, -1);
        return d2.markup = "########".slice(0, s2), true;
      }
      function Yt(e2, t2, n2) {
        let r2 = e2.md.block.ruler.getRules("paragraph");
        if (e2.sCount[t2] - e2.blkIndent >= 4) return false;
        let i2 = e2.parentType;
        e2.parentType = "paragraph";
        let a2 = 0, o2, s2 = t2 + 1;
        for (; s2 < n2 && !e2.isEmpty(s2); s2++) {
          if (e2.sCount[s2] - e2.blkIndent > 3) continue;
          if (e2.sCount[s2] >= e2.blkIndent) {
            let t4 = e2.bMarks[s2] + e2.tShift[s2], n3 = e2.eMarks[s2];
            if (t4 < n3 && (o2 = e2.src.charCodeAt(t4), (o2 === 45 || o2 === 61) && (t4 = e2.skipChars(t4, o2), t4 = e2.skipSpaces(t4), t4 >= n3))) {
              a2 = o2 === 61 ? 1 : 2;
              break;
            }
          }
          if (e2.sCount[s2] < 0) continue;
          let t3 = false;
          for (let i3 = 0, a3 = r2.length; i3 < a3; i3++) if (r2[i3](e2, s2, n2, true)) {
            t3 = true;
            break;
          }
          if (t3) break;
        }
        if (!a2) return e2.parentType = i2, false;
        let c2 = R(e2.getLines(t2, s2, e2.blkIndent, false));
        e2.line = s2 + 1;
        let l2 = e2.push("heading_open", `h${a2}`, 1);
        l2.markup = String.fromCharCode(o2), l2.map = [t2, e2.line];
        let u2 = e2.push("inline", "", 0);
        u2.content = c2, u2.map = [t2, e2.line - 1], u2.children = [];
        let d2 = e2.push("heading_close", `h${a2}`, -1);
        return d2.markup = String.fromCharCode(o2), e2.parentType = i2, true;
      }
      function Xt(e2, t2, n2) {
        let r2 = e2.md.block.ruler.getRules("paragraph"), i2 = e2.parentType, a2 = t2 + 1;
        for (e2.parentType = "paragraph"; a2 < n2 && !e2.isEmpty(a2); a2++) {
          if (e2.sCount[a2] - e2.blkIndent > 3 || e2.sCount[a2] < 0) continue;
          let t3 = false;
          for (let i3 = 0, o3 = r2.length; i3 < o3; i3++) if (r2[i3](e2, a2, n2, true)) {
            t3 = true;
            break;
          }
          if (t3) break;
        }
        let o2 = R(e2.getLines(t2, a2, e2.blkIndent, false));
        e2.line = a2;
        let s2 = e2.push("paragraph_open", "p", 1);
        s2.map = [t2, e2.line];
        let c2 = e2.push("inline", "", 0);
        return c2.content = o2, c2.map = [t2, e2.line], c2.children = [], e2.push("paragraph_close", "p", -1), e2.parentType = i2, true;
      }
      var q = [
        [
          "table",
          jt,
          ["paragraph", "reference"]
        ],
        ["code", Mt],
        [
          "fence",
          Nt,
          [
            "paragraph",
            "reference",
            "blockquote",
            "list"
          ]
        ],
        [
          "blockquote",
          Pt,
          [
            "paragraph",
            "reference",
            "blockquote",
            "list"
          ]
        ],
        [
          "hr",
          Ft,
          [
            "paragraph",
            "reference",
            "blockquote",
            "list"
          ]
        ],
        [
          "list",
          zt,
          [
            "paragraph",
            "reference",
            "blockquote"
          ]
        ],
        ["reference", Ht],
        [
          "html_block",
          qt,
          [
            "paragraph",
            "reference",
            "blockquote"
          ]
        ],
        [
          "heading",
          Jt,
          [
            "paragraph",
            "reference",
            "blockquote"
          ]
        ],
        ["lheading", Yt],
        ["paragraph", Xt]
      ];
      var Zt = class {
        constructor() {
          D(this, "ruler", new B()), D(this, "State", Dt);
          for (let e2 = 0; e2 < q.length; e2++) this.ruler.push(q[e2][0], q[e2][1], { alt: (q[e2][2] || []).slice() });
        }
        tokenize(e2, t2, n2) {
          let r2 = this.ruler.getRules(""), i2 = r2.length, a2 = e2.md.options.maxNesting, o2 = t2, s2 = false;
          for (; o2 < n2 && (e2.line = o2 = e2.skipEmptyLines(o2), !(o2 >= n2 || e2.sCount[o2] < e2.blkIndent)); ) {
            if (e2.level >= a2) {
              e2.line = n2;
              break;
            }
            let t3 = e2.line, c2 = false;
            for (let a3 = 0; a3 < i2; a3++) if (c2 = r2[a3](e2, o2, n2, false), c2) {
              if (t3 >= e2.line) throw Error("block rule didn't increment state.line");
              break;
            }
            if (!c2) throw Error("none of the block rules matched");
            e2.tight = !s2, e2.isEmpty(e2.line - 1) && (s2 = true), o2 = e2.line, o2 < n2 && e2.isEmpty(o2) && (s2 = true, o2++, e2.line = o2);
          }
        }
        parse(e2, t2, n2, r2) {
          if (!e2) return;
          let i2 = new this.State(e2, t2, n2, r2);
          this.tokenize(i2, i2.line, i2.lineMax);
        }
      };
      var Qt = class {
        constructor(e2, t2, n2, r2) {
          D(this, "pos", 0), D(this, "level", 0), D(this, "pending", ""), D(this, "pendingLevel", 0), D(this, "cache", {}), D(this, "backticks", {}), D(this, "backticksScanned", false), D(this, "skipHtmlSpecial", false), D(this, "linkLevel", 0), D(this, "delimiters", []), D(this, "_prev_delimiters", []), D(this, "Token", z), this.src = e2, this.env = n2, this.md = t2, this.tokens = r2, this.tokens_meta = Array(r2.length), this.posMax = this.src.length;
        }
        pushPending() {
          let e2 = new z("text", "", 0);
          return e2.content = this.pending, e2.level = this.pendingLevel, this.tokens.push(e2), this.pending = "", e2;
        }
        push(e2, t2, n2) {
          this.pending && this.pushPending();
          let r2 = new z(e2, t2, n2), i2;
          return n2 < 0 && (this.level--, this.delimiters = this._prev_delimiters.pop()), r2.level = this.level, n2 > 0 && (this.level++, this._prev_delimiters.push(this.delimiters), this.delimiters = [], i2 = { delimiters: this.delimiters }), this.pendingLevel = this.level, this.tokens.push(r2), this.tokens_meta.push(i2), r2;
        }
        scanDelims(e2, t2) {
          let n2 = this.posMax, r2 = this.src.charCodeAt(e2), i2;
          if (e2 === 0) i2 = 32;
          else if (e2 === 1) i2 = this.src.charCodeAt(0), (i2 & 63488) == 55296 && (i2 = 65533);
          else if (i2 = this.src.charCodeAt(e2 - 1), (i2 & 64512) == 56320) {
            let t3 = this.src.charCodeAt(e2 - 2);
            i2 = (t3 & 64512) == 55296 ? 65536 + (t3 - 55296 << 10) + (i2 - 56320) : 65533;
          } else (i2 & 64512) == 55296 && (i2 = 65533);
          let a2 = e2;
          for (; a2 < n2 && this.src.charCodeAt(a2) === r2; ) a2++;
          let o2 = a2 - e2, s2 = a2 < n2 ? this.src.charCodeAt(a2) : 32;
          if ((s2 & 64512) == 55296) {
            let e3 = this.src.charCodeAt(a2 + 1);
            s2 = (e3 & 64512) == 56320 ? 65536 + (s2 - 55296 << 10) + (e3 - 56320) : 65533;
          } else (s2 & 64512) == 56320 && (s2 = 65533);
          let c2 = I(i2) || F(i2), l2 = I(s2) || F(s2), u2 = P(i2), d2 = P(s2), f2 = !d2 && (!l2 || u2 || c2), p2 = !u2 && (!c2 || d2 || l2);
          return {
            can_open: f2 && (t2 || !p2 || c2),
            can_close: p2 && (t2 || !f2 || l2),
            length: o2
          };
        }
      };
      function $t(e2) {
        switch (e2) {
          case 10:
          case 33:
          case 35:
          case 36:
          case 37:
          case 38:
          case 42:
          case 43:
          case 45:
          case 58:
          case 60:
          case 61:
          case 62:
          case 64:
          case 91:
          case 92:
          case 93:
          case 94:
          case 95:
          case 96:
          case 123:
          case 125:
          case 126:
            return true;
          default:
            return false;
        }
      }
      function en(e2, t2) {
        let n2 = e2.pos;
        for (; n2 < e2.posMax && !$t(e2.src.charCodeAt(n2)); ) n2++;
        return n2 !== e2.pos && (t2 || (e2.pending += e2.src.slice(e2.pos, n2)), e2.pos = n2, true);
      }
      function tn(e2) {
        return e2 >= 65 && e2 <= 90 || e2 >= 97 && e2 <= 122;
      }
      function nn(e2) {
        return e2 >= 65 && e2 <= 90 || e2 >= 97 && e2 <= 122 || e2 >= 48 && e2 <= 57 || e2 === 43 || e2 === 45 || e2 === 46;
      }
      function rn(e2, t2) {
        if (!e2.md.options.linkify || e2.linkLevel > 0) return false;
        let n2 = e2.pos, r2 = e2.posMax;
        if (n2 + 3 > r2 || e2.src.charCodeAt(n2) !== 58 || e2.src.charCodeAt(n2 + 1) !== 47 || e2.src.charCodeAt(n2 + 2) !== 47) return false;
        let i2 = n2 - Math.min(10, e2.pending.length, n2), a2 = n2;
        for (; a2 > i2 && nn(e2.src.charCodeAt(a2 - 1)); ) a2--;
        if (a2 === n2 || !tn(e2.src.charCodeAt(a2))) return false;
        let o2 = n2 - a2, s2 = e2.md.linkify.matchAtStart(e2.src.slice(a2));
        if (!s2) return false;
        let c2 = s2.url;
        if (c2.length <= o2) return false;
        let l2 = c2.length;
        for (; l2 > 0 && c2.charCodeAt(l2 - 1) === 42; ) l2--;
        l2 !== c2.length && (c2 = c2.slice(0, l2));
        let u2 = e2.md.normalizeLink(c2);
        if (!e2.md.validateLink(u2)) return false;
        if (!t2) {
          e2.pending = e2.pending.slice(0, -o2);
          let t3 = e2.push("link_open", "a", 1);
          t3.attrs = [["href", u2]], t3.markup = "linkify", t3.info = "auto";
          let n3 = e2.push("text", "", 0);
          n3.content = e2.md.normalizeLinkText(c2);
          let r3 = e2.push("link_close", "a", -1);
          r3.markup = "linkify", r3.info = "auto";
        }
        return e2.pos += c2.length - o2, true;
      }
      function an(e2, t2) {
        let n2 = e2.pos;
        if (e2.src.charCodeAt(n2) !== 10) return false;
        let r2 = e2.pending.length - 1, i2 = e2.posMax;
        if (!t2) {
          if (r2 >= 0 && e2.pending.charCodeAt(r2) === 32) {
            if (r2 >= 1 && e2.pending.charCodeAt(r2 - 1) === 32) {
              let t3 = r2 - 1;
              for (; t3 >= 1 && e2.pending.charCodeAt(t3 - 1) === 32; ) t3--;
              e2.pending = e2.pending.slice(0, t3), e2.push("hardbreak", "br", 0);
            } else e2.pending = e2.pending.slice(0, -1), e2.push("softbreak", "br", 0);
          } else e2.push("softbreak", "br", 0);
        }
        for (n2++; n2 < i2 && N(e2.src.charCodeAt(n2)); ) n2++;
        return e2.pos = n2, true;
      }
      var on = [];
      for (let e2 = 0; e2 < 256; e2++) on.push(0);
      "\\!\"#$%&'()*+,./:;<=>?@[]^_`{|}~-".split("").forEach(function(e2) {
        on[e2.charCodeAt(0)] = 1;
      });
      function sn(e2, t2) {
        let n2 = e2.pos, r2 = e2.posMax;
        if (e2.src.charCodeAt(n2) !== 92 || (n2++, n2 >= r2)) return false;
        let i2 = e2.src.charCodeAt(n2);
        if (i2 === 10) {
          for (t2 || e2.push("hardbreak", "br", 0), n2++; n2 < r2 && (i2 = e2.src.charCodeAt(n2), N(i2)); ) n2++;
          return e2.pos = n2, true;
        }
        if (i2 === 32) {
          if (!t2) {
            let t3 = e2.push("text_special", "", 0);
            t3.content = "\\", t3.markup = "\\", t3.info = "escape";
          }
          return e2.pos = n2, true;
        }
        let a2 = e2.src[n2];
        if (i2 >= 55296 && i2 <= 56319 && n2 + 1 < r2) {
          let t3 = e2.src.charCodeAt(n2 + 1);
          t3 >= 56320 && t3 <= 57343 && (a2 += e2.src[n2 + 1], n2++);
        }
        let o2 = "\\" + a2;
        if (!t2) {
          let t3 = e2.push("text_special", "", 0);
          t3.content = i2 < 256 && on[i2] !== 0 ? a2 : o2, t3.markup = o2, t3.info = "escape";
        }
        return e2.pos = n2 + 1, true;
      }
      function cn(e2) {
        let t2 = {}, n2 = 0;
        for (; (n2 = e2.indexOf("`", n2)) !== -1; ) {
          let r2 = n2;
          for (; e2.charCodeAt(++n2) === 96; ) ;
          t2[n2 - r2] = r2;
        }
        return t2;
      }
      function ln(e2, t2) {
        var n2;
        let r2 = e2.pos;
        if (e2.src.charCodeAt(r2) !== 96) return false;
        let i2 = e2.posMax, a2 = r2 + 1;
        for (; a2 < i2 && e2.src.charCodeAt(a2) === 96; ) a2++;
        let o2 = e2.src.slice(r2, a2), s2 = o2.length;
        if (e2.backticksScanned || (e2.backticks = cn(e2.src), e2.backticksScanned = true), ((n2 = e2.backticks[s2]) == null ? -1 : n2) >= a2) {
          let n3 = a2, r3;
          for (; (r3 = e2.src.indexOf("`", n3)) !== -1 && r3 < i2; ) {
            for (n3 = r3 + 1; e2.src.charCodeAt(n3) === 96; ) n3++;
            if (n3 > i2) break;
            if (n3 - r3 === s2) {
              if (!t2) {
                let t3 = e2.push("code_inline", "code", 0);
                t3.markup = o2;
                let n4 = e2.src.slice(a2, r3).replace(/\n/g, " ");
                n4.startsWith(" ") && n4.endsWith(" ") && /[^ ]/.test(n4) && (n4 = n4.slice(1, -1)), t3.content = n4;
              }
              return e2.pos = n3, true;
            }
          }
        }
        return t2 || (e2.pending += o2), e2.pos = a2, true;
      }
      function un(e2, t2) {
        let n2 = e2.pos, r2 = e2.src.charCodeAt(n2);
        if (t2 || r2 !== 126) return false;
        let i2 = e2.scanDelims(e2.pos, true), a2 = i2.length, o2 = String.fromCharCode(r2);
        if (a2 < 2) return false;
        let s2;
        a2 % 2 && (s2 = e2.push("text", "", 0), s2.content = o2, a2--);
        for (let t3 = 0; t3 < a2; t3 += 2) s2 = e2.push("text", "", 0), s2.content = o2 + o2, e2.delimiters.push({
          marker: r2,
          length: 0,
          token: e2.tokens.length - 1,
          end: -1,
          open: i2.can_open,
          close: i2.can_close
        });
        return e2.pos += i2.length, true;
      }
      function dn(e2, t2) {
        let n2, r2 = [], i2 = t2.length;
        for (let a2 = 0; a2 < i2; a2++) {
          let i3 = t2[a2];
          if (i3.marker !== 126 || i3.end === -1) continue;
          let o2 = t2[i3.end];
          n2 = e2.tokens[i3.token], n2.type = "s_open", n2.tag = "s", n2.nesting = 1, n2.markup = "~~", n2.content = "", n2 = e2.tokens[o2.token], n2.type = "s_close", n2.tag = "s", n2.nesting = -1, n2.markup = "~~", n2.content = "", e2.tokens[o2.token - 1].type === "text" && e2.tokens[o2.token - 1].content === "~" && r2.push(o2.token - 1);
        }
        for (; r2.length; ) {
          let t3 = r2.pop(), i3 = t3 + 1;
          for (; i3 < e2.tokens.length && e2.tokens[i3].type === "s_close"; ) i3++;
          i3--, t3 !== i3 && (n2 = e2.tokens[i3], e2.tokens[i3] = e2.tokens[t3], e2.tokens[t3] = n2);
        }
      }
      function fn(e2) {
        let t2 = e2.tokens_meta, n2 = e2.tokens_meta.length;
        dn(e2, e2.delimiters);
        for (let i2 = 0; i2 < n2; i2++) {
          var r2;
          let n3 = (r2 = t2[i2]) == null ? void 0 : r2.delimiters;
          n3 && dn(e2, n3);
        }
      }
      var pn = {
        tokenize: un,
        postProcess: fn
      };
      function mn(e2, t2) {
        let n2 = e2.pos, r2 = e2.src.charCodeAt(n2);
        if (t2 || r2 !== 95 && r2 !== 42) return false;
        let i2 = e2.scanDelims(e2.pos, r2 === 42);
        for (let t3 = 0; t3 < i2.length; t3++) {
          let t4 = e2.push("text", "", 0);
          t4.content = String.fromCharCode(r2), e2.delimiters.push({
            marker: r2,
            length: i2.length,
            token: e2.tokens.length - 1,
            end: -1,
            open: i2.can_open,
            close: i2.can_close
          });
        }
        return e2.pos += i2.length, true;
      }
      function hn(e2, t2) {
        let n2 = t2.length;
        for (let r2 = n2 - 1; r2 >= 0; r2--) {
          let n3 = t2[r2];
          if (n3.marker !== 95 && n3.marker !== 42 || n3.end === -1) continue;
          let i2 = t2[n3.end], a2 = r2 > 0 && t2[r2 - 1].end === n3.end + 1 && t2[r2 - 1].marker === n3.marker && t2[r2 - 1].token === n3.token - 1 && t2[n3.end + 1].token === i2.token + 1, o2 = String.fromCharCode(n3.marker), s2 = e2.tokens[n3.token];
          s2.type = a2 ? "strong_open" : "em_open", s2.tag = a2 ? "strong" : "em", s2.nesting = 1, s2.markup = a2 ? o2 + o2 : o2, s2.content = "";
          let c2 = e2.tokens[i2.token];
          c2.type = a2 ? "strong_close" : "em_close", c2.tag = a2 ? "strong" : "em", c2.nesting = -1, c2.markup = a2 ? o2 + o2 : o2, c2.content = "", a2 && (e2.tokens[t2[r2 - 1].token].content = "", e2.tokens[t2[n3.end + 1].token].content = "", r2--);
        }
      }
      function gn(e2) {
        let t2 = e2.tokens_meta, n2 = e2.tokens_meta.length;
        hn(e2, e2.delimiters);
        for (let i2 = 0; i2 < n2; i2++) {
          var r2;
          let n3 = (r2 = t2[i2]) == null ? void 0 : r2.delimiters;
          n3 && hn(e2, n3);
        }
      }
      var _n = {
        tokenize: mn,
        postProcess: gn
      };
      function vn(e2, t2) {
        let n2, r2, i2, a2, o2 = "", s2 = "", c2 = e2.pos, l2 = true;
        if (e2.src.charCodeAt(e2.pos) !== 91) return false;
        let u2 = e2.pos, d2 = e2.posMax, f2 = e2.pos + 1, p2 = e2.md.helpers.parseLinkLabel(e2, e2.pos, true);
        if (p2 < 0) return false;
        let m2 = p2 + 1;
        if (m2 < d2 && e2.src.charCodeAt(m2) === 40) {
          for (l2 = false, m2++; m2 < d2 && (n2 = e2.src.charCodeAt(m2), N(n2) || n2 === 10); m2++) ;
          if (m2 >= d2) return false;
          if (c2 = m2, i2 = e2.md.helpers.parseLinkDestination(e2.src, m2, e2.posMax), i2.ok) {
            for (o2 = e2.md.normalizeLink(i2.str), e2.md.validateLink(o2) ? m2 = i2.pos : o2 = "", c2 = m2; m2 < d2 && (n2 = e2.src.charCodeAt(m2), N(n2) || n2 === 10); m2++) ;
            if (i2 = e2.md.helpers.parseLinkTitle(e2.src, m2, e2.posMax), m2 < d2 && c2 !== m2 && i2.ok) for (s2 = i2.str, m2 = i2.pos; m2 < d2 && (n2 = e2.src.charCodeAt(m2), N(n2) || n2 === 10); m2++) ;
          }
          (m2 >= d2 || e2.src.charCodeAt(m2) !== 41) && (l2 = true), m2++;
        }
        if (l2) {
          if (e2.env.references === void 0) return false;
          if (m2 < d2 && e2.src.charCodeAt(m2) === 91 ? (c2 = m2 + 1, m2 = e2.md.helpers.parseLinkLabel(e2, m2), m2 >= 0 ? r2 = e2.src.slice(c2, m2++) : m2 = p2 + 1) : m2 = p2 + 1, r2 || (r2 = e2.src.slice(f2, p2)), r2 = L(r2), a2 = e2.env.references[r2], !a2) return e2.pos = u2, false;
          o2 = a2.href, s2 = a2.title;
        }
        if (!t2) {
          e2.pos = f2, e2.posMax = p2;
          let t3 = e2.push("link_open", "a", 1), n3 = [["href", o2]];
          if (t3.attrs = n3, s2 && n3.push(["title", s2]), r2) {
            let e3 = /* @__PURE__ */ Object.create(null);
            e3.label = r2, t3.meta = e3;
          }
          e2.linkLevel++, e2.md.inline.tokenize(e2), e2.linkLevel--, e2.push("link_close", "a", -1);
        }
        return e2.pos = m2, e2.posMax = d2, true;
      }
      function yn(e2, t2) {
        let n2, r2, i2, a2, o2, s2, c2, l2, u2 = "", d2 = e2.pos, f2 = e2.posMax;
        if (e2.src.charCodeAt(e2.pos) !== 33 || e2.src.charCodeAt(e2.pos + 1) !== 91) return false;
        let p2 = e2.pos + 2, m2 = e2.md.helpers.parseLinkLabel(e2, e2.pos + 1, false);
        if (m2 < 0) return false;
        if (a2 = m2 + 1, a2 < f2 && e2.src.charCodeAt(a2) === 40) {
          for (a2++; a2 < f2 && (n2 = e2.src.charCodeAt(a2), N(n2) || n2 === 10); a2++) ;
          if (a2 >= f2) return false;
          for (l2 = a2, s2 = e2.md.helpers.parseLinkDestination(e2.src, a2, e2.posMax), s2.ok && (u2 = e2.md.normalizeLink(s2.str), e2.md.validateLink(u2) ? a2 = s2.pos : u2 = ""), l2 = a2; a2 < f2 && (n2 = e2.src.charCodeAt(a2), N(n2) || n2 === 10); a2++) ;
          if (s2 = e2.md.helpers.parseLinkTitle(e2.src, a2, e2.posMax), a2 < f2 && l2 !== a2 && s2.ok) for (c2 = s2.str, a2 = s2.pos; a2 < f2 && (n2 = e2.src.charCodeAt(a2), N(n2) || n2 === 10); a2++) ;
          else c2 = "";
          if (a2 >= f2 || e2.src.charCodeAt(a2) !== 41) return e2.pos = d2, false;
          a2++;
        } else {
          if (e2.env.references === void 0) return false;
          if (a2 < f2 && e2.src.charCodeAt(a2) === 91 ? (l2 = a2 + 1, a2 = e2.md.helpers.parseLinkLabel(e2, a2), a2 >= 0 ? i2 = e2.src.slice(l2, a2++) : a2 = m2 + 1) : a2 = m2 + 1, i2 || (i2 = e2.src.slice(p2, m2)), i2 = L(i2), o2 = e2.env.references[i2], !o2) return e2.pos = d2, false;
          u2 = o2.href, c2 = o2.title;
        }
        if (!t2) {
          r2 = e2.src.slice(p2, m2);
          let t3 = [];
          e2.md.inline.parse(r2, e2.md, e2.env, t3);
          let n3 = e2.push("image", "img", 0), a3 = [["src", u2], ["alt", ""]];
          if (n3.attrs = a3, n3.children = t3, n3.content = r2, c2 && a3.push(["title", c2]), i2) {
            let e3 = /* @__PURE__ */ Object.create(null);
            e3.label = i2, n3.meta = e3;
          }
        }
        return e2.pos = a2, e2.posMax = f2, true;
      }
      var bn = /^([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/;
      var xn = /^([a-zA-Z][a-zA-Z0-9+.-]{1,31}):([^<>\x00-\x20]*)$/;
      function Sn(e2, t2) {
        let n2 = e2.pos;
        if (e2.src.charCodeAt(n2) !== 60) return false;
        let r2 = e2.pos, i2 = e2.posMax;
        for (; ; ) {
          if (++n2 >= i2) return false;
          let t3 = e2.src.charCodeAt(n2);
          if (t3 === 60) return false;
          if (t3 === 62) break;
        }
        let a2 = e2.src.slice(r2 + 1, n2);
        if (xn.test(a2)) {
          let n3 = e2.md.normalizeLink(a2);
          if (!e2.md.validateLink(n3)) return false;
          if (!t2) {
            let t3 = e2.push("link_open", "a", 1);
            t3.attrs = [["href", n3]], t3.markup = "autolink", t3.info = "auto";
            let r3 = e2.push("text", "", 0);
            r3.content = e2.md.normalizeLinkText(a2);
            let i3 = e2.push("link_close", "a", -1);
            i3.markup = "autolink", i3.info = "auto";
          }
          return e2.pos += a2.length + 2, true;
        }
        if (bn.test(a2)) {
          let n3 = e2.md.normalizeLink(`mailto:${a2}`);
          if (!e2.md.validateLink(n3)) return false;
          if (!t2) {
            let t3 = e2.push("link_open", "a", 1);
            t3.attrs = [["href", n3]], t3.markup = "autolink", t3.info = "auto";
            let r3 = e2.push("text", "", 0);
            r3.content = e2.md.normalizeLinkText(a2);
            let i3 = e2.push("link_close", "a", -1);
            i3.markup = "autolink", i3.info = "auto";
          }
          return e2.pos += a2.length + 2, true;
        }
        return false;
      }
      function Cn(e2) {
        return /^<a[>\s]/i.test(e2);
      }
      function wn(e2) {
        return /^<\/a\s*>/i.test(e2);
      }
      function Tn(e2) {
        let t2 = e2 | 32;
        return t2 >= 97 && t2 <= 122;
      }
      function En(e2, t2) {
        let n2 = e2.src, r2, i2;
        if (n2.startsWith("<!--", t2)) {
          if (n2.startsWith(">", t2 + 4)) return t2 + 5;
          if (n2.startsWith("->", t2 + 4)) return t2 + 6;
          r2 = t2 + 4, i2 = "-->";
        } else if (n2.startsWith("<![CDATA[", t2)) r2 = t2 + 9, i2 = "]]>";
        else if (n2.charCodeAt(t2 + 1) === 63) r2 = t2 + 2, i2 = "?>";
        else if (Tn(n2.charCodeAt(t2 + 2))) r2 = t2 + 3, i2 = ">";
        else return -1;
        if (e2.skipHtmlSpecial) return -1;
        let a2 = n2.indexOf(i2, r2);
        return a2 < 0 ? (e2.skipHtmlSpecial = true, -1) : a2 + i2.length;
      }
      function Dn(e2, t2) {
        if (!e2.md.options.html) return false;
        let n2 = e2.posMax, r2 = e2.pos;
        if (e2.src.charCodeAt(r2) !== 60 || r2 + 2 >= n2) return false;
        let i2, a2 = e2.src.charCodeAt(r2 + 1);
        if (a2 === 33 || a2 === 63) i2 = En(e2, r2);
        else if (a2 === 47 || Tn(a2)) {
          let t3 = e2.src.slice(r2).match(Kt);
          i2 = t3 ? r2 + t3[0].length : -1;
        } else return false;
        if (i2 < 0) return false;
        if (!t2) {
          let t3 = e2.push("html_inline", "", 0);
          t3.content = e2.src.slice(r2, i2), Cn(t3.content) && e2.linkLevel++, wn(t3.content) && e2.linkLevel--;
        }
        return e2.pos = i2, true;
      }
      var On = /^&#((?:x[a-f0-9]{1,6}|[0-9]{1,7}));/i;
      var kn = /^&([a-z][a-z0-9]{1,31});/i;
      function An(e2, t2) {
        let n2 = e2.pos, r2 = e2.posMax;
        if (e2.src.charCodeAt(n2) !== 38 || n2 + 1 >= r2) return false;
        if (e2.src.charCodeAt(n2 + 1) === 35) {
          let r3 = e2.src.slice(n2).match(On);
          if (r3) {
            if (!t2) {
              let t3 = r3[1][0].toLowerCase() === "x" ? parseInt(r3[1].slice(1), 16) : parseInt(r3[1], 10), n3 = e2.push("text_special", "", 0);
              n3.content = Me(t3) ? A(t3) : A(65533), n3.markup = r3[0], n3.info = "entity";
            }
            return e2.pos += r3[0].length, true;
          }
        } else {
          let r3 = e2.src.slice(n2).match(kn);
          if (r3) {
            let n3 = Oe(r3[0]);
            if (n3 !== r3[0]) {
              if (!t2) {
                let t3 = e2.push("text_special", "", 0);
                t3.content = n3, t3.markup = r3[0], t3.info = "entity";
              }
              return e2.pos += r3[0].length, true;
            }
          }
        }
        return false;
      }
      function jn(e2) {
        let t2 = {}, n2 = e2.length;
        if (!n2) return;
        let r2 = 0, i2 = -2, a2 = [];
        for (let o2 = 0; o2 < n2; o2++) {
          let n3 = e2[o2];
          if (a2.push(0), (e2[r2].marker !== n3.marker || i2 !== n3.token - 1) && (r2 = o2), i2 = n3.token, n3.length = n3.length || 0, !n3.close) continue;
          t2.hasOwnProperty(n3.marker) || (t2[n3.marker] = [
            -1,
            -1,
            -1,
            -1,
            -1,
            -1
          ]);
          let s2 = t2[n3.marker][(n3.open ? 3 : 0) + n3.length % 3], c2 = r2 - a2[r2] - 1, l2 = c2;
          for (; c2 > s2; c2 -= a2[c2] + 1) {
            let t3 = e2[c2];
            if (t3.marker === n3.marker && t3.open && t3.end < 0) {
              let r3 = false;
              if ((t3.close || n3.open) && (t3.length + n3.length) % 3 == 0 && (t3.length % 3 != 0 || n3.length % 3 != 0) && (r3 = true), !r3) {
                let r4 = c2 > 0 && !e2[c2 - 1].open ? a2[c2 - 1] + 1 : 0;
                a2[o2] = o2 - c2 + r4, a2[c2] = r4, n3.open = false, t3.end = o2, t3.close = false, l2 = -1, i2 = -2;
                break;
              }
            }
          }
          l2 !== -1 && (t2[n3.marker][(n3.open ? 3 : 0) + (n3.length || 0) % 3] = l2);
        }
      }
      function Mn(e2) {
        let t2 = e2.tokens_meta, n2 = e2.tokens_meta.length;
        jn(e2.delimiters);
        for (let e3 = 0; e3 < n2; e3++) {
          var r2;
          let n3 = (r2 = t2[e3]) == null ? void 0 : r2.delimiters;
          n3 && jn(n3);
        }
      }
      function Nn(e2) {
        let t2, n2, r2 = 0, i2 = e2.tokens, a2 = e2.tokens.length;
        for (t2 = n2 = 0; t2 < a2; t2++) i2[t2].nesting < 0 && r2--, i2[t2].level = r2, i2[t2].nesting > 0 && r2++, i2[t2].type === "text" && t2 + 1 < a2 && i2[t2 + 1].type === "text" ? i2[t2 + 1].content = i2[t2].content + i2[t2 + 1].content : (t2 !== n2 && (i2[n2] = i2[t2]), n2++);
        t2 !== n2 && (i2.length = n2);
      }
      var Pn = [
        ["text", en],
        ["linkify", rn],
        ["newline", an],
        ["escape", sn],
        ["backticks", ln],
        ["strikethrough", pn.tokenize],
        ["emphasis", _n.tokenize],
        ["link", vn],
        ["image", yn],
        ["autolink", Sn],
        ["html_inline", Dn],
        ["entity", An]
      ];
      var Fn = [
        ["balance_pairs", Mn],
        ["strikethrough", pn.postProcess],
        ["emphasis", _n.postProcess],
        ["fragments_join", Nn]
      ];
      var In = class {
        constructor() {
          D(this, "ruler", new B()), D(this, "ruler2", new B()), D(this, "State", Qt);
          for (let e2 = 0; e2 < Pn.length; e2++) this.ruler.push(Pn[e2][0], Pn[e2][1]);
          for (let e2 = 0; e2 < Fn.length; e2++) this.ruler2.push(Fn[e2][0], Fn[e2][1]);
        }
        skipToken(e2) {
          let t2 = e2.pos, n2 = this.ruler.getRules(""), r2 = n2.length, i2 = e2.md.options.maxNesting, a2 = e2.cache;
          if (a2[t2] !== void 0) {
            e2.pos = a2[t2];
            return;
          }
          let o2 = false;
          if (e2.level < i2) {
            for (let i3 = 0; i3 < r2; i3++) if (e2.level++, o2 = n2[i3](e2, true), e2.level--, o2) {
              if (t2 >= e2.pos) throw Error("inline rule didn't increment state.pos");
              break;
            }
          } else e2.pos = e2.posMax;
          o2 || e2.pos++, a2[t2] = e2.pos;
        }
        tokenize(e2) {
          let t2 = this.ruler.getRules(""), n2 = t2.length, r2 = e2.posMax, i2 = e2.md.options.maxNesting;
          for (; e2.pos < r2; ) {
            let a2 = e2.pos, o2 = false;
            if (e2.level < i2) {
              for (let r3 = 0; r3 < n2; r3++) if (o2 = t2[r3](e2, false), o2) {
                if (a2 >= e2.pos) throw Error("inline rule didn't increment state.pos");
                break;
              }
            }
            if (o2) {
              if (e2.pos >= r2) break;
            } else e2.pending += e2.src[e2.pos++];
          }
          e2.pending && e2.pushPending();
        }
        parse(e2, t2, n2, r2) {
          let i2 = new this.State(e2, t2, n2, r2);
          this.tokenize(i2);
          let a2 = this.ruler2.getRules(""), o2 = a2.length;
          for (let e3 = 0; e3 < o2; e3++) a2[e3](i2);
        }
      };
      var Ln = class {
        constructor(e2 = {}) {
          D(this, "src_Any", C.source), D(this, "src_Cc", ee.source), D(this, "src_Z", ie.source), D(this, "src_P", ne.source), D(this, "src_ZPCc", [
            this.src_Z,
            this.src_P,
            this.src_Cc
          ].join("|")), D(this, "src_ZCc", [this.src_Z, this.src_Cc].join("|")), D(this, "cache", {}), D(this, "opts", {
            maxLength: 1e4,
            urlAuth: false,
            schema_names: []
          }), this.opts = {
            ...this.opts,
            ...e2
          };
        }
        set(e2 = {}) {
          return this.opts = {
            ...this.opts,
            ...e2
          }, this.cache = {}, this;
        }
        escapeRE(e2) {
          return e2.replace(/[.?*+^$[\]\\(){}|-]/g, "\\$&");
        }
        nestedPairRE(e2, t2, n2 = 4) {
          let r2 = this.escapeRE(e2), i2 = this.escapeRE(t2), a2 = `(?:(?!${this.src_ZCc}|${r2}|${i2}).)`, o2 = `${r2}${a2}{0,1000}${i2}`;
          for (let e3 = 2; e3 <= n2; e3++) o2 = `${r2}(?:${a2}|${o2}){0,1000}${i2}`;
          return o2;
        }
        get_text_separators() {
          var e2, t2;
          return (t2 = (e2 = this.cache).text_separators) == null ? e2.text_separators = /[><\uff5c]/ : t2;
        }
        get_pseudo_letter() {
          var e2, t2;
          return (t2 = (e2 = this.cache).src_pseudo_letter) == null ? e2.src_pseudo_letter = RegExp(`(?:(?!${this.get_text_separators().source}|${this.src_ZPCc})${this.src_Any})`) : t2;
        }
        get_ipv4_addr() {
          var e2, t2;
          return (t2 = (e2 = this.cache).src_ip4) == null ? e2.src_ip4 = /* @__PURE__ */ RegExp("(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])[.]){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])") : t2;
        }
        get_ipv6_addr() {
          var e2, t2;
          let n2 = "[0-9A-Fa-f]{1,4}", r2 = `(?:(?:${n2}:${n2})|${this.get_ipv4_addr().source})`;
          return (t2 = (e2 = this.cache).src_ip6_addr) == null ? e2.src_ip6_addr = RegExp(`(?:(?:${n2}:){6}${r2}|::(?:${n2}:){5}${r2}|(?:${n2})?::(?:${n2}:){4}${r2}|(?:(?:${n2}:){0,1}${n2})?::(?:${n2}:){3}${r2}|(?:(?:${n2}:){0,2}${n2})?::(?:${n2}:){2}${r2}|(?:(?:${n2}:){0,3}${n2})?::${n2}:${r2}|(?:(?:${n2}:){0,4}${n2})?::${r2}|(?:(?:${n2}:){0,5}${n2})?::${n2}|(?:(?:${n2}:){0,6}${n2})?::)`) : t2;
        }
        get_ipv6_url_host() {
          var e2, t2;
          return (t2 = (e2 = this.cache).src_ip6_host) == null ? e2.src_ip6_host = RegExp(`\\[${this.get_ipv6_addr().source}\\]`) : t2;
        }
        get_ipv6_mail_host() {
          var e2, t2;
          return (t2 = (e2 = this.cache).src_ipv6_mail_host) == null ? e2.src_ipv6_mail_host = RegExp(`\\[IPv6:${this.get_ipv6_addr().source}\\]`) : t2;
        }
        get_auth() {
          var e2, t2;
          return (t2 = (e2 = this.cache).src_auth) == null ? e2.src_auth = RegExp(`(?:(?:(?!${this.src_ZCc}|[@/\\[\\]()]).){1,50}@)?`) : t2;
        }
        get_port() {
          var e2, t2;
          return (t2 = (e2 = this.cache).src_port) == null ? e2.src_port = /* @__PURE__ */ RegExp("(?::(?:6(?:[0-4]\\d{3}|5(?:[0-4]\\d{2}|5(?:[0-2]\\d|3[0-5])))|[1-5]?\\d{1,4}))?") : t2;
        }
        get_host_terminator() {
          var e2, t2;
          return (t2 = (e2 = this.cache).src_host_terminator) == null ? e2.src_host_terminator = RegExp(`(?=$|${this.get_text_separators().source}|${this.src_ZPCc})(?!${this.opts["---"] ? "-(?!--)|" : "-|"}_|:\\d|\\.-|\\.(?!$|${this.src_ZPCc}))`) : t2;
        }
        get_path_terminator() {
          var e2, t2;
          return (t2 = (e2 = this.cache).src_path_terminator) == null ? e2.src_path_terminator = RegExp(`${this.src_ZPCc}|${this.get_text_separators().source}`) : t2;
        }
        get_path() {
          var e2, t2;
          return (t2 = (e2 = this.cache).src_path) == null ? e2.src_path = RegExp(`(?:[/?#](?:${this.nestedPairRE("[", "]")}|${this.nestedPairRE("(", ")")}|${this.nestedPairRE("{", "}")}|\\"(?:(?!${this.src_ZCc}|["]).){1,100}\\"|\\'(?:(?!${this.src_ZCc}|[']).){1,100}\\'|\\'(?=${this.get_pseudo_letter().source}|[-])|\\.{2,20}[:]?[a-zA-Z0-9%/&]|\\.(?!${this.src_ZCc}|[.]|$)|` + (this.opts["---"] ? "\\-(?!--(?:[^-]|$))(?:-{0,19})|" : "\\-{1,20}|") + `,(?!${this.src_ZCc}|$)|;(?!${this.src_ZCc}|$)|\\!{1,20}(?!${this.src_ZCc}|[!]|$)|\\?(?!${this.src_ZCc}|[?]|$)|` + this.get_path_extra().source + `[\\\\/:%@#&=_~*]|(?!${this.get_path_terminator().source}).){1,${this.opts.maxLength}}|\\/)?`) : t2;
        }
        get_mail_name() {
          var e2, t2;
          return (t2 = (e2 = this.cache).src_mail_name) == null ? e2.src_mail_name = /* @__PURE__ */ RegExp("[-!#$%&'*+/=?^_`{|}~a-zA-Z0-9](?:[-!#$%&'*+/=?^_`{|}~a-zA-Z0-9]|[.](?=[-!#$%&'*+/=?^_`{|}~a-zA-Z0-9])){0,63}") : t2;
        }
        get_xn() {
          var e2, t2;
          return (t2 = (e2 = this.cache).src_xn) == null ? e2.src_xn = /* @__PURE__ */ RegExp("xn--[a-z0-9\\-]{1,59}") : t2;
        }
        get_tld() {
          if (this.cache.tld) return this.cache.tld;
          let e2 = [...new Set(this.opts.tlds || [])].sort().reverse().join("|");
          return this.cache.tld = RegExp(`${e2 || "$#none#$"}|${this.get_xn().source}`), this.cache.tld;
        }
        get_domain_root() {
          var e2, t2;
          return (t2 = (e2 = this.cache).src_domain_root) == null ? e2.src_domain_root = RegExp("(?:" + this.get_xn().source + `|${this.get_pseudo_letter().source}{1,63})`) : t2;
        }
        get_domain() {
          var e2, t2;
          return (t2 = (e2 = this.cache).src_domain) == null ? e2.src_domain = RegExp("(?:" + this.get_xn().source + `|(?:${this.get_pseudo_letter().source})|(?:${this.get_pseudo_letter().source}(?:-|${this.get_pseudo_letter().source}){0,61}${this.get_pseudo_letter().source}))`) : t2;
        }
        get_url_host_port() {
          var e2, t2;
          return (t2 = (e2 = this.cache).url_host_port) == null ? e2.url_host_port = RegExp("(?:" + this.get_ipv6_url_host().source + `|(?:(?:(?:${this.get_domain().source})\\.){0,10}${this.get_domain().source}))` + this.get_port().source + this.get_host_terminator().source) : t2;
        }
        get_fuzzy_url_host_port() {
          var e2, t2;
          return (t2 = (e2 = this.cache).fuzzy_url_host_port) == null ? e2.fuzzy_url_host_port = RegExp("(?:" + (this.opts.fuzzyIP ? this.get_ipv4_addr().source + "|" : "") + `(?:(?:(?:${this.get_domain().source})\\.){1,10}(?:${this.get_tld().source})))` + this.get_host_terminator().source) : t2;
        }
        get_mail_host() {
          var e2, t2;
          return (t2 = (e2 = this.cache).src_mail_host) == null ? e2.src_mail_host = RegExp("(?:" + this.get_ipv6_mail_host().source + `|(?:(?:(?:${this.get_domain().source})\\.){0,4}${this.get_domain().source}))` + this.get_host_terminator().source) : t2;
        }
        get_fuzzy_mail_host() {
          var e2, t2;
          return (t2 = (e2 = this.cache).src_fuzzy_mail_host) == null ? e2.src_fuzzy_mail_host = RegExp("(?:" + this.get_ipv6_mail_host().source + `|(?:(?:(?:${this.get_domain().source})[.]){1,4}${this.get_domain_root().source}))` + this.get_host_terminator().source) : t2;
        }
        get_path_extra() {
          var e2, t2;
          return (t2 = (e2 = this.cache).src_path_extra) == null ? e2.src_path_extra = /* @__PURE__ */ RegExp("") : t2;
        }
        get_fuzzy_mail_host_search() {
          var e2, t2;
          return (t2 = (e2 = this.cache).mail_fuzzy_host_search) == null ? e2.mail_fuzzy_host_search = RegExp(`@${this.get_fuzzy_mail_host().source}`, "ig") : t2;
        }
        get_fuzzy_link_search() {
          var e2, t2;
          return (t2 = (e2 = this.cache).link_fuzzy_search) == null ? e2.link_fuzzy_search = RegExp(`(^|(?![.:/\\-_@])(?:[$+<=>^\`|｜]|${this.src_ZPCc}))(?:(?![$+<=>^\`|｜])${this.get_fuzzy_url_host_port().source}${this.get_path().source})`, "ig") : t2;
        }
        get_http_validator() {
          var e2, t2;
          return (t2 = (e2 = this.cache).http_validator) == null ? e2.http_validator = RegExp("\\/\\/" + (this.opts.urlAuth ? this.get_auth().source : "") + this.get_url_host_port().source + this.get_path().source, "iy") : t2;
        }
        get_relative_proto_validator() {
          var e2, t2;
          return (t2 = (e2 = this.cache).relative_proto_validator) == null ? e2.relative_proto_validator = RegExp((this.opts.urlAuth ? this.get_auth().source : "") + `(?:localhost|${this.get_ipv6_url_host().source}|(?:(?:${this.get_domain().source})[.]){1,10}${this.get_domain_root().source})` + this.get_port().source + this.get_host_terminator().source + this.get_path().source, "iy") : t2;
        }
        get_mail_name_validator() {
          var e2, t2;
          return (t2 = (e2 = this.cache).mail_name_validator) == null ? e2.mail_name_validator = RegExp(`(?:^|${this.get_text_separators().source}|"|\\(|${this.src_ZCc})(${this.get_mail_name().source})$`) : t2;
        }
        get_mailto_validator() {
          var e2, t2;
          return (t2 = (e2 = this.cache).mailto_validator) == null ? e2.mailto_validator = RegExp(`${this.get_mail_name().source}@${this.get_mail_host().source}`, "iy") : t2;
        }
        get_schema_names() {
          var e2, t2;
          return (t2 = (e2 = this.cache).schema_names) == null ? e2.schema_names = new RegExp((this.opts.schema_names || []).map((e3) => this.escapeRE(e3)).join("|")) : t2;
        }
        get_schema_search() {
          var e2, t2;
          return (t2 = (e2 = this.cache).schema_search) == null ? e2.schema_search = RegExp(`(^|(?!_)(?:[><｜]|${this.src_ZPCc}))(${this.get_schema_names().source})`, "ig") : t2;
        }
        get_schema_at_start() {
          var e2, t2;
          return (t2 = (e2 = this.cache).schema_at_start) == null ? e2.schema_at_start = RegExp(`^${this.get_schema_search().source}`, "i") : t2;
        }
      };
      var Rn = {
        validate: (e2, t2, n2) => {
          let r2 = n2.re.get_http_validator();
          r2.lastIndex = t2;
          let i2 = r2.exec(e2);
          return i2 ? i2[0].length : 0;
        },
        normalize: (e2, t2) => t2.normalize(e2)
      };
      var zn = {
        "http:": Rn,
        "https:": Rn,
        "ftp:": Rn,
        "//": {
          validate: function(e2, t2, n2) {
            let r2 = n2.re.get_relative_proto_validator();
            r2.lastIndex = t2;
            let i2 = r2.exec(e2);
            return i2 ? t2 >= 3 && e2[t2 - 3] === ":" || t2 >= 3 && e2[t2 - 3] === "/" ? 0 : i2[0].length : 0;
          },
          normalize: (e2, t2) => t2.normalize(e2)
        },
        "mailto:": {
          validate: function(e2, t2, n2) {
            let r2 = n2.re.get_mailto_validator();
            r2.lastIndex = t2;
            let i2 = r2.exec(e2);
            return i2 ? i2[0].length : 0;
          },
          normalize: (e2, t2) => t2.normalize(e2)
        }
      };
      var Bn = "a:cdefgilmnoqrstuwxz|b:abdefghijmnorstvwyz|c:acdfghiklmnoruvwxyz|d:ejkmoz|e:cegrstu|f:ijkmor|g:abdefghilmnpqrstuwy|h:kmnrtu|i:delmnoqrst|j:emop|k:eghimnprwyz|l:abcikrstuvy|m:acdeghklmnopqrstuvwxyz|n:acefgilopruz|o:m|p:aefghklmnrstwy|q:a|r:eosuw|s:abcdeghijklmnortuvxyz|t:cdfghjklmnortvwz|u:agksyz|v:aceginu|w:fs|y:et|z:amw";
      var Vn = "biz|com|edu|gov|net|org|pro|web|xxx|aero|asia|coop|info|museum|name|shop|рф";
      function Hn() {
        let e2 = Vn.split("|");
        return Bn.split("|").forEach((t2) => {
          let n2 = t2.indexOf(":"), r2 = t2.slice(0, n2);
          for (let i2 of t2.slice(n2 + 1)) e2.push(r2 + i2);
        }), e2;
      }
      var Un = {
        fuzzyLink: false,
        fuzzyEmail: true,
        fuzzyIP: false,
        "---": false,
        tlds: Hn(),
        urlAuth: false,
        maxLength: 1e4
      };
      var Wn = class {
        constructor(e2, t2, n2, r2) {
          D(this, "schema", void 0), D(this, "index", void 0), D(this, "lastIndex", void 0), D(this, "raw", void 0), D(this, "text", void 0), D(this, "url", void 0);
          let i2 = e2.slice(n2, r2);
          this.schema = t2.toLowerCase(), this.index = n2, this.lastIndex = r2, this.raw = i2, this.text = i2, this.url = i2;
        }
      };
      var Gn = class {
        constructor(e2 = {}) {
          D(this, "__opts__", void 0), D(this, "__schemas__", void 0), D(this, "re", void 0);
          let { rebuilder: t2, ...n2 } = e2;
          this.__opts__ = {
            ...Un,
            ...n2
          }, this.__schemas__ = { ...zn }, this.re = t2 || new Ln(), this.re.set({
            ...this.__opts__,
            schema_names: Object.keys(this.__schemas__)
          });
        }
        add(e2, t2 = null) {
          if (!t2) delete this.__schemas__[e2];
          else {
            let n2 = {
              normalize: (e3, t3) => t3.normalize(e3),
              ...t2
            };
            this.__schemas__[e2] = n2;
          }
          return this.re.set({
            ...this.__opts__,
            schema_names: Object.keys(this.__schemas__)
          }), this;
        }
        set(e2 = {}) {
          return this.__opts__ = {
            ...this.__opts__,
            ...e2
          }, this.re.set({
            ...this.__opts__,
            schema_names: Object.keys(this.__schemas__)
          }), this;
        }
        test(e2) {
          if (!e2.length) return false;
          let t2, n2;
          for (n2 = this.re.get_schema_search(), n2.lastIndex = 0; (t2 = n2.exec(e2)) !== null; ) if (this.testSchemaAt(e2, t2[2], n2.lastIndex)) return true;
          if (this.__opts__.fuzzyLink && this.__schemas__["http:"] && (n2 = this.re.get_fuzzy_link_search(), n2.lastIndex = 0, n2.exec(e2) !== null)) return true;
          if (this.__opts__.fuzzyEmail && this.__schemas__["mailto:"] && e2.indexOf("@") >= 0) {
            let n3 = this.re.get_fuzzy_mail_host_search(), r2 = this.re.get_mail_name_validator();
            for (n3.lastIndex = 0; (t2 = n3.exec(e2)) !== null; ) {
              let n4 = e2.slice(Math.max(0, t2.index - 65), t2.index);
              if (r2.test(n4)) return true;
            }
          }
          return false;
        }
        testSchemaAt(e2, t2, n2) {
          return this.__schemas__[t2.toLowerCase()] ? this.__schemas__[t2.toLowerCase()].validate(e2.slice(0, n2 + this.__opts__.maxLength), n2, this) : 0;
        }
        match(e2) {
          let t2 = [], n2 = this.re.get_schema_search(), r2, i2, a2, o2, s2, c2, l2 = false, u2 = false, d2 = false, f2 = 0;
          if (!e2.length) return null;
          for (n2.lastIndex = 0, this.__opts__.fuzzyLink && this.__schemas__["http:"] && (r2 = this.re.get_fuzzy_link_search(), r2.lastIndex = 0), this.__opts__.fuzzyEmail && this.__schemas__["mailto:"] && (i2 = this.re.get_fuzzy_mail_host_search(), i2.lastIndex = 0, a2 = this.re.get_mail_name_validator()); ; ) {
            let p2 = Math.max(f2 - 1, 0);
            if (i2 && a2 && !d2 && (!s2 || s2.index < f2)) for (i2.lastIndex < p2 && (i2.lastIndex = p2); ; ) {
              let t3 = i2.exec(e2);
              if (!t3) {
                d2 = true, s2 = void 0;
                break;
              }
              let n3 = a2.exec(e2.slice(Math.max(0, t3.index - 65), t3.index));
              if (n3) {
                if (s2 = {
                  schema: "mailto:",
                  index: t3.index - n3[1].length,
                  lastIndex: t3.index + t3[0].length
                }, s2.index >= f2) break;
                i2.lastIndex < p2 && (i2.lastIndex = p2);
              }
            }
            if (r2 && !u2 && (!o2 || o2.index < f2)) for (r2.lastIndex < p2 && (r2.lastIndex = p2); ; ) {
              let t3 = r2.exec(e2);
              if (!t3) {
                u2 = true, o2 = void 0;
                break;
              }
              if (o2 = {
                schema: "",
                index: t3.index + t3[1].length,
                lastIndex: t3.index + t3[0].length
              }, o2.index >= f2) break;
              r2.lastIndex < p2 && (r2.lastIndex = p2);
            }
            let m2 = s2;
            (!m2 || o2 && (o2.index < m2.index || o2.index === m2.index && o2.lastIndex > m2.lastIndex)) && (m2 = o2);
            let h2;
            if (!l2) for (; ; ) {
              if (!c2) {
                n2.lastIndex < p2 && (n2.lastIndex = p2);
                let t4 = n2.exec(e2);
                if (!t4) {
                  l2 = true;
                  break;
                }
                c2 = {
                  schema: t4[2],
                  index: t4.index + t4[1].length,
                  lastIndex: t4.index + t4[0].length
                };
              }
              if (c2.index < f2) {
                c2 = void 0;
                continue;
              }
              if (m2 && c2.index > m2.index) break;
              let t3 = c2;
              c2 = void 0;
              let r3 = this.testSchemaAt(e2, t3.schema, t3.lastIndex);
              if (r3) {
                h2 = {
                  schema: t3.schema,
                  index: t3.index,
                  lastIndex: t3.lastIndex + r3
                };
                break;
              }
            }
            let g2 = h2;
            if ((!g2 || s2 && (s2.index < g2.index || s2.index === g2.index && s2.lastIndex > g2.lastIndex)) && (g2 = s2), (!g2 || o2 && (o2.index < g2.index || o2.index === g2.index && o2.lastIndex > g2.lastIndex)) && (g2 = o2), !g2) break;
            g2 === s2 ? s2 = void 0 : g2 === o2 && (o2 = void 0);
            let _2 = new Wn(e2, g2.schema, g2.index, g2.lastIndex);
            _2.schema ? this.__schemas__[_2.schema].normalize(_2, this) : this.normalize(_2), t2.push(_2), f2 = g2.lastIndex;
          }
          return t2.length ? t2 : null;
        }
        matchAtStart(e2) {
          if (!e2.length) return null;
          let t2 = this.re.get_schema_at_start().exec(e2);
          if (!t2) return null;
          let n2 = this.testSchemaAt(e2, t2[2], t2[0].length);
          if (!n2) return null;
          let r2 = new Wn(e2, t2[2], t2.index + t2[1].length, t2.index + t2[0].length + n2);
          return this.__schemas__[r2.schema].normalize(r2, this), r2;
        }
        tlds(e2, t2 = false) {
          return e2 = Array.isArray(e2) ? e2 : [e2], t2 ? this.__opts__.tlds = this.__opts__.tlds.concat(e2) : this.__opts__.tlds = e2, this.re.set({
            ...this.__opts__,
            schema_names: Object.keys(this.__schemas__)
          }), this;
        }
        normalize(e2) {
          e2.schema || (e2.url = `http://${e2.url}`), e2.schema === "mailto:" && !/^mailto:/i.test(e2.url) && (e2.url = `mailto:${e2.url}`);
        }
      };
      var J = 2147483647;
      var Y = 36;
      var Kn = 1;
      var X = 26;
      var qn = 38;
      var Jn = 700;
      var Yn = 72;
      var Xn = 128;
      var Zn = "-";
      var Qn = /^xn--/;
      var $n = /[^\0-\x7F]/;
      var er = /[\x2E\u3002\uFF0E\uFF61]/g;
      var tr = {
        overflow: "Overflow: input needs wider integers to process",
        "not-basic": "Illegal input >= 0x80 (not a basic code point)",
        "invalid-input": "Invalid input"
      };
      var nr = 35;
      var Z = Math.floor;
      var rr = String.fromCharCode;
      function Q(e2) {
        throw RangeError(tr[e2]);
      }
      function ir(e2, t2) {
        let n2 = [], r2 = e2.length;
        for (; r2--; ) n2[r2] = t2(e2[r2]);
        return n2;
      }
      function ar(e2, t2) {
        let n2 = e2.split("@"), r2 = "";
        n2.length > 1 && (r2 = n2[0] + "@", e2 = n2[1]), e2 = e2.replace(er, ".");
        let i2 = ir(e2.split("."), t2).join(".");
        return r2 + i2;
      }
      function or(e2) {
        let t2 = [], n2 = 0, r2 = e2.length;
        for (; n2 < r2; ) {
          let i2 = e2.charCodeAt(n2++);
          if (i2 >= 55296 && i2 <= 56319 && n2 < r2) {
            let r3 = e2.charCodeAt(n2++);
            (r3 & 64512) == 56320 ? t2.push(((i2 & 1023) << 10) + (r3 & 1023) + 65536) : (t2.push(i2), n2--);
          } else t2.push(i2);
        }
        return t2;
      }
      var sr = (e2) => String.fromCodePoint(...e2);
      var cr = function(e2) {
        return e2 >= 48 && e2 < 58 ? 26 + (e2 - 48) : e2 >= 65 && e2 < 91 ? e2 - 65 : e2 >= 97 && e2 < 123 ? e2 - 97 : Y;
      };
      var lr = function(e2, t2) {
        return e2 + 22 + 75 * (e2 < 26) - ((t2 != 0) << 5);
      };
      var ur = function(e2, t2, n2) {
        let r2 = 0;
        for (e2 = n2 ? Z(e2 / Jn) : e2 >> 1, e2 += Z(e2 / t2); e2 > 455; r2 += Y) e2 = Z(e2 / nr);
        return Z(r2 + 36 * e2 / (e2 + qn));
      };
      var dr = function(e2) {
        let t2 = [], n2 = e2.length, r2 = 0, i2 = Xn, a2 = Yn, o2 = e2.lastIndexOf(Zn);
        o2 < 0 && (o2 = 0);
        for (let n3 = 0; n3 < o2; ++n3) e2.charCodeAt(n3) >= 128 && Q("not-basic"), t2.push(e2.charCodeAt(n3));
        for (let s2 = o2 > 0 ? o2 + 1 : 0; s2 < n2; ) {
          let o3 = r2;
          for (let t3 = 1, i3 = Y; ; i3 += Y) {
            s2 >= n2 && Q("invalid-input");
            let o4 = cr(e2.charCodeAt(s2++));
            o4 >= Y && Q("invalid-input"), o4 > Z((J - r2) / t3) && Q("overflow"), r2 += o4 * t3;
            let c3 = i3 <= a2 ? Kn : i3 >= a2 + X ? X : i3 - a2;
            if (o4 < c3) break;
            let l2 = Y - c3;
            t3 > Z(J / l2) && Q("overflow"), t3 *= l2;
          }
          let c2 = t2.length + 1;
          a2 = ur(r2 - o3, c2, o3 == 0), Z(r2 / c2) > J - i2 && Q("overflow"), i2 += Z(r2 / c2), r2 %= c2, t2.splice(r2++, 0, i2);
        }
        return String.fromCodePoint(...t2);
      };
      var fr = function(e2) {
        let t2 = [];
        e2 = or(e2);
        let n2 = e2.length, r2 = Xn, i2 = 0, a2 = Yn;
        for (let n3 of e2) n3 < 128 && t2.push(rr(n3));
        let o2 = t2.length, s2 = o2;
        for (o2 && t2.push(Zn); s2 < n2; ) {
          let n3 = J;
          for (let t3 of e2) t3 >= r2 && t3 < n3 && (n3 = t3);
          let c2 = s2 + 1;
          n3 - r2 > Z((J - i2) / c2) && Q("overflow"), i2 += (n3 - r2) * c2, r2 = n3;
          for (let n4 of e2) if (n4 < r2 && ++i2 > J && Q("overflow"), n4 === r2) {
            let e3 = i2;
            for (let n5 = Y; ; n5 += Y) {
              let r3 = n5 <= a2 ? Kn : n5 >= a2 + X ? X : n5 - a2;
              if (e3 < r3) break;
              let i3 = e3 - r3, o3 = Y - r3;
              t2.push(rr(lr(r3 + i3 % o3, 0))), e3 = Z(i3 / o3);
            }
            t2.push(rr(lr(e3, 0))), a2 = ur(i2, c2, s2 === o2), i2 = 0, ++s2;
          }
          ++i2, ++r2;
        }
        return t2.join("");
      };
      var pr = {
        version: "2.3.1",
        ucs2: {
          decode: or,
          encode: sr
        },
        decode: dr,
        encode: fr,
        toASCII: function(e2) {
          return ar(e2, function(e3) {
            return $n.test(e3) ? "xn--" + fr(e3) : e3;
          });
        },
        toUnicode: function(e2) {
          return ar(e2, function(e3) {
            return Qn.test(e3) ? dr(e3.slice(4).toLowerCase()) : e3;
          });
        }
      };
      var mr = {
        default: {
          options: {
            html: false,
            xhtmlOut: false,
            breaks: false,
            langPrefix: "language-",
            linkify: false,
            typographer: false,
            quotes: "“”‘’",
            highlight: null,
            maxNesting: 100
          },
          components: {
            core: {},
            block: {},
            inline: {}
          }
        },
        zero: {
          options: {
            html: false,
            xhtmlOut: false,
            breaks: false,
            langPrefix: "language-",
            linkify: false,
            typographer: false,
            quotes: "“”‘’",
            highlight: null,
            maxNesting: 20
          },
          components: {
            core: { rules: [
              "normalize",
              "block",
              "strip_references",
              "inline",
              "text_join"
            ] },
            block: { rules: ["paragraph"] },
            inline: {
              rules: ["text"],
              rules2: ["balance_pairs", "fragments_join"]
            }
          }
        },
        commonmark: {
          options: {
            html: true,
            xhtmlOut: true,
            breaks: false,
            langPrefix: "language-",
            linkify: false,
            typographer: false,
            quotes: "“”‘’",
            highlight: null,
            maxNesting: 20
          },
          components: {
            core: { rules: [
              "normalize",
              "block",
              "strip_references",
              "inline",
              "text_join"
            ] },
            block: { rules: [
              "blockquote",
              "code",
              "fence",
              "heading",
              "hr",
              "html_block",
              "lheading",
              "list",
              "reference",
              "paragraph"
            ] },
            inline: {
              rules: [
                "autolink",
                "backticks",
                "emphasis",
                "entity",
                "escape",
                "html_inline",
                "image",
                "link",
                "newline",
                "text"
              ],
              rules2: [
                "balance_pairs",
                "emphasis",
                "fragments_join"
              ]
            }
          }
        }
      };
      var hr = /^(vbscript|javascript|file|data):/;
      var gr = /^data:image\/(gif|png|jpeg|webp);/;
      var _r = [
        "http:",
        "https:",
        "mailto:"
      ];
      var $ = class {
        validateLink(e2) {
          let t2 = e2.trim().toLowerCase();
          return !hr.test(t2) || gr.test(t2);
        }
        normalizeLink(e2) {
          let t2 = b(e2, true);
          if (t2.hostname && (!t2.protocol || _r.indexOf(t2.protocol) >= 0)) try {
            t2.hostname = pr.toASCII(t2.hostname);
          } catch (e3) {
          }
          return t2.auth && (t2.auth = s(t2.auth)), t2.hostname && (t2.hostname = s(t2.hostname)), t2.pathname && (t2.pathname = s(t2.pathname)), t2.search && (t2.search = s(t2.search)), t2.hash && (t2.hash = s(t2.hash)), c(t2);
        }
        normalizeLinkText(e2) {
          let t2 = b(e2, true);
          if (t2.hostname && (!t2.protocol || _r.indexOf(t2.protocol) >= 0)) try {
            t2.hostname = pr.toUnicode(t2.hostname);
          } catch (e3) {
          }
          return i(c(t2), i.defaultChars + "%");
        }
        constructor(...e2) {
          D(this, "inline", new In()), D(this, "block", new Zt()), D(this, "core", new Et()), D(this, "renderer", new Ze()), D(this, "linkify", new Gn()), D(this, "utils", ke), D(this, "helpers", Object.assign({}, Xe));
          let [t2, n2] = e2;
          typeof t2 == "string" ? (this.configure(t2), n2 && this.set(n2)) : (this.configure("default"), this.set(t2 || {}));
        }
        set(e2) {
          return Object.assign(this.options, e2), this;
        }
        configure(e2) {
          let t2;
          if (typeof e2 == "string") {
            let n3 = e2;
            if (t2 = mr[n3], !t2) throw Error(`Wrong 'markdown-it' preset "${n3}", check name`);
          } else t2 = e2;
          if (!t2) throw Error("Wrong `markdown-it` preset, can't be empty");
          t2.options && (this.options = { ...t2.options });
          let n2 = t2.components;
          if (n2) {
            var r2;
            [
              "core",
              "block",
              "inline"
            ].forEach((e4) => {
              var t3;
              let r3 = (t3 = n2[e4]) == null ? void 0 : t3.rules;
              r3 && this[e4].ruler.enableOnly(r3);
            });
            let e3 = (r2 = n2.inline) == null ? void 0 : r2.rules2;
            e3 && this.inline.ruler2.enableOnly(e3);
          }
          return this;
        }
        enable(e2, t2 = false) {
          let n2 = [];
          Array.isArray(e2) || (e2 = [e2]), [
            "core",
            "block",
            "inline"
          ].forEach((t3) => {
            n2 = n2.concat(this[t3].ruler.enable(e2, true));
          }), n2 = n2.concat(this.inline.ruler2.enable(e2, true));
          let r2 = e2.filter((e3) => n2.indexOf(e3) < 0);
          if (r2.length && !t2) throw Error(`MarkdownIt. Failed to enable unknown rule(s): ${r2}`);
          return this;
        }
        disable(e2, t2 = false) {
          let n2 = [];
          Array.isArray(e2) || (e2 = [e2]), [
            "core",
            "block",
            "inline"
          ].forEach((t3) => {
            n2 = n2.concat(this[t3].ruler.disable(e2, true));
          }), n2 = n2.concat(this.inline.ruler2.disable(e2, true));
          let r2 = e2.filter((e3) => n2.indexOf(e3) < 0);
          if (r2.length && !t2) throw Error(`MarkdownIt. Failed to disable unknown rule(s): ${r2}`);
          return this;
        }
        use(e2, ...t2) {
          return e2.apply(e2, [this, ...t2]), this;
        }
        parse(e2, t2) {
          if (typeof e2 != "string") throw Error("Input data should be a String");
          let n2 = new this.core.State(e2, this, t2);
          return this.core.process(n2), n2.tokens;
        }
        render(e2, t2 = {}) {
          return this.renderer.render(this.parse(e2, t2), this.options, t2);
        }
        parseInline(e2, t2) {
          let n2 = new this.core.State(e2, this, t2);
          return n2.inlineMode = true, this.core.process(n2), n2.tokens;
        }
        renderInline(e2, t2 = {}) {
          return this.renderer.render(this.parseInline(e2, t2), this.options, t2);
        }
      };
      D($, "Token", z), D($, "Ruler", B), D($, "Renderer", Ze), D($, "ParserCore", Et), D($, "StateCore", Qe), D($, "ParserBlock", Zt), D($, "StateBlock", Dt), D($, "ParserInline", In), D($, "StateInline", Qt);
      var vr = Ae($);

      // tools/markdown/render.mjs
      var parser = new vr({ html: false, linkify: false, typographer: false, maxNesting: 20 });
      var MARKDOWN_LIMITS = Object.freeze({ characters: 32e3, tokens: 6e3, nesting: 20 });
      var TAGS = Object.freeze({ paragraph_open: "p", strong_open: "strong", em_open: "em", s_open: "s", blockquote_open: "blockquote", bullet_list_open: "ul", ordered_list_open: "ol", list_item_open: "li", table_open: "table", thead_open: "thead", tbody_open: "tbody", tr_open: "tr", th_open: "th", td_open: "td" });
      var RAW_URL_FORBIDDEN = /[\p{Cc}\p{Cf}\p{White_Space}\ufffd\\]/u;
      var DECODED_URL_FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\ufffd\\]/u;
      function safeURLRepresentation(value) {
        if (typeof value !== "string" || RAW_URL_FORBIDDEN.test(value) || /%25/i.test(value)) return false;
        try {
          return !DECODED_URL_FORBIDDEN.test(decodeURIComponent(value));
        } catch {
          return false;
        }
      }
      function safeMarkdownURL(value, ownOrigin = globalThis.location?.origin) {
        if (typeof value !== "string" || !/^https:\/\//i.test(value) || !safeURLRepresentation(value)) return null;
        try {
          const url = new URL(value);
          if (url.protocol !== "https:" || !url.hostname || url.username || url.password || !safeURLRepresentation(url.href)) return null;
          if (url.hostname.endsWith(".")) return null;
          const destinationHost = url.hostname.toLowerCase();
          const currentHost = ownOrigin ? new URL(ownOrigin).hostname.toLowerCase().replace(/\.+$/, "") : null;
          if (currentHost !== null && (!currentHost || destinationHost === currentHost)) return null;
          return url.href;
        } catch {
          return null;
        }
      }
      var activeRejectedFallbacks = null;
      var parseDestination = parser.helpers.parseLinkDestination;
      parser.helpers = { ...parser.helpers, parseLinkDestination(source, start, end) {
        const result = parseDestination(source, start, end);
        if (result.ok) {
          const raw = source[start] === "<" ? source.slice(start + 1, result.pos - 1) : source.slice(start, result.pos);
          const rawAllowed = safeURLRepresentation(raw);
          if (source[start] === "<" && (!rawAllowed || !parser.normalizeLink(result.str))) {
            const fallback = parser.normalizeLink(raw);
            const href = fallback && safeMarkdownURL(fallback, null);
            if (href) activeRejectedFallbacks?.add(href);
          }
          if (!rawAllowed) return { ...result, ok: false };
        }
        return result;
      } };
      var normalizeLink = parser.normalizeLink;
      parser.normalizeLink = (value) => {
        const intended = safeMarkdownURL(value, null);
        if (!intended) return "";
        const normalized = normalizeLink(value);
        return safeMarkdownURL(normalized, null) === intended ? normalized : "";
      };
      var validateLink = parser.validateLink;
      parser.validateLink = (value) => validateLink(value) && safeMarkdownURL(value, null) !== null;
      for (const [owner, method] of [[parser.block, "tokenize"], [parser.inline, "tokenize"], [parser.inline, "skipToken"]]) {
        const original = owner[method];
        owner[method] = function(state, ...args) {
          if (state.level >= MARKDOWN_LIMITS.nesting) state.env.markdownNestingExhausted = true;
          return original.call(this, state, ...args);
        };
      }
      function renderBotMarkdown(source, { document = globalThis.document, ownOrigin = globalThis.location?.origin } = {}) {
        const root = document.createElement("div");
        root.className = "markdown";
        root.setAttribute("role", "group");
        root.setAttribute("aria-label", "Bot message content");
        const plain = () => {
          root.classList.add("markdown-plain");
          const p2 = document.createElement("p");
          p2.textContent = typeof source === "string" ? source : "";
          root.replaceChildren(p2);
          return root;
        };
        if (typeof source !== "string" || source.length > MARKDOWN_LIMITS.characters || source.includes("\0")) return plain();
        try {
          let walk = function(list) {
            for (const token of list) {
              if (token.hidden && (token.type === "paragraph_open" || token.type === "paragraph_close")) continue;
              const parent = stack.at(-1);
              if (token.type === "inline") {
                walk(token.children || []);
                continue;
              }
              if (token.type === "fence" || token.type === "code_block") {
                const pre = document.createElement("pre");
                pre.tabIndex = 0;
                pre.setAttribute("role", "region");
                pre.setAttribute("aria-label", "Code in bot message");
                const code = document.createElement("code");
                code.textContent = token.content;
                pre.append(code);
                parent.append(pre);
                continue;
              }
              if (token.type === "text") {
                parent.append(document.createTextNode(token.content));
                continue;
              }
              if (token.type === "code_inline") {
                const code = document.createElement("code");
                code.textContent = token.content;
                parent.append(code);
                continue;
              }
              if (token.type === "softbreak" || token.type === "hardbreak" || token.type === "hr") {
                parent.append(document.createElement(token.type === "hr" ? "hr" : "br"));
                continue;
              }
              if (token.type === "image") {
                const note = document.createElement("span");
                note.className = "markdown-image-note";
                note.textContent = "[Image not loaded" + (token.content ? ": " + token.content : "") + "]";
                parent.append(note);
                continue;
              }
              if (token.nesting === -1) {
                if (stack.length > 1) stack.pop();
                continue;
              }
              if (token.nesting === 1) {
                let node;
                if (token.type === "link_open") {
                  let href = safeMarkdownURL(token.attrGet("href"), ownOrigin);
                  if (rejectedFallbacks.has(href)) href = null;
                  node = document.createElement(href ? "a" : "span");
                  if (href) {
                    node.href = href;
                    node.target = "_blank";
                    node.rel = "noopener noreferrer";
                    node.referrerPolicy = "no-referrer";
                    node.title = href + " (opens in new tab)";
                    node.setAttribute("aria-description", "External HTTPS link; opens in a new tab.");
                  }
                } else if (token.type === "heading_open") {
                  node = document.createElement("h" + (/^h[1-6]$/.test(token.tag) ? Math.min(6, Number(token.tag[1]) + 1) : 3));
                } else if (Object.hasOwn(TAGS, token.type)) {
                  node = document.createElement(TAGS[token.type]);
                  if (token.type === "ordered_list_open") {
                    const start = token.attrGet("start");
                    if (start && /^\d{1,9}$/.test(start)) node.start = Number(start);
                  }
                  if (token.type === "th_open") node.scope = "col";
                } else node = document.createElement("span");
                if (token.type === "table_open") {
                  const region = document.createElement("div");
                  region.className = "markdown-table";
                  region.tabIndex = 0;
                  region.setAttribute("role", "region");
                  region.setAttribute("aria-label", "Table in bot message");
                  region.append(node);
                  parent.append(region);
                } else parent.append(node);
                stack.push(node);
                continue;
              }
              if (token.content) parent.append(document.createTextNode(token.content));
            }
          };
          const environment = {};
          const rejectedFallbacks = /* @__PURE__ */ new Set();
          const previousRejections = activeRejectedFallbacks;
          let tokens;
          activeRejectedFallbacks = rejectedFallbacks;
          try {
            tokens = parser.parse(source, environment);
          } finally {
            activeRejectedFallbacks = previousRejections;
          }
          if (environment.markdownNestingExhausted) return plain();
          let count = 0;
          const pending = [...tokens];
          while (pending.length) {
            const token = pending.pop();
            if (++count > MARKDOWN_LIMITS.tokens) return plain();
            if (token.children) pending.push(...token.children);
          }
          const stack = [root];
          walk(tokens);
          return root.textContent.trim() ? root : plain();
        } catch {
          return plain();
        }
      }
      return __toCommonJS(render_exports);
    })();

    // END GENERATED SAFE MARKDOWN RUNTIME
    renderBotBody.renderer = ArtemisMarkdown.renderBotMarkdown;
  }
  return renderBotBody.renderer(source);
}
initAppearance();
// User-facing diagnostic controls are deliberately not mounted in this build.
// Navigation changes only this view, never the gateway profile/session/model.
const dialogs = [[$('navigation'), $('navToggle'), $('closeNav')], [$('context-menu'), $('menuToggle'), $('show-info')], [$('connection-access'), $('show-info'), $('closeAccess'), $('menuToggle')]];
for (const [dialog, trigger, first, returnTarget = trigger] of dialogs) {
  trigger.onclick = () => {
    if (typeof dialog.showModal !== 'function') { text($('announcement'), 'This browser cannot open navigation dialogs.'); return; }
    trigger.focus({ preventScroll: true });
    for (const [other] of dialogs) if (other !== dialog && other.open) { other.dataset.restore = 'false'; other.close(); }
    if (dialog === $('connection-access')) { text($('access-state'), $('notice').textContent); loadScanToOpen(); }
    dialog.showModal(); trigger.setAttribute('aria-expanded', 'true'); first.focus({ preventScroll: true });
  };
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]')].filter(el => el.getClientRects().length && el.tabIndex >= 0 && (el.type !== 'radio' || el.checked));
    const target = event.shiftKey ? controls.at(-1) : controls[0];
    if (event.shiftKey ? document.activeElement === controls[0] : document.activeElement === controls.at(-1)) { event.preventDefault(); target?.focus(); }
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return; // Ignore an older queued close after reopening.
    trigger.setAttribute('aria-expanded', 'false');
    if (dialog.dataset.restore !== 'false') {
      const homeDetails = dialog === $('connection-access') && view === 'home' && !$('home-connection-status').hidden && !$('home-toast-details').hidden;
      (homeDetails ? $('home-toast-details') : returnTarget.hidden ? $('navToggle') : returnTarget).focus({ preventScroll: true });
    }
    delete dialog.dataset.restore;
  });
  dialog.addEventListener('click', event => {
    const r = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) dialog.close();
  });
}
$('closeNav').onclick = () => $('navigation').close();
$('closeAccess').onclick = () => $('connection-access').close();
$('preview-error').hidden = !ERROR_PREVIEW_ENABLED;
$('preview-error').onclick = () => {
  if (!ERROR_PREVIEW_ENABLED || view !== 'chat') return;
  const show = () => {
    const wasHidden = $('preview-notice').hidden;
    $('preview-notice').hidden = false;
    feed.latest(); feed.reveal($('dismiss-preview'));
    if (wasHidden) text($('preview-announcement'), $('preview-text').textContent);
  };
  const menu = $('context-menu');
  if (menu.open) { menu.dataset.restore = 'false'; menu.addEventListener('close', show, { once: true }); menu.close(); }
  else show();
};
$('dismiss-preview').onclick = () => {
  $('preview-notice').hidden = true; text($('preview-announcement'), '');
  $('menuToggle').focus({ preventScroll: true }); feed.restore(feed.capture());
};
function navigationView() {
  const previousView = view; const reading = previousView === 'chat' ? feed.capture() : feed.saved;
  view = !location.hash || location.hash === '#view=chat' ? 'chat' : location.hash === '#view=home' ? 'home' : 'unavailable';
  document.body.dataset.view = view;
  $('transcript').hidden = view !== 'chat';
  $('home-view').hidden = view !== 'home'; $('unavailable-view').hidden = view !== 'unavailable';
  $(view === 'chat' ? 'transcript' : view === 'home' ? 'home-connection-status' : 'unavailable-view').insertBefore(document.querySelector('.conversation-info'), view === 'chat' ? $('preview-notice') : null);
  document.querySelector('.conversation-info').setAttribute('aria-label', view === 'home' ? 'Connection status' : 'System notice');
  $('home-connection-status').hidden = view !== 'home';
  document.querySelector('.composer-zone').hidden = view !== 'chat';
  $('identity-avatar').hidden = view !== 'chat' || identityRejected;
  $('menuToggle').hidden = view !== 'chat';
  text($('conversation-name'), view === 'chat' && !identityRejected ? sender() : view === 'home' ? 'Home' : 'Unavailable');
  document.title = view === 'home' ? 'Artemis' : `${$('conversation-name').textContent} · Artemis`;
  for (const link of document.querySelectorAll('[data-view]')) {
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  for (const [dialog] of dialogs) if (dialog.open) dialog.close();
  if (model) render(model.state); else renderHome();
  if (view === 'chat' && previousView !== 'chat') feed.restore(reading);
  feed.schedule(); feed.updateButton();
}
for (const link of document.querySelectorAll('.navigation-list a')) link.addEventListener('click', () => { if ($('navigation').open) $('navigation').close(); });
window.addEventListener('hashchange', () => { navigationView(); if (!model && !booting && view !== 'unavailable') boot(); });
$('skip').onclick = event => { event.preventDefault(); $(view === 'chat' ? 'transcript' : view === 'home' ? 'home-view' : 'unavailable-view').focus(); };
navigationView();
for (const kind of ['all', 'bots', 'rooms']) {
  const button = $('home-' + kind + '-filter');
  if (button) button.onclick = () => setHomeFilter(kind);
}
$('home-toast-details').onclick = () => $('show-info').click();
function fitDraft() {
  const draft = $('draft');
  draft.closest('.composer').classList.toggle('has-draft', draft.value.length > 0);
  draft.style.height = 'auto'; draft.style.height = `${Math.min(120, draft.scrollHeight)}px`;
}
$('draft').addEventListener('input', () => { model?.setDraft($('draft').value); fitDraft(); });
function sendMessage() {
  if (view !== 'chat') return;
  const before = model?.state.pending;
  model?.send();
  if (model?.state.pending && model.state.pending !== before) $('draft').blur();
}
$('draft').addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing) { event.preventDefault(); sendMessage(); }
});
$('composer').onsubmit = event => { event.preventDefault(); sendMessage(); };
$('connect').onclick = () => { failures = 0; if (identityFence || model?.identityRejected) return recoverIdentity(); if (model) return model.connect(); return reconnectSelection(); };
$('check').onclick = () => model?.connect();
$('discard').onclick = () => { model?.discardHeldDraft(); fitDraft(); };
$('recover').onclick = () => { model?.restoreHeldMessage(); fitDraft(); };
$('start').onclick = () => model?.start();
window.addEventListener('online', () => { diagnosticEvent('online'); resumeConnection(true); });
window.addEventListener('pagehide', event => { diagnosticEvent('pagehide', 'none', { pageshow_persisted: event.persisted === true }); suspendConnection(); gateway.close(); });
document.addEventListener('visibilitychange', () => { diagnosticEvent(document.hidden ? 'visibility_hidden_received' : 'visibility_visible_received'); if (document.hidden) suspendConnection(); else resumeConnection(); });
window.addEventListener('pageshow', event => { diagnosticEvent('pageshow', 'none', { pageshow_persisted: event.persisted === true }); if (event.persisted && !document.hidden) resumeConnection(); });
let viewportFrame = 0;
function sizeViewport() {
  cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(() => {
    const viewport = window.visualViewport;
    // A user's pinch zoom is not a keyboard resize. Keep the layout geometry
    // stable rather than counter-zooming/reflowing it to the zoomed crop.
    if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
    const style = document.documentElement.style;
    style.setProperty('--viewport-height', `${viewport?.height ?? innerHeight}px`);
    style.setProperty('--viewport-width', `${viewport?.width ?? innerWidth}px`);
    style.setProperty('--viewport-top', `${viewport?.offsetTop ?? 0}px`);
    style.setProperty('--viewport-left', `${viewport?.offsetLeft ?? 0}px`);
    // Size only; the single feed owner handles geometry and reader anchoring.
    feed.schedule();
  });
}
window.visualViewport?.addEventListener('resize', sizeViewport);
window.visualViewport?.addEventListener('scroll', sizeViewport);
window.addEventListener('resize', sizeViewport);
$('draft').addEventListener('focus', sizeViewport);
$('draft').addEventListener('blur', sizeViewport);
$('draft').addEventListener('input', sizeViewport);
sizeViewport();
async function boot(allowIdentityRecovery = false) {
  if (booting || model || view === 'unavailable') return;
  if (pendingSelection) return; // Only the explicit recovery control retries a failed selection.
  if (identityFence && !allowIdentityRecovery) return;
  if (location.protocol !== 'https:' && !loopback) { renderNotice('error', 'HTTPS is required outside loopback. No connection was attempted.'); return; }

  booting = true;
  try {
    const response = await fetch(new URL('/api/plugins/artemis-owner-proof/connection', location.origin), { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    if (response.status === 401) { setRosterState('auth', 'Hermes sign-in is needed. No automatic retry.'); $('connect').hidden = false; $('login').hidden = !prepareSignIn(); renderNotice('auth', 'Use Hermes Webapp sign-in in a new tab, then return here and choose Connect. Keep this page open; drafts stay only here. Nothing is resent.'); return; }
    if (!response.ok) throw new Error('Settings unavailable');
    const settings = await response.json();
    if (settings.protocol !== 'artemis-owner-routing-v1') throw new Error('Unsupported identity contract');
    const profile = parseProfile(location.href);
    if (profile === null) {
      if (!initialRosterAttempted || allowIdentityRecovery) { initialRosterAttempted = true; await discoverProfiles(allowIdentityRecovery); }
      else if (rosterPhase === 'ready') renderNotice('chooser', 'Choose a bot. No conversation is opened automatically.');
      return;
    }
    await selectProfile(profile, null, allowIdentityRecovery);
  } catch { identityRejected = true; navigationView(); $('send').disabled = true; renderNotice('error', 'Unable to open the protected Artemis connection. Check this Artemis installation and Hermes Webapp access. No workspace or other profile was opened.'); $('login').hidden = true; }
  finally { booting = false; }
}
function listProfiles(binding) {
  pageIdentity.assert(binding);
  setRosterState('ready', 'Bots from this Hermes host. Selection is explicit.');
  for (const id of ['bot-list', 'chooser-bots', 'home-bots']) $(id).replaceChildren();
  for (const profile of binding.profiles) {
    openingLabels.set(profile.id, profile.label);
    for (const id of ['bot-list', 'chooser-bots', 'home-bots']) {
    const link = document.createElement('a');
    const url = new URL(location.href); url.searchParams.delete('profile'); url.searchParams.set('artemis_profile', profile.id); url.hash = 'view=chat';
    link.href = url.href; link.setAttribute('aria-label', `${profile.label}, profile ${profile.id}`);
    const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = [...profile.label][0]; avatar.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.className = 'bot-label'; label.textContent = profile.label;
    link.append(avatar, label);
    if (profile.label !== profile.id) { const detail = document.createElement('small'); detail.textContent = profile.id; label.append(detail); }
    if (id === 'home-bots') {
      const status = document.createElement('span'); status.className = 'bot-status'; status.id = 'home-state-' + profile.id;
      const dot = document.createElement('span'); dot.className = 'connection-dot'; dot.setAttribute('aria-hidden', 'true'); dot.hidden = true;
      const caption = document.createElement('span'); caption.className = 'connection-label'; status.append(dot, caption); label.append(status);
      link.setAttribute('aria-describedby', status.id);
    }
    link.dataset.profile = profile.id;
    if (profile.id === activeEntry?.gateway.profile) link.setAttribute('aria-current', 'page');
    link.onclick = event => {
      event.preventDefault();
      if (id === 'home-bots' && (link.parentElement !== $('home-bots') || $('home-bots').hidden || identityFence || identityRejected || model?.identityRejected || model?.state.phase === 'auth')) return;
      if ($('navigation').open) $('navigation').close();
      selectProfile(profile.id, binding.hostId);
    };
    $(id).append(link);
    }
  }
  renderHome();
}
function identity() {
  const name = sender();
  for (const node of document.querySelectorAll('#identity-avatar,#bot-activity .avatar')) text(node, [...name][0]);

  $('transcript').setAttribute('aria-label', `Conversation with ${name}`);
  $('bot-activity').setAttribute('aria-label', `${name} activity`);
  $('draft').placeholder = `Message ${name}…`;
  text(document.querySelector('label[for="draft"]'), `Message ${name}`);
  text(document.querySelector('.private-scope'), `To ${name} · ${gateway.profile} · ${location.host} · Canonical Bot Chat only; no side threads`);
  navigationView();
}
async function reconnectSelection(allowIdentityRecovery = false) {
  if (pendingSelection) {
    const { profile, expectedHost } = pendingSelection;
    await selectProfile(profile, expectedHost, allowIdentityRecovery);
  } else if (initialRosterAttempted && ['auth', 'error', 'blocked'].includes(rosterPhase)) await discoverProfiles(allowIdentityRecovery);
  else await boot(allowIdentityRecovery);
}
async function selectProfile(profile, expectedHost = null, allowIdentityRecovery = false) {
  if (identityFence && !allowIdentityRecovery) {
    renderNotice('error', 'The selected host or bot could not be verified. Use Verify original connection before selecting another bot. Nothing was sent.'); return;
  }
  const epoch = ++selectionEpoch;
  pendingSelection = Object.freeze({ profile, expectedHost });
  openingView = !openingProfiles.has(profile) && !entries.has(profile) && !allowIdentityRecovery
    ? { epoch, profile, label: openingLabels.get(profile) || null, announced: false } : null;
  openingProfiles.add(profile);
  const isCurrent = () => epoch === selectionEpoch;
  ++metadataEpoch; $('load-bots').disabled = false;
  if (activeEntry) activeEntry.reader = { snapshot: feed.capture(), following: feed.following };
  clearTimeout(reconnectTimer); reconnectTimer = null;
  model?.traceDiagnostic?.('capture_stopped');
  const previous = gateway; activeEntry = null; model = null; syncMessageProvenanceOwner(); previous.close();
  $('send').disabled = true; $('draft').readOnly = true; $('draft').value = ''; $('messages').replaceChildren();
  $('start').hidden = true;
  $('preview-notice').hidden = true; text($('preview-announcement'), '');
  renderedRows = ''; lastReply = ''; lastDelivery = ''; initialHistory = true; lastWorking = false;
  feed.saved = null; feed.expected = null; feed.following = true;
  renderNotice('connecting', 'Checking the selected host and bot identity…');
  let entry = entries.get(profile);
  let opening;
  try {
    if (!entry) {
      opening = new ProfileGateway({ profile, expectedHost, pageIdentity, isCurrent });
      await opening.connect();
      if (openingView?.epoch === epoch && isCurrent()) {
        openingView.label = opening.binding.sender;
        renderNotice('connecting', 'Checking the selected host and bot identity…');
      }
      const settings = await opening.target();
      if (epoch !== selectionEpoch) { opening.close(); return; }
      entry = { gateway: opening };
      entry.model = new Conversation(opening, settings, state => { if (activeEntry === entry) render(state); });
      entries.set(profile, entry);
    } else if (expectedHost && entry.gateway.expectedHost !== expectedHost) throw new Error('Host mismatch');
    if (epoch !== selectionEpoch) return;
    entry.gateway.isCurrent = isCurrent;
    activeEntry = entry; model = entry.model; gateway = entry.gateway; syncMessageProvenanceOwner();
    const url = new URL(location.href); url.searchParams.delete('profile'); url.searchParams.set('artemis_profile', profile); url.hash = 'view=chat'; history.replaceState(null, '', url);
    identityRejected = false; identity(); listProfiles(gateway.binding);
    const recovered = await entry.model.connect({ recoverIdentity: entry.model.identityRejected });
    if (epoch !== selectionEpoch) return;
    if (recovered) pendingSelection = null;
    if (allowIdentityRecovery && recovered) { identityFence = false; render(entry.model.state); }
    if (entry.reader) { feed.following = entry.reader.following; feed.restore(entry.reader.snapshot); }
  } catch (error) {
    opening?.close();
    if (epoch !== selectionEpoch) return;
    entry?.gateway.close(); gateway = { connected: false, close() {} }; model = null; activeEntry = null; syncMessageProvenanceOwner();
    identityRejected = true; navigationView();
    $('send').disabled = true;
    $('connect').hidden = false;
    text($('connect'), identityFence ? 'Verify original connection' : 'Connect');
    const auth = error instanceof RpcError && error.reason === 'authentication_required';
    renderNotice(auth ? 'auth' : 'error', auth ? 'Use Hermes Webapp sign-in in a new tab, then return here and choose Connect or Verify original connection. Keep this page open; nothing is resent.' : canonicalMessage(error.reason) || 'The selected host or bot could not be verified. No other profile was selected and nothing was sent.');
    $('login').hidden = !auth || !prepareSignIn();
  }
}
function rejectPageIdentity(notice) {
  identityFence = true; ++selectionEpoch; ++metadataEpoch;
  clearTimeout(reconnectTimer); reconnectTimer = null;
  for (const entry of entries.values()) entry.model.rejectIdentity(notice);
  if (!model) renderNotice('error', notice);
  $('load-bots').disabled = false; $('send').disabled = true; $('start').hidden = true;
  text($('connect'), 'Verify original connection'); text($('announcement'), notice);
  $('connect').hidden = false;
  setRosterState('blocked', 'Host identity needs deliberate verification.');
}
async function recoverIdentity() {
  // Only the explicit recovery button reaches here; online/timers never unlatch.
  identityFence = true;
  if (!model) { await reconnectSelection(true); return; }
  const owner = model; const epoch = ++selectionEpoch; ++metadataEpoch;
  clearTimeout(reconnectTimer); reconnectTimer = null;
  owner.gateway.isCurrent = () => epoch === selectionEpoch;
  const recovered = await owner.connect({ recoverIdentity: true });
  if (model !== owner || epoch !== selectionEpoch) return;
  if (recovered) identityFence = false;
  render(owner.state);
}
async function discoverProfiles(allowIdentityRecovery = false) {
  if (location.protocol !== 'https:' && !loopback) return;
  if (discoveryBusy || pendingSelection || (identityFence || model?.identityRejected) && !allowIdentityRecovery) return;
  discoveryBusy = true;
  const request = ++metadataEpoch; const selection = selectionEpoch;
  const isCurrent = () => request === metadataEpoch && selection === selectionEpoch;
  const discovery = new ProfileGateway({ profile: 'default', expectedHost: pageIdentity.hostId, pageIdentity, isCurrent, canonicalOnly: false });
  setRosterState('loading', 'Finding bots on this host…');
  if (!model) renderNotice('connecting', 'Finding bots on this Hermes host. No conversation is opened automatically.');
  try {
    await discovery.connect();
    if (isCurrent()) {
      listProfiles(discovery.binding);
      if (allowIdentityRecovery) identityFence = false;
      if (!model) { $('connect').hidden = true; $('login').hidden = true; renderNotice('chooser', 'Choose a bot. No conversation is opened automatically.'); }
    }
  }
  catch (error) {
    if (isCurrent()) {
      if (error instanceof RpcError && error.reason === 'authentication_required') {
        setRosterState('auth', 'Hermes sign-in is needed. No automatic retry.');
        $('connect').hidden = false;
        renderNotice('auth', 'Use Hermes Webapp sign-in in a new tab, then return here and choose Connect. Nothing is sent or retried automatically.');
        $('login').hidden = !prepareSignIn();
      } else if (error instanceof RpcError && error.reason === 'routing_identity_mismatch') rejectPageIdentity('Could not verify this host’s bot list. Use Verify original connection to deliberately recheck the original host and bot. Nothing will be resent.');
      else {
        setRosterState('error', 'Bot discovery failed. Retry when you are ready.');
        if (!model) renderNotice('error', 'Unable to load the bot list. Use Retry bot list in navigation; no conversation was opened.');
      }
    }
  }
  finally { discovery.close(); discoveryBusy = false; if (isCurrent()) $('load-bots').disabled = false; }
}
$('load-bots').onclick = () => discoverProfiles();
let polling = false;
setInterval(async () => {
  if (identityFence || model?.identityRejected || !model || !gateway.connected || document.hidden || polling || model.foregroundState?.checking && model.foregroundState.failed || ['sending', 'connecting', 'empty', 'error', 'auth'].includes(model.state.phase)) return;
  polling = true;
  try { await model.refresh(); } catch { /* fixed connection state is rendered by the model */ }
  finally { polling = false; }
}, 1500);
boot();
