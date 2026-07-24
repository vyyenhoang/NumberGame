/* ============================================================
   Number Clash — 2-team number card duel
   - Host-authoritative state over PeerJS (free cloud broker)
   - Join by 6-letter code or QR link
   - Hotseat (pass & play) mode on one device
   ============================================================ */
"use strict";

/* ---------------- tiny helpers ---------------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const clone = (o) => JSON.parse(JSON.stringify(o));
const now = () => Date.now();

function show(id) {
  $$(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
  window.scrollTo(0, 0);
}
let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- constants ---------------- */
const ROUNDS = 12;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PEER_PREFIX = "nclash-v1-";
const REVEAL_SECS = 18;
const OTHER = { A: "B", B: "A" };

function freshDeck() {
  const d = [];
  for (let k = 0; k < 2; k++) for (let n = 1; n <= 7; n++) d.push(n);
  return d;
}

/* ---------------- app-level state ---------------- */
let mode = null;          // 'host' | 'client' | 'hotseat'
let myTeam = null;        // 'A' | 'B' | null (spectator)
let G = null;             // authoritative game state (host & hotseat only)
let V = null;             // view state currently rendered
let clockOffset = 0;      // hostNow - localNow (client-side smoothing)
let peer = null, hostConn = null;
const conns = new Map();  // host: conn -> {team:'B'|'spec', name}
let tickInt = null, uiInt = null;

/* selection state (local UI) */
let sel = [];             // selected hand indices
let roomCode = "";
let lastPhase = null;     // to reset selection on phase change
let giveDialogOpen = false;

/* ============================================================
   GAME ENGINE (runs on host device / hotseat device)
   ============================================================ */
function newGameState() {
  return {
    phase: "lobby", // lobby | discuss | pick | reveal | over
    round: 0,
    settings: { discussSec: 60, pickSec: 30, totalMin: 20 },
    startedAt: null,
    phaseEndsAt: null,
    pickStartAt: { A: null, B: null },
    hotActive: null, // hotseat: whose pick turn
    teams: {
      A: mkTeam("Team Phoenix"),
      B: mkTeam("Team Dragon"),
    },
    lastRound: null,
    result: null,
  };
}
function mkTeam(name) {
  return {
    name, players: [], hand: [], score: 0,
    hiddenLeft: 1, timeMs: 0, connected: false, ready: false, pick: null,
  };
}
function activePlayers(t) { return t.players.filter((p) => p && p.trim()); }
function leadPlayer(t, round) {
  const ps = activePlayers(t);
  if (!ps.length) return "—";
  return ps[(round - 1) % ps.length];
}

function engineStart() {
  G.teams.A.hand = freshDeck();
  G.teams.B.hand = freshDeck();
  G.teams.A.score = G.teams.B.score = 0;
  G.teams.A.hiddenLeft = G.teams.B.hiddenLeft = 1;
  G.teams.A.timeMs = G.teams.B.timeMs = 0;
  G.round = 1;
  G.startedAt = now();
  G.result = null;
  G.lastRound = null;
  startDiscuss();
}

function startDiscuss() {
  G.phase = "discuss";
  G.teams.A.ready = G.teams.B.ready = false;
  G.teams.A.pick = G.teams.B.pick = null;
  G.hotActive = null;
  if (G.settings.discussSec <= 0) return startPick(); // discussion turned off
  G.phaseEndsAt = now() + G.settings.discussSec * 1000;
  pushState();
}

function startPick() {
  G.phase = "pick";
  G.teams.A.ready = G.teams.B.ready = false;
  if (mode === "hotseat") {
    G.hotActive = "A";
    G.phaseEndsAt = null; // starts when team A taps "show our cards"
    G.pickStartAt = { A: null, B: null };
  } else {
    const t = now();
    G.phaseEndsAt = t + G.settings.pickSec * 1000;
    G.pickStartAt = { A: t, B: t };
  }
  pushState();
}

function beginHotTurn(team) {
  if (G.phase !== "pick" || G.hotActive !== team || G.pickStartAt[team]) return;
  const t = now();
  G.pickStartAt[team] = t;
  G.phaseEndsAt = t + G.settings.pickSec * 1000;
  pushState();
}

function submitPick(team, idx, hidden, giveIdx) {
  if (G.phase !== "pick") return;
  const T = G.teams[team];
  if (T.pick) return;
  if (mode === "hotseat" && G.hotActive !== team) return;
  // validate indices
  if (!Array.isArray(idx) || idx.length !== 2) return;
  const [i, j] = idx;
  if (i === j || ![i, j].every((k) => Number.isInteger(k) && k >= 0 && k < T.hand.length)) return;
  hidden = !!hidden && T.hiddenLeft > 0;
  if (hidden) {
    if (giveIdx !== i && giveIdx !== j) return;
    T.hiddenLeft--;
  } else {
    giveIdx = T.hand[i] >= T.hand[j] ? i : j; // must give the bigger card
  }
  // chess clock
  const start = G.pickStartAt[team];
  if (start) T.timeMs += now() - start;
  T.pick = { idx: [i, j], hidden, giveIdx };

  if (mode === "hotseat" && team === "A" && !G.teams.B.pick) {
    G.hotActive = "B";
    G.phaseEndsAt = null;
    pushState();
    return;
  }
  if (G.teams.A.pick && G.teams.B.pick) resolveRound();
  else pushState();
}

