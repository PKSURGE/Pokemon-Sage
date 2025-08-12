const SHINY_ODDS = 0.10;
const EVO_FINAL_LEVEL = 32;
const STARTER_LEVEL = 6;

// simple type chart (for messages only)
const TYPE_EFFECTIVENESS = {
  Fire: { strong: ['Grass'], weak: ['Water', 'Rock'] },
  Water: { strong: ['Fire', 'Rock'], weak: ['Grass', 'Electric'] },
  Grass: { strong: ['Water', 'Rock'], weak: ['Fire'] },
  Electric: { strong: ['Water'], weak: ['Ground'] },
  Rock: { strong: ['Fire'], weak: ['Water', 'Grass'] },
  Psychic: { strong: ['Fighting'], weak: ['Bug', 'Ghost'] },
  Dragon: { strong: ['Dragon'], weak: [] },
  Ghost: { strong: ['Psychic'], weak: [] },
  Normal: { strong: [], weak: [] }
};

// fixed starter definitions
const STARTER_DEFS = [
  { species: 'Pyrobit', type: 'Fire', variant: 0 },
  { species: 'Aquaffin', type: 'Water', variant: 1 },
  { species: 'Florava', type: 'Grass', variant: 2 }
];

// small move pools
const MOVE_POOLS = {
  Normal: ['Chomp'],
  Fire: ['Ember Bite', 'Flame Poke'],
  Water: ['Bubble Snap', 'Tidal Tap'],
  Grass: ['Leaf Nibble', 'Vine Flick'],
  Electric: ['Spark Jab'],
  Rock: ['Stone Toss']
};

// small helpers
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (n) => Math.floor(Math.random() * n);
const isShinyRoll = () => Math.random() < SHINY_ODDS;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ---------------------- THREE.js RENDERERS ----------------------
let labRenderer, labScene, labCamera;
let battleRenderer, battleScene, battleCamera;
let labAnim = null;
let battleAnim = null;

function createRendererForCanvas(canvasId, bg = 0xeef6ff) {
  const canvas = document.getElementById(canvasId);
  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: canvas });
  const w = window.innerWidth;
  const h = Math.max(300, window.innerHeight * 0.55);
  renderer.setSize(w, h, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg);
  const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);
  camera.position.set(0, 2.3, 5);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dl = new THREE.DirectionalLight(0xffffff, 0.9);
  dl.position.set(4, 8, 6);
  scene.add(dl);
  return { renderer, scene, camera };
}

// ---------------------- LOWPOLY MODELS ----------------------
function makePlayerPlaceholder(colorHex = 0x4b6cff) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.45), mat);
  body.position.y = 0.6;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), mat);
  head.position.y = 1.3;
  g.add(head);
  return g;
}

function makeCreaturePlaceholder(colorHex = 0xff4444, shiny = false, variant = 0) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.5, metalness: shiny ? 0.12 : 0 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), mat);
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), mat);
  head.position.set(0, 0.95, 0.55);
  g.add(head);
  if (variant === 0) {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 10), mat);
    tail.position.set(-1.05, -0.15, 0);
    tail.rotation.z = Math.PI / 2;
    g.add(tail);
  } else if (variant === 1) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.6), mat);
    fin.position.set(1.05, -0.15, 0);
    fin.rotation.z = 0.45;
    g.add(fin);
  } else {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 10), mat);
    horn.position.set(0, 1.15, 0.8);
    g.add(horn);
  }
  if (shiny) {
    mat.emissive = new THREE.Color(0xfff4cc);
    mat.emissiveIntensity = 0.12;
  }
  return g;
}

// ---------------------- GAME STATE ----------------------
let playerParty = []; // start empty
let currentBattle = null;
let battleType = 'trainer'; // 'trainer' or 'wild'

