const SHINY_ODDS = 0.10;
const EVO_FINAL_LEVEL = 32;
const STARTER_LEVEL = 6;
const TYPES = ['Fire','Water','Grass','Electric','Rock','Psychic','Dragon','Ghost'];

// simple type chart (attacker => array of types it is super-effective vs)
const TYPE_EFFECTIVENESS = {
  Fire: { strong:['Grass'], weak:['Water','Rock'] },
  Water: { strong:['Fire','Rock'], weak:['Grass','Electric'] },
  Grass: { strong:['Water','Rock'], weak:['Fire'] },
  Electric: { strong:['Water'], weak:['Ground'] }, // Ground not used but placeholder
  Rock: { strong:['Fire'], weak:['Water','Grass'] },
  Psychic: { strong:['Fighting'], weak:['Bug','Ghost'] },
  Dragon: { strong:['Dragon'], weak:[] },
  Ghost: { strong:['Psychic'], weak:[] }
};

// fixed starters (names won't change between loads)
const FIXED_STARTERS = [
  { species: 'Pyrobit', baseType: 'Fire', variant:0 },
  { species: 'Aquaffin', baseType: 'Water', variant:1 },
  { species: 'Florava', baseType: 'Grass', variant:2 }
];

// placeholder move pools (type keyed)
const MOVE_POOLS = {
  Normal: ['Chomp'],
  Fire: ['Ember Bite','Flame Poke','Singe claw'],
  Water: ['Bubble Snap','Tidal Tap','Splash Jab'],
  Grass: ['Leaf Nibble','Vine Flick','Bud Thrust'],
  Electric: ['Spark Jab','Volt Tap'],
  Rock: ['Stone Toss','Rock Spin'],
  Psychic: ['Mind Peck','Psi Flick'],
  Dragon: ['Drake Peck','Scale Rush'],
  Ghost: ['Shade Swipe','Haunt Lash']
};

// small helpers
const rnd = (arr)=>arr[Math.floor(Math.random()*arr.length)];
const randInt = (n)=>Math.floor(Math.random()*n);
const isShinyRoll = ()=> Math.random() < SHINY_ODDS;

// ---------- Three.js & Scenes ----------
let owRenderer, owScene, owCamera;
let labRenderer, labScene, labCamera;
let battleRenderer, battleScene, battleCamera;
let animationFrame = null;

// set up a renderer for a canvas id and return {renderer,scene,camera}
function createRenderer(canvasId, clearColor=0x87CEEB, heightRatio=1.0){
  const canvas = document.getElementById(canvasId);
  const renderer = new THREE.WebGLRenderer({ antialias:true, canvas: canvas });
  const w = window.innerWidth, h = Math.max(300, window.innerHeight * 0.55);
  renderer.setSize(w, h, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(clearColor);
  const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);
  camera.position.set(0, 2.3, 5);
  const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(5,10,7); scene.add(dl);
  scene.add(new THREE.AmbientLight(0xffffff,0.4));
  return { renderer, scene, camera };
}

function resizeCanvas(canvasId, renderer, camera){
  if (!renderer) return;
  const w = window.innerWidth, h = Math.max(300, window.innerHeight * 0.55);
  renderer.setSize(w, h);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
}

// tiny low-poly character (player) for overworld
function makePlayerMesh(colorHex=0x4b6cff){
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness:0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7,1.1,0.45), mat); body.position.y = 0.6; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.35,12,10), mat); head.position.y = 1.3; g.add(head);
  return g;
}

// lowpoly lab model (simple building)
function makeLabModel(){
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd6e7f5, roughness:0.8 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(4,2.2,4), mat); base.position.y = 1.1; g.add(base);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4,0.8,8), new THREE.MeshStandardMaterial({color:0xb14d4d}));
  roof.position.y = 2.2; roof.rotation.y = Math.PI/4; g.add(roof);
  return g;
}

// creature sprite-like 3D (back and front orientation handled by placement)
function makeCreatureMesh(colorHex=0xff4444, shiny=false, variant=0){
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness:0.5, metalness: shiny?0.15:0 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), mat); body.position.set(0,0,0); group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), mat); head.position.set(0,0.95,0.55); group.add(head);
  if (variant===0){
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28,0.9,10), mat); tail.position.set(-1.05,-0.15,0); tail.rotation.z = Math.PI/2; group.add(tail);
  } else if (variant===1){
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2,0.7,0.6), mat); fin.position.set(1.05,-0.15,0); fin.rotation.z = 0.45; group.add(fin);
  } else {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.22,0.6,10), mat); horn.position.set(0,1.15,0.8); group.add(horn);
  }
  if (shiny){ mat.emissive = new THREE.Color(0xfff4cc); mat.emissiveIntensity = 0.12; }
  return group;
}

