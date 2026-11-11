import { RpcError } from './gateway.mjs';
import { canonicalMessage } from './canonical.mjs';

const submissionId = row => row.role === 'user' ? row.display_metadata?.submission_id : null;
const deliveryLabels = { sending: 'Sending…', unknown: 'Delivery unknown', rejected: 'Not accepted' };
// Presentation only: empty tool/reasoning records remain in state.rows for receipt evidence.
export const isDisplayableAssistant = row => row?.role === 'assistant' && typeof row.content === 'string' && row.content.trim().length > 0;
const DIAGNOSTIC_APP_REVISION = 'a-diag1-r10';
const DIAGNOSTIC_CONVERSATION_REVISION = 'c-diag1-r12';
const diagnosticEvents = ['arm', 'visibility_hidden_received', 'visibility_visible_received', 'pagehide', 'pageshow', 'online', 'recovery_queued', 'recovery_begin', 'connect_completion', 'failure_before', 'failure_after', 'recovered', 'capture_stopped'];
const diagnosticOrigins = ['current_connect', 'retry_cap', 'foreground_deadline', 'none', 'unattributed'];
const diagnosticCategories = ['none', 'auth', 'identity', 'malformed_scope', 'unknown_outcome', 'known_refusal', 'known_failed_turn', 'host_attention', 'other_protected'];
const diagnosticPhases = ['offline', 'connecting', 'empty', 'ready', 'sending', 'waiting', 'unknown', 'failed', 'auth', 'error', 'other'];
function diagnosticUtf8Bytes(text) {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0);
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
class LocalDiagnostics {
  #events = []; #pin = null; #terminal = null; #final = null; #context = []; #recording = false;
  #seq = 0; #started = 0; #previous = 0; #truncated = false; #saturated = false; #returned = false;
  #now; #build;
  constructor(appRevision, conversationRevision, now) {
    const app = appRevision === DIAGNOSTIC_APP_REVISION ? appRevision : 'unsupported';
    const conversation = [DIAGNOSTIC_CONVERSATION_REVISION, 'c-src-3beb4e39'].includes(conversationRevision) ? conversationRevision : 'unsupported';
    this.#build = Object.freeze({ app_revision: app, conversation_revision: conversation,
      build_pair_status: app === 'unsupported' || conversation === 'unsupported' ? 'unsupported' : conversation === DIAGNOSTIC_CONVERSATION_REVISION ? 'matched' : 'mixed' });
    this.#now = typeof now === 'function' ? now : () => performance.now();
  }
  get build() { return this.#build; }
  get recording() { return this.#recording; }
  get retainedCount() { return new Set([...this.#events, ...this.#context, this.#pin?.before, this.#pin?.after, this.#terminal, this.#final].filter(Boolean)).size; }
  clear() {
    this.#events = []; this.#pin = null; this.#terminal = null; this.#final = null; this.#context = []; this.#recording = false;
    this.#seq = 0; this.#truncated = false; this.#saturated = false; this.#returned = false;
  }
  arm() {
    this.clear();
    try {
      if (this.#build.build_pair_status !== 'matched') return false;
      const now = this.#now(); if (typeof now !== 'number' || !Number.isFinite(now)) return false;
      this.#started = now; this.#previous = now; this.#recording = true; return true;
    } catch { return false; }
  }
  stop() { this.record('capture_stopped', {}); }
  record(event, data = {}) {
    if (!this.#recording || !diagnosticEvents.includes(event)) return;
    try {
      // Inspect only fixed own data properties. Never enumerate, spread or serialize supplied objects/accessors.
      const input = data && typeof data === 'object' ? data : {};
      const take = key => Object.getOwnPropertyDescriptor(input, key)?.value;
      let saturated = false;
      const number = (value, max, quantize = false) => {
        if (value === undefined) return 0;
        if (typeof value !== 'number' || !Number.isFinite(value)) { saturated = true; return 0; }
        if (value < 0 || value > max) saturated = true;
        const bounded = Math.min(max, Math.max(0, value));
        return quantize ? Math.floor(bounded / 10) * 10 : Math.floor(bounded);
      };
      const bool = key => take(key) === true;
      const enumeration = (key, allowed, fallback, missing = fallback) => {
        const value = take(key);
        return typeof value === 'string' && allowed.includes(value) ? value : value === undefined ? missing : fallback;
      };
      const value = this.#now(); const now = typeof value === 'number' && Number.isFinite(value) ? value : NaN;
      const row = {
        seq: number(++this.#seq, 65535), relative_ms: number(now - this.#started, 600000, true), gap_ms: number(now - this.#previous, 600000, true), event,
        failure_origin: enumeration('failure_origin', diagnosticOrigins, 'unattributed', 'none'),
        phase: enumeration('phase', diagnosticPhases, 'other'), protected_category: enumeration('protected_category', diagnosticCategories, 'other_protected', 'none'),
        ownership_class: enumeration('ownership_class', ['current', 'retired', 'unknown'], 'unknown'),
        lifecycle_captured: number(take('lifecycle_captured'), 65535), lifecycle_current: number(take('lifecycle_current'), 65535),
        generation_captured: number(take('generation_captured'), 65535), generation_current: number(take('generation_current'), 65535),
        model_matches: bool('model_matches'), lifecycle_matches: bool('lifecycle_matches'), episode_matches: bool('episode_matches'), generation_matches: bool('generation_matches'),
        document_hidden: bool('document_hidden'), modeled_hidden: bool('modeled_hidden'), pageshow_persisted: bool('pageshow_persisted'),
        budget_running: bool('budget_running'), budget_elapsed_ms: number(take('budget_elapsed_ms'), 600000, true), budget_remaining_field_ms: number(take('budget_remaining_field_ms'), 15000, true), effective_remaining_ms: number(take('effective_remaining_ms'), 15000, true),
        connecting: bool('connecting'), refreshing: bool('refreshing'), queued: bool('queued'), attempted: bool('attempted'), checking: bool('checking'), failed: bool('failed'), verified: bool('verified'), transport_connected: bool('transport_connected'), retry_count: number(take('retry_count'), 5), saturated: false
      };
      row.saturated = saturated; this.#saturated ||= saturated;
      if (!this.#pin && row.failed && event !== 'failure_before' && row.failure_origin === 'none') row.failure_origin = 'unattributed';
      this.#previous = typeof now === 'number' && Number.isFinite(now) ? now : this.#previous;
      Object.freeze(row); this.#events.push(row);
      if (event === 'visibility_visible_received' || event === 'pageshow') this.#returned = true;
      if (!this.#pin && (event === 'failure_before' || row.failed)) {
        this.#pin = { before: row, after: event === 'failure_before' ? null : row }; this.#context = this.#events.slice(-8);
      } else if (this.#pin) {
        if (event === 'failure_after' && !this.#pin.after && row.failure_origin === this.#pin.before.failure_origin) this.#pin.after = row;
        if (this.#context.length < 16) this.#context.push(row); else this.#truncated = true;
      }
      if (event === 'capture_stopped' || event === 'recovered' && this.#returned) { this.#final = row; this.#recording = false; }
      if (!this.#terminal && event === 'failure_after' && row.failed && ['retry_cap', 'foreground_deadline'].includes(row.failure_origin)) this.#terminal = row;
      // Include pins/context/summary in the 64-record memory budget, not just the rolling ring.
      while (this.retainedCount > 64 && this.#events.length) { this.#events.shift(); this.#truncated = true; }
    } catch { this.#recording = false; this.#truncated = true; }
  }
  text() {
    try {
      const events = (this.#pin ? this.#context : this.#events.slice(-16)).slice();
      let truncated = this.#truncated || this.#events.length > events.length;
      for (;;) {
        // Serialize only projected records; check real UTF-8 size independently of the enum/ASCII invariant.
        const text = JSON.stringify({ schema: 2, app_revision: this.#build.app_revision, conversation_revision: this.#build.conversation_revision,
          build_pair_status: this.#build.build_pair_status, recording: this.#recording, truncated, saturated: this.#saturated, first_failure: this.#pin, terminal_failure: this.#terminal, final_state: this.#final, events });
        if (diagnosticUtf8Bytes(text) <= 16384) return text;
        if (!events.length) return '{"schema":1,"status":"unavailable"}';
        events.shift(); truncated = true;
      }
    } catch { return '{"schema":1,"status":"unavailable"}'; }
  }
  snapshot() { return JSON.parse(this.text()); }
}
// Metadata is inspected only on explicit capture. Before that, weak correspondence
// tables contain numeric positions only: no metadata, identifiers or strong row refs.
const MESSAGE_TAIL = 8, MESSAGE_COUNT = 255;
function messageOwn(object, key) {
  try {
    if (!object || typeof object !== 'object') return { known: false };
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor) return { known: true, missing: true };
    return Object.hasOwn(descriptor, 'value') ? { known: true, value: descriptor.value } : { known: false };
  } catch { return { known: false }; }
}
function messageFlag(property) {
  return property.known && (property.missing || typeof property.value === 'boolean')
    ? { value: property.value === true, known: true } : { value: false, known: false };
}
function messageRow(row, take) {
  const role = take(row, 'role'), metadata = take(row, 'display_metadata');
  const modelOnly = metadata.known && (metadata.missing || metadata.value === null)
    ? { value: false, known: true } : metadata.known && metadata.value && typeof metadata.value === 'object' && !Array.isArray(metadata.value)
      ? messageFlag(take(metadata.value, 'model_only')) : { value: false, known: false };
  const kind = take(row, 'display_kind'), archived = messageFlag(take(row, 'archived'));
  const hiddenKnown = kind.known && (kind.missing || kind.value === 'hidden');
  return { role: role.known && ['user', 'assistant', 'system', 'tool'].includes(role.value) ? role.value : 'unknown',
    model_only: modelOnly.value, model_only_known: modelOnly.known,
    hidden: hiddenKnown && kind.value === 'hidden', hidden_known: hiddenKnown,
    archived: archived.value, archived_known: archived.known };
}
function messageLength(array, take) {
  if (!Array.isArray(array)) return null;
  const length = take(array, 'length').value;
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}
class MessageDiagnostics {
  #build; #report = null; #project;
  constructor(app, conversation, project) { this.#build = new LocalDiagnostics(app, conversation).build; this.#project = project; }
  get build() { return this.#build; }
  clear() { this.#report = null; }
  capture(owner, input) {
    if (this.#build.build_pair_status !== 'matched') return false;
    try { this.#report = this.#project(owner, input); return this.#report.status === 'captured'; }
    catch { this.#report = { status: 'unavailable' }; return false; }
  }
  select(ordinal) {
    if (this.#report?.status !== 'captured') return;
    this.#report.selected_ordinal = Number.isInteger(ordinal) && ordinal >= 0 && ordinal <= this.#report.dom_tail.length ? ordinal : 0;
  }
  text() {
    try {
      const text = JSON.stringify({ schema: 2, diagnostic: 'message_provenance', ...this.#build,
        scope: 'accepted_model_current_view', tail_cap: MESSAGE_TAIL, count_cap: MESSAGE_COUNT,
        ...(this.#report || { status: 'off' }) });
      if (diagnosticUtf8Bytes(text) <= 8192) return text;
    } catch { /* No raw error or supplied object can enter fallback output. */ }
    return '{"schema":2,"diagnostic":"message_provenance","status":"unavailable"}';
  }
  snapshot() { return JSON.parse(this.text()); }
}
export class Conversation {
  #viewArrays = new WeakMap(); #viewArticles = new WeakMap(); #viewEpoch = 0; #viewProjection = null;
  static diagnosticRevision = DIAGNOSTIC_CONVERSATION_REVISION;
  // Presentation only. Protocol roles/rows remain untouched for reconciliation.
  // Own data descriptors avoid invoking metadata accessors or coercion hooks.
  static displayPresentation(row) {
    const kind = messageOwn(row, 'display_kind').value;
    const metadata = messageOwn(row, 'display_metadata').value;
    let validMetadata = false;
    try { validMetadata = Boolean(metadata && typeof metadata === 'object' && !Array.isArray(metadata)); }
    catch { /* A revoked object is not a validated metadata container. */ }
    if (kind === 'hidden' || kind === 'internal_notification' ||
        validMetadata && messageOwn(metadata, 'model_only').value === true) return { kind: 'hidden' };
    if (kind === 'process_complete' || kind === 'async_delegation_complete') {
      const text = validMetadata ? messageOwn(metadata, 'display_text').value : undefined;
      // The producer admission contract is nonblank text, at most 2000 code points.
      // Missing/malformed card text never falls back to model-facing machinery.
      // Python str.strip whitespace, verified against the actual producer over
      // U+0000..U+10FFFF. Unlike JS trim: includes NEL/C0; excludes FEFF.
      // Test nonblankness only; retain the original display text literally.
      return typeof text === 'string' && /[^\u0009-\u000D\u001C-\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/u.test(text) && [...text].length <= 2000
        ? { kind: 'system_notice', text } : { kind: 'hidden' };
    }
    // Unknown/absent kinds cannot safely identify historical machinery.
    return { kind: 'message' };
  }
  static createDiagnostics(appRevision, conversationRevision, now) { return new LocalDiagnostics(appRevision, conversationRevision, now); }
  static createMessageDiagnostics(appRevision, conversationRevision) { return new MessageDiagnostics(appRevision, conversationRevision, (owner, input) => Conversation.#messageDiagnosticProjection(owner, input)); }
  #viewStamp(rows) {
    try {
      let epoch = this.#viewArrays.get(rows);
      if (epoch === undefined) { epoch = ++this.#viewEpoch; this.#viewArrays.set(rows, epoch); }
      return epoch;
    } catch { return -1; }
  }
  #noteViewProjection(count, tail, epoch) {
    try { this.#viewProjection = { epoch, count, tail }; }
    catch { this.#viewProjection = null; }
  }
  rememberDiagnosticArticle(article, ordinal, rendered = true) {
    try {
      if (rendered !== true && this.#viewArticles.get(article)?.ordinal !== ordinal) return;
      const projection = this.#viewProjection, start = Math.max(0, (projection?.count || 0) - MESSAGE_TAIL);
      if (projection && Number.isSafeInteger(ordinal) && ordinal >= start && ordinal < projection.count) this.#viewArticles.set(article, { index: projection.tail[ordinal - start], epoch: projection.epoch, ordinal });
    } catch { /* Never interrupt the real renderer. */ }
  }
  static #messageDiagnosticProjection(owner, input) {
    const reads = new WeakMap();
    const take = (object, key) => {
      if (!object || typeof object !== 'object') return { known: false };
      let properties = reads.get(object);
      if (!properties) { properties = new Map(); reads.set(object, properties); }
      if (!properties.has(key)) properties.set(key, messageOwn(object, key));
      return properties.get(key);
    };
    const rows = take(take(owner, 'state').value, 'rows').value, count = messageLength(rows, take);
    const nodes = take(input, 'nodes').value, roles = take(input, 'roles').value;
    const nodeCount = messageLength(nodes, take), roleCount = messageLength(roles, take), domCount = take(input, 'count').value;
    if (count === null || nodeCount === null || nodeCount > MESSAGE_TAIL || nodeCount !== roleCount || !Number.isSafeInteger(domCount) || domCount < 0 || nodeCount !== Math.min(MESSAGE_TAIL, domCount)) return { status: 'unavailable' };
    const epoch = owner.#viewArrays.get(rows), projection = owner.#viewProjection;
    const current = epoch !== undefined && projection?.epoch === epoch;
    const cache = new Map(), unknown = { role: 'unknown', model_only: false, model_only_known: false, hidden: false, hidden_known: false, archived: false, archived_known: false };
    const source = index => {
      if (!Number.isSafeInteger(index) || index < 0 || index >= count) return unknown;
      if (!cache.has(index)) cache.set(index, messageRow(take(rows, String(index)).value, take));
      return cache.get(index);
    };
    const record = (index, ordinal, known = true) => ({ ordinal,
      raw_tail_ordinal: known && index >= Math.max(0, count - MESSAGE_TAIL) && index < count ? index - Math.max(0, count - MESSAGE_TAIL) + 1 : 0,
      origin: !known ? 'unknown' : index === -1 ? 'local' : index >= 0 && index < count ? 'saved' : 'unknown',
      ...(known && index >= 0 ? source(index) : index === -1 && known ? { ...unknown, role: 'user' } : unknown) });
    const raw = [];
    for (let index = Math.max(0, count - MESSAGE_TAIL); index < count; index++) raw.push(record(index, raw.length + 1));
    const projected = current ? projection.tail.map((index, offset) => record(index, offset + 1)) : [];
    let mappingKnown = current, orderMatches = current;
    const dom = [];
    for (let offset = 0; offset < nodeCount; offset++) {
      const article = take(nodes, String(offset)).value, slot = owner.#viewArticles.get(article);
      const known = current && slot?.epoch === epoch;
      const role = take(roles, String(offset)).value;
      const domRole = ['user', 'reply', 'system_notice'].includes(role) ? role : 'unknown';
      mappingKnown &&= known; orderMatches &&= known && slot.ordinal === domCount - nodeCount + offset;
      dom.push({ ...record(slot?.index, offset + 1, known), dom_role: domRole });
    }
    return { status: 'captured', selected_ordinal: 0, raw_count: Math.min(count, MESSAGE_COUNT), raw_count_capped: count > MESSAGE_COUNT,
      projected_known: Boolean(current), projected_count: current ? Math.min(projection.count, MESSAGE_COUNT) : 0,
      projected_count_capped: Boolean(current && projection.count > MESSAGE_COUNT),
      dom_count: Math.min(domCount, MESSAGE_COUNT), dom_count_capped: domCount > MESSAGE_COUNT,
      counts_match_known: Boolean(current), projected_dom_counts_match: Boolean(current && projection.count === domCount),
      mapping_known: Boolean(mappingKnown), projected_dom_order_matches: Boolean(orderMatches),
      truncated: count > MESSAGE_TAIL || Boolean(current && projection.count > MESSAGE_TAIL) || domCount > MESSAGE_TAIL,
      raw_tail: raw, projected_tail: projected, dom_tail: dom };
  }
  constructor(gateway, settings, notify = () => {}, makeId = () => crypto.randomUUID()) {
    this.gateway = gateway; this.settings = settings; this.notify = notify; this.makeId = makeId;
    this.state = { phase: 'offline', rows: [], draft: '', sessionId: settings.sessionId ?? null, pending: null,
      notice: 'Not connected. Your draft stays in this page; nothing is queued.' };
    gateway.onClose = () => this.disconnected();
    this.connecting = false; this.refreshing = false; this.busy = false;
    // Confirmed acceptance is page-memory evidence, never inferred from history.
    this.delivery = new Set();
    this.replyGaps = new Map();
    this.messageRevision = 0;
    this.lifecycle = 0; this.identityRejected = false; this.identityNotice = '';
    this.foregroundState = null; this.warning = null; this.refreshVersion = 0; this.idleWaiters = [];
    this.diagnostics = null; this.diagnosticCause = 'none'; this.diagnosticHostAttention = false; this.diagnosticRecoveryPending = false;
  }
  diagnosticProtectedCategory() {
    if (this.identityRejected) return this.identityPhase === 'auth' ? 'auth' : 'identity';
    if (this.state.phase === 'auth' || this.warning?.phase === 'auth') return 'auth';
    if (this.diagnosticCause === 'malformed_scope' || this.diagnosticCause === 'identity') return this.diagnosticCause;
    if (this.state.pending?.status === 'rejected') return 'known_refusal';
    if (this.state.pending?.terminalReceipt?.result?.failed || this.state.pending?.terminalReceipt?.result?.completed === false) return 'known_failed_turn';
    if (this.state.pending?.status === 'unknown' || this.state.phase === 'unknown' || this.warning?.phase === 'unknown') return 'unknown_outcome';
    if (this.diagnosticHostAttention) return 'host_attention';
    if (this.diagnosticCause !== 'none') return this.diagnosticCause;
    return this.state.phase === 'error' || this.warning?.phase === 'error' ? 'other_protected' : 'none';
  }
  noteDiagnosticError(reason) {
    this.diagnosticCause = reason === 'authentication_required' ? 'auth' : reason === 'routing_identity_mismatch' ? 'identity'
      : ['malformed_history_snapshot', 'session_scope_mismatch', 'receipt_scope_mismatch'].includes(reason) ? 'malformed_scope' : reason == null || reason === 'connection_denied' ? 'none' : 'other_protected';
  }
  traceDiagnostic(event, origin = 'none', context = {}) {
    try {
      if (!this.diagnostics?.recording) return;
      const s = this.foregroundState, take = key => Object.getOwnPropertyDescriptor(context, key)?.value;
      const flag = key => take(key) === undefined ? true : take(key) === true;
      const elapsed = s?.startedAt != null ? performance.now() - s.startedAt : 0;
      this.diagnostics.record(event, {
        failure_origin: origin, phase: this.state.phase, protected_category: this.diagnosticProtectedCategory(),
        lifecycle_captured: take('lifecycle_captured') ?? this.lifecycle, lifecycle_current: this.lifecycle, generation_captured: take('generation_captured') ?? s?.generation ?? 0, generation_current: s?.generation ?? 0,
        model_matches: flag('model_matches'), lifecycle_matches: flag('lifecycle_matches'), episode_matches: flag('episode_matches'), generation_matches: flag('generation_matches'),
        ownership_class: ['model_matches', 'lifecycle_matches', 'episode_matches', 'generation_matches'].every(flag) ? 'current' : 'retired',
        document_hidden: typeof document !== 'undefined' && document.hidden === true, modeled_hidden: s?.hidden === true, pageshow_persisted: take('pageshow_persisted') === true,
        budget_running: s?.startedAt != null, budget_elapsed_ms: elapsed, budget_remaining_field_ms: s?.remaining ?? 0, effective_remaining_ms: Math.max(0, (s?.remaining ?? 0) - elapsed),
        connecting: this.connecting, refreshing: this.refreshing, queued: s?.queued === true, attempted: s?.attempted === true, checking: s?.checking === true,
        failed: s?.failed === true, verified: s?.verified === true, transport_connected: this.gateway.connected === true,
        retry_count: take('retry_count') ?? (typeof this.diagnosticRetryCount === 'function' ? this.diagnosticRetryCount() : this.diagnosticRetryCount ?? 0)
      });
    } catch { /* Diagnostics never interrupt application control flow. */ }
  }
  emit() {
    if (this.identityRejected) { this.state.phase = this.identityPhase; this.state.notice = this.identityNotice; }
    if (['auth', 'error', 'unknown', 'failed'].includes(this.state.phase) || /^Hermes (needs attention|finished processing)/.test(this.state.notice)) {
      this.warning = { phase: this.state.phase, notice: this.state.notice };
    }
    this.notify(this.state);
  }
  whenIdle() {
    return this.connecting || this.refreshing || this.state.phase === 'sending'
      ? new Promise(resolve => this.idleWaiters.push(resolve)) : Promise.resolve();
  }
  signalIdle() {
    if (!this.connecting && !this.refreshing && this.state.phase !== 'sending') this.idleWaiters.splice(0).forEach(resolve => resolve());
  }
  pauseForeground() {
    const s = this.foregroundState;
    if (!s) return;
    if (s.startedAt !== null) s.remaining = Math.max(0, s.remaining - (performance.now() - s.startedAt));
    clearTimeout(s.timer); s.timer = null; s.startedAt = null;
  }
  background() {
    this.pauseForeground();
    if (!this.foregroundState || this.foregroundState.verified) {
      this.foregroundState = { remaining: 15000, startedAt: null, timer: null, hidden: true, checking: false, failed: false, verified: false, queued: false, attempted: false, generation: 0, retryable: false, reservation: null };
    }
    const s = this.foregroundState;
    // Invalidate a check in flight without renewing its budget or retry count.
    // A replacement may queue, but must join the old work before starting.
    if (this.connecting && !s.failed) s.attempted = false;
    s.hidden = true; s.checking = true; s.queued = false; ++s.generation;
    this.traceDiagnostic('visibility_hidden_received');
  }
  canRecoverAutomatically() {
    return !this.identityRejected && !(this.foregroundState?.checking && this.foregroundState.failed) && !['auth', 'error'].includes(this.state.phase) && !['auth', 'error'].includes(this.warning?.phase);
  }
  beginForeground() {
    const s = this.foregroundState;
    if (!s) return false;
    s.hidden = false;
    if (!this.canRecoverAutomatically() || s.verified) return false;
    s.checking = true;
    if (!s.failed && s.startedAt === null) {
      s.startedAt = performance.now();
      s.timer = setTimeout(() => this.failForeground('foreground_deadline'), s.remaining);
    }
    const queue = !s.queued && !s.attempted;
    if (queue) s.queued = true;
    this.traceDiagnostic('visibility_visible_received');
    this.emit(); return queue;
  }
  attemptFailedForeground() {
    const s = this.foregroundState;
    if (!s?.checking || s.verified || s.failed) return;
    this.traceDiagnostic('failure_before', 'current_connect');
    s.retryable = this.canRecoverAutomatically(); this.emit();
    this.traceDiagnostic('failure_after', 'current_connect');
  }
  failForeground(origin = 'unattributed') {
    const s = this.foregroundState;
    if (!s?.checking || s.verified || s.failed) return;
    this.traceDiagnostic('failure_before', origin);
    this.pauseForeground(); s.failed = true; s.retryable = false; s.reservation = null; this.emit();
    this.traceDiagnostic('failure_after', origin);
  }
  finishForeground(owner, generation) {
    const s = this.foregroundState;
    // Success proves only the visible interval in which verification began.
    if (!s || s !== owner || s.hidden || s.generation !== generation) return;
    this.pauseForeground(); s.checking = false; s.verified = true; s.queued = false; s.retryable = false; s.reservation = null;
    this.diagnosticRecoveryPending = true;
  }
  presentation() {
    const s = this.foregroundState;
    if ((s?.checking || this.connecting) && this.warning) return this.warning;
    if (s?.checking) return s.failed
      ? { phase: 'offline', notice: 'Connection not restored yet. Reconnect or check the host. Nothing will be resent.' }
      : { phase: 'connecting', notice: this.gateway.connected ? 'Checking connection…' : 'Reconnecting…' };
    return this.state;
  }
  refreshed() {
    ++this.refreshVersion;
    this.warning = null;
  }
  current(epoch) { return epoch === this.lifecycle && !this.identityRejected; }
  rejectIdentity(notice = 'The host or bot identity could not be verified. Verify the original connection deliberately; nothing will be resent.', phase = 'error') {
    this.identityRejected = true; this.identityNotice = notice; this.identityPhase = phase; ++this.lifecycle;
    this.connecting = false; this.refreshing = false;
    const pending = this.state.pending;
    if (pending && !pending.terminalReceipt && pending.status !== 'rejected') pending.status = 'unknown';
    // Fence before closing: pending RPC catches and onClose belong to the retired epoch.
    this.pauseForeground(); this.gateway.close(); this.emit(); this.signalIdle();
  }
  setDraft(text) { this.state.draft = text; this.emit(); }
  isWorking() { return !this.foregroundState?.checking && !this.connecting && this.gateway.connected && this.state.phase === 'waiting' && this.state.pending?.status === 'started'; }
  historyNotice({ awaitingUser = false } = {}) {
    const replies = [...this.replyGaps.values()];
    if (replies.some(id => id === null)) { this.diagnosticCause = 'other_protected'; return 'Hermes finished processing, but no stable reply address was returned. Check reply history on the host.'; }
    if (replies.some(id => this.state.rows.some(row => row.role === 'assistant' && row.row_id === id && !isDisplayableAssistant(row)))) {
      this.diagnosticCause = 'other_protected';
      return 'Hermes finished processing, but its saved reply has no displayable text. Check the conversation on the host.';
    }
    return awaitingUser ? 'Hermes finished. Syncing the saved conversation…'
      : this.replyGaps.size ? 'Hermes finished. Syncing the saved reply…' : 'Connected. History is saved by Hermes.';
  }
  visibleRows() {
    const epoch = this.#viewStamp(this.state.rows);
    const sourceTail = [];
    const note = index => { sourceTail.push(index); if (sourceTail.length > MESSAGE_TAIL) sourceTail.shift(); };
    const pending = this.state.pending;
    const matched = pending && this.state.rows.some(row => submissionId(row) === pending.inputId && Number.isSafeInteger(row.row_id));
    const rows = this.state.rows.filter((row, index) => { const visible = Conversation.displayPresentation(row).kind !== 'hidden' && (row.role !== 'assistant' || isDisplayableAssistant(row)); if (visible) note(index); return visible; }).map(row => {
      if (Conversation.displayPresentation(row).kind === 'system_notice') return row;
      const id = submissionId(row);
      const delivered = this.delivery.has(id);
      const label = delivered ? 'Delivered' : pending && id === pending.inputId ? deliveryLabels[pending.status] : null;
      return label ? { ...row, delivery: label, deliveryTitle: delivered ? 'Delivered to Hermes' : label, active: false } : row;
    });
    if (pending && !matched) {
      const delivered = this.delivery.has(pending.inputId);
      const label = delivered ? 'Delivered' : deliveryLabels[pending.status];
      rows.push({ role: 'user', content: pending.text, local: true, submission_id: pending.inputId, delivery: label, deliveryTitle: delivered ? 'Delivered to Hermes' : label, active: false });
      note(-1);
    }
    this.#noteViewProjection(rows.length, sourceTail, epoch);
    return rows;
  }
  restoreHeldMessage() {
    const pending = this.state.pending;
    if (!pending || !['unknown', 'failed'].includes(this.state.phase) || this.state.draft.length) return false;
    this.state.draft = pending.text;
    if (pending.status === 'rejected') { this.messageRevision++; this.state.pending = null; this.state.phase = this.gateway.connected ? 'ready' : 'offline'; }
    this.state.notice = this.state.pending ? 'Text restored. The turn outcome is still unresolved; nothing will be resent. Check the host before sending again.' : 'Text restored. Nothing was resent.';
    this.emit(); return true;
  }
  disconnected() {
    if (this.identityRejected) return;
    if (this.state.pending?.status === 'rejected' || this.state.pending?.terminalReceipt?.result?.failed || this.state.pending?.terminalReceipt?.result?.completed === false) {
      this.state.phase = 'failed';
      this.state.notice = this.state.pending.refusalNotice || 'Hermes reported a failed turn. Its text is retained. Restore it or dismiss the held message; nothing will be retried automatically.';
      this.emit(); return;
    }
    const knownTerminal = Boolean(this.state.pending?.terminalReceipt);
    if (this.state.pending && !knownTerminal) this.state.pending.status = 'unknown';
    this.state.phase = this.state.pending && !knownTerminal ? 'unknown' : 'offline';
    this.state.notice = knownTerminal ? 'Connection lost after a known terminal result. Saved history still needs checking; nothing will be resent.' : this.state.pending ? this.delivery.has(this.state.pending.inputId) ? 'Connection lost after delivery to Hermes. The turn outcome is unknown; nothing will be resent.' : 'Connection lost. Delivery is not confirmed; your held draft will not be resent.' : 'Host unavailable. Your draft stays in this page; nothing is queued.';
    this.emit();
  }
  async connect({ recoverIdentity = false } = {}) {
    if (this.connecting || this.identityRejected && !recoverIdentity) return false;
    const recovering = this.identityRejected;
    if (recovering) { ++this.lifecycle; this.identityRejected = false; }
    const epoch = this.lifecycle;
    const refreshVersion = this.refreshVersion;
    const foreground = this.foregroundState;
    const generation = foreground && !foreground.hidden ? foreground.generation : null;
    this.connecting = true; this.state.phase = 'connecting'; this.state.notice = 'Connecting to Hermes…'; this.emit();
    try {
      await this.gateway.connect();
      if (!this.current(epoch)) return false;
      if (this.settings.kind === 'canonical' && typeof this.gateway.canonicalTarget === 'function') {
        const target = await this.gateway.canonicalTarget();
        if (!this.current(epoch)) return false;
        if (target?.kind !== 'canonical' || target.scopeKey !== this.settings.scopeKey) throw new RpcError('session_scope_mismatch');
        this.settings = target; this.state.sessionId = target.sessionId;
      }
      await this.refresh();
      const verified = this.current(epoch) && this.gateway.connected && this.refreshVersion > refreshVersion;
      if (verified) this.finishForeground(foreground, generation);
      return verified;
    }
    catch (error) {
      if (!this.current(epoch)) return false;
      if (error.reason === 'canonical_operation_retired') return false;
      this.noteDiagnosticError(error instanceof RpcError ? error.reason : null);
      if (recovering || error instanceof RpcError && error.reason === 'routing_identity_mismatch') {
        if (error instanceof RpcError && error.reason === 'authentication_required') this.rejectIdentity('Your Hermes sign-in has expired or was revoked. Sign in again, then deliberately verify the original connection; nothing is resent.', 'auth');
        else this.rejectIdentity();
        return false;
      }
      if (this.state.pending && !this.state.pending.terminalReceipt && this.state.pending.status !== 'rejected') this.state.pending.status = 'unknown';
      if (error instanceof RpcError && error.reason === 'authentication_required') {
        this.state.phase = 'auth'; this.state.notice = 'Your Hermes sign-in has expired or was revoked. Sign in again; nothing is resent.'; this.emit();
      } else if (error instanceof RpcError && error.reason === 'webapp_required') {
        this.state.phase = 'error'; this.state.notice = 'Open this page on the Hermes Webapp, not the standalone dashboard.'; this.emit();
      } else if (canonicalMessage(error.reason)) {
        this.state.phase = 'error'; this.state.notice = canonicalMessage(error.reason); this.emit();
      } else { this.disconnected(); }
    } finally { if (epoch === this.lifecycle) { this.connecting = false; this.signalIdle(); this.emit(); if (this.diagnosticRecoveryPending) { this.diagnosticRecoveryPending = false; this.traceDiagnostic('connect_completion'); this.traceDiagnostic('recovered'); } } }
    return false;
  }
  async start() {
    if (this.identityRejected || this.state.phase !== 'empty' || !this.gateway.connected) return;
    const epoch = this.lifecycle;
    this.connecting = true; this.state.phase = 'connecting'; this.emit();
    try {
      if (this.settings.kind !== 'canonical' || typeof this.gateway.ensureCanonical !== 'function') throw new RpcError('canonical_contract_unsupported');
      const target = await this.gateway.ensureCanonical();
      if (!this.current(epoch)) return;
      if (target?.kind !== 'canonical' || target.scopeKey !== this.settings.scopeKey || !target.sessionId || !Array.isArray(target.sessionIds) || !target.sessionIds.includes(target.sessionId)) throw new RpcError('session_scope_mismatch');
      this.settings = target; this.state.sessionId = target.sessionId;
      await this.refresh();
    } catch (error) {
      if (!this.current(epoch)) return;
      if (error.reason === 'canonical_operation_retired') {
        if (this.state.phase === 'connecting') {
          this.state.phase = 'offline'; this.state.notice = 'Bot Chat check interrupted. Reconnect to check its canonical registry; nothing will be recreated or resent.';
        }
        return;
      }
      this.noteDiagnosticError(error.reason);
      if (error.reason === 'routing_identity_mismatch') this.rejectIdentity();
      else {
        this.state.phase = error instanceof RpcError && error.reason === 'authentication_required' ? 'auth' : 'error';
        this.state.notice = canonicalMessage(error.reason) || 'Could not verify this bot’s canonical Bot Chat. Check Hermes access and reconnect; nothing was sent.'; this.emit();
      }
    } finally { if (this.current(epoch)) { this.connecting = false; this.emit(); } this.signalIdle(); }
  }
  async refresh() {
    if (this.identityRejected || this.refreshing || !this.gateway.connected) return;
    const epoch = this.lifecycle;
    this.refreshing = true;
    this.diagnosticCause = 'none';
    const revision = this.messageRevision;
    try {
      if (!this.state.sessionId) {
        this.state.phase = 'empty'; this.state.notice = this.gateway.canonicalAttempted
          ? canonicalMessage('canonical_creation_unconfirmed')
          : 'Bot Chat required. Open or create Bot Chat checks the exact canonical registry first. Only confirmed absence permits creation; no message or welcome prompt is sent.';
        this.refreshed(); this.emit(); return;
      }
      const snapshot = await this.gateway.rpc('session.resume', { session_id: this.state.sessionId });
      if (!this.current(epoch) || revision !== this.messageRevision) return;
      if (snapshot.session_id !== this.state.sessionId && !(this.settings.sessionIds || []).includes(snapshot.session_id)) throw new RpcError('session_scope_mismatch');
      this.state.sessionId = snapshot.session_id;
      this.state.rows = Array.isArray(snapshot.messages) ? snapshot.messages.filter(row => ['user', 'assistant'].includes(row.role) && typeof row.content === 'string') : [];
      for (const [id, replyId] of this.replyGaps) {
        if (replyId !== null && this.state.rows.some(row => isDisplayableAssistant(row) && row.row_id === replyId)) this.replyGaps.delete(id);
      }
      this.busy = Boolean(snapshot.running || snapshot.pending?.length || snapshot.open_requests?.length);
      this.diagnosticHostAttention = Boolean(snapshot.open_requests?.length);
      const pending = this.state.pending;
      if (pending) {
        if (pending.status === 'rejected') { this.state.phase = 'failed'; this.state.notice = pending.refusalNotice; this.refreshed(); this.emit(); return; }
        const canonical = this.state.rows.find(row => submissionId(row) === pending.inputId && Number.isSafeInteger(row.row_id));
        if (!pending.admissionId) pending.admissionId = snapshot.pending?.find(row => row.input_id === pending.inputId)?.admission_id || null;
        if (!pending.admissionId) {
          pending.status = 'unknown';
          this.state.phase = 'unknown'; this.state.notice = canonical ? 'Saved message found by submission ID. The turn outcome is unknown; nothing will be resent.' : 'History refreshed, but the outcome cannot be confirmed. Nothing has been resent. Review the host before sending again.';
        } else {
          const receipt = pending.terminalReceipt || await this.gateway.rpc('prompt.receipt', { session_id: this.state.sessionId, admission_id: pending.admissionId, include_result: true });
          if (!this.current(epoch) || revision !== this.messageRevision) return;
          // The RPC is scoped to this session/admission. Echoed identity must agree.
          if ((receipt.admission_id && receipt.admission_id !== pending.admissionId) || (receipt.session_id && receipt.session_id !== this.state.sessionId)) throw new RpcError('receipt_scope_mismatch');
          if (['queued', 'started', 'terminal', 'unknown'].includes(receipt.status)) this.delivery.add(pending.inputId);
          // Known terminal results remain terminal across reconnect/history lag.
          if (receipt.status === 'terminal' && typeof receipt.result?.completed === 'boolean') pending.terminalReceipt = receipt;
          if (receipt.status === 'unknown') {
            pending.status = 'unknown';
            this.state.phase = 'unknown'; this.state.notice = 'Hermes reports an unknown outcome. Nothing will be retried automatically.';
          } else if (receipt.status === 'terminal' && (receipt.result?.failed || receipt.result?.completed === false)) {
            pending.status = 'failed';
            this.state.phase = 'failed'; this.state.notice = 'Hermes reported a failed turn. Its text is retained. Restore it or dismiss the held message; nothing will be retried automatically.';
          } else if (receipt.status === 'terminal' && receipt.result?.completed === true) {
            pending.status = 'complete';
            const replyId = receipt.result.persisted_turn?.final_assistant_row_id;
            const addressedReply = Number.isSafeInteger(replyId) && replyId > 0 ? replyId : null;
            if (addressedReply === null || !this.state.rows.some(row => isDisplayableAssistant(row) && row.row_id === addressedReply)) this.replyGaps.set(pending.inputId, addressedReply);
            else this.replyGaps.delete(pending.inputId);
            if (canonical) {
              this.state.pending = null;
            }
            this.state.phase = canonical && !this.busy ? 'ready' : 'waiting';
            this.state.notice = this.historyNotice({ awaitingUser: !canonical });
          } else {
            pending.status = receipt.status === 'started' ? 'started' : receipt.status === 'queued' ? 'queued' : 'unknown';
            if (pending.status === 'unknown') {
              this.state.phase = 'unknown'; this.state.notice = 'The host returned an unrecognized outcome. Nothing will be resent.'; this.emit(); return;
            }
            this.state.phase = 'waiting'; this.state.notice = `Delivered to Hermes. Waiting for ${this.settings.sender}…`;
          }
        }
      } else {
        this.state.phase = this.busy ? 'waiting' : 'ready';
        this.state.notice = snapshot.open_requests?.length ? 'Hermes needs attention on the host. No approval is available from this screen.' : this.busy ? 'This conversation has pending host activity.' : this.historyNotice();
      }
      this.refreshed(); this.emit();
    } catch (error) {
      if (!this.current(epoch) || revision !== this.messageRevision) return;
      if (error instanceof RpcError) {
        this.noteDiagnosticError(error.reason);
        if (error.reason === 'authentication_required') {
          if (this.state.pending && !this.state.pending.terminalReceipt && this.state.pending.status !== 'rejected') this.state.pending.status = 'unknown';
          this.state.phase = 'auth'; this.state.notice = 'Your Hermes sign-in has expired or was revoked. Sign in again; nothing is resent.'; this.emit(); return;
        }
        if (this.state.pending?.status === 'rejected') {
          this.state.phase = 'failed'; this.state.notice = this.state.pending.refusalNotice; this.emit(); return;
        }
        const knownTerminal = Boolean(this.state.pending?.terminalReceipt);
        if (this.state.pending && !knownTerminal) this.state.pending.status = 'unknown';
        this.state.phase = this.state.pending && !knownTerminal ? 'unknown' : 'error';
        this.state.notice = knownTerminal ? 'Could not refresh saved history. The known terminal result is retained; nothing will be resent.' : this.state.pending ? 'Could not check this message. Its outcome is unknown; nothing will be resent.' : 'Hermes could not open this canonical Bot Chat. Review the bot in official Hermes, then reconnect; nothing was sent.';
        this.emit();
      }
      else { this.disconnected(); throw error; }
    } finally { if (epoch === this.lifecycle) { this.refreshing = false; this.signalIdle(); } }
  }
  async send() {
    if (this.identityRejected || this.foregroundState?.checking || this.connecting || this.state.phase !== 'ready' || !this.gateway.connected || this.state.pending || !this.state.draft.trim()) return false;
    const epoch = this.lifecycle;
    const pending = { inputId: this.makeId(), text: this.state.draft, admissionId: null, status: 'sending' };
    this.messageRevision++;
    this.state.pending = pending; this.state.draft = ''; this.state.phase = 'sending'; this.state.notice = 'Sending to Hermes…'; this.emit();
    try {
      const receipt = await this.gateway.rpc('prompt.submit', { session_id: this.state.sessionId, input_id: pending.inputId, text: pending.text });
      if (!this.current(epoch)) return true;
      if (!receipt?.admission_id) throw new Error('Admission outcome unknown');
      if (this.state.pending !== pending) return true;
      if (receipt.session_id && receipt.session_id !== this.state.sessionId) throw new Error('Admission scope mismatch');
      pending.admissionId = receipt.admission_id;
      if (['queued', 'started', 'terminal', 'unknown'].includes(receipt.status)) this.delivery.add(pending.inputId);
      pending.status = ['queued', 'started', 'terminal'].includes(receipt.status) ? receipt.status : 'unknown';
      this.state.phase = pending.status === 'unknown' ? 'unknown' : 'waiting';
      this.state.notice = pending.status === 'unknown' ? 'Turn outcome unknown. Nothing will be resent.' : `Delivered to Hermes. Waiting for ${this.settings.sender}…`; this.emit();
      await this.refresh();
    } catch (error) {
      if (!this.current(epoch) || this.state.pending !== pending) return true;
      if (error instanceof RpcError && error.admitted === false) {
        pending.status = 'rejected'; this.state.phase = 'failed'; this.state.notice = 'Hermes did not accept this message. Restore its text or dismiss it; nothing will be retried.';
        pending.refusalNotice = this.state.notice;
      } else { pending.status = 'unknown'; this.state.phase = 'unknown'; this.state.notice = this.delivery.has(pending.inputId) ? 'Delivered to Hermes, but the turn outcome could not be checked. Nothing will be resent.' : 'Delivery is not confirmed. Your held message will not be resent; check delivery first.'; }
      this.emit();
    }
    this.signalIdle(); return true;
  }
  discardHeldDraft() {
    if (this.state.phase !== 'failed') return;
    this.messageRevision++;
    this.state.pending = null;
    this.state.phase = !this.gateway.connected ? 'offline' : this.busy ? 'waiting' : 'ready';
    this.state.notice = 'Held message dismissed. Your current draft is unchanged. Nothing was resent.'; this.emit();
  }
}
