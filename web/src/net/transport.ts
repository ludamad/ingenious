// A message channel abstraction so the game host and clients don't care whether
// they're talking over a WebRTC DataConnection or an in-process loopback (used
// for the host's own seat).
export interface Transport {
  send(msg: unknown): void;
  onMessage(cb: (msg: any) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

class LoopEnd implements Transport {
  other!: LoopEnd;
  private msgCb: ((m: any) => void) | null = null;
  private closeCb: (() => void) | null = null;
  closed = false;

  send(msg: unknown) {
    if (this.closed) return;
    const o = this.other;
    queueMicrotask(() => { if (!o.closed) o.msgCb?.(msg); });
  }
  onMessage(cb: (m: any) => void) { this.msgCb = cb; }
  onClose(cb: () => void) { this.closeCb = cb; }
  close() {
    if (this.closed) return;
    this.closed = true;
    const o = this.other;
    queueMicrotask(() => o.closeCb?.());
  }
}

// Two linked endpoints; anything sent on one arrives on the other.
export function loopback(): [Transport, Transport] {
  const a = new LoopEnd();
  const b = new LoopEnd();
  a.other = b;
  b.other = a;
  return [a, b];
}