// ---------- Game State ----------
let OW_PLAYER_POS = {x:0, z:0}; // simple local coords
let hasEnteredLab = false;
let playerTeam = []; // array of owned pokemon objects
let currentBattle = null;
let battleType = 'trainer'; // 'trainer' for rival, later 'wild' for wild

// Fixed starter definitions (species, type). species names stay constant
const STARTER_DEFS = [
  { species:'Pyrobit', type:'Fire', variant:0 },
  { species:'Aquaffin', type:'Water', variant:1 },
  { species:'Florava', type:'Grass', variant:2 }
];

// helper make starter instance (level 6, two moves: Chomp + type move, two locked)
function makeStarterInstance(def){
  const shiny = isShinyRoll();
  const color = new THREE.Color().setHSL(Math.random(),0.6,0.5).getHex();
  const stats = { hp: 60 + randInt(20), atk: 12 + randInt(6), def: 8 + randInt(6), spd: 8 + randInt(6) };
  // moves: slot1 Chomp, slot2 = a type move, slots 3-4 locked
  const typeMoves = MOVE_POOLS[def.type] || MOVE_POOLS['Normal'];
  const typeMove = typeMoves.length? typeMoves[0] : 'Type Hit';
  const moves = [
    { name:'Chomp', type:'Normal', pp:999 },
    { name: typeMove, type:def.type, pp:999 },
    { name:'???', type:null, locked:true },
    { name:'???', type:null, locked:true }
  ];
  return {
    species: def.species,
    nickname: def.species, // species name used as display (placeholder fixed name)
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

// ---------- Overworld init ----------
function startOverworld(){
  const out = createRenderer('owCanvas', 0x9fd8f0);
  owRenderer = out.renderer; owScene = out.scene; owCamera = out.camera;
  // ground plane
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40,40), new THREE.MeshStandardMaterial({color:0x9ad07f}));
  ground.rotation.x = -Math.PI/2; ground.position.y = -0.1; owScene.add(ground);
  // lab model
  const lab = makeLabModel(); lab.position.set(6,0,0); owScene.add(lab);
  // player
  const playerMesh = makePlayerMesh(0x355ebd); playerMesh.position.set(OW_PLAYER_POS.x,0,OW_PLAYER_POS.z); owScene.add(playerMesh);
  // simple animate
  (function loop(){
    animationFrame = requestAnimationFrame(loop);
    playerMesh.rotation.y += 0.002;
    owRenderer.render(owScene, owCamera);
  })();

  // movement & lab-enter check
  window.addEventListener('keydown', (e)=> {
    const step = 0.6;
    if (e.key === 'ArrowUp' || e.key === 'w') OW_PLAYER_POS.z -= step;
    if (e.key === 'ArrowDown' || e.key === 's') OW_PLAYER_POS.z += step;
    if (e.key === 'ArrowLeft' || e.key === 'a') OW_PLAYER_POS.x -= step;
    if (e.key === 'ArrowRight' || e.key === 'd') OW_PLAYER_POS.x += step;
    playerMesh.position.set(OW_PLAYER_POS.x,0,OW_PLAYER_POS.z);
    // lab entrance area at (6,0,0) radius 1.4
    const dx = OW_PLAYER_POS.x - 6, dz = OW_PLAYER_POS.z - 0;
    if (!hasEnteredLab && Math.sqrt(dx*dx + dz*dz) < 1.6){
      hasEnteredLab = true;
      enterLab();
    }
  });
}

