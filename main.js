const TYPES = ['Fire','Water','Grass','Electric','Rock','Psychic','Dragon','Ghost'];
const TYPE_COUNTER = { // simplified counters (attacker -> defender it is good vs)
  Fire: ['Grass','Ice'],
  Water: ['Fire','Rock'],
  Grass: ['Water','Rock'],
  Electric: ['Water'],
  Rock: ['Fire','Ice'],
  Psychic: ['Fighting','Poison'],
  Dragon: ['Dragon'],
  Ghost: ['Psychic']
};
// small helper to pick random
const rnd = (arr)=>arr[Math.floor(Math.random()*arr.length)];
const randInt = (n)=>Math.floor(Math.random()*n);
const shinyChance = ()=> (Math.random() < 0.1); // 1 in 10

// Basic stat generator (balanced starters)
function makeBaseStats(){ return {hp: 60 + randInt(20), atk: 10 + randInt(6), def: 8 + randInt(6), spd: 8 + randInt(6)}; }

// ------ Simple 3D Scene Setup ------
let renderer, scene, camera, canvasContainer;
function initThree(canvasId){
  const canvas = document.getElementById(canvasId);
  // If we already appended a renderer DOM, remove it
  if (renderer) {
    renderer.dispose();
    if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }
  renderer = new THREE.WebGLRenderer({ antialias:true, canvas: canvas });
  renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);
  camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
  camera.position.set(0, 2, 6);

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

// Make a lowpoly "creature" composed of primitive shapes.
// options: color, shiny (bool)
function makeCreatureMesh(color=0xff0000, shiny=false, variant=0){
  const group = new THREE.Group();
  // body: sphere
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness:0.7, metalness: shiny?0.2:0 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 12), bodyMat);
  group.add(body);
  // head: smaller sphere
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 12), bodyMat);
  head.position.set(0,0.9,0.4);
  group.add(head);
  // tail / extra by variant
  if (variant === 0){
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.25,0.8,8), bodyMat);
    tail.position.set(-0.9, -0.1, 0);
    tail.rotation.z = Math.PI/2;
    group.add(tail);
  } else if (variant === 1){
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2,0.6,0.6), bodyMat);
    fin.position.set(0.9,-0.1,0);
    fin.rotation.z = 0.4;
    group.add(fin);
  } else {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.2,0.6,8), bodyMat);
    horn.position.set(0,1.1,0.7);
    group.add(horn);
  }
  // shiny glint: if shiny, add slight emissive color
  if (shiny){ bodyMat.emissive = new THREE.Color(0xffffcc); bodyMat.emissiveIntensity = 0.15; }
  return group;
}

// ------ Game State ------
let starters = []; // generated starter objects
let player = null;
let rival = null;
let currentBattle = null;
let animationId = null;

// create three mystery starters (random types, names, shiny chance)
function genStarters(){
  const names = ['Nyari','Vokku','Trelli','Pryce','Lomix','Asera','Bruni','Zevo'];
  starters = [];
  for(let i=0;i<3;i++){
    const type = rnd(TYPES);
    const shiny = shinyChance();
    const color = new THREE.Color().setHSL(Math.random(), 0.6, 0.5).getHex();
    const stats = makeBaseStats();
    const name = (names.splice(Math.floor(Math.random()*names.length),1)[0]) + (Math.random()<0.2 ? ' Jr' : '');
    starters.push({ id:i, name, type, shiny, color, stats, mesh:null, variant:i%3 });
  }
}

// Find a simple counter type to pick as rival choice
function chooseCounterType(playerType){
  // look for a type which lists playerType as defender in TYPE_COUNTER
  for(const [atk, defs] of Object.entries(TYPE_COUNTER)){
    if (defs && defs.includes(playerType)) return atk;
  }
  // fallback: pick any different type
  const pool = TYPES.filter(t=>t!==playerType);
  return rnd(pool);
}

// basic battle engine init
function startBattle(playerMon, rivalMon){
  currentBattle = {
    player: { pokemon:playerMon, hp: playerMon.stats.hp, maxhp:playerMon.stats.hp, atk:playerMon.stats.atk, def:playerMon.stats.def, spd:playerMon.stats.spd, megaUsed:false },
    rival: { pokemon:rivalMon, hp: rivalMon.stats.hp, maxhp:rivalMon.stats.hp, atk:rivalMon.stats.atk, def:rivalMon.stats.def, spd:rivalMon.stats.spd, megaUsed:false },
    turn: 'player'
  };
  // update UI names and HP
  document.getElementById('playerName').textContent = `${playerMon.name} (${playerMon.type})${playerMon.shiny ? ' ✨' : ''}`;
  document.getElementById('rivalName').textContent = `${rivalMon.name} (${rivalMon.type})${rivalMon.shiny ? ' ✨' : ''}`;
  updateHPBars();
  showBattleUI();
  renderBattleScene(playerMon, rivalMon);
  populateMoves();
}

