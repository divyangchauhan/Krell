// ============================================================
// KRELL client — websocket wrapper with ping measurement
// ============================================================

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.connected = false;
    this.rtt = 0;
    this._pingId = 0;
    this._pings = new Map();
    this._pingTimer = 0;
  }

  on(type, fn) { this.handlers[type] = fn; }

  connect(name) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      this.connected = true;
      this.send({ t: 'join', name });
      this._pingTimer = setInterval(() => {
        const id = ++this._pingId;
        this._pings.set(id, performance.now());
        this.send({ t: 'ping', id, rtt: this.rtt });
      }, 2000);
      this.handlers.open?.();
    };
    this.ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'pong') {
        const t0 = this._pings.get(m.id);
        if (t0 != null) {
          this.rtt = Math.round(performance.now() - t0);
          this._pings.delete(m.id);
        }
        return;
      }
      this.handlers[m.t]?.(m);
    };
    this.ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      clearInterval(this._pingTimer);
      this.handlers.close?.(was);
    };
    this.ws.onerror = () => {};
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  close() {
    clearInterval(this._pingTimer);
    if (this.ws) { this.ws.onclose = null; this.ws.close(); }
    this.connected = false;
  }
}