// ---------- Lab & starter selection ----------
function enterLab(){
  // stop overworld rendering
  if (animationFrame) cancelAnimationFrame(animationFrame);
  document.getElementById('overworld').classList.add('hidden');
  document.getElementById('labScene').classList.remove('hidden');

  // init lab renderer & scene
  const out = createRenderer('labCanvas', 0xeef6ff);
  labRenderer = out.renderer; labScene = out.scene; labCamera = out.camera;
  labCamera.position.set(0,1.6,3.5);
  // lab interior objects (table)
  const table = new THREE.Mesh(new THREE.BoxGeometry(4,0.4,2.2), new THREE.MeshStandardMaterial({color:0x7b5a3c}));
  table.position.set(0,0.15,0); labScene.add(table);
  // professor (simple model)
  const prof = makePlayerMesh(0xa54c3a); prof.scale.set(0.9,0.9,0.9); prof.position.set(-2,0,0); labScene.add(prof);

  // render starters on table and build selection UI
  const row = document.getElementById('startersRow');
  row.innerHTML = '';
  // create three fixed starter instances (do not randomize names)
  const fixed = STARTER_DEFS;
  const starterInstances = fixed.map(def => makeStarterInstance(def));
  // store them globally so pick persists across reload?
  // we'll store to sessionStorage to keep them fixed for the session; later we can expand to localStorage
  sessionStorage.setItem('starterSet', JSON.stringify(starterInstances));

  starterInstances.forEach((st, idx)=>{
    // create card
    const card = document.createElement('div'); card.className='starterCard';
    const ccanvas = document.createElement('canvas'); ccanvas.className='starterCanvas';
    ccanvas.width = 280; ccanvas.height = 180;
    card.appendChild(ccanvas);
    const nameDiv = document.createElement('div'); nameDiv.className='starterName'; nameDiv.textContent = st.species; card.appendChild(nameDiv);
    const hint = document.createElement('div'); hint.className='smallHint'; hint.textContent = '??? (type & level hidden)'; card.appendChild(hint);
    const choose = document.createElement('button'); choose.className='starterChoose'; choose.textContent='Choose';
    choose.onclick = ()=> {
      // lock in starter, add to playerTeam, start rival battle
      playerTeam.push(st);
      // pick rival as one of remaining two, choose type advantage if possible
      const rem = starterInstances.filter((_,i)=>i!==idx);
      // pick rival that counters player type if exists
      let rivalPick = rem[0];
      // simple attempt to pick a counter by scanning type effectiveness
      for (const cand of rem){
        const base = cand.type || cand.species || 'Fire';
        // if cand is strong vs player, prefer it
        const pType = st.type;
        if (TYPE_EFFECTIVENESS[base] && TYPE_EFFECTIVENESS[base].strong && TYPE_EFFECTIVENESS[base].strong.includes(pType)){
          rivalPick = cand; break;
        }
      }
      // set rival level etc, new instance
      const rivalInstance = JSON.parse(JSON.stringify(rivalPick));
      rivalInstance.level = STARTER_LEVEL;
      rivalInstance.shiny = isShinyRoll();
      // hide lab UI and start battle
      document.getElementById('labScene').classList.add('hidden');
      startBattle(st, rivalInstance, 'trainer');
    };
    card.appendChild(choose);
    row.appendChild(card);

    // small preview render per starter card
    const pScene = new THREE.Scene();
    pScene.background = new THREE.Color(0xdef3f6);
    const pCam = new THREE.PerspectiveCamera(45, ccanvas.width/ccanvas.height, 0.1, 50);
    pCam.position.set(0,1.6,3);
    const pRend = new THREE.WebGLRenderer({ canvas: ccanvas, antialias:true });
    pRend.setSize(ccanvas.width, ccanvas.height, false);
    pScene.add(new THREE.AmbientLight(0xffffff,0.8));
    pScene.add(new THREE.DirectionalLight(0xffffff,0.7));
    const mesh = makeCreatureMesh(st.color, st.shiny, st.variant); mesh.position.set(0,0,0); pScene.add(mesh);
    (function loop(){ mesh.rotation.y += 0.01; pRend.render(pScene, pCam); requestAnimationFrame(loop); })();
  });

  // lab render loop
  (function loop(){
    animationFrame = requestAnimationFrame(loop);
    labRenderer.render(labScene, labCamera);
  })();
}

// ---------- Battle flow & UI ----------
function startBattle(playerMon, rivalMon, type='trainer'){
  battleType = type; // 'trainer' or 'wild'
  document.getElementById('battleUI').classList.remove('hidden');
  // create battle renderer
  const out = createRenderer('battleCanvas', 0xeef8ff);
  battleRenderer = out.renderer; battleScene = out.scene; battleCamera = out.camera;
  battleCamera.position.set(0,1.6,5);

  // initialize currentBattle model
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
      hp: rivalMon.stats ? rivalMon.stats.hp : (60+randInt(20)),
      maxhp: rivalMon.stats ? rivalMon.stats.hp : (60+randInt(20)),
      atk: rivalMon.stats ? rivalMon.stats.atk : (10+randInt(6)),
      def: rivalMon.stats ? rivalMon.stats.def : (8+randInt(6)),
      spd: rivalMon.stats ? rivalMon.stats.spd : (8+randInt(6)),
      megaUsed: false
    },
    turn: 'player'
  };

  // update UI name & level
  document.getElementById('playerName').textContent = currentBattle.player.pokemon.nickname || currentBattle.player.pokemon.species;
  document.getElementById('playerLevel').textContent = `Lv ${currentBattle.player.pokemon.level || STARTER_LEVEL}`;
  document.getElementById('oppName').textContent = currentBattle.rival.pokemon.nickname || currentBattle.rival.pokemon.species || 'Rival';
  document.getElementById('oppLevel').textContent = `Lv ${currentBattle.rival.pokemon.level || STARTER_LEVEL}`;

  updateHPBars();
  setupBattleScene();
  populateBattleUI();
  animateBattle();
}