// small damage calc
function calcDamage(attacker, defender){
  // base damage = attacker's atk - defender's def/2 + small random
  const base = Math.max(1, Math.floor(attacker.atk - defender.def/2 + 2 + Math.random()*4));
  return base;
}

// apply move and handle turn progression
async function doPlayerMove(moveIdx){
  if (!currentBattle) return;
  if (currentBattle.player.hp <=0 || currentBattle.rival.hp <=0) return;
  // basic sequence: player attacks then rival if alive
  const dmg = calcDamage(currentBattle.player, currentBattle.rival);
  currentBattle.rival.hp -= dmg;
  showMessage(`${currentBattle.player.pokemon.name} used Move ${moveIdx+1} — did ${dmg} damage!`);
  updateHPBars();
  await sleep(800);
  if (currentBattle.rival.hp <= 0){
    showMessage(`Rival's ${currentBattle.rival.pokemon.name} fainted! You win!`);
    endBattle(true);
    return;
  }
  // Rival turn
  const rdmg = calcDamage(currentBattle.rival, currentBattle.player);
  currentBattle.player.hp -= rdmg;
  showMessage(`Rival's ${currentBattle.rival.pokemon.name} hit for ${rdmg} damage!`);
  updateHPBars();
  if (currentBattle.player.hp <= 0){
    showMessage(`${currentBattle.player.pokemon.name} fainted! You lost...`);
    endBattle(false);
  }
}

// Mega evolve (player)
function playerMega(){
  if (!currentBattle) return;
  if (currentBattle.player.megaUsed) { showMessage("Mega already used this battle."); return; }
  currentBattle.player.megaUsed = true;
  // simple effect: increase atk/def/spd and change color
  currentBattle.player.atk += 6;
  currentBattle.player.def += 4;
  currentBattle.player.spd += 3;
  showMessage(`${currentBattle.player.pokemon.name} Mega Evolved!`);
  // visual: scale and tint mesh
  const mesh = player.mesh;
  if (mesh){
    mesh.scale.set(1.25,1.25,1.25);
    // add glow: increase emissive
    mesh.traverse((c)=>{ if (c.material) { c.material.emissive = new THREE.Color(0xffeeaa); c.material.emissiveIntensity = 0.2; } });
  }
}

// End battle cleanup
function endBattle(playerWon){
  // revert mega visuals/stats
  const mesh = player.mesh;
  if (mesh){ mesh.scale.set(1,1,1); mesh.traverse((c)=>{ if (c.material){ c.material.emissiveIntensity = 0; } }); }
  // simple stop and show selection screen after a delay
  setTimeout(()=>{
    showMessage(playerWon ? "Victory! Return to town to continue." : "You were defeated. Try again.");
    // restore UI flow: go back to selection for demo purposes
    setTimeout(()=>{ location.reload(); }, 1600);
  }, 800);
}

// small helper
function sleep(ms){ return new Promise(res=>setTimeout(res,ms)); }

// update HP bar widths
function updateHPBars(){
  if (!currentBattle) return;
  const p = currentBattle.player, r = currentBattle.rival;
  const pPct = Math.max(0, Math.floor((p.hp / p.maxhp) *100));
  const rPct = Math.max(0, Math.floor((r.hp / r.maxhp) *100));
  document.querySelector('#playerHP .hp').style.width = `${pPct}%`;
  document.querySelector('#rivalHP .hp').style.width = `${rPct}%`;
}

// UI helpers
function showMessage(txt, timeout=1800){
  const box = document.getElementById('messageBox');
  box.textContent = txt; box.classList.remove('hidden');
  if (timeout>0) setTimeout(()=>box.classList.add('hidden'), timeout);
}
function showBattleUI(){ document.getElementById('battleUI').classList.remove('hidden'); document.getElementById('selectScreen').classList.add('hidden'); document.getElementById('startScreen').classList.add('hidden'); }
function showSelectUI(){ document.getElementById('selectScreen').classList.remove('hidden'); document.getElementById('startScreen').classList.add('hidden'); }

// Populate moves (four placeholder moves)
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
  // mega button
  document.getElementById('megaBtn').onclick = ()=> playerMega();
  document.getElementById('runBtn').onclick = ()=> { showMessage('You ran away!'); setTimeout(()=>location.reload(),800); };
}