// create a starter instance
function makeStarter(def) {
  const shiny = isShinyRoll();
  const color = new THREE.Color().setHSL(Math.random(), 0.6, 0.5).getHex();
  const stats = { hp: 60 + randInt(20), atk: 12 + randInt(6), def: 8 + randInt(6), spd: 8 + randInt(6) };
  const pool = MOVE_POOLS[def.type] || MOVE_POOLS['Normal'];
  const typeMove = pool[0] || 'Type Hit';
  const moves = [
    { name: 'Chomp', type: 'Normal', locked: false },
    { name: typeMove, type: def.type, locked: false },
    { name: '???', type: null, locked: true },
    { name: '???', type: null, locked: true }
  ];
  return {
    species: def.species,
    nickname: def.species,
    type: def.type,
    variant: def.variant,
    shiny,
    color,
    stats,
    level: STARTER_LEVEL,
    evoStage: 1,
    moves
  };
}

// ---------------------- UI UTIL ----------------------
function showElement(id) { document.getElementById(id).classList.remove('hidden'); }
function hideElement(id) { document.getElementById(id).classList.add('hidden'); }
function setText(id, text) { const e = document.getElementById(id); if (e) e.textContent = text; }
function showMessage(msg, timeout = 1600) {
  const box = document.getElementById('messageBox');
  box.textContent = msg;
  box.classList.remove('hidden');
  if (timeout > 0) setTimeout(() => box.classList.add('hidden'), timeout);
}

// ---------------------- STARTER FLOW ----------------------
function openLabUI() {
  hideElement('overworld');
  showElement('labScene');

  // setup renderer for lab preview
  const out = createRendererForCanvas('labCanvas', 0xeef6ff);
  labRenderer = out.renderer; labScene = out.scene; labCamera = out.camera;
  labCamera.position.set(0, 1.6, 3.5);

  // simple table
  const table = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 2.0), new THREE.MeshStandardMaterial({ color: 0x7b5a3c }));
  table.position.set(0, 0.15, 0);
  labScene.add(table);

  // professor (placeholder)
  const prof = makePlayerPlaceholder(0xa54c3a);
  prof.position.set(-2, 0, 0);
  labScene.add(prof);

  // create starter cards
  const row = document.getElementById('startersRow');
  row.innerHTML = '';
  const starters = STARTER_DEFS.map((d) => makeStarter(d));

  starters.forEach((st, idx) => {
    // HTML card
    const card = document.createElement('div');
    card.className = 'starterCard';
    const ccanvas = document.createElement('canvas');
    ccanvas.className = 'starterCanvas';
    ccanvas.width = 280; ccanvas.height = 180;
    card.appendChild(ccanvas);
    const nameDiv = document.createElement('div');
    nameDiv.className = 'starterName';
    nameDiv.textContent = st.species;
    card.appendChild(nameDiv);
    const hint = document.createElement('div');
    hint.className = 'smallHint';
    hint.textContent = '??? (type & level hidden)';
    card.appendChild(hint);
    const choose = document.createElement('button');
    choose.className = 'starterChoose';
    choose.textContent = 'Choose';
    choose.onclick = () => {
      // lock in starter
      playerParty.push(st);
      // pick rival from remaining starters (prefer counter)
      const remaining = starters.filter((_, i) => i !== idx);
      let rivalPick = remaining[0];
      for (const c of remaining) {
        if (TYPE_EFFECTIVENESS[c.type] && TYPE_EFFECTIVENESS[c.type].strong.includes(st.type)) {
          rivalPick = c;
          break;
        }
      }
      rivalPick = JSON.parse(JSON.stringify(rivalPick)); // clone
      rivalPick.level = STARTER_LEVEL;
      rivalPick.shiny = isShinyRoll();
      // go battle
      hideElement('labScene');
      startBattle(st, rivalPick, 'trainer');
    };
    card.appendChild(choose);
    row.appendChild(card);

    // small card preview (tiny scene)
    const pScene = new THREE.Scene();
    pScene.background = new THREE.Color(0xdef3f6);
    const pCam = new THREE.PerspectiveCamera(45, ccanvas.width / ccanvas.height, 0.1, 50);
    pCam.position.set(0, 1.6, 3);
    const pRend = new THREE.WebGLRenderer({ canvas: ccanvas, antialias: true });
    pRend.setSize(ccanvas.width, ccanvas.height, false);
    pScene.add(new THREE.AmbientLight(0xffffff, 0.8));
    pScene.add(new THREE.DirectionalLight(0xffffff, 0.7));
    const mesh = makeCreaturePlaceholder(st.color, st.shiny, st.variant);
    pScene.add(mesh);
    (function loop() { mesh.rotation.y += 0.01; pRend.render(pScene, pCam); requestAnimationFrame(loop); })();
  });

  // lab loop
  (function labLoop() {
    labAnim = requestAnimationFrame(labLoop);
    labRenderer.render(labScene, labCamera);
  })();
}