// animate battle scene with player back-left and opponent front-right
let playerMesh, rivalMesh;
function setupBattleScene(){
  // clear scene
  while(battleScene.children.length>0) battleScene.remove(battleScene.children[0]);
  // ground/platform
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(14,8), new THREE.MeshStandardMaterial({color:0x7bc47f}));
  ground.rotation.x = -Math.PI/2; ground.position.y = -1.2; battleScene.add(ground);
  // small lab background props
  const bench = new THREE.Mesh(new THREE.BoxGeometry(6,0.3,1.6), new THREE.MeshStandardMaterial({color:0x8b6b4a}));
  bench.position.set(0,-0.6,-1.8); battleScene.add(bench);

  // player (back view) positioned left/back
  const pm = currentBattle.player.pokemon;
  playerMesh = makeCreatureMesh(pm.color, pm.shiny, pm.variant);
  playerMesh.position.set(-2.2, -0.2, 0.6);
  playerMesh.rotation.y = Math.PI/6; // show back/three-quarter
  battleScene.add(playerMesh);
  // opponent front-right
  const rm = currentBattle.rival.pokemon;
  rivalMesh = makeCreatureMesh(rm.color, rm.shiny, rm.variant);
  rivalMesh.position.set(2.0, -0.2, -0.2);
  rivalMesh.rotation.y = -Math.PI/3; // face player
  battleScene.add(rivalMesh);
}

// small animate loop
function animateBattle(){
  if (animationFrame) cancelAnimationFrame(animationFrame);
  const loop = ()=>{
    animationFrame = requestAnimationFrame(loop);
    if (playerMesh) playerMesh.rotation.y += 0.006;
    if (rivalMesh) rivalMesh.rotation.y -= 0.006;
    const t = Date.now()*0.002;
    if (playerMesh) playerMesh.position.y = Math.sin(t*1.5)*0.04;
    if (rivalMesh) rivalMesh.position.y = Math.sin(t*1.5+1)*0.04;
    battleRenderer.render(battleScene, battleCamera);
  };
  loop();
}

// update hp bars UI
function updateHPBars(){
  if (!currentBattle) return;
  const p = currentBattle.player, r = currentBattle.rival;
  const pPct = Math.max(0, Math.floor((p.hp / p.maxhp) *100));
  const rPct = Math.max(0, Math.floor((r.hp / r.maxhp) *100));
  document.querySelector('#playerHP .hp').style.width = `${pPct}%`;
  document.querySelector('#oppHP .hp').style.width = `${rPct}%`;
}

// UI wiring: Fight / Bag / Run / Mega
function populateBattleUI(){
  // Fight
  document.getElementById('fightBtn').onclick = ()=> {
    document.getElementById('movesPanel').classList.remove('hidden');
    document.getElementById('mainMenu').classList.add('hidden');
    renderMovesPanel();
  };
  // Bag
  document.getElementById('bagBtn').onclick = ()=> showMessage('Your bag is empty!');
  // Run
  document.getElementById('runBtn').onclick = ()=> {
    if (battleType !== 'wild'){ flashButton('runBtn'); showMessage("No running from Trainer battles!"); return; }
    showMessage('You ran away!');
    // end battle and return to lab (for demo just reload)
    setTimeout(()=> location.reload(), 800);
  };
  // Mega
  document.getElementById('megaBtn').onclick = ()=> {
    const p = currentBattle.player.pokemon;
    if (!(p.evoStage === 3 && p.level >= EVO_FINAL_LEVEL)){
      flashButton('megaBtn'); showMessage("Can't Mega Evolve yet!");
      return;
    }
    if (currentBattle.player.megaUsed){ showMessage("Mega already used this battle."); return; }
    // apply mega buffs & visual
    currentBattle.player.megaUsed = true;
    currentBattle.player.atk += 8; currentBattle.player.def += 5; currentBattle.player.spd += 4;
    showMessage(`${p.nickname || p.species} Mega Evolved!`);
    if (playerMesh){
      playerMesh.scale.set(1.28,1.28,1.28);
      playerMesh.traverse(c=>{ if (c.material){ c.material.emissive = new THREE.Color(0xfff1d0); c.material.emissiveIntensity = 0.18; }});
    }
  };

  document.getElementById('movesBack').onclick = ()=> {
    document.getElementById('movesPanel').classList.add('hidden');
    document.getElementById('mainMenu').classList.remove('hidden');
  };
}

