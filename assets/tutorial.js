/* Number Clash — illustrated tutorial slides */
(function () {
  const CA = "#ff6b5e", CB = "#35c4b5", GOLD = "#ffd166", INK = "#f2f5ff", MUT = "#9aa7cc";

  function card(x, y, n, color, opts) {
    opts = opts || {};
    const rot = opts.rot || 0, s = opts.s || 1, glow = opts.glow, dim = opts.dim, back = opts.back;
    const w = 52 * s, h = 74 * s;
    let inner;
    if (back) {
      inner = `<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="8" fill="#38487c" stroke="#5a6ca8" stroke-width="3"/>
        <path d="M${-w/2+6},${-h/2+10} l${w-12},${h-20} M${-w/2+6},${h/2-10} l${w-12},${-h+20}" stroke="#46578f" stroke-width="4"/>
        <text y="${8*s}" text-anchor="middle" font-size="${26*s}" font-weight="900" fill="#fff">?</text>`;
    } else {
      inner = `<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="8" fill="#fff" stroke="${glow ? GOLD : "#fff"}" stroke-width="${glow ? 4 : 2}"/>
        <text y="${9*s}" text-anchor="middle" font-size="${30*s}" font-weight="900" fill="#26304f">${n}</text>
        <circle cx="${w/2-9}" cy="${h/2-9}" r="4" fill="${color}"/>
        <text x="${-w/2+9}" y="${-h/2+15}" font-size="${11*s}" font-weight="900" fill="${color}">${n}</text>`;
    }
    return `<g transform="translate(${x} ${y}) rotate(${rot})" ${dim ? 'opacity=".38"' : ""}>${inner}</g>`;
  }

  function bubble(x, y, txt, color) {
    return `<g transform="translate(${x} ${y})">
      <rect x="-46" y="-18" width="92" height="34" rx="16" fill="${color}"/>
      <path d="M-8,14 l6,12 l8,-12 z" fill="${color}"/>
      <text y="5" text-anchor="middle" font-size="13" font-weight="800" fill="#fff">${txt}</text></g>`;
  }

  function person(x, y, color, scale) {
    const s = scale || 1;
    return `<g transform="translate(${x} ${y}) scale(${s})">
      <circle cy="-16" r="9" fill="${color}"/>
      <path d="M-12,14 a12,14 0 0,1 24,0 z" fill="${color}"/></g>`;
  }

  window.TUTORIAL_SLIDES = [
    {
      tag: "Step 1 · Setup", title: "Two teams, one room",
      text: "The host creates a room and shares a 6-letter code or QR code. The other team joins from their own phone. Each team lists up to 6 players — that order decides who leads each round.",
      svg: `<svg viewBox="0 0 420 190">
        <rect x="150" y="20" width="120" height="150" rx="14" fill="#16203f" stroke="#3d4f8a" stroke-width="3"/>
        <rect x="168" y="40" width="84" height="84" rx="8" fill="#fff"/>
        ${[0,1,2,3].map(i=>[0,1,2,3].map(j=>((i*7+j*3)%3!==1)?`<rect x="${174+j*18}" y="${46+i*18}" width="13" height="13" fill="#26304f"/>`:"").join("")).join("")}
        <text x="210" y="152" text-anchor="middle" font-size="16" font-weight="900" fill="${GOLD}" letter-spacing="3">AB12CD</text>
        ${person(60,80,CA)} ${person(95,95,CA,0.8)} ${person(30,95,CA,0.8)}
        <text x="62" y="135" text-anchor="middle" font-size="13" font-weight="800" fill="${CA}">Team 1</text>
        ${person(360,80,CB)} ${person(325,95,CB,0.8)} ${person(392,95,CB,0.8)}
        <text x="358" y="135" text-anchor="middle" font-size="13" font-weight="800" fill="${CB}">Team 2</text>
        <path d="M115,80 Q135,70 150,75" stroke="${MUT}" stroke-width="2.5" fill="none" stroke-dasharray="4 4" marker-end="url(#arr)"/>
        <path d="M305,80 Q285,70 272,75" stroke="${MUT}" stroke-width="2.5" fill="none" stroke-dasharray="4 4"/>
        <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="${MUT}"/></marker></defs>
      </svg>`
    },
    {
      tag: "Step 2 · Your deck", title: "Cards 1–7… twice!",
      text: "Every team starts with 14 cards: two full sets of 1 to 7. Everyone on the team can see their own hand, but the other team can't.",
      svg: `<svg viewBox="0 0 420 190">
        ${[1,2,3,4,5,6,7].map((n,i)=>card(60+i*50, 70, n, CA, {rot:-6+i*2})).join("")}
        ${[1,2,3,4,5,6,7].map((n,i)=>card(60+i*50, 150, n, CA, {rot:6-i*2})).join("")}
        <text x="210" y="18" text-anchor="middle" font-size="14" font-weight="800" fill="${MUT}">14 cards per team</text>
      </svg>`
    },
    {
      tag: "Step 3 · Each round", title: "Discuss, then pick 2 cards",
      text: "A discussion timer runs first — talk strategy with your team (the lead player has the final say). Then the pick timer starts: choose exactly 2 cards and submit before time runs out. Your thinking time is tracked like a chess clock!",
      svg: `<svg viewBox="0 0 420 190">
        ${bubble(80, 40, "Play high?", CA)} ${bubble(190, 30, "Save the 7!", "#3d4f8a")}
        ${person(60, 95, CA)} ${person(110, 100, CA, .85)} ${person(160, 97, CA, .9)}
        ${card(270, 120, 6, CA, {glow:1, rot:-6})} ${card(330, 120, 2, CA, {glow:1, rot:6})}
        ${card(388, 135, 4, CA, {dim:1, rot:12, s:.8})}
        <g transform="translate(330 40)">
          <circle r="24" fill="#16203f" stroke="${GOLD}" stroke-width="3"/>
          <path d="M0,0 L0,-14 M0,0 L9,5" stroke="${GOLD}" stroke-width="3" stroke-linecap="round"/>
        </g>
        <text x="330" y="82" text-anchor="middle" font-size="12" font-weight="800" fill="${GOLD}">⏱ pick in time!</text>
      </svg>`
    },
    {
      tag: "Step 4 · Showdown", title: "Bigger sum wins the point",
      text: "Both teams reveal at the same time. Add your two cards together — the higher total scores 1 point. Equal sums? No point for anyone.",
      svg: `<svg viewBox="0 0 420 190">
        ${card(80, 85, 5, CA, {rot:-8})} ${card(140, 85, 3, CA, {rot:8})}
        <text x="110" y="165" text-anchor="middle" font-size="22" font-weight="900" fill="${CA}">5+3 = 8 🏆</text>
        <g transform="translate(210 85)"><circle r="26" fill="${GOLD}"/><text y="8" text-anchor="middle" font-size="20" font-weight="900" fill="#7a4c00">VS</text></g>
        ${card(280, 85, 6, CB, {rot:-8})} ${card(340, 85, 1, CB, {rot:8})}
        <text x="310" y="165" text-anchor="middle" font-size="20" font-weight="900" fill="${MUT}">6+1 = 7</text>
      </svg>`
    },
    {
      tag: "Step 5 · The twist", title: "Swap the big, drop the small",
      text: "After every reveal, each team hands its BIGGER card to the other team, and the smaller card is discarded forever. Winning a round can still feed your best card to the enemy — plan ahead!",
      svg: `<svg viewBox="0 0 420 190">
        ${card(80, 60, 5, CA, {glow:1})} ${card(340, 60, 6, CB, {glow:1})}
        <path d="M115,45 C180,10 240,10 305,45" stroke="${CA}" stroke-width="4" fill="none" marker-end="url(#arrA)"/>
        <path d="M305,75 C240,110 180,110 115,75" stroke="${CB}" stroke-width="4" fill="none" marker-end="url(#arrB)"/>
        ${card(80, 150, 3, CA, {dim:1, s:.85})} ${card(340, 150, 1, CB, {dim:1, s:.85})}
        <text x="210" y="150" text-anchor="middle" font-size="30">🗑️</text>
        <text x="210" y="176" text-anchor="middle" font-size="12" font-weight="800" fill="${MUT}">small cards discarded</text>
        <text x="210" y="70" text-anchor="middle" font-size="12" font-weight="800" fill="${GOLD}">big cards switch sides</text>
        <defs>
          <marker id="arrA" markerWidth="9" markerHeight="9" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="${CA}"/></marker>
          <marker id="arrB" markerWidth="9" markerHeight="9" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="${CB}"/></marker>
        </defs>
      </svg>`
    },
    {
      tag: "Step 6 · Secret weapon", title: "🎭 Hidden advantage — once per game",
      text: "Once per game a team may play in secret: your numbers stay hidden from the other team, and YOU choose which of your two cards to give away (even the small one!). The round is still scored secretly by the game.",
      svg: `<svg viewBox="0 0 420 190">
        ${card(90, 90, 0, CA, {back:1})} ${card(150, 90, 0, CA, {back:1})}
        <text x="120" y="165" text-anchor="middle" font-size="18" font-weight="900" fill="${MUT}">? + ? = ??</text>
        <text x="120" y="28" text-anchor="middle" font-size="26">🎭</text>
        ${card(300, 90, 2, CA, {glow:1})}
        <path d="M330,70 q40,-20 60,5" stroke="${GOLD}" stroke-width="4" fill="none" marker-end="url(#arrG)"/>
        <text x="330" y="165" text-anchor="middle" font-size="12" font-weight="800" fill="${GOLD}">you pick the gift —</text>
        <text x="330" y="180" text-anchor="middle" font-size="12" font-weight="800" fill="${GOLD}">why not the tiny one? 😈</text>
        <defs><marker id="arrG" markerWidth="9" markerHeight="9" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="${GOLD}"/></marker></defs>
      </svg>`
    },
    {
      tag: "Step 7 · The clock", title: "12 rounds — or the clock decides",
      text: "Each player leads twice → 12 rounds total. The whole game also has a time limit. If time runs out, the game stops right there. Highest score wins; if it's a draw, the team that used LESS thinking time takes the victory. Fast and smart beats slow and perfect!",
      svg: `<svg viewBox="0 0 420 190">
        <g transform="translate(210 85)">
          <circle r="55" fill="#16203f" stroke="${GOLD}" stroke-width="5"/>
          ${[0,1,2,3,4,5,6,7,8,9,10,11].map(i=>`<line x1="0" y1="-46" x2="0" y2="-51" stroke="${MUT}" stroke-width="3" transform="rotate(${i*30})"/>`).join("")}
          <path d="M0,0 L0,-34" stroke="${CA}" stroke-width="5" stroke-linecap="round" transform="rotate(115)"/>
          <path d="M0,0 L0,-26" stroke="${CB}" stroke-width="5" stroke-linecap="round" transform="rotate(40)"/>
          <circle r="5" fill="${INK}"/>
        </g>
        <text x="70" y="50" font-size="13" font-weight="800" fill="${CA}">Team 1: 4 pts</text>
        <text x="70" y="72" font-size="13" font-weight="800" fill="${CB}">Team 2: 4 pts</text>
        <text x="70" y="100" font-size="12" font-weight="800" fill="${MUT}">draw →</text>
        <text x="290" y="50" font-size="13" font-weight="800" fill="${CA}">⏱ 3:20 used ✔</text>
        <text x="290" y="72" font-size="13" font-weight="800" fill="${CB}">⏱ 5:44 used</text>
        <text x="290" y="100" font-size="12" font-weight="800" fill="${GOLD}">faster team wins!</text>
        <text x="210" y="180" text-anchor="middle" font-size="14" font-weight="900" fill="${INK}">Good luck — have fun! 🎉</text>
      </svg>`
    },
  ];
})();