// ---------------------- BATTLE SYSTEM ----------------------
function startBattle(playerMon, rivalMon, type = 'trainer') {
  battleType = type;
  showElement('battleUI');

  const out = createRendererForCanvas('battleCanvas', 0xeef8ff);
  battleRenderer = out.renderer; battleScene = out.scene; battleCamera = out.camera;
  battleCamera.position.set(0, 1.6, 5);

  currentBattle = {
    player: {
      pokemon: playerMon,
      hp: playerMon.stats.hp,
      maxhp: playerMon.stats.hp,
      atk: playerMon.stats.atk,
      def: playerMon.stats.def,
      spd: playerMon.stats.spd,
      megaUsed: false
    },
    rival: {
      pokemon: rivalMon,
      hp: rivalMon.stats ? rivalMon.stats.hp : 60 + randInt(20),
      maxhp: rivalMon.stats ? rivalMon.stats.hp : 60 + randInt(20),
      atk: rivalMon.stats ? rivalMon.stats.atk : 10 + randInt(6),
      def: rivalMon.stats ? rivalMon.stats.def : 8 + randInt(6),
      spd: rivalMon.stats ? rivalMon.stats.spd : 8 + randInt(6),
      megaUsed: false
    },
    turn: 'player'
  };

  // UI update
  setText('playerName', currentBattle.player.pokemon.nickname || currentBattle.player.pokemon.species);
  setText('playerLevel', `Lv ${currentBattle.player.pokemon.level || STARTER_LEVEL}`);
  setText('oppName', currentBattle.rival.pokemon.nickname || currentBattle.rival.pokemon.species || 'Rival');
  setText('oppLevel', `Lv ${currentBattle.rival.pokemon.level || STARTER_LEVEL}`);
  updateHPBars();

  setupBattleScene();
  wireBattleUI();
  animateBattle();
}

let playerMesh = null;
let rivalMesh = null;

function setupBattleScene() {
  // clear
  while (battleScene.children.length) battleScene.remove(battleScene.children[0]);

  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshStandardMaterial({ color: 0x7bc47f }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.2;
  battleScene.add(ground);

  // bench / lab props
  const bench = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 1.6), new THREE.MeshStandardMaterial({ color: 0x8b6b4a }));
  bench.position.set(0, -0.6, -1.8);
  battleScene.add(bench);

  // player mesh (back-left)
  const pm = currentBattle.player.pokemon;
  playerMesh = makeCreaturePlaceholder(pm.color, pm.shiny, pm.variant);
  playerMesh.position.set(-2.2, -0.2, 0.6);
  playerMesh.rotation.y = Math.PI / 6;
  battleScene.add(playerMesh);

  // rival mesh (front-right)
  const rm = currentBattle.rival.pokemon;
  rivalMesh = makeCreaturePlaceholder(rm.color, rm.shiny, rm.variant);
  rivalMesh.position.set(2.0, -0.2, -0.2);
  rivalMesh.rotation.y = -Math.PI / 3;
  battleScene.add(rivalMesh);
}

