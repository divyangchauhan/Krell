// ============================================================
// KRELL client — DOM HUD: buy menu, scoreboard, killfeed, chat,
// center messages, vitals, spectate bar
// ============================================================

import { TEAM, TEAM_INFO, PHASE, TIMING, END_REASON, BOMB_NAME, WIN_ROUNDS } from '/shared/const.js';
import { WEAPONS, SHOP, GEAR_PRICES } from '/shared/weapons.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(state, net) {
    this.state = state;
    this.net = net;
    this.buyOpen = false;
    this.escOpen = false;
    this.chatOpen = false;
    this.lastPhase = '';
    this.msgTimer = 0;
    this._buildBuyMenu();

    $('chat-input').addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = $('chat-input').value.trim();
        if (text) this.net.send({ t: 'chat', text });
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
  }

  // ---------------------------------------------------------- buy menu

  _buildBuyMenu() {
    const grid = $('buy-grid');
    grid.innerHTML = '';
    for (const item of SHOP) {
      const w = WEAPONS[item.id];
      const name = w ? w.name : item.id === 'armor' ? 'AEGIS WEAVE' : item.id === 'nade' ? 'PLASMA GRENADE' : 'AMMO CACHE';
      const price = w ? w.price : GEAR_PRICES[item.id];
      const el = document.createElement('div');
      el.className = 'buy-item';
      el.dataset.id = item.id;
      el.innerHTML = `
        <span class="bi-key">${item.hotkey}</span>
        <div class="bi-body">
          <div class="bi-name">${name}</div>
          <div class="bi-desc">${item.desc}</div>
        </div>
        <span class="bi-price">$${price}</span>`;
      el.addEventListener('click', () => this.tryBuy(item.id));
      grid.appendChild(el);
    }
  }

  tryBuy(id) {
    this.net.send({ t: 'buy', id });
  }

  onBought() {
    audio.buy();
    this.refreshBuyMenu();
  }

  onBuyFail(why) {
    audio.deny();
    const el = [...document.querySelectorAll('.buy-item')];
    for (const e of el) e.classList.remove('shake');
    if (why === 'time' || why === 'zone') {
      this.toast(why === 'zone' ? 'RETURN TO SUPPLY ZONE TO BUY' : 'BUY TIME EXPIRED');
      this.closeBuy();
    }
  }

  shakeItem(id) {
    const el = document.querySelector(`.buy-item[data-id="${id}"]`);
    if (el) { el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 300); }
  }

  refreshBuyMenu() {
    const me = this.state.me;
    $('buy-money').textContent = `$${me.money}`;
    for (const el of document.querySelectorAll('.buy-item')) {
      const id = el.dataset.id;
      const w = WEAPONS[id];
      const price = w ? w.price : GEAR_PRICES[id];
      const owned =
        (id === 'armor' && me.armor >= 100) ||
        (id === 'nade' && me.nades >= 1) ||
        (w && me.primary === id);
      el.classList.toggle('owned', !!owned);
      el.classList.toggle('cant', !owned && me.money < price);
    }
  }

  openBuy() {
    if (this.buyOpen) return;
    this.buyOpen = true;
    this.refreshBuyMenu();
    $('buymenu').classList.remove('hidden');
    audio.click();
  }

  closeBuy() {
    this.buyOpen = false;
    $('buymenu').classList.add('hidden');
  }

  buyHotkey(key) {
    const item = SHOP.find((s) => s.hotkey === key);
    if (item) this.tryBuy(item.id);
  }

  // ---------------------------------------------------------- chat

  openChat() {
    this.chatOpen = true;
    $('chat-entry').classList.remove('hidden');
    $('chat-input').value = '';
    $('chat-input').focus();
  }

  closeChat() {
    this.chatOpen = false;
    $('chat-entry').classList.add('hidden');
    $('chat-input').blur();
  }

  addChat(from, team, text, system = false) {
    const log = $('chatlog');
    const row = document.createElement('div');
    row.className = 'chat-row' + (system ? ' sys' : '');
    if (system) {
      row.textContent = text;
    } else {
      const b = document.createElement('b');
      b.className = team === TEAM.KRELL ? 't-k' : 't-w';
      b.textContent = from + ': ';
      row.appendChild(b);
      row.appendChild(document.createTextNode(text));
    }
    log.appendChild(row);
    while (log.children.length > 6) log.firstChild.remove();
    setTimeout(() => row.classList.add('fade'), 9000);
    setTimeout(() => row.remove(), 10500);
    if (!system) audio.chat();
  }

  // ---------------------------------------------------------- killfeed

  killfeed(killerName, killerTeam, victimName, victimTeam, weaponId, isMe) {
    const feed = $('killfeed');
    const row = document.createElement('div');
    row.className = 'kf-row' + (isMe ? ' kf-me' : '');
    const wname = weaponId === 'bomb' ? BOMB_NAME : (WEAPONS[weaponId]?.short || weaponId.toUpperCase());
    const k = document.createElement('span');
    k.className = killerTeam === TEAM.KRELL ? 't-k' : 't-w';
    k.textContent = killerName;
    const mid = document.createElement('span');
    mid.className = 'kf-w';
    mid.textContent = `[ ${wname} ]`;
    const v = document.createElement('span');
    v.className = victimTeam === TEAM.KRELL ? 't-k' : 't-w';
    v.textContent = victimName;
    if (killerName) row.append(k);
    row.append(mid, v);
    feed.appendChild(row);
    while (feed.children.length > 5) feed.firstChild.remove();
    setTimeout(() => row.classList.add('fade'), 5200);
    setTimeout(() => row.remove(), 6000);
  }

  // ---------------------------------------------------------- center messages

  msg(text, color = '#cdd6f4', sub = '', holdMs = 2400) {
    const el = $('center-msg');
    el.textContent = text;
    el.style.color = color;
    el.classList.remove('hidden');
    // retrigger entry animation
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    const subEl = $('sub-msg');
    if (sub) { subEl.textContent = sub; subEl.classList.remove('hidden'); }
    else subEl.classList.add('hidden');
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => {
      el.classList.add('hidden');
      subEl.classList.add('hidden');
    }, holdMs);
  }

  toast(text) {
    this.addChat(null, 0, text, true);
  }

  // ---------------------------------------------------------- per-frame refresh

  update() {
    const st = this.state;
    const me = st.me;

    // vitals
    $('hp-num').textContent = Math.max(0, me.hp);
    $('hp-fill').style.width = `${Math.max(0, me.hp)}%`;
    $('hp-fill').classList.toggle('low', me.hp <= 30);
    $('ar-num').textContent = me.armor;
    $('ar-fill').style.width = `${me.armor}%`;

    // money + ammo
    $('money').textContent = `$${me.money}`;
    const w = WEAPONS[me.wid] || WEAPONS.pistol;
    $('weapon-name').textContent = w.name;
    const magEl = $('ammo-mag');
    if (w.melee) {
      magEl.textContent = '—';
      $('ammo-res').textContent = '';
      magEl.className = '';
    } else {
      magEl.textContent = me.mag;
      $('ammo-res').textContent = `/ ${me.res}`;
      magEl.className = (me.mag === 0 ? 'empty' : '') + (me.reloadLeft > 0 ? ' reloading' : '');
    }

    // slots
    for (const chip of document.querySelectorAll('.slotchip')) {
      const slot = +chip.dataset.slot;
      chip.classList.toggle('active', slot === me.slot && slot !== 4);
      if (slot === 1) {
        const has = !!me.primary;
        chip.classList.toggle('empty', !has);
        $('slot1-name').textContent = has ? WEAPONS[me.primary].short : '—';
      }
      if (slot === 4) {
        chip.classList.toggle('empty', me.nades === 0);
        $('slot4-name').textContent = `×${me.nades}`;
      }
    }

    // clock + phase
    this.updateClock();

    // alive pips
    this.updatePips();

    // connection quality
    const rtt = this.net.rtt;
    $('net-ping').textContent = `${rtt} ms`;
    const dot = $('net-dot');
    dot.className = rtt > 160 ? 'bad' : rtt > 80 ? 'warn' : '';

    // progress bar (plant/defuse)
    const prog = me.plant > 0 ? me.plant : me.defuse > 0 ? me.defuse : 0;
    $('progress-wrap').classList.toggle('hidden', prog <= 0);
    if (prog > 0) {
      $('progress-label').textContent = me.plant > 0 ? 'ARMING VOID CHARGE' : 'NEUTRALIZING';
      $('progress-fill').style.width = `${prog * 100}%`;
      $('progress-fill').style.background = me.plant > 0 ? '#ffd166' : '#3fd9ff';
    }

    // spectate bar
    const spec = !me.alive && (st.phase === PHASE.LIVE || st.phase === PHASE.POST || st.phase === PHASE.WARMUP);
    $('spectate').classList.toggle('hidden', !spec);
    if (spec) {
      const r = st.roster.get(st.spectateId);
      $('spectate-name').textContent = r ? r.name : '—';
    }

    // buy hint
    const canBuyPhase = st.phase === PHASE.FREEZE || st.phase === PHASE.WARMUP;
    $('buyhint').classList.toggle('hidden', !(canBuyPhase && me.alive && !this.buyOpen));

    // scores
    $('score-k').textContent = st.scores[0];
    $('score-w').textContent = st.scores[1];
    $('sb-score').textContent = `${st.scores[0]} — ${st.scores[1]}`;

    if (this.buyOpen) this.refreshBuyMenu();
  }

  updateClock() {
    const st = this.state;
    const timerEl = $('timer');
    const left = st.phaseTimeLeft();
    const bombLit = st.bomb.st === 'planted';
    $('bomb-lit').classList.toggle('hidden', !bombLit);
    timerEl.classList.toggle('hidden', bombLit);
    $('round-label').textContent =
      st.phase === PHASE.WARMUP ? 'WARMUP' :
      st.phase === PHASE.STARTING ? 'STARTING' :
      st.phase === PHASE.OVER ? 'MATCH OVER' : `ROUND ${st.round}`;
    if (!bombLit) {
      const s = Math.ceil(left / 1000);
      timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      timerEl.classList.toggle('low', st.phase === PHASE.LIVE && s <= 15);
    }
  }

  updatePips() {
    const st = this.state;
    for (const [team, elId] of [[TEAM.KRELL, 'alive-k'], [TEAM.WARDEN, 'alive-w']]) {
      const el = $(elId);
      const members = [...st.roster.values()].filter((r) => r.team === team);
      if (el.children.length !== members.length) {
        el.innerHTML = members.map(() => '<div class="pip"></div>').join('');
      }
      members.forEach((m, i) => el.children[i]?.classList.toggle('dead', !m.alive));
    }
  }

  // ---------------------------------------------------------- scoreboard

  showScoreboard(show) {
    $('scoreboard').classList.toggle('hidden', !show);
    if (show) this.fillScoreboard();
  }

  fillScoreboard() {
    const st = this.state;
    for (const [team, elId] of [[TEAM.KRELL, 'sb-krell'], [TEAM.WARDEN, 'sb-warden']]) {
      const tbody = $(elId).querySelector('tbody');
      tbody.innerHTML = '';
      const rows = [...st.roster.entries()]
        .filter(([, r]) => r.team === team)
        .sort((a, b) => b[1].kills - a[1].kills);
      for (const [id, r] of rows) {
        const tr = document.createElement('tr');
        if (!r.alive && st.phase === PHASE.LIVE) tr.className = 'dead';
        if (id === st.id) tr.classList.add('me');
        const name = document.createElement('td');
        name.textContent = r.name;
        if (r.bot) {
          const tag = document.createElement('span');
          tag.className = 'bot-tag'; tag.textContent = 'SYNTH';
          name.appendChild(tag);
        }
        tr.appendChild(name);
        for (const v of [r.kills, r.deaths, id === st.id || r.team === st.team ? `$${r.money}` : '—', r.bot ? '—' : r.ping]) {
          const td = document.createElement('td');
          td.textContent = v;
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    }
  }

  // ---------------------------------------------------------- phase transitions

  onPhase(phase) {
    const st = this.state;
    if (phase === this.lastPhase) return;
    this.lastPhase = phase;
    switch (phase) {
      case PHASE.STARTING:
        this.msg('MATCH FOUND', '#b36bff', 'first to ' + WIN_ROUNDS + ' rounds', 3000);
        break;
      case PHASE.FREEZE:
        this.closeBuy();
        this.msg(`ROUND ${st.round}`, '#cdd6f4', st.team === TEAM.KRELL ? 'deliver the void charge' : 'hold the rift sites', 2200);
        audio.roundStart();
        if (st.me.alive) this.openBuy();
        break;
      case PHASE.LIVE:
        this.closeBuy();
        this.msg('BREACH', '#b36bff', '', 1100);
        break;
      case PHASE.WARMUP:
        this.msg('WARMUP', '#6b7494', 'waiting for operatives', 2500);
        break;
    }
  }

  onRoundEnd(winner, reason) {
    const st = this.state;
    const info = TEAM_INFO[winner];
    const won = winner === st.team;
    this.msg(
      `${info.name} WIN`,
      info.color,
      END_REASON[reason] || reason,
      3400,
    );
    if (won) audio.win(); else audio.lose();
  }

  onGameOver(winner) {
    const st = this.state;
    const info = TEAM_INFO[winner];
    const won = winner === st.team;
    this.msg(
      won ? 'VICTORY' : 'DEFEAT',
      won ? '#41e596' : '#ff4757',
      `${info.name} take SITE-9 — next match soon`,
      9000,
    );
  }
}
