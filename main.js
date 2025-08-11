const TYPES = ['Fire','Water','Grass','Electric','Rock','Psychic','Dragon','Ghost'];
const rnd = (arr)=>arr[Math.floor(Math.random()*arr.length)];
const randInt = (n)=>Math.floor(Math.random()*n);
const shinyChance = ()=> (Math.random() < 0.1); // 1 in 10

// Starter evolution config
const EVO_FINAL_LEVEL = 32; // final evo reached at level 32
// Basic stat generator (balanced)
function makeBaseStats(){ return {hp: 60 + randInt(20), atk: 10 + randInt(6), def: 8 + randInt(6), spd: 8 + randInt(6)}; }

// ------ Three.js Scene Setup (reusable) ------
let renderer, scene, camera;
function initThree(canvasId){
  const canvas = document.getElementById(canvasId);
  if (renderer && renderer.domElement && renderer.domElement.parentNode) {
    renderer.dispose();
    renderer.domElement.remove();
  }
  renderer = new THREE.WebGLRenderer({ antialias:true, canvas: canvas });
  const w = window.innerWidth, h = Math.max(300, window.innerHeight * 0.55);
  renderer.setSize(w, h, false);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);
  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
  camera.position.set(0, 2.5, 6);
  // lights
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(5,10,7);
  scene.add(dir);
  scene.add(new THREE.AmbientLight(0xffffff,0.4));
  window.addEventListener('resize', onResize);
}
function onResize(){
  const canvas = document.getElementById('gameCanvas');
  if (!renderer) return;
  const w = window.innerWidth, h = Math.max(300, window.innerHeight * 0.55);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// quick lowpoly "ORAS-inspired" creature: nicer proportions than cube
function makeCreatureMesh(colorHex=0xff0000, shiny=false, variant=0){
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness:0.6, metalness: shiny ? 0.15 : 0 });
  // body
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.95, 18, 16), mat);
  body.position.set(0,0,0);
  group.add(body);
  // head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 12), mat);
  head.position.set(0,0.95,0.55);
  group.add(head);
  // small limbs/fin/horn by variant
  if (variant===0){
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28,0.9,10), mat);
    tail.position.set(-1.05, -0.15, 0);
    tail.rotation.z = Math.PI/2;
    group.add(tail);
  } else if (variant===1){
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2,0.7,0.6), mat);
    fin.position.set(1.05, -0.15, 0);
    fin.rotation.z = 0.45;
    group.add(fin);
  } else {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.22,0.6,10), mat);
    horn.position.set(0,1.15,0.8);
    group.add(horn);
  }
  // shiny tint
  if (shiny){ mat.emissive = new THREE.Color(0xfff4cc); mat.emissiveIntensity = 0.12; }
  return group;
}

// ------ Game State ------
let starters = [];
let player = null;
let rival = null;
let currentBattle = null;
let animationId = null;

// Generate 3 random original starters (level 6, evoStage 1)
function genStarters(){
  const namePool = ['Nyari','Vokku','Trelli','Pryce','Lomix','Asera','Bruni','Zevo','Maru','Kori','Salla','Fen'];
  const pickNames = [];
  for(let i=0;i<3;i++){
    const idx = Math.floor(Math.random()*namePool.length);
    pickNames.push(namePool.splice(idx,1)[0]);
  }
  starters = pickNames.map((nm,i)=>{
    const type = rnd(TYPES);
    const shiny = shinyChance();
    const color = new THREE.Color().setHSL(Math.random(),0.6,0.5).getHex();
    const stats = makeBaseStats();
    return {
      id: i,
      name: nm,
      type,
      shiny,
      color,
      stats,
      level: 6,
      evoStage: 1, // base
      mesh: null,
      variant: i % 3
    };
  });
}

// helper to pick rival starter (choose one of remaining starters)
function chooseRivalStarter(playerIndex){
  const ids = starters.map(s=>s.id).filter(id=>id!==playerIndex);
  const pick = ids[Math.floor(Math.random()*ids.length)];
  // deep clone base starter but adjust name & possible shiny
  const base = JSON.parse(JSON.stringify(starters.find(s=>s.id===pick)));
  // rival gets its own shiny roll
  base.shiny = shinyChance();
  base.name = 'Rivalon'; // rival name
  base.level = 6;
  base.mesh = null;
  return base;
}

// ------ Start / Select / UI flow ------
document.addEventListener('DOMContentLoaded', ()=>{
  initThree('gameCanvas');
  onResize();
  const startBtn = document.getElementById('startButton');
  startBtn.onclick = ()=>{
    genStarters();
    showSelectUI();
    renderStarterRow();
  };
});

