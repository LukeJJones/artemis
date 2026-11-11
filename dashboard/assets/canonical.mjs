import { RpcError } from './gateway.mjs';

const canonicalId = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value);
const canonicalRefuse = reason => { throw new RpcError(reason); };
const canonicalTitle = 'Bot Chat';

export function canonicalMessage(reason) {
  return ({
    canonical_contract_unsupported: 'Bot Chat required. This host does not advertise the supported canonical Bot Chat contract. Open this bot in supported official Hermes, then reconnect; Artemis will not create a separate chat.',
    canonical_registry_unconfirmed: 'Could not confirm the Bot Chat registry. Reconnect to check again. No new chat was requested; your draft stays in this page.',
    canonical_creation_unconfirmed: 'Bot Chat creation outcome is unconfirmed. Reconnect to check its registry; Artemis will not repeat creation or send anything. If still unavailable, check the Bot Chat in official Hermes.',
    canonical_confirmation_failed: 'Bot Chat creation could not be confirmed against its canonical root and compression tip. Reconnect to check, or open the bot in official Hermes. No message was sent.',
    canonical_connection_unavailable: 'The Bot Chat check lost its connection. Reconnect to check the canonical registry; Artemis will not repeat creation or send anything.',
    canonical_changed: 'The canonical Bot Chat identity changed. Verify this bot in official Hermes and reopen Artemis deliberately. Your draft stays in this page; nothing will be resent.'
  })[reason] || null;
}

// Public signed-in metadata only, never an auth store, credential or authorization substitute.
// The official owner gateway normalizes interactive sign-ins to the host owner. We additionally
// fence a changed visible sign-in on this page; these values are never persisted or exported.
export async function canonicalLogin(gateway) {
  const response = await gateway.fetcher(new URL('/api/auth/me', gateway.origin), {
    method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error'
  });
  if (!response.ok) canonicalRefuse(response.status === 401 ? 'authentication_required' : 'canonical_contract_unsupported');
  const value = await response.json();
  if (!canonicalId(value?.provider) || !canonicalId(value?.user_id) ||
      (value.org_id != null && (typeof value.org_id !== 'string' || value.org_id.length > 1024 || /[\u0000-\u001f\u007f]/.test(value.org_id)))) canonicalRefuse('canonical_contract_unsupported');
  return JSON.stringify([value.provider, value.user_id, value.org_id ?? '']);
}

export function canonicalSupported(description) {
  // local-cli-create-v1 is the inspected official titled-create contract; runtime.describe
  // advertises CREATE_FIELDS + title (hidden is a typed envelope field, not a CREATE_FIELD).
  const fields = description?.session_create?.parameters;
  return Array.isArray(description?.capabilities) && description.capabilities.includes('local-cli-create-v1') &&
    Array.isArray(description.session_create?.sources) && description.session_create.sources.includes('gui') &&
    Array.isArray(fields) && ['request_id', 'source', 'title', 'follow_profile_config', 'accept_hooks'].every(key => fields.includes(key));
}

export function canonicalRoster(binding, roster) {
  const row = roster?.profiles?.[0];
  if (roster?.install_id !== binding.hostId || row?.name !== binding.profile || row.path !== binding.authorityId ||
      !Object.hasOwn(row, 'canonical_session')) canonicalRefuse('routing_identity_mismatch');
  const ref = row.canonical_session;
  if (ref === null) return null;
  if (!ref || typeof ref !== 'object' || Array.isArray(ref) || !canonicalId(ref.id) ||
      (ref.resolved_id != null && !canonicalId(ref.resolved_id)) ||
      (ref.root_title != null && ref.root_title !== canonicalTitle)) canonicalRefuse('routing_identity_mismatch');
  return { root: ref.id, tip: ref.resolved_id ?? ref.id };
}

export function canonicalTarget(binding, ref) {
  return Object.freeze({ sender: binding.sender, scopeKey: binding.scopeKey, kind: 'canonical',
    sessionId: ref?.root ?? null, sessionIds: Object.freeze(ref ? [...new Set([ref.root, ref.tip])] : []) });
}

export async function canonicalRequest(binding) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(binding.scopeKey));
  return Object.freeze({ request_id: 'artemis-canonical-bot-chat-v1-' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
    title: canonicalTitle, hidden: true, source: 'gui', follow_profile_config: true, accept_hooks: false });
}

function canonicalListed(result) {
  if (result?.scope !== 'stored' || !Array.isArray(result.sessions) || result.sessions.length > 1) canonicalRefuse('canonical_registry_unconfirmed');
  if (!result.sessions.length) return null;
  const row = result.sessions[0];
  if (!row || !canonicalId(row.id) || !canonicalId(row.resolved_id) || row.root_title !== canonicalTitle ||
      (row.session_id != null && row.session_id !== row.resolved_id)) canonicalRefuse('canonical_registry_unconfirmed');
  return { root: row.id, tip: row.resolved_id };
}