// flash a button visually (for disallowed actions)
function flashButton(id){
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.style.transform = 'translateY(-4px)';
  btn.style.boxShadow = '0 6px 14px rgba(255,0,0,0.12)';
  setTimeout(()=>{ btn.style.transform=''; btn.style.boxShadow=''; }, 220);
}

// Moves panel rendering (4 slots; locked slots show ???)
function renderMovesPanel(){
  const grid = document.getElementById('movesGrid');
  grid.innerHTML = '';
  const pm = currentBattle.player.pokemon;
  for (let i=0;i<4;i++){
    const m = pm.moves[i] || { name:'???', locked:true };
    const btn = document.createElement('button');
    btn.className = 'moveBtn' + (m.locked ? ' locked' : '');
    btn.textContent = m.name;
    if (!m.locked){
      btn.onclick = ()=> useMove(i);
    } else {
      btn.onclick = ()=> showMessage('Move locked until learned.');
    }
    grid.appendChild(btn);
  }
}

// move effectiveness check
function effectivenessText(moveType, targetType){
  if (!moveType || !targetType) return '';
  const eff = TYPE_EFFECTIVENESS[moveType];
  if (!eff) return '';
  if (eff.strong && eff.strong.includes(targetType)) return "It's super effective!";
  if (eff.weak && eff.weak.includes(targetType)) return "It's not very effective...";
  return '';
}

// using a move
async function useMove(slotIdx){
  if (!currentBattle) return;
  const p = currentBattle.player, r = currentBattle.rival;
  const move = p.pokemon.moves[slotIdx];
  if (!move || move.locked) { showMessage('Move locked.'); return; }

  // player attack
  const base = Math.max(1, Math.floor(p.atk - r.def/2 + 2 + Math.random()*4));
  r.hp -= base;
  updateHPBars();
  let effText = effectivenessText(move.type, r.pokemon.type);
  showMessage(`${p.pokemon.nickname || p.pokemon.species} used ${move.name}! ${effText}`, 1000);
  await sleep(900);
  if (r.hp <= 0){ showMessage(`Rival's ${r.pokemon.nickname || r.pokemon.species} fainted!`); endBattle(true); return; }

  // rival turn (simple AI: prefer type move)
  const rMove = chooseRivalMove();
  const rBase = Math.max(1, Math.floor(r.atk - p.def/2 + 2 + Math.random()*4));
  p.hp -= rBase;
  let rEff = effectivenessText(rMove.type, p.pokemon.type);
  showMessage(`Rival used ${rMove.name}! ${rEff}`, 900);
  updateHPBars();
  if (p.hp <= 0){ showMessage(`${p.pokemon.nickname || p.pokemon.species} fainted!`); endBattle(false); return; }
}

// simple rival move chooser
function chooseRivalMove(){
  const rpk = currentBattle.rival.pokemon;
  // if rival has a type move at slot1/2, pick it else chomp
  for (let i=0;i<rpk.moves && i<rpk.moves.length;i++){
    const m = rpk.moves[i];
    if (m && !m.locked && m.type === rpk.type) return m;
  }
  return rpk.moves[0] || { name:'Chomp', type:'Normal' };
}

function endBattle(playerWon){
  // revert any mega visuals
  if (playerMesh){
    playerMesh.scale.set(1,1,1);
    playerMesh.traverse(c=>{ if (c.material) c.material.emissiveIntensity = 0; });
  }
  setTimeout(()=>{
    showMessage(playerWon ? "Victory! Professor congratulates you." : "You were defeated. Professor encourages you.");
    // for demo: after short delay, reload the page to return to overworld
    setTimeout(()=> location.reload(), 1400);
  }, 800);
}

function showMessage(text, timeout=1500){
  const box = document.getElementById('messageBox');
  box.text
