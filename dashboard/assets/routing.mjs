import { Gateway, RpcError } from './gateway.mjs';
import { CanonicalBotChat, canonicalLogin, canonicalRoster, canonicalTarget } from './canonical.mjs';

const profileId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
const opaque = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f]/.test(value);
const refuse = () => { throw new RpcError('routing_identity_mismatch'); };

export function parseProfile(url) {
  const location = new URL(url);
  // Webapp uses an explicit query selection, not an invented adapter prefix.
  if (location.pathname.startsWith('/p/')) refuse();
  // `profile` is also Hermes's plugin-serving scope. Prefer an Artemis-owned
  // page parameter; ONLY the supported ticket request uses official `profile`.
  // Legacy query is recognized when the host successfully serves that scope;
  // contradictory/duplicate selectors never resolve to a default.
  const values = [...location.searchParams.getAll('artemis_profile'), ...location.searchParams.getAll('profile')];
  if (!values.length) return null;
  if (values.length !== 1 || !profileId(values[0])) refuse();
  return values[0];
}

export function verifyBinding({ profile, origin, description, roster, expectedHost = null, expectedAuthorityId = null }) {
  if (!profileId(profile) || !opaque(description?.profile_id) || !opaque(description?.instance_id) ||
      roster?.bot_mode_protocol !== true || !opaque(roster.install_id) || !Array.isArray(roster.profiles) || !roster.profiles.length) refuse();
  if (expectedHost !== null && roster.install_id !== expectedHost) refuse();
  const ids = new Set();
  for (const row of roster.profiles) {
    if (!profileId(row.name) || ids.has(row.name)) refuse();
    ids.add(row.name);
  }
  // Official profiles.list emits its own authority's row FIRST. Compare the
  // opaque authority identity too; a sibling appearing later is not a binding.
  const own = roster.profiles[0];
  if (own.name !== profile || own.path !== description.profile_id) refuse();
  if (expectedAuthorityId !== null && description.profile_id !== expectedAuthorityId) refuse();
  const profiles = roster.profiles.map(row => ({ id: row.name,
    label: opaque(row.display_name) ? row.display_name : row.name }));
  return Object.freeze({ profile, origin: new URL(origin).origin, hostId: roster.install_id, authorityId: description.profile_id,
    scopeKey: JSON.stringify([new URL(origin).origin, roster.install_id, profile, description.profile_id]), profiles,
    sender: profiles[0].label });
}

export async function targetFor(binding, roster) {
  // A roster is a hint, not permission to create. target() adds exact-title discovery.
  return canonicalTarget(binding, canonicalRoster(binding, roster));
}

// One instance per page, shared by selection AND metadata-only connections.
// A synchronous commit means concurrent verified responses cannot replace pins.
export class PageIdentity {
  constructor() {
    this.hostId = null; this.authorities = new Map(); this.canonicalPrincipal = null;
    this.canonicalAttempts = new Set(); this.canonicalRoots = new Map();
  }
  accept(binding, isCurrent = () => true) {
    if (!isCurrent() || !opaque(binding?.hostId) || !opaque(binding?.authorityId)) refuse();
    if (this.hostId !== null && binding.hostId !== this.hostId) refuse();
    if (this.authorities.has(binding.profile) && this.authorities.get(binding.profile) !== binding.authorityId) refuse();
    if (this.hostId === null) this.hostId = binding.hostId;
    this.authorities.set(binding.profile, binding.authorityId);
  }
  assert(binding) {
    if (!binding || binding.hostId !== this.hostId || this.authorities.get(binding.profile) !== binding.authorityId) refuse();
  }
}

export class ProfileGateway extends Gateway {
  constructor(options = {}) {
    if (!profileId(options.profile)) refuse();
    super(options);
    Object.defineProperty(this, 'profile', { value: options.profile, writable: false });
    this.expectedHost = options.expectedHost ?? null;
    this.expectedAuthorityId = null;
    this.pageIdentity = options.pageIdentity ?? new PageIdentity();
    this.isCurrent = options.isCurrent ?? (() => true);
    this.binding = null;
    this.canonicalOnly = options.canonicalOnly !== false;
    this.canonicalPrincipal = null; this.canonicalEpoch = 0;
    this.canonicalChat = new CanonicalBotChat(this);
  }
  async connect() {
    const isCurrent = this.isCurrent;
    const epoch = ++this.canonicalEpoch;
    this.verified = false;
    try {
      const login = this.canonicalOnly ? await canonicalLogin(this) : null;
      if (!isCurrent() || this.canonicalEpoch !== epoch) refuse();
      await super.connect();
      if (!isCurrent()) refuse();
      const description = await super.rpc('runtime.describe');
      if (!isCurrent()) refuse();
      const roster = await super.rpc('profiles.list', { include_sessions: false });
      const binding = verifyBinding({ profile: this.profile, origin: this.origin, description, roster, expectedHost: this.expectedHost, expectedAuthorityId: this.expectedAuthorityId });
      if (this.canonicalOnly) {
        const after = await canonicalLogin(this);
        if (!isCurrent() || this.canonicalEpoch !== epoch || login !== after ||
            (this.pageIdentity.canonicalPrincipal !== null && this.pageIdentity.canonicalPrincipal !== login)) refuse();
      }
      this.pageIdentity.accept(binding, isCurrent);
      if (this.canonicalOnly) { this.pageIdentity.canonicalPrincipal = login; this.canonicalPrincipal = login; }
      this.binding = binding;
      this.expectedHost = this.binding.hostId;
      this.expectedAuthorityId = this.binding.authorityId;
      this.description = description; this.verified = true;
    } catch (error) {
      this.close(); throw error;
    }
  }
  async canonicalRoster() {
    if (!this.connected || !this.verified || !this.isCurrent()) refuse();
    const isCurrent = this.isCurrent;
    const roster = await super.rpc('profiles.list', { include_sessions: true });
    const binding = verifyBinding({ profile: this.profile, origin: this.origin, description: this.description, roster, expectedHost: this.expectedHost, expectedAuthorityId: this.expectedAuthorityId });
    this.pageIdentity.accept(binding, isCurrent);
    if (!isCurrent()) refuse();
    return roster;
  }
  target() { return this.canonicalChat.discover(); }
  canonicalTarget() { return this.canonicalChat.discover(); }
  ensureCanonical() { return this.canonicalChat.ensure(); }
  get canonicalAttempted() { return this.canonicalChat.attempted; }
  rpc(method, params = {}) {
    if (!this.verified || !this.connected || (params.profile !== undefined && params.profile !== this.profile)) return Promise.reject(new RpcError('routing_identity_mismatch'));
    try { this.pageIdentity.assert(this.binding); } catch (error) { return Promise.reject(error); }
    return super.rpc(method, params);
  }
  close() { ++this.canonicalEpoch; this.verified = false; super.close(); }
}