function autoPick(team) {
  const T = G.teams[team];
  if (T.pick) return;
  // auto-play the two lowest cards (timeout penalty)
  const order = T.hand.map((v, k) => [v, k]).sort((a, b) => a[0] - b[0]);
  const i = order[0][1], j = order[1][1];
  T.timeMs += G.settings.pickSec * 1000; // full pick time counted
  T.pick = { idx: [i, j], hidden: false, giveIdx: T.hand[i] >= T.hand[j] ? i : j };
}

function resolveRound() {
  const sides = {};
  for (const t of ["A", "B"]) {
    const T = G.teams[t], p = T.pick;
    const cards = [T.hand[p.idx[0]], T.hand[p.idx[1]]];
    sides[t] = {
      cards, sum: cards[0] + cards[1], hidden: p.hidden,
      gaveVal: T.hand[p.giveIdx],
      discVal: T.hand[p.idx[0] === p.giveIdx ? p.idx[1] : p.idx[0]],
    };
  }
  let winner = null;
  if (sides.A.sum > sides.B.sum) winner = "A";
  else if (sides.B.sum > sides.A.sum) winner = "B";
  if (winner) G.teams[winner].score++;

  // move cards: remove both picked, give one to opponent
  for (const t of ["A", "B"]) {
    const T = G.teams[t];
    [...T.pick.idx].sort((a, b) => b - a).forEach((k) => T.hand.splice(k, 1));
  }
  G.teams.B.hand.push(sides.A.gaveVal);
  G.teams.A.hand.push(sides.B.gaveVal);
  G.teams.A.hand.sort((a, b) => a - b);
  G.teams.B.hand.sort((a, b) => a - b);

  G.lastRound = { round: G.round, winner, sides };
  G.phase = "reveal";
  G.teams.A.ready = G.teams.B.ready = false;
  G.phaseEndsAt = now() + REVEAL_SECS * 1000;
  pushState();
}

function advanceFromReveal() {
  if (G.phase !== "reveal") return;
  if (G.round >= ROUNDS) return endGame("rounds");
  G.round++;
  startDiscuss();
}

function endGame(reason) {
  const A = G.teams.A, B = G.teams.B;
  let winner = null, why = "";
  if (A.score !== B.score) {
    winner = A.score > B.score ? "A" : "B";
    why = "Higher score wins.";
  } else if (A.timeMs !== B.timeMs) {
    winner = A.timeMs < B.timeMs ? "A" : "B";
    why = "Scores tied — the team that used less thinking time wins!";
  } else {
    why = "Perfectly even. A true draw!";
  }
  G.phase = "over";
  G.phaseEndsAt = null;
  G.result = {
    reason, winner, why,
    score: { A: A.score, B: B.score },
    time: { A: A.timeMs, B: B.timeMs },
    roundsPlayed: G.lastRound ? G.lastRound.round : 0,
  };
  pushState();
}

function engineTick() {
  if (!G || G.phase === "lobby" || G.phase === "over") return;
  const t = now();
  // total game limit
  if (G.startedAt && t - G.startedAt >= G.settings.totalMin * 60000) {
    // teams mid-pick keep accrued time
    for (const k of ["A", "B"]) {
      const s = G.pickStartAt[k];
      if (G.phase === "pick" && s && !G.teams[k].pick) G.teams[k].timeMs += t - s;
    }
    return endGame("time");
  }
  if (G.phaseEndsAt && t >= G.phaseEndsAt) {
    if (G.phase === "discuss") startPick();
    else if (G.phase === "pick") {
      if (mode === "hotseat") {
        autoPick(G.hotActive);
        if (G.hotActive === "A" && !G.teams.B.pick) {
          G.hotActive = "B"; G.phaseEndsAt = null; pushState();
        } else resolveRound();
      } else {
        autoPick("A"); autoPick("B");
        resolveRound();
      }
    } else if (G.phase === "reveal") advanceFromReveal();
  }
  // both ready short-circuits
  if (G.phase === "discuss" && bothAck()) startPick();
  else if (G.phase === "reveal" && bothAck()) advanceFromReveal();
}
function bothAck() {
  if (mode === "hotseat") return G.teams.A.ready; // single Next button
  return G.teams.A.ready && G.teams.B.ready;
}

/* ---------------- views & masking ---------------- */
function viewFor(team) {
  const v = clone(G);
  v.now = now();
  for (const t of ["A", "B"]) {
    const T = v.teams[t];
    T.handCount = T.hand.length;
    const isMine = t === team;
    if (!isMine) {
      T.hand = null;
      if (T.pick) T.pick = { submitted: true, hidden: T.pick.hidden };
    }
    if (v.lastRound) {
      const s = v.lastRound.sides[t];
      if (s.hidden && !isMine) {
        v.lastRound.sides[t] = { hidden: true, gaveVal: s.gaveVal, masked: true };
      }
    }
  }
  return v;
}

