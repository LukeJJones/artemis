export class RpcError extends Error {
  constructor(reason, admitted) { super('Hermes rejected the request'); this.reason = reason; this.admitted = admitted; }
}
export class ConnectionError extends Error {}

export class Gateway {
  constructor({ origin = location.origin, profile = null, fetcher = fetch, WebSocketClass = WebSocket } = {}) {
    this.origin = origin; this.profile = profile; this.fetcher = fetcher.bind(globalThis); this.WebSocketClass = WebSocketClass;
    this.pending = new Map(); this.serial = 0; this.connected = false; this.onClose = () => {};
  }
  async connect() {
    if (this.connected) return;
    const endpoint = new URL('/api/webapp/socket-ticket', this.origin);
    endpoint.searchParams.set('socket', 'gateway');
    if (this.profile) endpoint.searchParams.set('profile', this.profile);
    const response = await this.fetcher(endpoint, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new RpcError(response.status === 401 ? 'authentication_required' : response.status === 404 ? 'webapp_required' : 'connection_denied');
    const { ticket } = await response.json();
    if (typeof ticket !== 'string' || !ticket) throw new ConnectionError('Ticket unavailable');
    const url = new URL('/api/ws', this.origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    await new Promise((resolve, reject) => {
      let ready = false;
      const socket = new this.WebSocketClass(url, ['hermes-gateway-v1', `hermes-gateway-ticket.${ticket}`]);
      this.socket = socket;
      const timer = setTimeout(() => { socket.close(); reject(new ConnectionError('Connection timed out')); }, 15000);
      socket.onmessage = ({ data }) => {
        if (this.socket !== socket) return;
        let frame;
        try { frame = JSON.parse(data); } catch { return; }
        if (frame.params?.type === 'gateway.ready' && !ready) {
          ready = true; this.connected = true; clearTimeout(timer); resolve();
        }
        if (frame.id === undefined) return;
        const call = this.pending.get(frame.id);
        if (!call) return;
        this.pending.delete(frame.id); clearTimeout(call.timer);
        if (frame.error) call.reject(new RpcError(frame.error.data?.reason || 'request_rejected', frame.error.data?.admitted));
        else call.resolve(frame.result);
      };
      socket.onerror = () => { if (!ready) { clearTimeout(timer); reject(new ConnectionError('Connection failed')); } };
      socket.onclose = () => {
        if (!ready) { clearTimeout(timer); reject(new ConnectionError('Connection closed')); }
        if (this.socket !== socket) return;
        clearTimeout(timer); this.connected = false;
        for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(new ConnectionError('Connection closed')); }
        this.pending.clear();
        if (!ready) reject(new ConnectionError('Connection closed'));
        this.onClose();
      };
    });
  }
  rpc(method, params = {}) {
    if (!this.connected) return Promise.reject(new ConnectionError('Not connected'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new ConnectionError('Request timed out')); }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params })); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new ConnectionError('Send outcome unknown')); }
    });
  }
  close() {
    const socket = this.socket; const wasConnected = this.connected;
    this.socket = null; this.connected = false;
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(new ConnectionError('Connection closed')); }
    this.pending.clear(); socket?.close();
    if (wasConnected) this.onClose();
  }
}