// render the starter cards
function renderStarterRow(){
  const row = document.getElementById('startersRow');
  row.innerHTML = '';
  starters.forEach((st, idx)=>{
    const card = document.createElement('div'); card.className='starterCard';
    const ccanvas = document.createElement('canvas'); ccanvas.className='starterCanvas';
    ccanvas.width = 320; ccanvas.height = 180;
    card.appendChild(ccanvas);
    const nm = document.createElement('div'); nm.className='starterName'; nm.textContent = st.name; card.appendChild(nm);
    const hint = document.createElement('div'); hint.className='smallHint'; hint.textContent = '??? (type & level hidden)'; card.appendChild(hint);
    const choose = document.createElement('button'); choose.textContent = 'Choose'; choose.style.marginTop='8px';
    choose.onclick = ()=> pickStarter(idx);
    card.appendChild(choose);
    row.appendChild(card);

    // small preview scene per card
    const pScene = new THREE.Scene();
    pScene.background = new THREE.Color(0xdef3f6);
    const pCamera = new THREE.PerspectiveCamera(45, ccanvas.width/ccanvas.height, 0.1, 50);
    pCamera.position.set(0,1.6,3);
    const pRenderer = new THREE.WebGLRenderer({ canvas: ccanvas, antialias:true });
    pRenderer.setSize(ccanvas.width, ccanvas.height, false);
    pRenderer.setPixelRatio(window.devicePixelRatio);
    pScene.add(new THREE.AmbientLight(0xffffff,0.8));
    const dl = new THREE.DirectionalLight(0xffffff,0.6); dl.position.set(3,5,2); pScene.add(dl);
    const mesh = makeCreatureMesh(st.color, st.shiny, st.variant); mesh.position.set(0,0,0);
    pScene.add(mesh);
    (function anim(){ mesh.rotation.y += 0.01; pRenderer.render(pScene, pCamera); requestAnimationFrame(anim); })();
  });
}

// when player picks starter
function pickStarter(idx){
  player = JSON.parse(JSON.stringify(starters[idx])); // clone
  player.mesh = null; // will create fresh mesh in battle scene
  // reveal chosen info (name + level)
  showMessage(`You chose ${player.name}! Lv ${player.level} ${player.shiny ? '✨' : ''}`, 1400);
  // choose rival from other starters
  rival = chooseRivalStarter(idx);
  // start battle
  startBattle(player, rival);
}

// ------ Battle system ------
function startBattle(playerMon, rivalMon){
  currentBattle = {
    player: { pokemon: playerMon, hp: playerMon.stats.hp, maxhp: playerMon.stats.hp, atk:playerMon.stats.atk, def:playerMon.stats.def, spd:playerMon.stats.spd, megaUsed:false },
    rival: { pokemon: rivalMon, hp: rivalMon.stats.hp, maxhp:rivalMon.stats.hp, atk:rivalMon.stats.atk, def:rivalMon.stats.def, spd:rivalMon.stats.spd, megaUsed:false },
    turn: 'player'
  };
  // update UI
  document.getElementById('playerName').textContent = `${playerMon.name}`;
  document.getElementById('playerLevel').textContent = `Lv ${playerMon.level}`;
  document.getElementById('rivalName').textContent = `${rivalMon.name}`;
  document.getElementById('rivalLevel').textContent = `Lv ${rivalMon.level}`;
  updateHPBars();
  showBattleUI();
  renderBattleScene(playerMon, rivalMon);
  populateMoves();
}

function calcDamage(attacker, defender){
  const base = Math.max(1, Math.floor(attacker.atk - defender.def/2 + 2 + Math.random()*4));
  return base;
}

async function doPlayerMove(moveIdx){
  if (!currentBattle) return;
  if (currentBattle.player.hp <=0 || currentBattle.rival.hp <=0) return;
  const dmg = calcDamage(currentBattle.player, currentBattle.rival);
  currentBattle.rival.hp -= dmg;
  showMessage(`${currentBattle.player.pokemon.name} used Move ${moveIdx+1} — did ${dmg} damage!`);
  updateHPBars();
  await sleep(700);
  if (currentBattle.rival.hp <=0){
    showMessage(`Rival's ${currentBattle.rival.pokemon.name} fainted! You win!`);
    endBattle(true);
    return;
  }
  // rival turn
  const rdmg = calcDamage(currentBattle.rival, currentBattle.player);
  currentBattle.player.hp -= rdmg;
  showMessage(`Rival's ${currentBattle.rival.pokemon.name} hit for ${rdmg} damage!`);
  updateHPBars();
  if (currentBattle.player.hp <=0){
    showMessage(`${currentBattle.player.pokemon.name} fainted! You lost...`);
    endBattle(false);
  }
}