function applyAction(team, a) {
  // `team` is the authenticated owner ('A' for host device, conn team for remote, or literal for hotseat)
  if (!G) return;
  switch (a.t) {
    case "roster":
      if (G.phase !== "lobby" || a.team !== team) return;
      G.teams[a.team].players = (a.players || []).slice(0, 6).map((p) => String(p).slice(0, 20));
      pushState(); break;
    case "teamName":
      if (a.team !== team) return;
      G.teams[a.team].name = String(a.name || "").slice(0, 16) || G.teams[a.team].name;
      pushState(); break;
    case "settings":
      if (team !== "A" || G.phase !== "lobby") return;
      const s = a.s || {};
      G.settings.discussSec = [0, 30, 45, 60, 90, 120].includes(+s.discussSec) ? +s.discussSec : G.settings.discussSec;
      G.settings.pickSec = [15, 20, 30, 45, 60].includes(+s.pickSec) ? +s.pickSec : G.settings.pickSec;
      G.settings.totalMin = [10, 15, 20, 30, 45].includes(+s.totalMin) ? +s.totalMin : G.settings.totalMin;
      pushState(); break;
    case "start":
      if (team !== "A" || G.phase !== "lobby") return;
      if (!canStart()) return;
      engineStart(); break;
    case "ready":
      if (a.team !== team) return;
      if (G.phase === "discuss" || G.phase === "reveal") { G.teams[a.team].ready = true; engineTick(); pushState(); }
      break;
    case "beginTurn":
      if (mode === "hotseat") beginHotTurn(a.team);
      break;
    case "submit":
      if (a.team !== team) return;
      submitPick(a.team, a.idx, a.hidden, a.giveIdx);
      break;
    case "rematch":
      if (team !== "A") return;
      const keep = { A: G.teams.A, B: G.teams.B };
      const set = G.settings;
      G = newGameState();
      G.settings = set;
      for (const t of ["A", "B"]) {
        G.teams[t].name = keep[t].name;
        G.teams[t].players = keep[t].players;
        G.teams[t].connected = keep[t].connected;
      }
      pushState(); break;
  }
}
function canStart() {
  const okA = activePlayers(G.teams.A).length >= 1;
  const okB = activePlayers(G.teams.B).length >= 1;
  const connOk = mode === "hotseat" || G.teams.B.connected;
  return okA && okB && connOk;
}

/* push state to all clients + rerender locally */
function pushState() {
  if (!G) return;
  if (mode === "host") {
    for (const [conn, meta] of conns) {
      if (conn.open) {
        try { conn.send({ t: "state", v: viewFor(meta.team === "spec" ? null : meta.team), now: now() }); } catch (e) {}
      }
    }
    V = viewFor(myTeam);
  } else if (mode === "hotseat") {
    V = hotView();
  }
  render();
}
function hotView() {
  // shared-screen view: mask hidden plays in lastRound, expose both hand arrays
  const v = clone(G);
  v.now = now();
  for (const t of ["A", "B"]) {
    v.teams[t].handCount = v.teams[t].hand.length;
    if (v.lastRound) {
      const s = v.lastRound.sides[t];
      if (s.hidden) v.lastRound.sides[t] = { hidden: true, gaveVal: s.gaveVal, masked: true };
    }
  }
  return v;
}

/* ============================================================
   NETWORKING (PeerJS)
   ============================================================ */