// One orchestrator per immutable profile gateway; attempts/known roots belong to PageIdentity,
// so rebuilding a controller or switching bots does not reset an ambiguous creation attempt.
export class CanonicalBotChat {
  constructor(gateway) { this.gateway = gateway; this.opening = null; }
  get attempted() { return this.gateway.pageIdentity.canonicalAttempts.has(this.gateway.binding?.scopeKey); }
  operation() {
    const g = this.gateway, epoch = g.canonicalEpoch, binding = g.binding, current = g.isCurrent, login = g.canonicalPrincipal;
    const fence = () => {
      if (!binding || !login || g.canonicalPrincipal !== login || g.pageIdentity.canonicalPrincipal !== login) canonicalRefuse('routing_identity_mismatch');
      g.pageIdentity.assert(binding);
      if (!current() || g.canonicalEpoch !== epoch || g.binding !== binding) canonicalRefuse('canonical_operation_retired');
    };
    const guard = () => {
      fence();
      if (!g.connected || !g.verified) canonicalRefuse('canonical_connection_unavailable');
    };
    guard();
    if (!canonicalSupported(g.description)) canonicalRefuse('canonical_contract_unsupported');
    const checkLogin = async () => {
      guard(); const fresh = await canonicalLogin(g); guard();
      if (fresh !== login) canonicalRefuse('routing_identity_mismatch');
    };
    return { g, binding, fence, guard, checkLogin };
  }
  async read(op, strict = false) {
    const { g, binding, fence, guard, checkLogin } = op;
    let positive = null;
    // A compression can advance between registry/projection reads. Re-resolve at most
    // three complete samples, never merge aliases from a contradictory sample. Retain
    // the last positive projection: a later best-effort null cannot erase its evidence.
    for (let sample = 0; sample < 3; sample++) {
      await checkLogin();
      const before = canonicalRoster(binding, await g.canonicalRoster()); guard();
      let response;
      try { response = await g.rpc('session.list', { title: canonicalTitle, include_hidden: true, limit: 200 }); }
      catch (error) {
        fence();
        if (['authentication_required', 'routing_identity_mismatch'].includes(error?.reason)) throw error;
        canonicalRefuse('canonical_registry_unconfirmed');
      }
      guard(); const listed = canonicalListed(response);
      const after = canonicalRoster(binding, await g.canonicalRoster()); guard();
      await checkLogin();
      const known = g.pageIdentity.canonicalRoots.get(binding.scopeKey);
      if (!listed && (before || after || known || positive)) canonicalRefuse('canonical_registry_unconfirmed');
      if (listed && ((before && before.root !== listed.root) || (after && after.root !== listed.root) ||
          (known && known !== listed.root) || (positive && positive.root !== listed.root))) canonicalRefuse('canonical_changed');
      // Preserve the existing stricter post-create requirement: positive final root/tip.
      if (strict && (!listed || !after || after.root !== listed.root || after.tip !== listed.tip)) canonicalRefuse('canonical_confirmation_failed');
      positive = after || before || positive;
      if (listed && positive && positive.tip !== listed.tip) {
        if (sample === 2) canonicalRefuse('canonical_registry_unconfirmed');
        continue;
      }
      return listed;
    }
  }
  remember(op, ref) {
    op.guard();
    if (ref) op.g.pageIdentity.canonicalRoots.set(op.binding.scopeKey, ref.root);
    return canonicalTarget(op.binding, ref);
  }
  async discover() {
    const op = this.operation();
    return this.remember(op, await this.read(op));
  }
  ensure() {
    if (this.opening) return this.opening;
    this.opening = this.open().finally(() => { this.opening = null; });
    return this.opening;
  }
  async open() {
    const op = this.operation(), { g, binding, fence, guard, checkLogin } = op;
    const found = await this.read(op);
    if (found) return this.remember(op, found);
    if (this.attempted) canonicalRefuse('canonical_creation_unconfirmed');
    const request = await canonicalRequest(binding); guard();
    // A final independent registry check closes local lookup races; the official titled-create
    // lock/idempotency resolves simultaneous creators. Only this explicit method may write.
    const latest = await this.read(op);
    if (latest) return this.remember(op, latest);
    await checkLogin(); guard();
    if (this.attempted) canonicalRefuse('canonical_creation_unconfirmed');
    // Mark BEFORE dispatch. No error, reconnect, controller rebuild or selection change clears it.
    g.pageIdentity.canonicalAttempts.add(binding.scopeKey);
    let created;
    try { created = await g.rpc('session.create', request); }
    catch (error) {
      fence();
      if (['authentication_required', 'routing_identity_mismatch'].includes(error?.reason)) throw error;
      canonicalRefuse('canonical_creation_unconfirmed');
    }
    guard();
    if (!canonicalId(created?.session_id) || (created.stored_session_id != null && !canonicalId(created.stored_session_id))) canonicalRefuse('canonical_confirmation_failed');
    const confirmed = await this.read(op, true); guard();
    // Never paint a create snapshot or claim continuity from its ID alone. Both independent
    // canonical projections must agree, and every returned create ID must belong to that lineage.
    const aliases = new Set([confirmed.root, confirmed.tip]);
    if (![created.session_id, created.stored_session_id].filter(value => value != null).every(id => aliases.has(id))) canonicalRefuse('routing_identity_mismatch');
    return this.remember(op, confirmed);
  }
}
