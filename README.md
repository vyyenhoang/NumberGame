# 🃏 Number Clash — Team Card Duel

A free, no-server party game for **two teams** (up to 6 players each). Each team holds two sets of cards **1–7** (14 cards). Every round both teams secretly pick **2 cards** — the bigger sum scores the point, then the **big cards switch sides** and the small ones are discarded. Once per game a team can play its **🎭 hidden advantage**. 12 rounds, chess-clock timing, and if the score is a draw, **the faster team wins**.

**Play it in a browser — phones work great.** No accounts, no backend, 100% free hosting on GitHub Pages.

## ✨ Features

- 🎪 **Create a room** and share a **6-letter code or QR code** — the other team joins from their own device (peer-to-peer via PeerJS, no game server needed)
- 🎮 **One-device mode** (pass & play) when you don't have two devices or internet is flaky
- 👥 Up to **6 players per team**, named in play order — the **lead player** rotates every round, so each player leads twice across the 12 rounds
- ⏱ **Timers everywhere**: discussion timer, card-pick timer (auto-plays your two lowest cards if you run out!), and a total game limit — going over stops the game on the spot
- ♟ **Chess-clock fairness**: each team's thinking time is tracked; tied score → less time used wins
- 🎭 **Hidden advantage** (once per game): your numbers stay secret and *you* choose which card to hand over — even the tiny one
- 📖 **Illustrated tutorial** built in (7 visual steps)

## 📜 Rules in 30 seconds

1. Each team starts with cards **1–7 twice** (14 cards).
2. Each round: **discuss**, then **pick 2 cards** before the timer ends.
3. Reveal together — **bigger sum = 1 point** (tie = no point).
4. Each team **gives its bigger card to the opponent**; the smaller card is **discarded**.
5. **🎭 Hidden advantage** (1× per game): don't reveal your numbers, and choose *either* of your two cards to give away.
6. After **12 rounds** (or when the game clock runs out): most points wins. **Draw → the team that used less thinking time wins.**

## 🚀 Play / deploy for free (GitHub Pages)

The repo is a static site — `index.html` at the root, zero build step.

1. Merge to `main`.
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. The included workflow (`.github/workflows/deploy-pages.yml`) deploys automatically on every push to `main`.
4. Your game is live at `https://<username>.github.io/NumberGame/` — share that link; room QR codes point to it automatically.

> Multiplayer uses the free public [PeerJS](https://peerjs.com) cloud broker for the initial handshake; the game itself is direct device-to-device (WebRTC). Both devices just need internet.

You can also test locally: `python3 -m http.server` in the repo folder, then open `http://localhost:8000`.

## 🗂 Project layout

```
index.html               app shell (all screens)
assets/style.css         theme + layout
assets/app.js            game engine, PeerJS networking, UI
assets/tutorial.js       illustrated tutorial slides (inline SVG)
assets/vendor/           vendored PeerJS + QR generator (no CDN needed)
.github/workflows/       GitHub Pages deploy
```