function genCode() {
  let c = "";
  for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

function destroyNet() {
  try { peer && peer.destroy(); } catch (e) {}
  peer = null; hostConn = null; conns.clear();
  clearInterval(tickInt); tickInt = null;
}

function hostRoom(attempt = 0) {
  destroyNet();
  mode = "host"; myTeam = "A";
  roomCode = genCode();
  G = newGameState();
  G.teams.A.connected = true;
  $("#net-status").textContent = "Opening room…";
  $("#net-status").classList.remove("err");
  show("#screen-lobby");
  renderLobbyStatic();

  peer = new Peer(PEER_PREFIX + roomCode, { debug: 1 });
  peer.on("open", () => {
    $("#net-status").textContent = "✅ Room is live — waiting for Team 2 to join…";
    renderRoomCode();
    pushState();
  });
  peer.on("connection", (conn) => {
    conn.on("open", () => {
      let team = "spec";
      if (!G.teams.B.connected) { team = "B"; G.teams.B.connected = true; }
      conns.set(conn, { team, name: "" });
      conn.send({ t: "welcome", team, code: roomCode });
      if (team === "B") {
        toast("🎉 Team 2 joined!");
        $("#net-status").textContent = "✅ Both teams connected. Fill rosters and start!";
      } else toast("👀 A spectator joined");
      pushState();
    });
    conn.on("data", (m) => {
      const meta = conns.get(conn);
      if (!meta) return;
      if (m && m.t === "hello") { meta.name = String(m.name || "").slice(0, 20); return; }
      if (m && m.t === "act" && meta.team !== "spec") applyAction(meta.team, m.a || {});
    });
    conn.on("close", () => {
      const meta = conns.get(conn);
      conns.delete(conn);
      if (meta && meta.team === "B") {
        G.teams.B.connected = false;
        toast("⚠️ Team 2 disconnected");
        $("#net-status").textContent = "⚠️ Team 2 disconnected — they can rejoin with the same code.";
        pushState();
      }
    });
  });
  peer.on("error", (err) => {
    if (err.type === "unavailable-id" && attempt < 3) return hostRoom(attempt + 1);
    $("#net-status").textContent = "❌ Connection service error: " + err.type + " — check internet and retry.";
    $("#net-status").classList.add("err");
  });
  tickInt = setInterval(() => { engineTick(); }, 400);
}

function joinRoom(code, name) {
  destroyNet();
  mode = "client"; myTeam = null;
  roomCode = code;
  const st = $("#join-status");
  st.textContent = "Connecting…"; st.classList.remove("err");
  peer = new Peer({ debug: 1 });
  let opened = false;
  peer.on("open", () => {
    hostConn = peer.connect(PEER_PREFIX + code, { reliable: true });
    hostConn.on("open", () => {
      opened = true;
      hostConn.send({ t: "hello", name });
      st.textContent = "Connected! Waiting for game data…";
    });
    hostConn.on("data", onClientData);
    hostConn.on("close", () => {
      toast("❌ Lost connection to the host");
      if ($("#screen-game").classList.contains("active") || $("#screen-lobby").classList.contains("active")) {
        show("#screen-home");
      }
    });
  });
  peer.on("error", (err) => {
    if (err.type === "peer-unavailable") {
      st.textContent = "❌ Room not found. Check the code — the host must keep the room open.";
    } else {
      st.textContent = "❌ Connection error: " + err.type;
    }
    st.classList.add("err");
  });
  setTimeout(() => {
    if (!opened && $("#screen-join").classList.contains("active") && st.textContent.startsWith("Connecting")) {
      st.textContent = "Still trying… weak network? Both devices need internet.";
    }
  }, 6000);
}

function onClientData(m) {
  if (!m) return;
  if (m.t === "welcome") {
    myTeam = m.team === "spec" ? null : m.team;
    renderRoomCode();
    toast(myTeam ? `You are ${myTeam === "A" ? "Team 1" : "Team 2"}'s device` : "You joined as a spectator");
    return;
  }
  if (m.t === "state") {
    clockOffset = (m.now || Date.now()) - Date.now();
    V = m.v;
    render();
  }
}
function sendAct(a) {
  if (mode === "client") {
    if (hostConn && hostConn.open) hostConn.send({ t: "act", a });
  } else {
    applyAction(mode === "hotseat" ? a.team || "A" : "A", a);
  }
}
/* hotseat & host shortcut: local actions for my own team */
function act(a) {
  if (mode === "client") sendAct(a);
  else if (mode === "host") applyAction("A", a);
  else if (mode === "hotseat") applyAction(a.team || "A", a);
}

/* ============================================================
   RENDERING
   ============================================================ */
function hostNow() { return Date.now() + clockOffset; }

function renderRoomCode() {
  $("#room-code").textContent = roomCode.split("").join(" ");
  const url = location.origin + location.pathname + "?room=" + roomCode;
  try {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    $("#qr-box").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2 });
  } catch (e) { $("#qr-box").innerHTML = ""; }
}

function renderLobbyStatic() {
  for (const t of ["A", "B"]) {
    const box = $("#roster-" + t);
    if (box.children.length) continue;
    for (let i = 0; i < 6; i++) {
      const row = document.createElement("div");
      row.className = "roster-item";
      row.innerHTML = `<span class="ord">${i + 1}</span><input class="input-text roster-input" data-team="${t}" data-i="${i}" maxlength="20" placeholder="Player ${i + 1}${i === 0 ? " (required)" : ""}">`;
      box.appendChild(row);
    }
  }
}

function editable(team) {
  if (mode === "hotseat") return true;
  return myTeam === team;
}

function renderLobby() {
  if (!V) return;
  renderLobbyStatic();
  for (const t of ["A", "B"]) {
    const T = V.teams[t];
    const nameInput = $("#name-" + t);
    if (document.activeElement !== nameInput) nameInput.value = T.name;
    nameInput.disabled = !editable(t);
    $$(`.roster-input[data-team="${t}"]`).forEach((inp) => {
      if (document.activeElement !== inp) inp.value = T.players[+inp.dataset.i] || "";
      inp.disabled = !editable(t);
    });
  }
  // settings
  const isHost = mode !== "client";
  ["discuss", "pick", "total"].forEach((k) => {
    const el = $("#set-" + k);
    el.disabled = !isHost;
    const val = { discuss: V.settings.discussSec, pick: V.settings.pickSec, total: V.settings.totalMin }[k];
    if (document.activeElement !== el) el.value = String(val);
  });
  // start button (host / hotseat only)
  const btn = $("#btn-start");
  const hint = $("#start-hint");
  if (mode === "client") {
    btn.style.display = "none";
    hint.textContent = myTeam ? "Waiting for the host to start the game…" : "Spectating — waiting for the host…";
  } else {
    btn.style.display = "";
    const okA = V.teams.A.players.some((p) => p && p.trim());
    const okB = V.teams.B.players.some((p) => p && p.trim());
    const connOk = mode === "hotseat" || V.teams.B.connected;
    btn.disabled = !(okA && okB && connOk);
    hint.textContent = !connOk ? "Waiting for Team 2's device to join…"
      : !(okA && okB) ? "Add at least 1 player on each team."
      : "Ready when you are!";
  }
  if (mode === "hotseat") {
    $("#room-panel").style.display = "none";
    $("#roster-B-hint").textContent = "Up to 6 players — play order follows this list.";
  } else {
    $("#room-panel").style.display = "";
  }
}