function animateBattle() {
  if (battleAnim) cancelAnimationFrame(battleAnim);
  const loop = () => {
    battleAnim = requestAnimationFrame(loop);
    if (playerMesh) playerMesh.rotation.y += 0.006;
    if (rivalMesh) rivalMesh.rotation.y -= 0.006;
    const t = Date.now() * 0.002;
    if (playerMesh) playerMesh.position.y = Math.sin(t * 1.5) * 0.04;
    if (rivalMesh) rivalMesh.position.y = Math.sin(t * 1.5 + 1) * 0.04;
    battleRenderer.render(battleScene, battleCamera);
  };
  loop();
}

function updateHPBars() {
  if (!currentBattle) return;
  const p = currentBattle.player, r = currentBattle.rival;
  const pPct = Math.max(0, Math.floor((p.hp / p.maxhp) * 100));
  const rPct = Math.max(0, Math.floor((r.hp / r.maxhp) * 100));
  const pbar = document.querySelector('#playerHP .hp');
  const rbar = document.querySelector('#oppHP .hp');
  if (pbar) pbar.style.width = `${pPct}%`;
  if (rbar) rbar.style.width = `${rPct}%`;
}

// ---------------------- BATTLE UI & LOGIC ----------------------
function wireBattleUI() {
  // Fight
  document.getElementById('fightBtn').onclick = () => {
    showElement('movesPanel');
    hideElement('mainMenu');
    renderMovesPanel();
  };

  // Bag
  document.getElementById('bagBtn').onclick = () => {
    showMessage('Your bag is empty!');
  };

  // Run
  document.getElementById('runBtn').onclick = () => {
    if (battleType !== 'wild') {
      flashButton('runBtn');
      showMessage("No running from Trainer battles!");
      return;
    }
    showMessage('You ran away!');
    setTimeout(() => window.location.reload(), 800);
  };

  // Mega
  document.getElementById('megaBtn').onclick = () => {
    const p = currentBattle.player.pokemon;
    if (!(p.evoStage === 3 && p.level >= EVO_FINAL_LEVEL)) {
      flashButton('megaBtn');
      showMessage("Can't Mega Evolve yet!");
      return;
    }
    if (currentBattle.player.megaUsed) {
      showMessage('Mega already used this battle.');
      return;
    }
    currentBattle.player.megaUsed = true;
    currentBattle.player.atk += 8;
    currentBattle.player.def += 5;
    currentBattle.player.spd += 4;
    showMessage(`${p.nickname || p.species} Mega Evolved!`);
    if (playerMesh) {
      playerMesh.scale.set(1.28, 1.28, 1.28);
      playerMesh.traverse((c) => { if (c.material) { c.material.emissive = new THREE.Color(0xfff1d0); c.material.emissiveIntensity = 0.18; } });
    }
  };

  // moves back
  document.getElementById('movesBack').onclick = () => {
    hideElement('movesPanel');
    showElement('mainMenu');
  };
}

// flash button animation
function flashButton(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.transform = 'translateY(-6px)';
  el.style.boxShadow = '0 8px 20px rgba(255,0,0,0.12)';
  setTimeout(() => { el.style.transform = ''; el.style.boxShadow = ''; }, 240);
}

// Moves panel
function renderMovesPanel() {
  const grid = document.getElementById('movesGrid');
  grid.innerHTML = '';
  const pm = currentBattle.player.pokemon;
  for (let i = 0; i < 4; i++) {
    const m = pm.moves[i] || { name: '???', locked: true };
    const btn = document.createElement('button');
    btn.className = 'moveBtn' + (m.locked ? ' locked' : '');
    btn.textContent = m.name;
    if (!m.locked) {
      btn.onclick = () => playerUseMove(i);
    } else {
      btn.onclick = () => showMessage('Move locked until learned.');
    }
    grid.appendChild(btn);
  }
}

