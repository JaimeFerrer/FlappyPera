(() => {
  "use strict";

  // ---------- Config ----------
  const LIME = "#d6ff2f";
  const LIME_DARK = "#9fd600";
  const BG_TOP = "#0a0f08";
  const BG_BOTTOM = "#05070a";
  const PEAR_BODY = "#c7e81c";
  const PEAR_BODY_DARK = "#9fbf10";
  const STEM_BROWN = "#5a3c1a";
  const LEAF_GREEN = "#4fae2e";

  const GRAVITY = 1500; // px/s^2
  const FLAP_VELOCITY = -430; // px/s
  const MAX_FALL_SPEED = 900;
  const PIPE_SPEED = 190; // px/s
  const PIPE_GAP_RATIO = 0.28; // fraction of canvas height
  const PIPE_WIDTH_RATIO = 0.14;
  const PIPE_INTERVAL = 1.45; // seconds between pipes
  const GROUND_HEIGHT_RATIO = 0.09;
  const PEAR_RADIUS_RATIO = 0.045;

  const BEST_KEY = "flappypera_best_score";
  const NAME_KEY = "flappypera_player_name";

  // ---------- Canvas setup ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const BASE_W = 480;
  const BASE_H = 720;
  let scale = 1;

  function resize() {
    const targetRatio = BASE_W / BASE_H;
    let w = window.innerWidth;
    let h = window.innerHeight;
    if (w / h > targetRatio) {
      w = h * targetRatio;
    } else {
      h = w / targetRatio;
    }
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const dpr = window.devicePixelRatio || 1;
    canvas.width = BASE_W * dpr;
    canvas.height = BASE_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scale = 1;
  }
  window.addEventListener("resize", resize);
  resize();

  const W = BASE_W;
  const H = BASE_H;
  const GROUND_Y = H * (1 - GROUND_HEIGHT_RATIO);
  const PEAR_R = H * PEAR_RADIUS_RATIO;
  const PIPE_W = W * PIPE_WIDTH_RATIO;
  const PIPE_GAP = H * PIPE_GAP_RATIO;
  const DISCO_BALL_X = W / 2;
  const DISCO_BALL_Y = 46;
  const DISCO_BALL_R = 30;
  const FLOOR_TOP = GROUND_Y - 150;

  // ---------- Audio (simple WebAudio beeps, no external files) ----------
  let audioCtx = null;
  function beep(freq, dur, type = "square", vol = 0.05) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = vol;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      osc.stop(audioCtx.currentTime + dur);
    } catch (e) {
      /* audio not available */
    }
  }
  const sfx = {
    flap: () => beep(520, 0.08, "square", 0.04),
    score: () => beep(880, 0.12, "triangle", 0.05),
    hit: () => beep(120, 0.35, "sawtooth", 0.07),
  };

  // ---------- State ----------
  const STATE = { READY: "ready", PLAYING: "playing", DEAD: "dead", RANKING: "ranking" };
  let state = STATE.READY;
  let rankingReturnState = STATE.READY;
  let readyRankingButtonRect = null;
  let deadRankingCardRect = null;

  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let score = 0;

  // ---------- Ranking global (Firebase) ----------
  let rankingEntries = [];
  let rankingLoading = false;
  function refreshRanking() {
    if (!window.Leaderboard || !window.Leaderboard.enabled) return;
    rankingLoading = true;
    window.Leaderboard.getTop(10)
      .then((list) => {
        rankingEntries = list;
        rankingLoading = false;
      })
      .catch(() => {
        rankingLoading = false;
      });
  }
  window.addEventListener("leaderboard-ready", refreshRanking);
  refreshRanking();

  function ensurePlayerNameAndSubmit(finalScore) {
    if (finalScore <= 0) return;
    if (!window.Leaderboard || !window.Leaderboard.enabled) return;
    let name = localStorage.getItem(NAME_KEY);
    if (name === null) {
      name = window.prompt(
        "¡Apúntate al ranking! ¿Cómo te llamas? (déjalo en blanco para no participar)",
        ""
      );
      name = (name || "").trim().slice(0, 16);
      localStorage.setItem(NAME_KEY, name);
    }
    if (!name) return;
    window.Leaderboard.submitScore(name, finalScore).then((changed) => {
      if (changed) refreshRanking();
    });
  }

  // Tappable preview card shown on the game-over screen: top 5 + a hint that
  // taps through to the full top-10 ranking screen.
  function drawRankingPreview(startY) {
    if (!window.Leaderboard || !window.Leaderboard.enabled) {
      deadRankingCardRect = null;
      return;
    }

    const rows = rankingEntries.length === 0 ? 1 : Math.min(5, rankingEntries.length);
    const lines = [];
    if (rankingEntries.length === 0) {
      lines.push(rankingLoading ? "Cargando..." : "¡Sé el primero!");
    } else {
      rankingEntries.slice(0, 5).forEach((entry, i) => {
        let displayName = String(entry.name || "?");
        if (displayName.length > 12) displayName = displayName.slice(0, 12) + "…";
        lines.push(`${i + 1}. ${displayName} — ${entry.score}`);
      });
    }
    const hint = "Toca para ver el Top 10 ▸";

    // Dark translucent card behind the block so it stands out from the busy background.
    ctx.save();
    ctx.font = "600 13px 'Anton', sans-serif";
    let maxTextW = ctx.measureText("🏆 RANKING").width;
    for (const line of lines) maxTextW = Math.max(maxTextW, ctx.measureText(line).width);
    ctx.font = "500 11px 'Anton', sans-serif";
    maxTextW = Math.max(maxTextW, ctx.measureText(hint).width);
    const boxW = Math.min(W - 40, maxTextW + 44);
    const boxTop = startY - 22;
    const boxH = 26 + 18 * (rows - 1) + 64;
    const boxX = W / 2 - boxW / 2;
    ctx.fillStyle = "rgba(5,7,10,0.62)";
    roundRectPath(boxX, boxTop, boxW, boxH, 12);
    ctx.fill();
    ctx.restore();
    deadRankingCardRect = { x: boxX, y: boxTop, w: boxW, h: boxH };

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "700 15px 'Anton', sans-serif";
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = "#000";
    ctx.fillStyle = LIME;
    ctx.strokeText("🏆 RANKING", W / 2, startY);
    ctx.fillText("🏆 RANKING", W / 2, startY);

    ctx.font = "600 13px 'Anton', sans-serif";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#000";
    ctx.fillStyle = "#fff";
    lines.forEach((line, i) => {
      const y = startY + 26 + i * 18;
      ctx.strokeText(line, W / 2, y);
      ctx.fillText(line, W / 2, y);
    });

    const hintY = startY + 26 + (rows - 1) * 18 + 22;
    ctx.font = "500 11px 'Anton', sans-serif";
    ctx.lineWidth = 2.5;
    const pulse = 0.55 + 0.45 * Math.sin(elapsed * 4);
    ctx.globalAlpha = pulse;
    ctx.strokeText(hint, W / 2, hintY);
    ctx.fillStyle = LIME;
    ctx.fillText(hint, W / 2, hintY);
    ctx.restore();
  }

  // Small pill button shown on the ready screen, taps through to the full ranking screen.
  function drawRankingButton(centerY) {
    if (!window.Leaderboard || !window.Leaderboard.enabled) {
      readyRankingButtonRect = null;
      return;
    }
    const label = "🏆 VER RANKING";
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "700 16px 'Anton', sans-serif";
    const textW = ctx.measureText(label).width;
    const boxW = textW + 46;
    const boxH = 38;
    const boxX = W / 2 - boxW / 2;
    const boxY = centerY - boxH / 2;
    ctx.fillStyle = "rgba(5,7,10,0.75)";
    ctx.strokeStyle = LIME;
    ctx.lineWidth = 2.5;
    roundRectPath(boxX, boxY, boxW, boxH, boxH / 2);
    ctx.fill();
    ctx.stroke();

    ctx.textBaseline = "middle";
    ctx.fillStyle = LIME;
    ctx.fillText(label, W / 2, centerY + 1);
    ctx.restore();

    readyRankingButtonRect = { x: boxX, y: boxY, w: boxW, h: boxH };
  }

  // Full-screen top-10 ranking, reached from the ready button or the game-over preview.
  function drawRankingScreen() {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.78)";
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "700 32px 'Bangers', 'Anton', sans-serif";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#000";
    ctx.fillStyle = LIME;
    ctx.strokeText("🏆 RANKING", W / 2, H * 0.16);
    ctx.fillText("🏆 RANKING", W / 2, H * 0.16);
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "600 19px 'Anton', sans-serif";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#000";
    ctx.fillStyle = "#fff";
    const listTop = H * 0.27;
    const lineH = 33;
    if (rankingEntries.length === 0) {
      const msg = rankingLoading ? "Cargando..." : "¡Sé el primero en apuntarte!";
      ctx.strokeText(msg, W / 2, listTop);
      ctx.fillText(msg, W / 2, listTop);
    } else {
      rankingEntries.slice(0, 10).forEach((entry, i) => {
        const y = listTop + i * lineH;
        let displayName = String(entry.name || "?");
        if (displayName.length > 16) displayName = displayName.slice(0, 16) + "…";
        const line = `${i + 1}. ${displayName} — ${entry.score}`;
        ctx.strokeText(line, W / 2, y);
        ctx.fillText(line, W / 2, y);
      });
    }
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "500 16px sans-serif";
    ctx.fillStyle = "#cfcfcf";
    const pulse = 0.6 + 0.4 * Math.sin(elapsed * 4);
    ctx.globalAlpha = pulse;
    ctx.fillText("Toca para volver", W / 2, H * 0.92);
    ctx.restore();
  }

  function pointInRect(x, y, r) {
    return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  function openRanking(returnState) {
    rankingReturnState = returnState;
    state = STATE.RANKING;
    refreshRanking();
  }

  const pear = {
    x: W * 0.28,
    y: H * 0.45,
    vy: 0,
    rotation: 0,
  };

  // "La Pera" — Pablo, the birthday boy, as a pear-plane (from the party flyer).
  const pearImg = new Image();
  let pearImgLoaded = false;
  pearImg.onload = () => {
    pearImgLoaded = true;
  };
  pearImg.src = "assets/pera-pablo.png";

  // Club sign hanging above the DJ booth.
  const coliseumImg = new Image();
  let coliseumLoaded = false;
  coliseumImg.onload = () => {
    coliseumLoaded = true;
  };
  coliseumImg.src = "assets/coliseum-sign.png";

  // Cheering crowd silhouette tiled along the ground.
  const groundCrowdImg = new Image();
  let groundCrowdLoaded = false;
  groundCrowdImg.src = "assets/ground-crowd.png";

  // Background party guests — friends' faces on little dancing bodies.
  const FRIEND_NAMES = [
    "Tomy",
    "Nacho",
    "Pajarillo",
    "Jaime",
    "Betato",
    "Totti",
    "Laura",
    "Jordas",
    "Carlos",
    "Canudas",
    "Fer",
    "Boix",
    "Pinero",
    "Domingo",
    "NPerez",
    "Bellostas",
    "Eloy",
    "Nico",
  ];
  const friends = FRIEND_NAMES.map((name) => {
    const img = new Image();
    const friend = { name, img, loaded: false, aspect: 0.7 };
    img.onload = () => {
      friend.loaded = true;
      friend.aspect = img.naturalWidth / img.naturalHeight;
    };
    img.src = `assets/friends/${name}.png`;
    return friend;
  });

  const SHIRT_COLORS = [
    "#ff5fa2",
    "#4fd8ff",
    "#ffd23f",
    "#a463ff",
    "#ff7a45",
    "#4fff9f",
    "#ff4d4d",
    "#3b82f6",
    "#f5f5f5",
    "#7ee81c",
    "#e94ff0",
    "#22d3c9",
  ];
  const PANTS_COLORS = [
    "#2b3a67",
    "#3d2b45",
    "#394d3a",
    "#4a2f2f",
    "#2f3e4a",
    "#43354a",
    "#1f2937",
    "#5b3a29",
    "#6b2c2c",
    "#4a3f6b",
  ];
  const SHOE_COLORS = ["#141414", "#241f1a", "#1c1c24", "#20241f", "#241416"];
  const SHIRT_ICONS = ["note", "headphones", "disco", "cassette", "bolt", "star", "vinyl", "mic"];
  const SKIN_COLOR = "#e8b48c";
  const SKIN_SHADOW = "#c98f65";
  const OUTLINE = "#161616";
  const DANCER_FADE = 0.35;
  // A "dance floor" row near the bottom, clear of the title/score text and
  // the player's fixed x position.
  const dancerSlots = [
    { xf: 0.12, yf: 0.7 },
    { xf: 0.36, yf: 0.79 },
    { xf: 0.63, yf: 0.73 },
    { xf: 0.88, yf: 0.8 },
  ].map((slot) => ({
    ...slot,
    state: "empty",
    timer: 1 + Math.random() * 5,
    friend: null,
    mode: "dance",
    phase: Math.random() * 10,
    speed: 2.2 + Math.random() * 1.4,
    scale: 0.8 + Math.random() * 0.25,
    shirtColor: SHIRT_COLORS[0],
    pantsColor: PANTS_COLORS[0],
    shoeColor: SHOE_COLORS[0],
    longSleeve: false,
    icon: null,
  }));

  function pickFriend(excludeNames) {
    const pool = friends.filter((f) => !excludeNames.includes(f.name));
    const list = pool.length ? pool : friends;
    return list[Math.floor(Math.random() * list.length)];
  }

  function updateDancers(dt) {
    const active = dancerSlots.filter((s) => s.state !== "empty" && s.friend).map((s) => s.friend.name);
    for (const slot of dancerSlots) {
      slot.timer -= dt;
      if (slot.timer > 0) continue;
      if (slot.state === "empty") {
        slot.friend = pickFriend(active);
        slot.mode = Math.random() < 0.5 ? "dance" : "wave";
        slot.phase = Math.random() * 10;
        slot.speed = 2.2 + Math.random() * 1.4;
        slot.scale = 0.85 + Math.random() * 0.3;
        slot.shirtColor = SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)];
        slot.pantsColor = PANTS_COLORS[Math.floor(Math.random() * PANTS_COLORS.length)];
        slot.shoeColor = SHOE_COLORS[Math.floor(Math.random() * SHOE_COLORS.length)];
        slot.longSleeve = Math.random() < 0.4;
        slot.icon = Math.random() < 0.5 ? null : SHIRT_ICONS[Math.floor(Math.random() * SHIRT_ICONS.length)];
        slot.state = "in";
        slot.timer = DANCER_FADE;
      } else if (slot.state === "in") {
        slot.state = "active";
        slot.timer = 3 + Math.random() * 3;
      } else if (slot.state === "active") {
        slot.state = "out";
        slot.timer = DANCER_FADE;
      } else if (slot.state === "out") {
        slot.state = "empty";
        slot.friend = null;
        slot.timer = 1.5 + Math.random() * 3;
      }
    }
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Filled + outlined rounded rect (shirt, pants) — comic-style silhouette.
  function drawBlock(x, y, w, h, r, fillColor) {
    roundRectPath(x, y, w, h, r);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }

  // Outlined capsule limb: thick dark stroke underneath, colored stroke on top.
  function drawLimb(x1, y1, x2, y2, width, color) {
    ctx.lineCap = "round";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = width + 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawBlob(cx, cy, r, fillColor) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }

  function lerpPoint(x1, y1, x2, y2, frac) {
    return { x: x1 + (x2 - x1) * frac, y: y1 + (y2 - y1) * frac };
  }

  // Tiny doodle-style prints for shirts, drawn centered at the origin
  // within roughly an `s`-wide box, always in a single dark ink color.
  const SHIRT_ICON_DRAWERS = {
    note(s) {
      ctx.fillStyle = OUTLINE;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = s * 0.08;
      ctx.lineCap = "round";
      ctx.save();
      ctx.translate(-s * 0.15, s * 0.32);
      ctx.rotate(-0.3);
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.16, s * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(s * 0.0, s * 0.28);
      ctx.lineTo(s * 0.18, -s * 0.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.18, -s * 0.4);
      ctx.quadraticCurveTo(s * 0.42, -s * 0.3, s * 0.28, -s * 0.05);
      ctx.stroke();
    },
    headphones(s) {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = s * 0.09;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.32, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(-s * 0.32, s * 0.08, s * 0.09, s * 0.14, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(s * 0.32, s * 0.08, s * 0.09, s * 0.14, 0, 0, Math.PI * 2);
      ctx.stroke();
    },
    disco(s) {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = s * 0.06;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.34, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-s * 0.34, i * s * 0.17);
        ctx.lineTo(s * 0.34, i * s * 0.17);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.34);
      ctx.lineTo(0, s * 0.34);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.34);
      ctx.lineTo(0, -s * 0.5);
      ctx.stroke();
    },
    cassette(s) {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = s * 0.06;
      roundRectPath(-s * 0.38, -s * 0.26, s * 0.76, s * 0.52, s * 0.08);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-s * 0.16, 0, s * 0.11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.16, 0, s * 0.11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, s * 0.14);
      ctx.lineTo(s * 0.3, s * 0.14);
      ctx.stroke();
    },
    bolt(s) {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = s * 0.06;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(s * 0.06, -s * 0.42);
      ctx.lineTo(-s * 0.2, s * 0.02);
      ctx.lineTo(s * 0.02, s * 0.02);
      ctx.lineTo(-s * 0.08, s * 0.42);
      ctx.lineTo(s * 0.24, -s * 0.08);
      ctx.lineTo(s * 0.02, -s * 0.08);
      ctx.closePath();
      ctx.stroke();
    },
    star(s) {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = s * 0.06;
      ctx.lineJoin = "round";
      const spikes = 5;
      const outerR = s * 0.36;
      const innerR = s * 0.15;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const a = (Math.PI / spikes) * i - Math.PI / 2;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    },
    vinyl(s) {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = s * 0.05;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = OUTLINE;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.06, 0, Math.PI * 2);
      ctx.fill();
    },
    mic(s) {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = s * 0.07;
      ctx.lineCap = "round";
      roundRectPath(-s * 0.13, -s * 0.4, s * 0.26, s * 0.4, s * 0.13);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -s * 0.02, s * 0.24, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, s * 0.22);
      ctx.lineTo(0, s * 0.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.14, s * 0.4);
      ctx.lineTo(s * 0.14, s * 0.4);
      ctx.stroke();
    },
  };

  function drawShirtIcon(name, cx, cy, size) {
    const drawer = SHIRT_ICON_DRAWERS[name];
    if (!drawer) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha *= 0.85;
    drawer(size);
    ctx.restore();
  }

  function drawDancer(slot) {
    if (slot.state === "empty" || !slot.friend || !slot.friend.loaded) return;
    let alpha = 1;
    if (slot.state === "in") alpha = 1 - slot.timer / DANCER_FADE;
    else if (slot.state === "out") alpha = slot.timer / DANCER_FADE;
    alpha = Math.max(0, Math.min(1, alpha));
    if (alpha <= 0) return;

    const HW = 40 * slot.scale;
    const headH = HW / slot.friend.aspect;
    const bodyW = HW * 1.1;
    const bodyH = HW * 1.35;
    const legLen = HW * 1.35;
    const armLen = HW * 1.05;
    const armW = HW * 0.34;
    const legW = HW * 0.4;
    const t = elapsed * slot.speed + slot.phase;
    const isDance = slot.mode === "dance";

    // Big, energetic dance bounce vs. a gentler wave sway.
    const bounce = isDance ? Math.abs(Math.sin(t * 2)) * HW * 0.32 : Math.sin(t * 1.6) * HW * 0.06;
    const hipSway = isDance ? Math.sin(t * 2) * HW * 0.22 : Math.sin(t * 1.6) * HW * 0.08;
    const bodyTilt = isDance ? Math.sin(t * 2 + 0.4) * 0.16 : Math.sin(t * 1.6) * 0.06;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(slot.xf * W + hipSway, slot.yf * H - bounce);
    ctx.rotate(bodyTilt);

    // legs (pants), from hip to shoe
    const hipY = bodyH;
    let leftFootX, rightFootX, leftFootY, rightFootY;
    if (isDance) {
      leftFootX = -HW * 0.4 + Math.sin(t * 2) * HW * 0.32;
      rightFootX = HW * 0.4 + Math.sin(t * 2 + Math.PI) * HW * 0.32;
      leftFootY = hipY + legLen - Math.max(0, Math.sin(t * 2 + Math.PI)) * HW * 0.32;
      rightFootY = hipY + legLen - Math.max(0, Math.sin(t * 2)) * HW * 0.32;
    } else {
      leftFootX = -HW * 0.28 + Math.sin(t * 1.6) * HW * 0.06;
      rightFootX = HW * 0.28 - Math.sin(t * 1.6) * HW * 0.06;
      leftFootY = hipY + legLen;
      rightFootY = hipY + legLen;
    }
    drawLimb(-HW * 0.16, hipY, leftFootX, leftFootY, legW, slot.pantsColor);
    drawLimb(HW * 0.16, hipY, rightFootX, rightFootY, legW, slot.pantsColor);
    drawBlob(leftFootX, leftFootY, legW * 0.55, slot.shoeColor);
    drawBlob(rightFootX, rightFootY, legW * 0.55, slot.shoeColor);

    // shirt (torso)
    drawBlock(-bodyW / 2, 0, bodyW, bodyH, bodyW * 0.32, slot.shirtColor);
    if (slot.icon) drawShirtIcon(slot.icon, 0, bodyH * 0.42, bodyW * 0.62);

    // arms (skin), from shoulder to hand
    let leftArmAngle, rightArmAngle;
    if (isDance) {
      leftArmAngle = Math.PI * 0.5 + Math.sin(t * 2) * 1.3;
      rightArmAngle = Math.PI * 0.5 + Math.sin(t * 2 + Math.PI) * 1.3;
    } else {
      leftArmAngle = 0.2 + Math.sin(t * 1.6) * 0.15;
      rightArmAngle = Math.PI * 0.82 + Math.sin(t * 5) * 0.4;
    }
    const leftShoulder = { x: -bodyW / 2 + HW * 0.05, y: HW * 0.15 };
    const rightShoulder = { x: bodyW / 2 - HW * 0.05, y: HW * 0.15 };
    const leftHand = {
      x: leftShoulder.x - armLen * Math.sin(leftArmAngle),
      y: leftShoulder.y + armLen * Math.cos(leftArmAngle),
    };
    const rightHand = {
      x: rightShoulder.x + armLen * Math.sin(rightArmAngle),
      y: rightShoulder.y + armLen * Math.cos(rightArmAngle),
    };
    if (slot.longSleeve) {
      const leftElbow = lerpPoint(leftShoulder.x, leftShoulder.y, leftHand.x, leftHand.y, 0.5);
      const rightElbow = lerpPoint(rightShoulder.x, rightShoulder.y, rightHand.x, rightHand.y, 0.5);
      drawLimb(leftShoulder.x, leftShoulder.y, leftElbow.x, leftElbow.y, armW, slot.shirtColor);
      drawLimb(leftElbow.x, leftElbow.y, leftHand.x, leftHand.y, armW * 0.88, SKIN_COLOR);
      drawLimb(rightShoulder.x, rightShoulder.y, rightElbow.x, rightElbow.y, armW, slot.shirtColor);
      drawLimb(rightElbow.x, rightElbow.y, rightHand.x, rightHand.y, armW * 0.88, SKIN_COLOR);
    } else {
      drawLimb(leftShoulder.x, leftShoulder.y, leftHand.x, leftHand.y, armW, SKIN_COLOR);
      drawLimb(rightShoulder.x, rightShoulder.y, rightHand.x, rightHand.y, armW, SKIN_COLOR);
    }
    drawBlob(leftHand.x, leftHand.y, armW * 0.62, SKIN_SHADOW);
    drawBlob(rightHand.x, rightHand.y, armW * 0.62, SKIN_SHADOW);

    // neck, so the head doesn't float above the shirt collar
    drawBlock(-HW * 0.16, -HW * 0.1, HW * 0.32, HW * 0.25, HW * 0.08, SKIN_COLOR);

    // head
    const headBob = isDance ? Math.sin(t * 2) * HW * 0.06 : Math.sin(t * 1.6) * HW * 0.03;
    ctx.drawImage(slot.friend.img, -HW / 2, -headH + headBob, HW, headH);

    ctx.restore();
  }

  function drawDancers() {
    for (const slot of dancerSlots) drawDancer(slot);
  }

  // A packed crowd of generic silhouettes filling the dance floor, so the
  // named friends look like they're popping out from among a full club.
  const CROWD_COLOR_BACK = "#2a2038";
  const CROWD_COLOR_FRONT = "#160f21";
  const crowdFigures = [];
  for (let i = 0; i < 30; i++) {
    crowdFigures.push({
      x: Math.random() * W,
      yf: 0.02 + Math.random() * 0.42,
      scale: 0.48 + Math.random() * 0.22,
      color: CROWD_COLOR_BACK,
      armsUp: Math.random() < 0.4,
      phase: Math.random() * 10,
      speed: 0.9 + Math.random() * 1.1,
      swayAmt: 0.07 + Math.random() * 0.07,
    });
  }
  for (let i = 0; i < 22; i++) {
    crowdFigures.push({
      x: Math.random() * W,
      yf: 0.4 + Math.random() * 0.55,
      scale: 0.72 + Math.random() * 0.3,
      color: CROWD_COLOR_FRONT,
      armsUp: Math.random() < 0.4,
      phase: Math.random() * 10,
      speed: 0.9 + Math.random() * 1.1,
      swayAmt: 0.09 + Math.random() * 0.09,
    });
  }

  function drawSilhouette(x, y, scale, color, armsUp, sway) {
    const HW = 15 * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(sway);
    ctx.fillStyle = color;

    // head
    ctx.beginPath();
    ctx.arc(0, -HW * 2.6, HW * 0.9, 0, Math.PI * 2);
    ctx.fill();

    // torso tapering into two legs
    ctx.beginPath();
    ctx.moveTo(-HW * 0.9, -HW * 1.7);
    ctx.lineTo(HW * 0.9, -HW * 1.7);
    ctx.lineTo(HW * 0.5, -HW * 0.2);
    ctx.lineTo(HW * 0.85, HW * 1.8);
    ctx.lineTo(HW * 0.25, HW * 1.8);
    ctx.lineTo(HW * 0.15, -HW * 0.1);
    ctx.lineTo(-HW * 0.15, -HW * 0.1);
    ctx.lineTo(-HW * 0.25, HW * 1.8);
    ctx.lineTo(-HW * 0.85, HW * 1.8);
    ctx.lineTo(-HW * 0.5, -HW * 0.2);
    ctx.closePath();
    ctx.fill();

    // arms
    ctx.strokeStyle = color;
    ctx.lineWidth = HW * 0.45;
    ctx.lineCap = "round";
    ctx.beginPath();
    if (armsUp) {
      ctx.moveTo(-HW * 0.8, -HW * 1.5);
      ctx.lineTo(-HW * 1.3, -HW * 3.3);
      ctx.moveTo(HW * 0.8, -HW * 1.5);
      ctx.lineTo(HW * 1.3, -HW * 3.3);
    } else {
      ctx.moveTo(-HW * 0.8, -HW * 1.5);
      ctx.lineTo(-HW * 1.4, -HW * 0.2);
      ctx.moveTo(HW * 0.8, -HW * 1.5);
      ctx.lineTo(HW * 1.5, -HW * 0.7);
    }
    ctx.stroke();

    ctx.restore();
  }

  function drawCrowd() {
    for (const f of crowdFigures) {
      const y = FLOOR_TOP + f.yf * (GROUND_Y - FLOOR_TOP);
      const sway = Math.sin(elapsed * f.speed + f.phase) * f.swayAmt;
      drawSilhouette(f.x, y, f.scale, f.color, f.armsUp, sway);
    }
  }

  // A little DJ booth at the back of the floor, with a big rave-style
  // "TEKNO" sign hanging above it.
  const DJ_CX = W / 2;
  const STAGE_TOP = FLOOR_TOP - 8;
  const BOOTH_W = 128;
  const BOOTH_H = 58;
  const BOOTH_Y = STAGE_TOP - BOOTH_H + 6;

  function drawDjBooth() {
    ctx.fillStyle = "#0f0a18";
    ctx.strokeStyle = LIME;
    ctx.lineWidth = 3;

    // stage platform
    roundRectPath(DJ_CX - 118, STAGE_TOP, 236, 20, 6);
    ctx.fill();
    ctx.stroke();

    // booth
    roundRectPath(DJ_CX - BOOTH_W / 2, BOOTH_Y, BOOTH_W, BOOTH_H, 7);
    ctx.fill();
    ctx.stroke();

    // mixer top edge + knobs
    ctx.strokeStyle = "rgba(214,255,47,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(DJ_CX - BOOTH_W / 2 + 8, BOOTH_Y + BOOTH_H * 0.28);
    ctx.lineTo(DJ_CX + BOOTH_W / 2 - 8, BOOTH_Y + BOOTH_H * 0.28);
    ctx.stroke();
    const pulse = Math.abs(Math.sin(elapsed * 6));
    ctx.fillStyle = `rgba(214,255,47,${(0.55 + pulse * 0.35).toFixed(2)})`;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(DJ_CX + i * 26, BOOTH_Y + BOOTH_H * 0.64, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    drawDjSilhouette(DJ_CX, BOOTH_Y);
    // Sits right under the score, so only show it once the score does —
    // on the ready screen that spot is taken by the title.
    if (state !== STATE.READY) drawColiseumSign(DJ_CX, 222);
  }

  // DJ icon pose: leaning over the decks, one arm working the turntable,
  // the other thrown up in the air — flat shapes in the game's own colors.
  // A limb with a bright rim so it still reads against the black sky —
  // thicker lime stroke underneath, dark body-colored stroke on top.
  function djLimb(x1, y1, x2, y2, width) {
    ctx.lineCap = "round";
    ctx.strokeStyle = LIME;
    ctx.lineWidth = width + 3;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = "#241934";
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawDjSilhouette(x, boothTopY) {
    const HW = 27;
    const bob = Math.sin(elapsed * 3) * 2;
    const bodyColor = "#241934";
    ctx.save();
    ctx.translate(x, boothTopY + bob);
    ctx.rotate(-0.08);

    // arm down on the decks — bent at the elbow, mixing pose
    const djShoulder = { x: -HW * 0.5, y: -HW * 1.05 };
    const djElbow = { x: -HW * 0.98, y: -HW * 0.48 };
    const djHand = { x: -HW * 0.32, y: HW * 0.02 };
    djLimb(djShoulder.x, djShoulder.y, djElbow.x, djElbow.y, HW * 0.4);
    djLimb(djElbow.x, djElbow.y, djHand.x, djHand.y, HW * 0.38);
    ctx.fillStyle = LIME;
    ctx.beginPath();
    ctx.arc(djHand.x, djHand.y, HW * 0.2, 0, Math.PI * 2);
    ctx.fill();

    // arm thrown up, pumping a little
    const pump = Math.sin(elapsed * 4) * 0.08;
    djLimb(HW * 0.48, -HW * 1.2, HW * 1.55 + pump * 16, -HW * 2.8 - pump * 12, HW * 0.4);

    // Body as one continuous silhouette (torso + head), not a rect stacked
    // on a circle: stroke both shapes first, then fill both on top so each
    // fill swallows the other shape's stroke where they overlap, leaving
    // only the true outer outline visible. Torso is slim and its bottom
    // edge sits flush with the table instead of sinking into it.
    const headCy = -HW * 2.05;
    const torsoW = HW * 1.1;
    const torsoH = HW * 1.6;
    const torsoX = -torsoW / 2;
    const torsoY = -torsoH;
    const torsoR = HW * 0.52;

    ctx.strokeStyle = LIME;
    ctx.lineWidth = 3;
    roundRectPath(torsoX, torsoY, torsoW, torsoH, torsoR);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, headCy, HW * 0.95, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = bodyColor;
    roundRectPath(torsoX, torsoY, torsoW, torsoH, torsoR);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, headCy, HW * 0.95, 0, Math.PI * 2);
    ctx.fill();

    // headphones: a band over the head plus rounded ear cups
    ctx.strokeStyle = LIME;
    ctx.lineWidth = HW * 0.28;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, headCy + HW * 0.05, HW * 1.1, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.fillStyle = LIME;
    ctx.beginPath();
    ctx.arc(-HW * 1.02, headCy + HW * 0.18, HW * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(HW * 1.02, headCy + HW * 0.18, HW * 0.26, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // "Coliseum" club sign, hanging above the booth with a pulsing glow like
  // it's lit up by neon/spotlights.
  function drawColiseumSign(cx, bottomY) {
    if (!coliseumLoaded) return;
    const w = 170;
    const h = w / (coliseumImg.naturalWidth / coliseumImg.naturalHeight);
    const cy = bottomY - h / 2;

    const glowPulse = 0.5 + 0.5 * Math.sin(elapsed * 2.2);
    const sway = Math.sin(elapsed * 1.5) * 0.03;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sway);

    ctx.shadowColor = "rgba(255,255,255,0.95)";
    ctx.shadowBlur = 10 + glowPulse * 18;
    ctx.drawImage(coliseumImg, -w / 2, -h / 2, w, h);

    ctx.shadowColor = "rgba(79,255,153,0.85)";
    ctx.shadowBlur = 20 + glowPulse * 24;
    ctx.drawImage(coliseumImg, -w / 2, -h / 2, w, h);

    ctx.restore();
  }

  let pipes = []; // {x, gapY, passed}
  let timeSincePipe = 0;
  let groundOffset = 0;
  let elapsed = 0;

  // Disco ball / background particles (decorative)
  const stars = Array.from({ length: 40 }, () => ({
    x: Math.random() * W,
    y: Math.random() * GROUND_Y,
    r: Math.random() * 1.6 + 0.4,
    twinkle: Math.random() * Math.PI * 2,
  }));

  function resetGame() {
    pear.y = H * 0.45;
    pear.vy = 0;
    pear.rotation = 0;
    pipes = [];
    timeSincePipe = 0;
    score = 0;
    elapsed = 0;
  }

  function spawnPipe() {
    const margin = 60;
    const minGapY = margin + PIPE_GAP / 2;
    const maxGapY = GROUND_Y - margin - PIPE_GAP / 2;
    const gapY = minGapY + Math.random() * (maxGapY - minGapY);
    pipes.push({ x: W + PIPE_W, gapY, passed: false });
  }

  function flap() {
    if (state === STATE.READY || state === STATE.DEAD) {
      state = STATE.PLAYING;
      resetGame();
      pear.vy = FLAP_VELOCITY;
      sfx.flap();
    } else if (state === STATE.PLAYING) {
      pear.vy = FLAP_VELOCITY;
      sfx.flap();
    }
  }

  // ---------- Input ----------
  function getLogicalCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  }

  function onInput(e) {
    if (e) e.preventDefault();
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();

    if (state === STATE.RANKING) {
      state = rankingReturnState;
      return;
    }

    if (e && e.clientX !== undefined) {
      const { x, y } = getLogicalCoords(e);
      if (state === STATE.READY && pointInRect(x, y, readyRankingButtonRect)) {
        openRanking(STATE.READY);
        return;
      }
      if (state === STATE.DEAD && pointInRect(x, y, deadRankingCardRect)) {
        openRanking(STATE.DEAD);
        return;
      }
    }

    flap();
  }
  canvas.addEventListener("pointerdown", onInput);
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp") onInput(e);
  });

  // ---------- Drawing ----------
  function drawBackground(dt) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, BG_TOP);
    grad.addColorStop(1, BG_BOTTOM);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // twinkling stars / disco specks
    for (const s of stars) {
      s.twinkle += dt * 2;
      const alpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(s.twinkle));
      ctx.fillStyle = `rgba(214,255,47,${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    drawDanceFloor();
    drawDjBooth();
    drawCrowd();

    // disco ball centered on the ceiling, beaming light down over the floor
    drawDiscoLights(DISCO_BALL_X, DISCO_BALL_Y, elapsed);
    drawDiscoBall(DISCO_BALL_X, DISCO_BALL_Y, DISCO_BALL_R, elapsed);

    drawDancers();
  }

  // A dance floor band just above the game's own ground, so the background
  // dancers read as standing on something instead of floating in the sky.
  function drawDanceFloor() {
    const floorTop = FLOOR_TOP;
    const tile = 40;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, floorTop, W, GROUND_Y - floorTop);
    ctx.clip();

    const grad = ctx.createLinearGradient(0, floorTop, 0, GROUND_Y);
    grad.addColorStop(0, "#150a20");
    grad.addColorStop(1, "#241338");
    ctx.fillStyle = grad;
    ctx.fillRect(0, floorTop, W, GROUND_Y - floorTop);

    ctx.fillStyle = "rgba(255,255,255,0.05)";
    for (let gx = groundOffset - tile * 2; gx < W; gx += tile) {
      for (let gy = floorTop; gy < GROUND_Y; gy += tile) {
        const col = Math.round(gx / tile) + Math.round((gy - floorTop) / tile);
        if (col % 2 === 0) ctx.fillRect(gx, gy, tile, tile);
      }
    }

    ctx.strokeStyle = "rgba(214,255,47,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, floorTop);
    ctx.lineTo(W, floorTop);
    ctx.stroke();

    ctx.restore();
  }

  // Colored beams radiating from the disco ball, like light bouncing off it.
  function drawDiscoLights(cx, cy, t) {
    const colors = ["#4fd8ff", "#ff5fa2", "#ffd23f"];
    const rayCount = 9;
    const rotation = t * 0.15;
    const len = Math.max(W, H) * 0.85;
    const spread = 0.05;
    ctx.save();
    for (let i = 0; i < rayCount; i++) {
      const angle = (i / rayCount) * Math.PI * 2 + rotation;
      const color = colors[i % colors.length];
      const x1 = cx + Math.cos(angle - spread) * len;
      const y1 = cy + Math.sin(angle - spread) * len;
      const x2 = cx + Math.cos(angle + spread) * len;
      const y2 = cy + Math.sin(angle + spread) * len;
      const grad = ctx.createLinearGradient(cx, cy, (x1 + x2) / 2, (y1 + y2) / 2);
      grad.addColorStop(0, color + "5c");
      grad.addColorStop(1, color + "00");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawDiscoBall(cx, cy, r, t) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.6);
    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.5, "#cfcfcf");
    grad.addColorStop(1, "#8a8a8a");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-r, i * (r / 4));
      ctx.lineTo(r, i * (r / 4));
      ctx.stroke();
    }
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.abs(r * Math.cos((i * Math.PI) / 8)) || 0.1, r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    // hanging line
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, cy - r);
    ctx.stroke();
  }

  // The ground itself is the real cheering-crowd artwork, tiled edge to
  // edge and scrolling — no separate boundary line drawn on top.
  const GROUND_CROWD_H = 62;
  let groundCrowdW = 0;
  groundCrowdImg.onload = () => {
    groundCrowdLoaded = true;
    groundCrowdW = GROUND_CROWD_H * (groundCrowdImg.naturalWidth / groundCrowdImg.naturalHeight);
  };

  // The crowd scrolls slower than the speakers/pipes — its own pace, own
  // accumulator, not tied to PIPE_SPEED.
  const GROUND_CROWD_SPEED = 70;
  let groundCrowdOffset = 0;

  function drawGround(dt) {
    groundOffset -= PIPE_SPEED * dt;
    if (groundOffset < -40) groundOffset += 40;
    groundCrowdOffset += GROUND_CROWD_SPEED * dt;

    // Same black as the crowd artwork itself, so the ground below it
    // doesn't show as a different-colored strip under the silhouette.
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

    drawGroundCrowd();
  }

  // Tiles overlap by this much so the same-silhouette repeat blends into
  // itself instead of reading as a hard seam where one copy ends.
  const GROUND_CROWD_OVERLAP = 26;

  function drawGroundCrowd() {
    if (!groundCrowdLoaded || groundCrowdW <= 0) return;
    const y = GROUND_Y - GROUND_CROWD_H;
    const stride = Math.round(groundCrowdW) - GROUND_CROWD_OVERLAP;
    const offset = ((groundCrowdOffset % stride) + stride) % stride;
    ctx.save();
    ctx.shadowColor = "rgba(214,255,47,0.95)";
    ctx.shadowBlur = 4;
    for (let x = Math.round(-offset - stride); x < W; x += stride) {
      ctx.drawImage(groundCrowdImg, x, y, Math.round(groundCrowdW), GROUND_CROWD_H);
    }
    ctx.restore();

    // The artwork's own bottom edge is almost a straight line, so the glow
    // above bleeds into a stray lime underline there — paint it back over
    // in the same black as the ground so only the jagged top silhouette
    // (heads/arms) keeps its outline.
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, GROUND_Y - 3, W, H - GROUND_Y + 3);
  }

  // Speaker cabinet, tiled to fit any obstacle length — same footprint and
  // colors as the old plain pipe, just drawn as stacked PA speakers.
  // `kick` (0-1) is the current beat pulse, used to bump the cone size and
  // spawn an expanding sound-wave ring so the stack reads as blasting music.
  function drawSpeakerCabinet(x, y, w, h, kick) {
    ctx.fillStyle = "#0f1a0a";
    ctx.strokeStyle = LIME;
    ctx.lineWidth = 3;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    if (h <= 0) return;

    const unit = 95;
    const count = Math.max(1, Math.round(h / unit));
    const unitH = h / count;
    for (let i = 0; i < count; i++) {
      const uy = y + i * unitH;
      if (i > 0) {
        ctx.beginPath();
        ctx.moveTo(x, uy);
        ctx.lineTo(x + w, uy);
        ctx.strokeStyle = "rgba(214,255,47,0.55)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      const cx = x + w / 2;
      const cy = uy + unitH / 2;
      const rOuter = Math.min(w * 0.42, unitH * 0.38) * (1 + kick * 0.14);

      // expanding sound-wave ring, looping continuously off the beat
      const ringT = (elapsed * 1.3 + ((uy * 7) % 100) * 0.01) % 1;
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter * (1 + ringT * 1.7), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(214,255,47,${(0.4 * (1 - ringT)).toFixed(2)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // woofer
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
      ctx.fillStyle = "#05070a";
      ctx.fill();
      ctx.strokeStyle = LIME;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter * 0.55, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(214,255,47,0.65)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = LIME;
      ctx.fill();

      // corner bolts
      const bx = w * 0.3;
      const by = rOuter + 8;
      ctx.fillStyle = "rgba(214,255,47,0.7)";
      for (const dx of [-bx, bx]) {
        for (const dy of [-by, by]) {
          const py = cy + dy;
          if (py > uy + 4 && py < uy + unitH - 4) {
            ctx.beginPath();
            ctx.arc(cx + dx, py, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  }

  function drawSpeakerCap(x, y, w, h, kick) {
    ctx.fillStyle = "#0f1a0a";
    ctx.strokeStyle = LIME;
    ctx.lineWidth = 3;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);

    const dots = 5;
    const margin = w * 0.15;
    const usable = w - margin * 2;
    ctx.fillStyle = "rgba(214,255,47,0.7)";
    for (let i = 0; i < dots; i++) {
      const dx = x + margin + (usable * i) / (dots - 1);
      ctx.beginPath();
      ctx.arc(dx, y + h / 2, 2 + kick * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // One cabinet + its cap, rattled together on the beat like it's blasting
  // music at full volume. Purely visual — the collision rects never move.
  function drawSpeakerStack(cabX, cabY, cabW, cabH, capX, capY, capW, capH, kick, seed) {
    const shakeX = Math.sin(elapsed * 42 + seed) * 1.6 * kick;
    const shakeY = Math.cos(elapsed * 35 + seed * 1.3) * 1.1 * kick;
    ctx.save();
    ctx.translate(shakeX, shakeY);
    drawSpeakerCabinet(cabX, cabY, cabW, cabH, kick);
    drawSpeakerCap(capX, capY, capW, capH, kick);
    ctx.restore();
  }

  function drawPipe(pipe) {
    const topH = pipe.gapY - PIPE_GAP / 2;
    const bottomY = pipe.gapY + PIPE_GAP / 2;
    const bottomH = GROUND_Y - bottomY;
    const capH = 22;
    const kick = Math.pow(Math.abs(Math.sin(elapsed * 6)), 4);

    // top speaker stack
    drawSpeakerStack(pipe.x, 0, PIPE_W, topH, pipe.x - 5, topH - capH, PIPE_W + 10, capH, kick, pipe.gapY);

    // bottom speaker stack
    drawSpeakerStack(pipe.x, bottomY, PIPE_W, bottomH, pipe.x - 5, bottomY, PIPE_W + 10, capH, kick, pipe.gapY + 37);
  }

  function drawPear() {
    ctx.save();
    ctx.translate(pear.x, pear.y);
    ctx.rotate(pear.rotation);
    if (pearImgLoaded) {
      const targetH = PEAR_R * 3.1;
      const targetW = targetH * (pearImg.naturalWidth / pearImg.naturalHeight);
      ctx.drawImage(pearImg, -targetW / 2, -targetH / 2, targetW, targetH);
    } else {
      drawPearPlaceholder();
    }
    ctx.restore();
  }

  // Fallback placeholder, used only if the real sprite fails to load.
  // Assumes the caller has already translated/rotated into pear space.
  function drawPearPlaceholder() {
    const r = PEAR_R;

    // leaf
    ctx.fillStyle = LEAF_GREEN;
    ctx.beginPath();
    ctx.ellipse(-r * 0.1, -r * 1.55, r * 0.5, r * 0.22, -0.5, 0, Math.PI * 2);
    ctx.fill();

    // stem
    ctx.strokeStyle = STEM_BROWN;
    ctx.lineWidth = r * 0.18;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.3);
    ctx.lineTo(r * 0.15, -r * 1.6);
    ctx.stroke();

    // pear body (two stacked circles for classic pear silhouette)
    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r * 1.4);
    grad.addColorStop(0, PEAR_BODY);
    grad.addColorStop(1, PEAR_BODY_DARK);
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.arc(0, -r * 0.35, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, r * 0.35, r * 1.05, 0, Math.PI * 2);
    ctx.fill();

    // outline
    ctx.strokeStyle = "#3f4f08";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -r * 0.35, r * 0.7, Math.PI, Math.PI * 2);
    ctx.moveTo(-r * 1.05, r * 0.35);
    ctx.arc(0, r * 0.35, r * 1.05, Math.PI * 0.15, Math.PI * 0.85, false);
    ctx.stroke();

    // face (cartoon placeholder)
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(-r * 0.28, r * 0.1, r * 0.1, 0, Math.PI * 2);
    ctx.arc(r * 0.28, r * 0.1, r * 0.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = r * 0.09;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, r * 0.35, r * 0.35, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  // ---------- Text helpers ----------
  function drawTitleText() {
    ctx.textAlign = "center";
    ctx.save();
    ctx.font = "700 42px 'Bangers', 'Anton', sans-serif";
    ctx.fillStyle = "#000";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#000";
    const title1 = "FLAPPY";
    const title2 = "PERA";
    ctx.strokeText(title1, W / 2 + 2, H * 0.22 + 2);
    ctx.fillStyle = LIME;
    ctx.fillText(title1, W / 2, H * 0.22);

    ctx.font = "700 64px 'Bangers', 'Anton', sans-serif";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 7;
    ctx.strokeText(title2, W / 2, H * 0.22 + 58);
    ctx.fillStyle = "#fff";
    ctx.fillText(title2, W / 2, H * 0.22 + 58);
    ctx.restore();
  }

  function drawReadyOverlay() {
    drawTitleText();
    ctx.save();
    ctx.font = "600 23px 'Anton', sans-serif";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    const pulse = 0.6 + 0.4 * Math.sin(elapsed * 4);
    ctx.globalAlpha = pulse;
    ctx.fillText("TOCA O PULSA ESPACIO PARA VOLAR", W / 2, H * 0.62);
    ctx.restore();

    drawRankingButton(H * 0.79);

    if (best > 0) {
      ctx.save();
      ctx.font = "700 17px 'Anton', sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#000";
      ctx.strokeText(`Mejor puntuación: ${best}`, W / 2, H * 0.87);
      ctx.fillStyle = "#fff";
      ctx.fillText(`Mejor puntuación: ${best}`, W / 2, H * 0.87);
      ctx.restore();
    }
  }

  function drawScore() {
    ctx.save();
    ctx.font = "700 40px 'Anton', sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#000";
    ctx.strokeText(String(score), W / 2, 130);
    ctx.fillStyle = "#fff";
    ctx.fillText(String(score), W / 2, 130);
    ctx.restore();
  }

  function drawGameOver() {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "700 40px 'Bangers', 'Anton', sans-serif";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 6;
    ctx.strokeText("¡PLOF!", W / 2, H * 0.38);
    ctx.fillStyle = LIME;
    ctx.fillText("¡PLOF!", W / 2, H * 0.38);

    ctx.font = "600 20px 'Anton', sans-serif";
    ctx.fillStyle = "#fff";
    ctx.fillText(`Puntuación: ${score}`, W / 2, H * 0.46);
    ctx.fillStyle = LIME;
    ctx.fillText(`Mejor: ${best}`, W / 2, H * 0.51);

    ctx.font = "500 16px sans-serif";
    ctx.fillStyle = "#cfcfcf";
    const pulse = 0.6 + 0.4 * Math.sin(elapsed * 4);
    ctx.globalAlpha = pulse;
    ctx.fillText("Toca para volver a intentarlo", W / 2, H * 0.58);
    ctx.restore();

    drawRankingPreview(H * 0.63);
  }

  // ---------- Update ----------
  function circleRectCollide(cx, cy, r, rx, ry, rw, rh) {
    const closestX = Math.max(rx, Math.min(cx, rx + rw));
    const closestY = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy < r * r;
  }

  function updatePlaying(dt) {
    elapsed += dt;

    pear.vy += GRAVITY * dt;
    if (pear.vy > MAX_FALL_SPEED) pear.vy = MAX_FALL_SPEED;
    pear.y += pear.vy * dt;

    const targetRot = Math.max(-0.5, Math.min(1.1, pear.vy / 500));
    pear.rotation += (targetRot - pear.rotation) * Math.min(1, dt * 10);

    timeSincePipe += dt;
    if (timeSincePipe >= PIPE_INTERVAL) {
      timeSincePipe = 0;
      spawnPipe();
    }

    for (const pipe of pipes) {
      pipe.x -= PIPE_SPEED * dt;
      if (!pipe.passed && pipe.x + PIPE_W < pear.x - PEAR_R) {
        pipe.passed = true;
        score++;
        sfx.score();
      }
    }
    pipes = pipes.filter((p) => p.x > -PIPE_W - 10);

    // collisions
    let dead = false;
    if (pear.y + PEAR_R >= GROUND_Y || pear.y - PEAR_R <= 0) {
      dead = true;
    }
    for (const pipe of pipes) {
      const topH = pipe.gapY - PIPE_GAP / 2;
      const bottomY = pipe.gapY + PIPE_GAP / 2;
      if (
        circleRectCollide(pear.x, pear.y, PEAR_R * 0.85, pipe.x, 0, PIPE_W, topH) ||
        circleRectCollide(pear.x, pear.y, PEAR_R * 0.85, pipe.x, bottomY, PIPE_W, GROUND_Y - bottomY)
      ) {
        dead = true;
      }
    }

    if (dead) {
      state = STATE.DEAD;
      sfx.hit();
      if (score > best) {
        best = score;
        localStorage.setItem(BEST_KEY, String(best));
      }
      ensurePlayerNameAndSubmit(score);
    }
  }

  // ---------- Main loop ----------
  let lastTime = null;
  function loop(ts) {
    if (lastTime === null) lastTime = ts;
    let dt = (ts - lastTime) / 1000;
    dt = Math.min(dt, 0.035);
    lastTime = ts;

    updateDancers(dt);

    if (state === STATE.READY) {
      elapsed += dt;
      pear.y = H * 0.45 + Math.sin(elapsed * 3) * 10;
      pear.rotation = Math.sin(elapsed * 3) * 0.08;
    } else if (state === STATE.PLAYING) {
      updatePlaying(dt);
    }

    drawBackground(dt);
    for (const pipe of pipes) drawPipe(pipe);
    drawGround(dt);
    drawPear();

    if (state === STATE.READY) {
      drawReadyOverlay();
    } else if (state === STATE.PLAYING) {
      drawScore();
    } else if (state === STATE.DEAD) {
      drawScore();
      drawGameOver();
    } else if (state === STATE.RANKING) {
      drawRankingScreen();
    }

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