function teamLabel(t) { return V ? V.teams[t].name : t; }

function renderGame() {
  const v = V;
  const isHot = mode === "hotseat";
  const me = isHot ? (v.phase === "pick" ? v.hotActive : null) : myTeam;
  const opp = me ? OTHER[me] : "B";

  // topbar
  $("#hud-name-A").textContent = v.teams.A.name;
  $("#hud-name-B").textContent = v.teams.B.name;
  $("#hud-score-A").textContent = v.teams.A.score;
  $("#hud-score-B").textContent = v.teams.B.score;
  $("#hud-round").textContent = v.round;

  // areas: in hotseat during non-pick phases hide hand
  const myT = me ? v.teams[me] : null;
  const oppT = v.teams[opp];

  $("#opp-label").textContent = me ? oppT.name : `${v.teams.A.name} & ${v.teams.B.name}`;
  $("#opp-count").textContent = oppT.handCount ?? (oppT.hand ? oppT.hand.length : "?");
  $("#opp-hidden-badge").classList.toggle("used", oppT.hiddenLeft <= 0);
  const oc = $("#opp-cards");
  oc.innerHTML = "";
  const n = oppT.handCount ?? 0;
  for (let i = 0; i < n; i++) { const d = document.createElement("div"); d.className = "mini-back"; oc.appendChild(d); }

  $("#my-label").textContent = myT ? `${myT.name} — your hand` : "";
  $("#lead-name").textContent = me ? leadOf(v, me) : `${leadOf(v, "A")} / ${leadOf(v, "B")}`;
  $("#my-hidden-badge").classList.toggle("used", myT ? myT.hiddenLeft <= 0 : false);

  renderHand(me);
  renderPhase(me);
  renderOverlays(me);
}
function leadOf(v, t) {
  const ps = v.teams[t].players.filter((p) => p && p.trim());
  if (!ps.length) return "—";
  return ps[(v.round - 1) % ps.length];
}

function renderHand(me) {
  const hand = $("#hand");
  hand.innerHTML = "";
  const isHot = mode === "hotseat";
  const showHand = me && V.teams[me].hand && (!isHot || (V.phase === "pick" && V.hotActive === me && V.pickStartAt[me]));
  if (!showHand) {
    if (me === null && !isHot && myTeam === null) {
      $("#my-hint").textContent = "You are spectating.";
    }
    return;
  }
  const T = V.teams[me];
  const canPickNow = V.phase === "pick" && !T.pick;
  T.hand.forEach((val, i) => {
    const c = document.createElement("div");
    c.className = "card deal-in " + (me === "A" ? "ca" : "cb");
    c.style.animationDelay = i * 0.03 + "s";
    c.innerHTML = `<small>${val}</small>${val}`;
    if (sel.includes(i)) c.classList.add("sel");
    if (canPickNow) {
      c.onclick = () => {
        if (sel.includes(i)) sel = sel.filter((k) => k !== i);
        else { sel.push(i); if (sel.length > 2) sel.shift(); }
        renderGame();
      };
    } else if (T.pick) c.classList.add("dim");
    hand.appendChild(c);
  });
}

function renderPhase(me) {
  const banner = $("#phase-banner");
  const zone = $("#reveal-zone");
  const btnSubmit = $("#btn-submit");
  const btnReady = $("#btn-ready");
  const hidWrap = $("#hidden-toggle-wrap");
  const hint = $("#my-hint");
  const actionRow = $("#action-row");
  zone.innerHTML = "";
  const isHot = mode === "hotseat";
  const T = me ? V.teams[me] : null;

  actionRow.style.display = me ? "" : "none";
  btnSubmit.style.display = "none";
  btnReady.style.display = "none";
  hidWrap.style.display = "none";
  hint.textContent = "";

  if (V.phase === "discuss") {
    banner.innerHTML = `💬 Discussion time!<span class="sub">Lead player this round: <b>${esc(me ? leadOf(V, me) : leadOf(V, "A") + " & " + leadOf(V, "B"))}</b> — agree on 2 cards</span>`;
    if (me && !isHot) {
      btnReady.style.display = "";
      btnReady.disabled = T.ready;
      btnReady.textContent = T.ready ? "✔ Waiting for other team…" : "✔ We're ready";
    } else if (isHot) {
      btnReady.style.display = "";
      actionRow.style.display = "";
      const bothReady = V.teams.A.ready;
      btnReady.disabled = bothReady;
      btnReady.textContent = "⏩ Skip discussion";
    }
  } else if (V.phase === "pick") {
    if (me && T && !T.pick) {
      banner.innerHTML = `🃏 Pick 2 cards!<span class="sub">Tap two cards, then play them. Clock is running…</span>`;
      btnSubmit.style.display = "";
      btnSubmit.disabled = sel.length !== 2;
      const hid = $("#hidden-toggle");
      if (T.hiddenLeft > 0) {
        hidWrap.style.display = "";
        hidWrap.classList.remove("off");
      } else { hid.checked = false; }
      btnSubmit.textContent = hid.checked && sel.length === 2 ? "🎭 Play hidden…" : "Play cards";
      if (sel.length === 2 && T.hand) {
        hint.textContent = `Selected: ${T.hand[sel[0]]} + ${T.hand[sel[1]]} = ${T.hand[sel[0]] + T.hand[sel[1]]}` + (hid.checked ? " (hidden — you'll choose which card to give)" : ` — you will give away the ${Math.max(T.hand[sel[0]], T.hand[sel[1]])}`);
      }
    } else if (me && T && T.pick) {
      banner.innerHTML = `⏳ Cards locked in<span class="sub">Waiting for ${esc(V.teams[OTHER[me]].name)}…</span>`;
      hint.textContent = "Your play is submitted.";
    } else {
      banner.innerHTML = `🃏 Teams are picking…`;
    }
    // show opponent submitted state
    const oppP = me ? V.teams[OTHER[me]].pick : null;
    if (oppP && (oppP.submitted || oppP.idx)) {
      zone.innerHTML = `<div class="card back">?</div><div class="card back">?</div>`;
    }
  } else if (V.phase === "reveal" && V.lastRound) {
    banner.innerHTML = "";
    // handled by result overlay
  } else if (V.phase === "lobby") {
    banner.textContent = "";
  }
}