// ------ Rendering battle scene with 3D models ------
function renderBattleScene(playerMon, rivalMon){
  // clear scene
  while(scene.children.length>0) scene.remove(scene.children[0]);
  // lights
  scene.add(new THREE.AmbientLight(0xffffff,0.6));
  const dl = new THREE.DirectionalLight(0xffffff,1.0); dl.position.set(3,6,3); scene.add(dl);

  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(12,6), new THREE.MeshStandardMaterial({ color:0x7bc47f }));
  ground.rotation.x = -Math.PI/2;
  ground.position.y = -1.2;
  scene.add(ground);

  // create player mesh and rival mesh, position them
  player.mesh = makeCreatureMesh(playerMon.color, playerMon.shiny, playerMon.variant);
  player.mesh.position.set(-2,0,0);
  scene.add(player.mesh);

  rival.mesh = makeCreatureMesh(rivalMon.color, rivalMon.shiny, rivalMon.variant);
  rival.mesh.position.set(2,0,0);
  scene.add(rival.mesh);

  // simple animate loop
  if (animationId) cancelAnimationFrame(animationId);
  const loop = ()=> {
    animationId = requestAnimationFrame(loop);
    // bob and rotate creatures
    if (player.mesh) player.mesh.rotation.y += 0.008;
    if (rival.mesh) rival.mesh.rotation.y -= 0.008;
    const time = Date.now()*0.002;
    if (player.mesh) player.mesh.position.y = Math.sin(time*1.5)*0.08;
    if (rival.mesh) rival.mesh.position.y = Math.sin(time*1.5+1)*0.08;
    renderer.render(scene, camera);
  };
  loop();
}

// ------ Hook up UI flow: Start -> Generate Starters -> Select -> Rival Battle ------
document.addEventListener('DOMContentLoaded', ()=>{
  // prepare Three.js canvas and renderer
  initThree('gameCanvas');
  onResize();

  const startBtn = document.getElementById('startButton');
  startBtn.onclick = ()=>{
    genStarters();
    showSelectUI();
    renderStarterRow();
  };
});

// Draw starter cards (HTML + tiny preview canvas rendered via same main renderer by positioning)
function renderStarterRow(){
  const row = document.getElementById('startersRow');
  row.innerHTML = '';
  // For each starter, make a small preview area and button
  starters.forEach((st, idx)=>{
    const card = document.createElement('div'); card.className = 'starterCard';
    const ccanvas = document.createElement('canvas'); ccanvas.className='starterCanvas';
    ccanvas.width = 320; ccanvas.height = 180;
    card.appendChild(ccanvas);
    const nm = document.createElement('div'); nm.className='starterName'; nm.textContent = st.name; card.appendChild(nm);
    const hint = document.createElement('div'); hint.className='smallHint'; hint.textContent = '??? (type hidden)'; card.appendChild(hint);
    const choose = document.createElement('button'); choose.textContent = 'Choose'; choose.style.marginTop='8px';
    choose.onclick = ()=> pickStarter(idx);
    card.appendChild(choose);
    row.appendChild(card);

    // Render a tiny preview using its own Three renderer (small)
    const previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color(0xdef3f6);
    const pCamera = new THREE.PerspectiveCamera(45, ccanvas.width/ccanvas.height, 0.1, 50);
    pCamera.position.set(0,1.5,3);
    const pRenderer = new THREE.WebGLRenderer({ canvas: ccanvas, antialias:true, alpha:false });
    pRenderer.setSize(ccanvas.width, ccanvas.height, false);
    pRenderer.setPixelRatio(window.devicePixelRatio);
    previewScene.add(new THREE.AmbientLight(0xffffff,0.8));
    const d = new THREE.DirectionalLight(0xffffff,0.6); d.position.set(3,5,2); previewScene.add(d);
    const mesh = makeCreatureMesh(st.color, st.shiny, st.variant); mesh.position.set(0,0,0);
    previewScene.add(mesh);
    const anim = ()=> { mesh.rotation.y += 0.01; pRenderer.render(previewScene, pCamera); requestAnimationFrame(anim); };
    anim();
  });
}

// on pick: set player, reveal type, pick rival and start battle
function pickStarter(idx){
  player = starters[idx];
  // reveal type in UI
  showMessage(`You chose ${player.name}! Type: ${player.type} ${player.shiny ? '✨' : ''}`,1400);
  // pick rival type that counters (simplified)
  const counterType = chooseCounterType(player.type);
  const rivalName = 'Rivalon';
  // create rival object with color and stats
  const rStats = makeBaseStats();
  const rivalColor = new THREE.Color().setHSL(Math.random(),0.6,0.5).getHex();
  rival = { name: rivalName, type: counterType, shiny: shinyChance(), color: rivalColor, stats: rStats, mesh:null, variant: (idx+1)%3 };

  // set player's high-level reference and start battle
  startBattle(player, rival);
}
