// ============================================================
// KRELL client — keyboard + mouse capture
// ============================================================

import { KEY, BTN } from '/shared/const.js';

export class Input {
  constructor() {
    this.keysDown = new Set();
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    this.fireHeld = false;
    this.aimHeld = false;        // right mouse — scope / steady aim
    this.blocked = false;        // true while a menu owns input
    this.onSlot = null;          // (slot) => void
    this.onToggle = null;        // (which: 'buy'|'score'|'esc'|'chat', down) => void

    addEventListener('keydown', (e) => this._key(e, true));
    addEventListener('keyup', (e) => this._key(e, false));
    addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    addEventListener('mousedown', (e) => {
      if (this.blocked || e.target.tagName !== 'CANVAS') return;
      if (e.button === 0) this.fireHeld = true;
      if (e.button === 2) { this.aimHeld = true; e.preventDefault(); }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
      if (e.button === 2) this.aimHeld = false;
    });
    addEventListener('contextmenu', (e) => { if (e.target.tagName === 'CANVAS') e.preventDefault(); });
    addEventListener('blur', () => { this.keysDown.clear(); this.fireHeld = false; this.aimHeld = false; });
    addEventListener('wheel', (e) => {
      if (this.blocked) return;
      this.onWheel?.(Math.sign(e.deltaY));
    }, { passive: true });
  }

  _key(e, down) {
    const c = e.code;
    if (c === 'Tab') { e.preventDefault(); this.onToggle?.('score', down); return; }
    if (!down) { this.keysDown.delete(c); return; }
    if (e.repeat) return;

    if (c === 'Escape') { this.onToggle?.('esc', true); return; }
    if (this.blocked) {
      if (c === 'KeyB') this.onToggle?.('buy', true);   // close buy with B too
      this.onMenuKey?.(e);
      return;
    }
    if (c === 'Enter') { this.onToggle?.('chat', true); return; }
    if (c === 'KeyB') { this.onToggle?.('buy', true); return; }
    if (c === 'Digit1') this.onSlot?.(1);
    if (c === 'Digit2') this.onSlot?.(2);
    if (c === 'Digit3') this.onSlot?.(3);
    this.keysDown.add(c);
  }

  // current movement keys bitmask
  keys() {
    if (this.blocked) return 0;
    let k = 0;
    if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) k |= KEY.UP;
    if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) k |= KEY.DOWN;
    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) k |= KEY.LEFT;
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) k |= KEY.RIGHT;
    return k;
  }

  buttons() {
    if (this.blocked) return 0;
    let b = 0;
    if (this.fireHeld) b |= BTN.FIRE;
    if (this.keysDown.has('KeyE')) b |= BTN.USE;
    if (this.keysDown.has('KeyR')) b |= BTN.RELOAD;
    if (this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight')) b |= BTN.WALK;
    if (this.keysDown.has('KeyG')) b |= BTN.NADE;
    return b;
  }
}