function renderOverlays(me) {
  const isHot = mode === "hotseat";
  const pass = $("#pass-overlay");
  const res = $("#result-overlay");

  /* hotseat pass screen */
  if (isHot && V.phase === "pick" && V.hotActive && !V.pickStartAt[V.hotActive]) {
    const T = V.teams[V.hotActive];
    $("#pass-emoji").textContent = V.hotActive === "A" ? "🔥" : "🐉";
    $("#pass-title").textContent = `${T.name} — your turn!`;
    $("#pass-text").textContent = `Pass the device to ${T.name}. Other team, look away! 👀 Tap below when only ${T.name} can see the screen. Your pick timer (${V.settings.pickSec}s) starts then.`;
    $("#pass-continue").onclick = () => { sel = []; act({ t: "beginTurn", team: V.hotActive }); };
    pass.classList.add("show");
  } else pass.classList.remove("show");

  /* round result */
  if (V.phase === "reveal" && V.lastRound) {
    giveDialogOpen = false;
    res.classList.add("show");
    renderResultCard(me);
  } else if (!giveDialogOpen) res.classList.remove("show");
}

function sideCardsHTML(s, colorClass) {
  if (s.masked) {
    return `<div class="cards-row"><div class="card back">?</div><div class="card back">?</div></div>
      <div class="sum">🎭 ? + ? </div>`;
  }
  let gaveMarked = false;
  const html = s.cards.map((v) => {
    const isGave = !gaveMarked && v === s.gaveVal;
    if (isGave) gaveMarked = true;
    return `<div class="card ${colorClass} ${isGave ? "given" : "dim"}">${v}<sub>${isGave ? "GIVEN" : "OUT"}</sub></div>`;
  }).join("");
  return `<div class="cards-row">${html}</div>
    <div class="sum">${s.cards[0]} + ${s.cards[1]} = ${s.sum}</div>`;
}

function renderResultCard(me) {
  const lr = V.lastRound;
  const box = $("#result-card");
  const wA = lr.winner === "A", wB = lr.winner === "B";
  const title = lr.winner ? `🏆 ${esc(V.teams[lr.winner].name)} takes round ${lr.round}!` : `🤝 Round ${lr.round} is a tie — no point`;
  const exch = [];
  for (const t of ["A", "B"]) {
    const s = lr.sides[t], o = OTHER[t];
    exch.push(`<b style="color:var(--team-${t.toLowerCase()})">${esc(V.teams[t].name)}</b> gave a <b>${s.gaveVal}</b> to ${esc(V.teams[o].name)}${s.masked || s.hidden ? " 🎭" : ` and discarded the ${s.discVal}`}.`);
  }
  const isHot = mode === "hotseat";
  const T = me ? V.teams[me] : null;
  let btnHTML;
  if (isHot) {
    btnHTML = `<button class="btn btn-primary btn-big" id="btn-next-round">${lr.round >= ROUNDS ? "See final result →" : "Next round →"}</button>`;
  } else if (me && T) {
    btnHTML = T.ready
      ? `<p class="muted small">Waiting for the other team…</p>`
      : `<button class="btn btn-primary btn-big" id="btn-next-round">${lr.round >= ROUNDS ? "See final result →" : "Continue →"}</button>`;
  } else {
    btnHTML = `<p class="muted small">Next round starting soon…</p>`;
  }
  box.innerHTML = `
    <div class="result-title">${title}</div>
    <div class="result-vs">
      <div class="result-side ${wA ? "win" : ""}">
        <h4 style="color:var(--team-a)">${esc(V.teams.A.name)}</h4>
        ${sideCardsHTML(lr.sides.A, "ca")}
      </div>
      <div class="result-side ${wB ? "win" : ""}">
        <h4 style="color:var(--team-b)">${esc(V.teams.B.name)}</h4>
        ${sideCardsHTML(lr.sides.B, "cb")}
      </div>
    </div>
    <div class="result-exchange">🔁 ${exch.join("<br>")}</div>
    ${btnHTML}
    <p class="muted small" style="margin-top:8px">auto-continues in <span id="reveal-cd">…</span>s</p>`;
  const b = $("#btn-next-round");
  if (b) b.onclick = () => { sel = []; act({ t: "ready", team: isHot ? "A" : me }); renderGame(); };
}