// Mega: only allowed if pokemon is final evo AND level >= EVO_FINAL_LEVEL
function playerMega(){
  if (!currentBattle) return;
  const pk = currentBattle.player.pokemon;
  if (currentBattle.player.megaUsed){ showMessage("Mega already used this battle."); return; }
  if (!(pk.evoStage === 3 && pk.level >= EVO_FINAL_LEVEL)){ showMessage("This Pokémon cannot Mega Evolve (not final stage or level too low)."); return; }
  currentBattle.player.megaUsed = true;
  currentBattle.player.atk += 8;
  currentBattle.player.def += 5;
  currentBattle.player.spd += 4;
  showMessage(`${pk.name} Mega Evolved!`);
  // visual effect: scale and tint
  const mesh = player.mesh;
  if (mesh){
    mesh.scale.set(1.28,1.28,1.28);
    mesh.traverse((c)=>{ if (c.material){ c.material.emissive = new THREE.Color(0xfff1d0); c.material.emissiveIntensity = 0.18; }});
  }
}

function endBattle(playerWon){
  const mesh = player.mesh;
  if (mesh){
    mesh.scale.set(1,1,1);
    mesh.traverse((c)=>{ if (c.material) c.material.emissiveIntensity = 0; });
  }
  setTimeout(()=>{
    showMessage(playerWon ? "Victory! Well done." : "You were defeated.");
    setTimeout(()=>{ location.reload(); }, 1400);
  }, 600);
}

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function updateHPBars(){
  if (!currentBattle) return;
  const p = currentBattle.player, r = currentBattle.rival;
  const pPct = Math.max(0, Math.floor((p.hp / p.maxhp) *100));
  const rPct = Math.max(0, Math.floor((r.hp / r.maxhp) *100));
  document.querySelector('#playerHP .hp').style.width = `${pPct}%`;
  document.querySelector('#rivalHP .hp').style.width = `${rPct}%`;
}

function showMessage(txt, timeout=1800){
  const box = document.getElementById('messageBox');
  box.textContent = txt; box.classList.remove('hidden');
  if (timeout>0) setTimeout(()=>box.classList.add('hidden'), timeout);
}
function showBattleUI(){ document.getElementById('battleUI').classList.remove('hidden'); document.getElementById('selectScreen').classList.add('hidden'); document.getElementById('startScreen').classList.add('hidden'); }
function showSelectUI(){ document.getElementById('selectScreen').classList.remove('hidden'); document.getElementById('startScreen').classList.add('hidden'); }

// Fill moves & action buttons
function populateMoves(){
  const container = document.getElementById('movesGrid');
  container.innerHTML = '';
  for(let i=0;i<4;i++){
    const btn = document.createElement('button');
    btn.className = 'moveBtn';
    btn.textContent = `Move ${i+1}`;
    btn.onclick = ()=> doPlayerMove(i);
    container.appendChild(btn);
  }
  document.getElementById('megaBtn').onclick = ()=> playerMega();
  document.getElementById('runBtn').onclick = ()=> { showMessage('You ran away!'); setTimeout(()=>location.reload(),600); };
}

// Render battle scene and models
function renderBattleScene(playerMon, rivalMon){
  // clear scene
  while(scene.children.length>0) scene.remove(scene.children[0]);
  scene.add(new THREE.AmbientLight(0xffffff,0.6));
  const dl = new THREE.DirectionalLight(0xffffff,1.0); dl.position.set(3,6,3); scene.add(dl);

  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(12,6), new THREE.MeshStandardMaterial({ color:0x7bc47f }));
  ground.rotation.x = -Math.PI/2; ground.position.y = -1.2; scene.add(ground);

  // create meshes
  player.mesh = makeCreatureMesh(playerMon.color, playerMon.shiny, playerMon.variant); player.mesh.position.set(-2,0,0); scene.add(player.mesh);
  rival.mesh = makeCreatureMesh(rivalMon.color, rivalMon.shiny, rivalMon.variant); rival.mesh.position.set(2,0,0); scene.add(rival.mesh);

  // animate loop
  if (animationId) cancelAnimationFrame(animationId);
  const loop = ()=> {
    animationId = requestAnimationFrame(loop);
    if (player.mesh) player.mesh.rotation.y += 0.008;
    if (rival.mesh) rival.mesh.rotation.y -= 0.008;
    const t = Date.now()*0.002;
    if (player.mesh) player.mesh.position.y = Math.sin(t*1.5)*0.06;
    if (rival.mesh) rival.mesh.position.y = Math.sin(t*1.5+1)*0.06;
    renderer.render(scene, camera);
  };
  loop();
}