// simple effectiveness text
function effectivenessText(moveType, targetType) {
  if (!moveType || !targetType) return '';
  const eff = TYPE_EFFECTIVENESS[moveType] || { strong: [], weak: [] };
  if (eff.strong.includes(targetType)) return "It's super effective!";
  if (eff.weak.includes(targetType)) return "It's not very effective...";
  return '';
}

// player uses a move
async function playerUseMove(slot) {
  if (!currentBattle) return;
  const P = currentBattle.player, R = currentBattle.rival;
  const move = P.pokemon.moves[slot];
  if (!move || move.locked) { showMessage('Move locked.'); return; }

  // simple damage calc
  const damage = Math.max(1, Math.floor(P.atk - (R.def / 2) + 2 + Math.random() * 4));
  R.hp -= damage;
  updateHPBars();
  showMessage(`${P.pokemon.nickname || P.pokemon.species} used ${move.name}! ${effectivenessText(move.type, R.pokemon.type)}`, 1000);
  await sleep(900);
  if (R.hp <= 0) { showMessage(`Rival's ${R.pokemon.nickname || R.pokemon.species} fainted!`); endBattle(true); return; }

  // rival turn
  const rivalMove = chooseRivalMove();
  const rDamage = Math.max(1, Math.floor(R.atk - (P.def / 2) + 2 + Math.random() * 4));
  P.hp -= rDamage;
  updateHPBars();
  showMessage(`Rival used ${rivalMove.name}! ${effectivenessText(rivalMove.type, P.pokemon.type)}`, 900);
  if (P.hp <= 0) { showMessage(`${P.pokemon.nickname || P.pokemon.species} fainted!`); endBattle(false); return; }
}

// simple rival AI move chooser
function chooseRivalMove() {
  const rpk = currentBattle.rival.pokemon;
  if (!rpk.moves) return { name: 'Chomp', type: 'Normal' };
  for (const m of rpk.moves) {
    if (m && !m.locked && m.type === rpk.type) return m;
  }
  return rpk.moves[0] || { name: 'Chomp', type: 'Normal' };
}

function endBattle(playerWon) {
  // revert megaviz
  if (playerMesh) {
    playerMesh.scale.set(1, 1, 1);
    playerMesh.traverse((c) => { if (c.material) c.material.emissiveIntensity = 0; });
  }
  setTimeout(() => {
    showMessage(playerWon ? 'Victory! Professor congratulates you.' : 'You were defeated. Professor encourages you.');
    setTimeout(() => window.location.reload(), 1200);
  }, 700);
}

// ---------------------- BOOT / BINDINGS ----------------------
document.addEventListener('DOMContentLoaded', () => {
  // simple overworld renderer (background only) - reuse lab renderer for simplicity
  const out = createRendererForCanvas('owCanvas', 0x9fd8f0);
  labRenderer = out.renderer; labScene = out.scene; labCamera = out.camera;
  labCamera.position.set(0, 2.3, 5);

  // add ground and lab model
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x9ad07f }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.1;
  labScene.add(ground);
  // lab building (small)
  const building = new THREE.Mesh(new THREE.BoxGeometry(4, 2.2, 4), new THREE.MeshStandardMaterial({ color: 0xd6e7f5 }));
  building.position.set(6, 1.1, 0);
  labScene.add(building);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 0.8, 8), new THREE.MeshStandardMaterial({ color: 0xb14d4d }));
  roof.position.set(6, 2.2, 0);
  labScene.add(roof);

  // small player preview
  const player = makePlayerPlaceholder(0x355ebd);
  player.position.set(0, 0, 0);
  labScene.add(player);

  (function loop() { requestAnimationFrame(loop); player.rotation.y += 0.002; labRenderer.render(labScene, labCamera); })();

  document.getElementById('enterLabBtn').onclick = () => openLabUI();
  document.getElementById('backToTown').onclick = () => { hideElement('labScene'); showElement('overworld'); };

  // hide/disable template panels initially
  hideElement('labScene'); hideElement('battleUI'); hideElement('movesPanel');
});