function renderOver() {
  const r = V.result;
  const box = $("#over-panel");
  const names = { A: V.teams.A.name, B: V.teams.B.name };
  const reasonTxt = r.reason === "time"
    ? `⏰ Time limit reached after ${r.roundsPlayed} round${r.roundsPlayed === 1 ? "" : "s"} — the game stops here.`
    : `All ${ROUNDS} rounds played!`;
  const headline = r.winner ? `${esc(names[r.winner])} wins!` : "It's a draw!";
  const emoji = r.winner ? "🏆" : "🤝";
  box.innerHTML = `
    <div class="trophy">${emoji}</div>
    <h1>${headline}</h1>
    <div class="over-score"><span class="a">${r.score.A}</span> : <span class="b">${r.score.B}</span></div>
    <div class="over-reason">
      ${reasonTxt}<br>${esc(r.why)}<br><br>
      ⏱ Thinking time used — <b style="color:var(--team-a)">${esc(names.A)}</b>: ${fmtClock(r.time.A)} ·
      <b style="color:var(--team-b)">${esc(names.B)}</b>: ${fmtClock(r.time.B)}
    </div>
    ${mode !== "client" ? `<button class="btn btn-primary btn-big" id="btn-rematch">🔁 Rematch (same teams)</button>` : `<p class="muted small">The host can start a rematch.</p>`}
    <button class="btn btn-secondary btn-big" id="btn-over-home">🏠 Back to home</button>`;
  const rm = $("#btn-rematch");
  if (rm) rm.onclick = () => act({ t: "rematch" });
  $("#btn-over-home").onclick = () => { leaveToHome(); };
}

function render() {
  if (!V) return;
  if (V.phase !== lastPhase) {
    sel = [];
    giveDialogOpen = false;
    const ht = $("#hidden-toggle");
    if (ht && V.phase !== "pick") ht.checked = false;
    lastPhase = V.phase;
  }
  if (V.phase === "lobby") {
    if (!$("#screen-lobby").classList.contains("active")) show("#screen-lobby");
    renderLobby();
  } else if (V.phase === "over") {
    if (!$("#screen-over").classList.contains("active")) show("#screen-over");
    renderOver();
  } else {
    if (!$("#screen-game").classList.contains("active")) { sel = []; show("#screen-game"); }
    renderGame();
  }
}

/* ---------------- live timer UI (runs everywhere) ---------------- */
function uiTick() {
  if (!V || !$("#screen-game").classList.contains("active")) return;
  const t = hostNow();
  const el = $("#phase-timer");
  if (V.phaseEndsAt) {
    const remain = Math.max(0, V.phaseEndsAt - t);
    el.textContent = fmtClock(remain);
    el.classList.toggle("hurry", remain < 10000 && (V.phase === "discuss" || V.phase === "pick"));
  } else {
    el.textContent = V.phase === "pick" ? "⏸" : "—";
    el.classList.remove("hurry");
  }
  // total bar
  if (V.startedAt) {
    const frac = Math.min(1, (t - V.startedAt) / (V.settings.totalMin * 60000));
    $("#totalbar-fill").style.width = (frac * 100).toFixed(1) + "%";
  }
  // team clocks (live accrual while picking)
  for (const k of ["A", "B"]) {
    let ms = V.teams[k].timeMs;
    if (V.phase === "pick" && V.pickStartAt && V.pickStartAt[k] && !V.teams[k].pick) ms += t - V.pickStartAt[k];
    $("#clock-" + k).textContent = "⏱" + fmtClock(ms);
  }
  const cd = $("#reveal-cd");
  if (cd && V.phaseEndsAt) cd.textContent = Math.max(0, Math.ceil((V.phaseEndsAt - t) / 1000));
}

/* ============================================================
   TUTORIAL
   ============================================================ */
let tutIdx = 0;
function renderTutorial() {
  const slides = window.TUTORIAL_SLIDES;
  const s = slides[tutIdx];
  $("#tut-slide-box").innerHTML = `<div class="tut-slide">
    <div class="step-tag">${s.tag}</div>
    <h2>${s.title}</h2>
    ${s.svg}
    <p>${s.text}</p>
  </div>`;
  $("#tut-dots").innerHTML = slides.map((_, i) => `<span class="${i === tutIdx ? "on" : ""}" data-i="${i}"></span>`).join("");
  $$("#tut-dots span").forEach((d) => (d.onclick = () => { tutIdx = +d.dataset.i; renderTutorial(); }));
  $("#tut-prev").disabled = tutIdx === 0;
  $("#tut-next").textContent = tutIdx === slides.length - 1 ? "Done ✔" : "Next →";
}

