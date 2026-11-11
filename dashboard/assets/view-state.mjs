import { ProfileGateway } from './routing.mjs';
import { RpcError } from './gateway.mjs';

// UI-boundary validation only; no host protocol, routing or conversation-engine change.
export class PresentationGateway extends ProfileGateway {
  // Paint evidence only: retain no snapshot/rows and never change RPC policy.
  #emptySession = null;
  hasEmptySnapshot(sessionId) {
    return typeof sessionId === 'string' && sessionId.length > 0 && this.#emptySession === sessionId;
  }
  async rpc(method, params = {}) {
    if (method === 'session.resume') this.#emptySession = null;
    const result = await super.rpc(method, params);
    if (method === 'session.resume') {
      this.historyMalformed = !Array.isArray(result?.messages);
      if (this.historyMalformed) throw new RpcError('malformed_history_snapshot');
      if (result.messages.length === 0 && result.message_count === 0 && (result.messages_omitted === undefined || result.messages_omitted === false) && result.session_id === params.session_id && typeof result.session_id === 'string' && result.session_id.length > 0) this.#emptySession = result.session_id;
    }
    return result;
  }
}

export function emptyPresentation({ phase, notice = '', selected = false, sender = 'this bot', malformed = false, rosterReady = false }) {
  if (!selected && rosterReady && !['auth', 'error', 'offline', 'connecting'].includes(phase)) return { title: 'Choose your bot.', body: 'Available bots on this Hermes host. Choose one to open its conversation; nothing is sent automatically.', chooser: true };
  if (phase === 'auth') return { title: 'Hermes sign-in needed.', body: notice, chooser: false };
  if (phase === 'error' || malformed) return { title: malformed ? 'History unavailable.' : 'Connection needs attention.', body: malformed ? 'Hermes did not return a valid message list. No empty history is assumed and nothing was sent.' : notice, chooser: false };
  if (phase === 'connecting') return { title: selected ? `Opening ${sender}…` : 'Finding your bots…', body: notice || 'Checking this Hermes host. No conversation is opened automatically.', chooser: false };
  if (phase === 'empty') return { title: 'Bot Chat required.', body: notice, chooser: false };
  if (phase === 'ready') return { title: `Connected to ${sender}.`, body: 'No messages are displayed in this conversation. Other conversations and host history have not been searched.', chooser: false };
  if (phase === 'waiting') return { title: `${sender} needs attention.`, body: notice, chooser: false };
  if (['offline', 'unknown', 'failed'].includes(phase)) return { title: phase === 'offline' ? 'Host unavailable.' : 'Conversation needs attention.', body: notice, chooser: false };
  return { title: 'Finding your bots…', body: notice || 'Checking this Hermes connection. No conversation is opened automatically.', chooser: false };
}