/* ============================================================
   HOTSEAT
   ============================================================ */
function startHotseat() {
  destroyNet();
  mode = "hotseat"; myTeam = null;
  G = newGameState();
  G.teams.A.connected = G.teams.B.connected = true;
  show("#screen-lobby");
  renderLobbyStatic();
  pushState();
  tickInt = setInterval(() => { engineTick(); }, 400);
}

function leaveToHome() {
  destroyNet();
  G = null; V = null; mode = null; myTeam = null; sel = [];
  history.replaceState(null, "", location.pathname);
  show("#screen-home");
}

/* ============================================================
   WIRE-UP
   ============================================================ */
function submitFlow() {
  const isHot = mode === "hotseat";
  const me = isHot ? V.hotActive : myTeam;
  if (!me) return;
  const T = V.teams[me];
  if (sel.length !== 2 || !T.hand) return;
  const hidden = $("#hidden-toggle").checked && T.hiddenLeft > 0;
  if (!hidden) {
    act({ t: "submit", team: me, idx: [...sel], hidden: false });
    sel = [];
    $("#hidden-toggle").checked = false;
    return;
  }
  // hidden: choose which card to give away
  const [i, j] = sel;
  const res = $("#result-overlay");
  giveDialogOpen = true;
  res.classList.add("show");
  $("#result-card").innerHTML = `
    <div class="overlay-emoji">🎭</div>
    <h2>Hidden play</h2>
    <p>Your numbers stay secret. Choose which card to <b>give away</b> to the other team — the other one is discarded.</p>
    <div class="give-pick-row">
      <div class="card ${me === "A" ? "ca" : "cb"}" data-give="${i}">${T.hand[i]}</div>
      <div class="card ${me === "A" ? "ca" : "cb"}" data-give="${j}">${T.hand[j]}</div>
    </div>
    <button class="btn btn-secondary" id="give-cancel" style="margin-top:14px">Cancel</button>`;
  $$("#result-card .card").forEach((c) => {
    c.onclick = () => {
      act({ t: "submit", team: me, idx: [i, j], hidden: true, giveIdx: +c.dataset.give });
      sel = [];
      $("#hidden-toggle").checked = false;
      giveDialogOpen = false;
      res.classList.remove("show");
      renderGame();
    };
  });
  $("#give-cancel").onclick = () => { giveDialogOpen = false; res.classList.remove("show"); renderGame(); };
}

function init() {
  /* home */
  $("#btn-create").onclick = () => hostRoom();
  $("#btn-join").onclick = () => show("#screen-join");
  $("#btn-hotseat").onclick = () => startHotseat();
  $("#btn-tutorial").onclick = () => { tutIdx = 0; renderTutorial(); show("#screen-tutorial"); };
  $$(".btn-back[data-back]").forEach((b) => (b.onclick = () => show("#screen-home")));

  /* join */
  $("#btn-join-go").onclick = () => {
    const code = $("#join-code").value.trim().toUpperCase();
    if (code.length !== 6) { $("#join-status").textContent = "Code must be 6 characters."; $("#join-status").classList.add("err"); return; }
    joinRoom(code, $("#join-name").value.trim());
  };
  $("#join-code").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });

  /* lobby */
  $("#btn-lobby-leave").onclick = () => leaveToHome();
  $("#btn-start").onclick = () => act({ t: "start" });
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.classList && el.classList.contains("roster-input")) {
      const team = el.dataset.team;
      if (!editable(team)) return;
      const players = $$(`.roster-input[data-team="${team}"]`).map((i) => i.value);
      act({ t: "roster", team, players });
    }
    if (el.id === "name-A" || el.id === "name-B") {
      const team = el.id.slice(-1);
      if (!editable(team)) return;
      act({ t: "teamName", team, name: el.value });
    }
    if (["set-discuss", "set-pick", "set-total"].includes(el.id) && mode !== "client") {
      act({ t: "settings", s: { discussSec: +$("#set-discuss").value, pickSec: +$("#set-pick").value, totalMin: +$("#set-total").value } });
    }
  });

  /* tutorial */
  $("#tut-prev").onclick = () => { if (tutIdx > 0) { tutIdx--; renderTutorial(); } };
  $("#tut-next").onclick = () => {
    if (tutIdx < window.TUTORIAL_SLIDES.length - 1) { tutIdx++; renderTutorial(); }
    else show("#screen-home");
  };

  /* game */
  $("#btn-submit").onclick = submitFlow;
  $("#btn-ready").onclick = () => {
    const me = mode === "hotseat" ? "A" : myTeam;
    if (me) act({ t: "ready", team: me });
    renderGame();
  };
  $("#hidden-toggle").addEventListener("change", () => renderGame());

  uiInt = setInterval(uiTick, 250);

  /* deep link ?room=CODE */
  const params = new URLSearchParams(location.search);
  const room = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (room.length === 6) {
    show("#screen-join");
    $("#join-code").value = room;
  }

  window.addEventListener("beforeunload", (e) => {
    if (G && G.phase !== "lobby" && G.phase !== "over" && mode !== null) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}
document.addEventListener("DOMContentLoaded", init);
