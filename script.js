/* ==================================================================
   ARDILLON — ¡Corre Katalina!
   Juego de carrera infinita 3D con Three.js
   Archivo principal de lógica del juego
   ================================================================== */

// ─────────────────────────────────────────────
// AUDIO ENGINE (Web Audio API — Sintetizado)
// ─────────────────────────────────────────────
const AudioEngine = (() => {
  let ctx = null;
  const getCtx = () => {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  };

  /** Tono simple con slide opcional */
  function playTone(freq, duration, type = 'sine', volume = 0.15, slide = 0) {
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime);
    if (slide) osc.frequency.linearRampToValueAtTime(freq + slide, c.currentTime + duration);
    gain.gain.setValueAtTime(volume, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(c.currentTime);
    osc.stop(c.currentTime + duration);
  }

  /** Ráfaga de ruido blanco */
  function playNoise(duration, volume = 0.08) {
    const c = getCtx();
    const bufferSize = c.sampleRate * duration;
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * volume;
    const source = c.createBufferSource();
    source.buffer = buffer;
    const gain = c.createGain();
    gain.gain.setValueAtTime(volume, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    source.connect(gain);
    gain.connect(c.destination);
    source.start(c.currentTime);
  }

  return {
    jump()       { playTone(400, 0.15, 'sine', 0.12, 300); playTone(700, 0.1, 'sine', 0.06, 200); },
    slide()      { playNoise(0.15, 0.06); playTone(200, 0.12, 'sawtooth', 0.04, -100); },
    nut()        { playTone(800, 0.08, 'sine', 0.1); playTone(1200, 0.1, 'sine', 0.08); },
    acorn()      { playTone(600, 0.06, 'sine', 0.1); playTone(900, 0.08, 'triangle', 0.1); playTone(1400, 0.12, 'sine', 0.08); },
    hit()        { playNoise(0.3, 0.15); playTone(150, 0.25, 'sawtooth', 0.12, -80); },
    powerup()    { playTone(500, 0.1, 'sine', 0.1); playTone(700, 0.1, 'sine', 0.1); playTone(1000, 0.15, 'sine', 0.1); },
    gameOver()   { playTone(400, 0.2, 'sawtooth', 0.1, -50); setTimeout(() => playTone(300, 0.2, 'sawtooth', 0.1, -50), 200); setTimeout(() => playTone(200, 0.4, 'sawtooth', 0.12, -100), 400); },
    laneChange() { playTone(500, 0.06, 'triangle', 0.05); }
  };
})();


// ─────────────────────────────────────────────
// CONSTANTES DEL JUEGO
// ─────────────────────────────────────────────
const LANE_WIDTH      = 3.2;
const LANES           = [LANE_WIDTH, 0, -LANE_WIDTH];
const GROUND_LENGTH   = 200;
const SPAWN_DIST      = 100;
const DESPAWN_DIST    = -15;
const BASE_SPEED      = 18;
const MAX_SPEED       = 45;
const JUMP_FORCE      = 12;
const GRAVITY         = 30;
const SLIDE_DURATION  = 0.6;
const MAGNET_DURATION = 8;
const MAGNET_RADIUS   = 5;
const MAX_LIVES       = 3;
const INVULN_TIME     = 1.5;


// ─────────────────────────────────────────────
// ESTADO DEL JUEGO
// ─────────────────────────────────────────────
let gameState   = 'menu';   // menu | playing | gameover
let score       = 0;
let highScore   = parseInt(localStorage.getItem('ardillon_highscore')) || 0;
let distance    = 0;
let lives       = MAX_LIVES;
let currentLane = 1;         // 0 = izquierda, 1 = centro, 2 = derecha
let playerY     = 0;
let velocityY   = 0;
let isJumping   = false;
let isSliding   = false;
let slideTimer  = 0;
let speed       = BASE_SPEED;
let invulnTimer = 0;
let magnetTimer = 0;
let hasShield   = false;
let nutCount    = 0;
let acornCount  = 0;
let runAnimTimer = 0;
let cameraShake = 0;

// Pools de objetos
let obstacles    = [];
let collectibles = [];
let powerups     = [];
let trees        = [];
let particles    = [];

// Temporizadores de spawn
let spawnTimer           = 0;
let collectibleSpawnTimer = 0;
let treeSpawnTimer       = 0;
let powerupSpawnTimer    = 0;


// ─────────────────────────────────────────────
// THREE.JS — Escena, cámara, renderer
// ─────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2a1a);
scene.fog = new THREE.FogExp2(0x1a2a1a, 0.012);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 6.5, -8);
camera.lookAt(0, 1.5, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.prepend(renderer.domElement);


// ─────────────────────────────────────────────
// ILUMINACIÓN
// ─────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0x667788, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffeedd, 1.2);
dirLight.position.set(8, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
dirLight.shadow.camera.near   = 1;
dirLight.shadow.camera.far    = 60;
dirLight.shadow.camera.left   = -15;
dirLight.shadow.camera.right  = 15;
dirLight.shadow.camera.top    = 15;
dirLight.shadow.camera.bottom = -15;
scene.add(dirLight);

const hemiLight = new THREE.HemisphereLight(0x88aacc, 0x445522, 0.4);
scene.add(hemiLight);


// ─────────────────────────────────────────────
// MATERIALES REUTILIZABLES
// ─────────────────────────────────────────────
const mat = {
  ground:     new THREE.MeshLambertMaterial({ color: 0x3a5a2a }),
  path:       new THREE.MeshLambertMaterial({ color: 0x6b4423 }),
  pathLine:   new THREE.MeshBasicMaterial({ color: 0x8b6333, transparent: true, opacity: 0.3 }),
  trunk:      new THREE.MeshLambertMaterial({ color: 0x5c3a1e }),
  leaves:     new THREE.MeshLambertMaterial({ color: 0x2d7a2d }),
  leavesDark: new THREE.MeshLambertMaterial({ color: 0x1d5a1d }),
  rock:       new THREE.MeshLambertMaterial({ color: 0x777777 }),
  log:        new THREE.MeshLambertMaterial({ color: 0x6d4c2a }),
  branch:     new THREE.MeshLambertMaterial({ color: 0x5c3a1e }),
  nut:        new THREE.MeshPhongMaterial({ color: 0xcc8844, shininess: 60 }),
  acorn:      new THREE.MeshPhongMaterial({ color: 0xffd700, shininess: 100, emissive: 0x443300, emissiveIntensity: 0.3 }),
  acornCap:   new THREE.MeshPhongMaterial({ color: 0x8b6914, shininess: 40 }),
  magnet:     new THREE.MeshPhongMaterial({ color: 0x4488ff, shininess: 80, emissive: 0x112244, emissiveIntensity: 0.5 }),
  shield:     new THREE.MeshPhongMaterial({ color: 0x44ff88, shininess: 80, emissive: 0x114422, emissiveIntensity: 0.5 }),
  // Ardilla
  sqBody:     new THREE.MeshLambertMaterial({ color: 0xb5651d }),
  sqBelly:    new THREE.MeshLambertMaterial({ color: 0xdeb887 }),
  sqEye:      new THREE.MeshBasicMaterial({ color: 0x111111 }),
  sqEyeWhite: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  sqNose:     new THREE.MeshBasicMaterial({ color: 0x333333 }),
  sqTail:     new THREE.MeshLambertMaterial({ color: 0xa0522d }),
};


// ─────────────────────────────────────────────
// SUELO Y CAMINO
// ─────────────────────────────────────────────
function createGround() {
  // Piso de hierba
  const groundGeo = new THREE.PlaneGeometry(80, GROUND_LENGTH);
  const ground = new THREE.Mesh(groundGeo, mat.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.01, GROUND_LENGTH / 2 - 10);
  ground.receiveShadow = true;
  scene.add(ground);

  // Camino de tierra
  const pathGeo = new THREE.PlaneGeometry(LANE_WIDTH * 3 + 2, GROUND_LENGTH);
  const path = new THREE.Mesh(pathGeo, mat.path);
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0, GROUND_LENGTH / 2 - 10);
  path.receiveShadow = true;
  scene.add(path);

  // Líneas divisorias de carriles
  for (let i = -1; i <= 1; i += 2) {
    const lineGeo = new THREE.PlaneGeometry(0.08, GROUND_LENGTH);
    const line = new THREE.Mesh(lineGeo, mat.pathLine);
    line.rotation.x = -Math.PI / 2;
    line.position.set(i * LANE_WIDTH / 2 + i * LANE_WIDTH / 2, 0.01, GROUND_LENGTH / 2 - 10);
    scene.add(line);
  }
}


// ─────────────────────────────────────────────
// KATALINA (la ardilla protagonista)
// ─────────────────────────────────────────────
let squirrel, sqParts = {};

function createSquirrel() {
  squirrel = new THREE.Group();

  // ── Torso ──
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 0.6, 8),
    mat.sqBody
  );
  body.position.set(0, 1.0, 0);
  body.rotation.x = 0.3;           // inclinada hacia adelante
  body.castShadow = true;
  squirrel.add(body);
  sqParts.body = body;

  // ── Panza ──
  const belly = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 8, 6),
    mat.sqBelly
  );
  belly.position.set(0, 0.95, -0.2);
  belly.scale.set(0.85, 1.0, 0.6);
  squirrel.add(belly);

  // ── Cabeza ──
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 8, 6),
    mat.sqBody
  );
  head.position.set(0, 1.65, -0.15);
  head.castShadow = true;
  squirrel.add(head);
  sqParts.head = head;

  // Hocico / cachetes
  const snout = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 6, 5),
    mat.sqBelly
  );
  snout.position.set(0, 1.58, -0.42);
  snout.scale.set(1, 0.8, 1);
  squirrel.add(snout);

  // ── Ojos ──
  for (let s = -1; s <= 1; s += 2) {
    const eyeWhite = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 6, 5),
      mat.sqEyeWhite
    );
    eyeWhite.position.set(s * 0.15, 1.72, -0.38);
    squirrel.add(eyeWhite);

    const eyePupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 6, 5),
      mat.sqEye
    );
    eyePupil.position.set(s * 0.15, 1.72, -0.45);
    squirrel.add(eyePupil);
  }

  // ── Nariz ──
  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 5, 4),
    mat.sqNose
  );
  nose.position.set(0, 1.62, -0.55);
  squirrel.add(nose);

  // ── Orejas ──
  for (let s = -1; s <= 1; s += 2) {
    const ear = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.22, 4),
      mat.sqBody
    );
    ear.position.set(s * 0.22, 1.95, -0.05);
    ear.rotation.z = s * 0.3;
    squirrel.add(ear);

    const earInner = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.14, 4),
      mat.sqBelly
    );
    earInner.position.set(s * 0.22, 1.93, -0.08);
    earInner.rotation.z = s * 0.3;
    squirrel.add(earInner);
  }

  // ── Brazos ──
  const armGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.35, 6);
  for (let s = -1; s <= 1; s += 2) {
    const arm = new THREE.Mesh(armGeo, mat.sqBody);
    arm.position.set(s * 0.4, 1.05, -0.1);
    arm.rotation.x = 0.5;
    arm.castShadow = true;
    squirrel.add(arm);
    if (s === -1) sqParts.armL = arm;
    else sqParts.armR = arm;
  }

  // ── Piernas ──
  const legGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.4, 6);
  for (let s = -1; s <= 1; s += 2) {
    const upperLeg = new THREE.Group();
    upperLeg.position.set(s * 0.22, 0.55, 0.05);

    const leg = new THREE.Mesh(legGeo, mat.sqBody);
    leg.position.set(0, -0.15, 0);
    leg.castShadow = true;
    upperLeg.add(leg);

    // Pie
    const foot = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 6, 4),
      mat.sqBody
    );
    foot.position.set(0, -0.4, -0.06);
    foot.scale.set(0.8, 0.5, 1.2);
    upperLeg.add(foot);

    squirrel.add(upperLeg);
    if (s === -1) sqParts.legL = upperLeg;
    else sqParts.legR = upperLeg;
  }

  // ── Cola esponjosa ──
  const tailGroup = new THREE.Group();
  tailGroup.position.set(0, 1.1, 0.45);

  const tailBase = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 6, 5),
    mat.sqTail
  );
  tailBase.scale.set(0.7, 0.7, 1.2);
  tailGroup.add(tailBase);

  const tailMid = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 6, 5),
    mat.sqTail
  );
  tailMid.position.set(0, 0.35, 0.15);
  tailMid.scale.set(0.7, 1, 0.8);
  tailGroup.add(tailMid);

  const tailTop = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 6, 5),
    mat.sqTail
  );
  tailTop.position.set(0, 0.7, 0.05);
  tailTop.scale.set(0.6, 0.8, 0.7);
  tailGroup.add(tailTop);

  const tailTip = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 5, 4),
    mat.sqBelly
  );
  tailTip.position.set(0, 0.9, -0.05);
  tailTip.scale.set(0.5, 0.6, 0.5);
  tailGroup.add(tailTip);

  squirrel.add(tailGroup);
  sqParts.tail = tailGroup;

  // ── Burbuja de escudo (oculta por defecto) ──
  const shieldBubble = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 12, 8),
    new THREE.MeshPhongMaterial({
      color: 0x44ffaa,
      transparent: true,
      opacity: 0.2,
      shininess: 100,
      side: THREE.DoubleSide
    })
  );
  shieldBubble.position.set(0, 1.0, 0);
  shieldBubble.visible = false;
  squirrel.add(shieldBubble);
  sqParts.shieldBubble = shieldBubble;

  squirrel.position.set(0, 0, 0);
  squirrel.rotation.y = Math.PI; // Face forward (+Z is away from camera)
  scene.add(squirrel);
}


// ─────────────────────────────────────────────
// ANIMACIÓN DE KATALINA
// ─────────────────────────────────────────────
function animateSquirrel(dt) {
  if (!squirrel) return;

  runAnimTimer += dt * speed * 0.6;

  // ── Corriendo ──
  if (!isJumping && !isSliding) {
    const legSwing = Math.sin(runAnimTimer) * 0.8;
    if (sqParts.legL) sqParts.legL.rotation.x = legSwing;
    if (sqParts.legR) sqParts.legR.rotation.x = -legSwing;

    if (sqParts.armL) sqParts.armL.rotation.x = 0.5 - legSwing * 0.5;
    if (sqParts.armR) sqParts.armR.rotation.x = 0.5 + legSwing * 0.5;

    if (sqParts.body) {
      sqParts.body.position.y = 1.0 + Math.abs(Math.sin(runAnimTimer)) * 0.08;
      sqParts.body.rotation.x = 0.3;
    }
    if (sqParts.head) {
      sqParts.head.position.y = 1.65 + Math.abs(Math.sin(runAnimTimer)) * 0.06;
    }

    if (sqParts.tail) {
      sqParts.tail.rotation.x = Math.sin(runAnimTimer * 0.7) * 0.15;
      sqParts.tail.rotation.z = Math.sin(runAnimTimer * 0.5) * 0.1;
    }

    squirrel.scale.set(1, 1, 1);
  }

  // ── Saltando ──
  if (isJumping) {
    if (sqParts.legL) sqParts.legL.rotation.x = -0.6;
    if (sqParts.legR) sqParts.legR.rotation.x = -0.6;
    if (sqParts.armL) sqParts.armL.rotation.x = -0.3;
    if (sqParts.armR) sqParts.armR.rotation.x = -0.3;
    if (sqParts.tail) {
      sqParts.tail.rotation.x = -0.3;
      sqParts.tail.rotation.z = Math.sin(runAnimTimer * 2) * 0.15;
    }
  }

  // ── Deslizándose ──
  if (isSliding) {
    squirrel.scale.set(1.15, 0.45, 1.15);
    if (sqParts.legL) sqParts.legL.rotation.x = 0.9;
    if (sqParts.legR) sqParts.legR.rotation.x = 0.9;
    if (sqParts.armL) sqParts.armL.rotation.x = 1.2;
    if (sqParts.armR) sqParts.armR.rotation.x = 1.2;
  }

  // Movimiento suave entre carriles
  const targetX = LANES[currentLane];
  squirrel.position.x += (targetX - squirrel.position.x) * 12 * dt;

  // Posición vertical (salto)
  squirrel.position.y = playerY;

  // Parpadeo de invulnerabilidad
  if (invulnTimer > 0) {
    squirrel.visible = Math.floor(invulnTimer * 10) % 2 === 0;
  } else {
    squirrel.visible = true;
  }

  // Burbuja de escudo
  sqParts.shieldBubble.visible = hasShield;
  if (hasShield) {
    sqParts.shieldBubble.rotation.y += dt * 2;
    sqParts.shieldBubble.material.opacity = 0.15 + Math.sin(Date.now() * 0.005) * 0.08;
  }
}


// ─────────────────────────────────────────────
// ÁRBOLES DECORATIVOS
// ─────────────────────────────────────────────
function createTree(x, z) {
  const group = new THREE.Group();

  const trunkH = 2 + Math.random() * 3;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.35, trunkH, 6),
    mat.trunk
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  group.add(trunk);

  // Follaje low-poly (conos apilados)
  const leaveMat = Math.random() > 0.5 ? mat.leaves : mat.leavesDark;
  const levels = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < levels; i++) {
    const r = 1.5 - i * 0.3 + Math.random() * 0.3;
    const h = 1.5 + Math.random() * 0.5;
    const leaf = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 6 + Math.floor(Math.random() * 3)),
      leaveMat
    );
    leaf.position.y = trunkH + i * 1.0;
    leaf.rotation.y = Math.random() * Math.PI;
    leaf.castShadow = true;
    group.add(leaf);
  }

  group.position.set(x, 0, z);
  const s = 0.7 + Math.random() * 0.6;
  group.scale.set(s, s, s);
  scene.add(group);
  return group;
}


// ─────────────────────────────────────────────
// OBSTÁCULOS
// ─────────────────────────────────────────────

/** Tronco caído — hay que SALTAR */
function createLog(lane, z) {
  const group = new THREE.Group();
  const log = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.4, LANE_WIDTH * 0.8, 8),
    mat.log
  );
  log.rotation.z = Math.PI / 2;
  log.position.y = 0.4;
  log.castShadow = true;
  group.add(log);

  // Anillos de corteza
  for (let i = -1; i <= 1; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.38, 0.04, 4, 8),
      mat.trunk
    );
    ring.rotation.y = Math.PI / 2;
    ring.position.set(i * 0.5, 0.4, 0);
    group.add(ring);
  }

  group.position.set(LANES[lane], 0, z);
  group.userData = { type: 'log', lane, radius: 1.2, height: 0.8 };
  scene.add(group);
  return group;
}

/** Rama baja — hay que AGACHARSE */
function createBranch(lane, z) {
  const group = new THREE.Group();

  const branch = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, LANE_WIDTH * 1.0, 6),
    mat.branch
  );
  branch.rotation.z = Math.PI / 2;
  branch.position.y = 1.6;
  branch.castShadow = true;
  group.add(branch);

  // Tronco de soporte a un lado
  const side = Math.random() > 0.5 ? 1 : -1;
  const support = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.25, 3.5, 6),
    mat.trunk
  );
  support.position.set(side * LANE_WIDTH * 0.5, 1.75, 0);
  support.castShadow = true;
  group.add(support);

  // Hojitas
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.25 + Math.random() * 0.15, 5, 4),
      mat.leaves
    );
    leaf.position.set(
      (Math.random() - 0.5) * LANE_WIDTH * 0.6,
      1.6 + Math.random() * 0.4,
      (Math.random() - 0.5) * 0.5
    );
    group.add(leaf);
  }

  // Hojas colgantes de advertencia
  const hangGeo = new THREE.ConeGeometry(0.15, 0.5, 4);
  for (let i = 0; i < 4; i++) {
    const hang = new THREE.Mesh(hangGeo, mat.leaves);
    hang.position.set(
      (Math.random() - 0.5) * LANE_WIDTH * 0.4,
      1.3,
      (Math.random() - 0.5) * 0.3
    );
    hang.rotation.x = Math.PI;
    group.add(hang);
  }

  group.position.set(LANES[lane], 0, z);
  group.userData = { type: 'branch', lane, radius: 1.2, heightMin: 1.0, heightMax: 2.2 };
  scene.add(group);
  return group;
}

/** Roca — hay que CAMBIAR DE CARRIL */
function createRock(lane, z) {
  const group = new THREE.Group();

  const rock1 = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.7, 0),
    mat.rock
  );
  rock1.position.set(0, 0.5, 0);
  rock1.rotation.set(Math.random(), Math.random(), Math.random());
  rock1.castShadow = true;
  group.add(rock1);

  const rock2 = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.5, 0),
    mat.rock
  );
  rock2.position.set(0.3, 0.35, 0.2);
  rock2.rotation.set(Math.random(), Math.random(), Math.random());
  rock2.castShadow = true;
  group.add(rock2);

  // Piedritas pequeñas
  for (let i = 0; i < 3; i++) {
    const peb = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.15, 0),
      mat.rock
    );
    peb.position.set(
      (Math.random() - 0.5) * 1.0,
      0.15,
      (Math.random() - 0.5) * 0.6
    );
    peb.rotation.set(Math.random(), Math.random(), Math.random());
    group.add(peb);
  }

  group.position.set(LANES[lane], 0, z);
  group.userData = { type: 'rock', lane, radius: 1.1, height: 1.4 };
  scene.add(group);
  return group;
}


// ─────────────────────────────────────────────
// COLECCIONABLES
// ─────────────────────────────────────────────

/** Nuez normal (+10 pts) */
function createNut(lane, z) {
  const group = new THREE.Group();
  const nut = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 8, 6),
    mat.nut
  );
  nut.scale.set(1, 0.8, 1);
  nut.castShadow = true;
  group.add(nut);

  group.position.set(LANES[lane], 1.2, z);
  group.userData = { type: 'nut', lane, collected: false };
  scene.add(group);
  return group;
}

/** Bellota dorada (+50 pts) */
function createAcorn(lane, z) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 8, 6),
    mat.acorn
  );
  body.scale.set(1, 1.2, 1);
  body.castShadow = true;
  group.add(body);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2.5),
    mat.acornCap
  );
  cap.position.y = 0.12;
  group.add(cap);

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.12, 4),
    mat.trunk
  );
  stem.position.y = 0.32;
  group.add(stem);

  // Anillo de brillo
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.45, 12),
    new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.15;
  group.add(glow);

  group.position.set(LANES[lane], 1.2, z);
  group.userData = { type: 'acorn', lane, collected: false, glow };
  scene.add(group);
  return group;
}


// ─────────────────────────────────────────────
// POWER-UPS
// ─────────────────────────────────────────────

/** Imán de nueces */
function createPowerupMagnet(lane, z) {
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.15, 0.3),
    mat.magnet
  );
  group.add(base);

  for (let s = -1; s <= 1; s += 2) {
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.4, 0.3),
      new THREE.MeshPhongMaterial({
        color: s === -1 ? 0xff4444 : 0x4444ff,
        shininess: 60
      })
    );
    arm.position.set(s * 0.18, 0.25, 0);
    group.add(arm);
  }

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.03, 8, 16),
    new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.4 })
  );
  group.add(ring);
  group.userData = { ring, type: 'magnet', lane, collected: false };

  group.position.set(LANES[lane], 1.5, z);
  scene.add(group);
  return group;
}

/** Escudo protector */
function createPowerupShield(lane, z) {
  const group = new THREE.Group();

  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 8, 6),
    mat.shield
  );
  shield.scale.set(1, 1, 0.4);
  group.add(shield);

  const star = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.12, 0),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  star.position.z = -0.18;
  group.add(star);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.03, 8, 16),
    new THREE.MeshBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0.4 })
  );
  group.add(ring);
  group.userData = { ring, type: 'shield', lane, collected: false };

  group.position.set(LANES[lane], 1.5, z);
  scene.add(group);
  return group;
}


// ─────────────────────────────────────────────
// PARTÍCULAS
// ─────────────────────────────────────────────
function spawnParticles(pos, color, count = 8) {
  for (let i = 0; i < count; i++) {
    const p = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial({ color })
    );
    p.position.copy(pos);
    p.userData = {
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        Math.random() * 5 + 2,
        (Math.random() - 0.5) * 4
      ),
      life: 0.6 + Math.random() * 0.4
    };
    scene.add(p);
    particles.push(p);
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.userData.life -= dt;
    if (p.userData.life <= 0) {
      scene.remove(p);
      particles.splice(i, 1);
      continue;
    }
    p.position.add(p.userData.vel.clone().multiplyScalar(dt));
    p.userData.vel.y -= 12 * dt;
    p.rotation.x += dt * 5;
    p.rotation.y += dt * 3;
    p.material.opacity = p.userData.life;
    p.scale.setScalar(p.userData.life);
  }
}


// ─────────────────────────────────────────────
// LÓGICA DE SPAWN
// ─────────────────────────────────────────────
function spawnObstacle() {
  const lane = Math.floor(Math.random() * 3);
  const z = SPAWN_DIST;
  const r = Math.random();

  let obj;
  if (r < 0.35)      obj = createLog(lane, z);
  else if (r < 0.65) obj = createBranch(lane, z);
  else                obj = createRock(lane, z);
  obstacles.push(obj);

  // A velocidades altas, a veces un segundo obstáculo en otro carril
  if (speed > 24 && Math.random() < 0.3) {
    const lane2 = (lane + 1 + Math.floor(Math.random() * 2)) % 3;
    const r2 = Math.random();
    let obj2;
    if (r2 < 0.35)      obj2 = createLog(lane2, z);
    else if (r2 < 0.65) obj2 = createBranch(lane2, z);
    else                 obj2 = createRock(lane2, z);
    obstacles.push(obj2);
  }
}

function spawnCollectibles() {
  const lane = Math.floor(Math.random() * 3);
  const count = 3 + Math.floor(Math.random() * 4);
  const isAcornChance = Math.random() < 0.15;

  for (let i = 0; i < count; i++) {
    const z = SPAWN_DIST + i * 2.5;
    let obj;
    if (isAcornChance && i === Math.floor(count / 2)) {
      obj = createAcorn(lane, z);
    } else {
      obj = createNut(lane, z);
    }
    collectibles.push(obj);
  }
}

function spawnPowerup() {
  const lane = Math.floor(Math.random() * 3);
  const z = SPAWN_DIST;
  let obj;
  if (Math.random() < 0.5) obj = createPowerupMagnet(lane, z);
  else                      obj = createPowerupShield(lane, z);
  powerups.push(obj);
}

function spawnTree() {
  const side = Math.random() > 0.5 ? 1 : -1;
  const x = side * (LANE_WIDTH * 1.8 + Math.random() * 6);
  const z = SPAWN_DIST + Math.random() * 20;
  trees.push(createTree(x, z));
}


// ─────────────────────────────────────────────
// COLISIONES
// ─────────────────────────────────────────────
function checkCollisions() {
  const px = squirrel.position.x;
  const py = playerY;
  const pz = squirrel.position.z;

  // ── Obstáculos ──
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const obs = obstacles[i];
    const d   = obs.userData;
    const dx  = Math.abs(px - obs.position.x);
    const dz  = Math.abs(pz - obs.position.z);

    if (dx < 1.2 && dz < 1.0) {
      let hit = false;

      if (d.type === 'log') {
        if (py < d.height) hit = true;
      } else if (d.type === 'branch') {
        if (!isSliding && py < d.heightMax && py + 1.8 > d.heightMin) hit = true;
      } else if (d.type === 'rock') {
        if (py < d.height) hit = true;
      }

      if (hit) handleHit(obs);
    }
  }

  // ── Coleccionables ──
  const magnetActive = magnetTimer > 0;
  for (let i = collectibles.length - 1; i >= 0; i--) {
    const col = collectibles[i];
    if (col.userData.collected) continue;

    let dx = px - col.position.x;
    let dz = pz - col.position.z;
    let dist = Math.sqrt(dx * dx + dz * dz);

    // Atracción del imán
    if (magnetActive && dist < MAGNET_RADIUS) {
      col.position.x += (px - col.position.x) * 8 * 0.016;
      col.position.z += (pz - col.position.z) * 8 * 0.016;
      col.position.y += (py + 1.0 - col.position.y) * 8 * 0.016;
      dx = px - col.position.x;
      dz = pz - col.position.z;
      dist = Math.sqrt(dx * dx + dz * dz);
    }

    if (dist < 1.0 && Math.abs(py - (col.position.y - 1.2)) < 1.5) {
      col.userData.collected = true;

      if (col.userData.type === 'nut') {
        score += 10;
        nutCount++;
        AudioEngine.nut();
        spawnParticles(col.position.clone(), 0xcc8844, 6);
        showScorePopup('+10', col.position, '#cc8844');
      } else if (col.userData.type === 'acorn') {
        score += 50;
        acornCount++;
        AudioEngine.acorn();
        spawnParticles(col.position.clone(), 0xffd700, 10);
        showScorePopup('+50', col.position, '#ffd700');
      }

      scene.remove(col);
      collectibles.splice(i, 1);
    }
  }

  // ── Power-ups ──
  for (let i = powerups.length - 1; i >= 0; i--) {
    const pw = powerups[i];
    if (pw.userData.collected) continue;

    const dx   = px - pw.position.x;
    const dz   = pz - pw.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 1.2 && Math.abs(py - (pw.position.y - 1.5)) < 1.8) {
      pw.userData.collected = true;

      if (pw.userData.type === 'magnet') {
        magnetTimer = MAGNET_DURATION;
        AudioEngine.powerup();
        spawnParticles(pw.position.clone(), 0x4488ff, 12);
        showScorePopup('🧲 IMÁN!', pw.position, '#4488ff');
      } else if (pw.userData.type === 'shield') {
        hasShield = true;
        AudioEngine.powerup();
        spawnParticles(pw.position.clone(), 0x44ff88, 12);
        showScorePopup('🛡️ ESCUDO!', pw.position, '#44ff88');
      }

      scene.remove(pw);
      powerups.splice(i, 1);
    }
  }
}

function handleHit(obs) {
  if (invulnTimer > 0) return;

  if (hasShield) {
    hasShield = false;
    invulnTimer = INVULN_TIME;
    AudioEngine.hit();
    spawnParticles(squirrel.position.clone().add(new THREE.Vector3(0, 1, 0)), 0x44ff88, 10);
    return;
  }

  lives--;
  invulnTimer = INVULN_TIME;
  AudioEngine.hit();
  spawnParticles(squirrel.position.clone().add(new THREE.Vector3(0, 1, 0)), 0xff4444, 12);
  updateLivesUI();

  cameraShake = 0.4;

  if (lives <= 0) endGame();
}


// ─────────────────────────────────────────────
// INTERFAZ (HUD)
// ─────────────────────────────────────────────
function updateHUD() {
  document.getElementById('hudScore').textContent     = score.toLocaleString();
  document.getElementById('hudHighscore').textContent  = '🏆 ' + Math.max(highScore, score).toLocaleString();
  document.getElementById('hudDistance').textContent    = Math.floor(distance) + 'm';

  // Indicador de imán
  const magnetInd  = document.getElementById('magnetIndicator');
  const magnetFill = document.getElementById('magnetTimer');
  if (magnetTimer > 0) {
    magnetInd.classList.add('active');
    magnetFill.style.width = ((magnetTimer / MAGNET_DURATION) * 100) + '%';
  } else {
    magnetInd.classList.remove('active');
  }

  // Indicador de escudo
  const shieldInd = document.getElementById('shieldIndicator');
  if (hasShield) shieldInd.classList.add('active');
  else           shieldInd.classList.remove('active');
}

function updateLivesUI() {
  const container = document.getElementById('hudLives');
  container.innerHTML = '';
  for (let i = 0; i < MAX_LIVES; i++) {
    const heart = document.createElement('div');
    heart.className = 'heart' + (i >= lives ? ' lost' : '');
    heart.innerHTML = `<svg viewBox="0 0 24 24" fill="${i < lives ? '#e74c3c' : '#555'}"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
    container.appendChild(heart);
  }
}

function showScorePopup(text, worldPos, color) {
  const v = worldPos.clone();
  v.project(camera);
  const x = (v.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-v.y * 0.5 + 0.5) * window.innerHeight;

  const popup = document.createElement('div');
  popup.className = 'score-popup';
  popup.textContent = text;
  popup.style.left  = x + 'px';
  popup.style.top   = y + 'px';
  popup.style.color = color;
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 800);
}


// ─────────────────────────────────────────────
// FLUJO DEL JUEGO (start / end)
// ─────────────────────────────────────────────
function startGame() {
  AudioEngine.jump();  // inicializar AudioContext con gesto del usuario

  gameState   = 'playing';
  score       = 0;
  distance    = 0;
  lives       = MAX_LIVES;
  currentLane = 1;
  playerY     = 0;
  velocityY   = 0;
  isJumping   = false;
  isSliding   = false;
  slideTimer  = 0;
  speed       = BASE_SPEED;
  invulnTimer = 0;
  magnetTimer = 0;
  hasShield   = false;
  nutCount    = 0;
  acornCount  = 0;
  cameraShake = 0;
  spawnTimer  = 0;
  collectibleSpawnTimer = 0;
  powerupSpawnTimer     = 0;
  treeSpawnTimer        = 0;

  // Limpiar objetos previos
  [...obstacles, ...collectibles, ...powerups, ...trees, ...particles].forEach(obj => scene.remove(obj));
  obstacles    = [];
  collectibles = [];
  powerups     = [];
  trees        = [];
  particles    = [];

  // Resetear ardilla
  if (squirrel) {
    squirrel.position.set(0, 0, 0);
    squirrel.rotation.y = Math.PI;
    squirrel.scale.set(1, 1, 1);
    squirrel.visible = true;
  }

  // UI
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('gameOverScreen').classList.remove('visible');
  document.getElementById('hud').classList.add('visible');
  updateLivesUI();

  // Árboles iniciales
  for (let i = 0; i < 20; i++) {
    const side = Math.random() > 0.5 ? 1 : -1;
    const x = side * (LANE_WIDTH * 1.8 + Math.random() * 8);
    const z = Math.random() * SPAWN_DIST;
    trees.push(createTree(x, z));
  }
}

function endGame() {
  gameState = 'gameover';
  AudioEngine.gameOver();

  const isNewRecord = score > highScore;
  if (isNewRecord) {
    highScore = score;
    localStorage.setItem('ardillon_highscore', highScore);
  }

  document.getElementById('hud').classList.remove('visible');
  document.getElementById('goScore').textContent = score.toLocaleString();
  document.getElementById('goHighscore').querySelector('span').textContent = highScore.toLocaleString();
  document.getElementById('goNewRecord').style.display = isNewRecord ? 'block' : 'none';
  document.getElementById('goNuts').textContent     = nutCount;
  document.getElementById('goAcorns').textContent   = acornCount;
  document.getElementById('goDistance').textContent  = Math.floor(distance) + 'm';

  setTimeout(() => {
    document.getElementById('gameOverScreen').classList.add('visible');
  }, 300);
}


// ─────────────────────────────────────────────
// CONTROLES — Teclado
// ─────────────────────────────────────────────
const keys = {};

window.addEventListener('keydown', (e) => {
  if (keys[e.code]) return;
  keys[e.code] = true;

  if (gameState === 'menu' || gameState === 'gameover') {
    if (e.code === 'Space' || e.code === 'Enter') startGame();
    return;
  }

  if (gameState !== 'playing') return;

  // Cambiar carril
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
    if (currentLane > 0) { currentLane--; AudioEngine.laneChange(); }
  }
  if (e.code === 'ArrowRight' || e.code === 'KeyD') {
    if (currentLane < 2) { currentLane++; AudioEngine.laneChange(); }
  }

  // Saltar
  if ((e.code === 'ArrowUp' || e.code === 'Space' || e.code === 'KeyW') && !isJumping) {
    isJumping  = true;
    velocityY  = JUMP_FORCE;
    isSliding  = false;
    slideTimer = 0;
    squirrel.scale.set(1, 1, 1);
    AudioEngine.jump();
  }

  // Deslizar
  if ((e.code === 'ArrowDown' || e.code === 'KeyS') && !isJumping) {
    isSliding  = true;
    slideTimer = SLIDE_DURATION;
    AudioEngine.slide();
  }
});

window.addEventListener('keyup', (e) => { keys[e.code] = false; });


// ─────────────────────────────────────────────
// CONTROLES — Táctil / Swipe
// ─────────────────────────────────────────────
let touchStartX = 0, touchStartY = 0, touchStartTime = 0;

window.addEventListener('touchstart', (e) => {
  touchStartX    = e.touches[0].clientX;
  touchStartY    = e.touches[0].clientY;
  touchStartTime = Date.now();
}, { passive: true });

window.addEventListener('touchend', (e) => {
  if (gameState !== 'playing') return;

  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  const dt = Date.now() - touchStartTime;
  if (dt > 300) return;

  const absDx     = Math.abs(dx);
  const absDy     = Math.abs(dy);
  const threshold = 30;

  if (absDx > absDy && absDx > threshold) {
    if (dx < 0 && currentLane > 0) { currentLane--; AudioEngine.laneChange(); }
    if (dx > 0 && currentLane < 2) { currentLane++; AudioEngine.laneChange(); }
  } else if (absDy > absDx && absDy > threshold) {
    if (dy < 0 && !isJumping) {
      isJumping  = true;
      velocityY  = JUMP_FORCE;
      isSliding  = false;
      slideTimer = 0;
      squirrel.scale.set(1, 1, 1);
      AudioEngine.jump();
    }
    if (dy > 0 && !isJumping) {
      isSliding  = true;
      slideTimer = SLIDE_DURATION;
      AudioEngine.slide();
    }
  }
}, { passive: true });


// ─────────────────────────────────────────────
// RESIZE
// ─────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});


// ─────────────────────────────────────────────
// GAME LOOP PRINCIPAL
// ─────────────────────────────────────────────
let lastTime = 0;

function gameLoop(time) {
  requestAnimationFrame(gameLoop);

  const dt = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;

  if (gameState === 'playing') update(dt);

  animateFloatingObjects(time);
  renderer.render(scene, camera);
}

function update(dt) {
  // Dificultad progresiva
  speed = Math.min(BASE_SPEED + score * 0.008, MAX_SPEED);

  distance += speed * dt;
  score    += Math.floor(speed * dt * 0.5);

  // ── Física del jugador ──
  if (isJumping) {
    velocityY -= GRAVITY * dt;
    playerY   += velocityY * dt;
    if (playerY <= 0) {
      playerY   = 0;
      velocityY = 0;
      isJumping = false;
    }
  }

  if (isSliding) {
    slideTimer -= dt;
    if (slideTimer <= 0) {
      isSliding = false;
      squirrel.scale.set(1, 1, 1);
    }
  }

  if (invulnTimer > 0) invulnTimer -= dt;
  if (magnetTimer > 0) magnetTimer -= dt;

  // ── Mover mundo ──
  const moveZ = -speed * dt;

  for (let i = obstacles.length - 1; i >= 0; i--) {
    obstacles[i].position.z += moveZ;
    if (obstacles[i].position.z < DESPAWN_DIST) {
      scene.remove(obstacles[i]);
      obstacles.splice(i, 1);
    }
  }

  for (let i = collectibles.length - 1; i >= 0; i--) {
    collectibles[i].position.z += moveZ;
    if (collectibles[i].position.z < DESPAWN_DIST) {
      scene.remove(collectibles[i]);
      collectibles.splice(i, 1);
    }
  }

  for (let i = powerups.length - 1; i >= 0; i--) {
    powerups[i].position.z += moveZ;
    if (powerups[i].position.z < DESPAWN_DIST) {
      scene.remove(powerups[i]);
      powerups.splice(i, 1);
    }
  }

  for (let i = trees.length - 1; i >= 0; i--) {
    trees[i].position.z += moveZ;
    if (trees[i].position.z < DESPAWN_DIST - 10) {
      scene.remove(trees[i]);
      trees.splice(i, 1);
    }
  }

  // ── Spawning ──
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnObstacle();
    spawnTimer = Math.max(1.2 - speed * 0.015, 0.5) + Math.random() * 0.8;
  }

  collectibleSpawnTimer -= dt;
  if (collectibleSpawnTimer <= 0) {
    spawnCollectibles();
    collectibleSpawnTimer = 1.5 + Math.random() * 1.5;
  }

  powerupSpawnTimer -= dt;
  if (powerupSpawnTimer <= 0) {
    spawnPowerup();
    powerupSpawnTimer = 15 + Math.random() * 20;
  }

  treeSpawnTimer -= dt;
  if (treeSpawnTimer <= 0) {
    spawnTree();
    treeSpawnTimer = 0.3 + Math.random() * 0.5;
  }

  // ── Colisiones ──
  checkCollisions();

  // ── Animaciones ──
  animateSquirrel(dt);
  updateCamera(dt);
  updateParticles(dt);
  updateHUD();
}

function updateCamera(dt) {
  const targetCamY = 6.5 + playerY * 0.3;
  camera.position.y += (targetCamY - camera.position.y) * 5 * dt;

  if (cameraShake > 0) {
    cameraShake -= dt;
    const intensity = cameraShake * 0.3;
    camera.position.x  = (Math.random() - 0.5) * intensity;
    camera.position.y += (Math.random() - 0.5) * intensity * 0.5;
  } else {
    camera.position.x += (0 - camera.position.x) * 5 * dt;
  }

  camera.lookAt(squirrel.position.x * 0.3, 1.5 + playerY * 0.5, 12);

  dirLight.position.x = squirrel.position.x + 8;
  dirLight.target.position.set(squirrel.position.x, 0, squirrel.position.z + 5);
  dirLight.target.updateMatrixWorld();
}

function animateFloatingObjects(time) {
  const t = time * 0.001;

  collectibles.forEach(c => {
    if (!c.userData.collected) {
      c.children[0].rotation.y = t * 3;
      c.children[0].position.y = Math.sin(t * 4 + c.position.z) * 0.1;
      if (c.userData.type === 'acorn' && c.userData.glow) {
        c.userData.glow.scale.setScalar(1 + Math.sin(t * 5) * 0.2);
      }
    }
  });

  powerups.forEach(p => {
    if (!p.userData.collected) {
      p.rotation.y    = t * 2;
      p.position.y    = 1.5 + Math.sin(t * 3 + p.position.z) * 0.2;
      if (p.userData.ring) {
        p.userData.ring.rotation.x = t * 2;
        p.userData.ring.rotation.z = t * 1.5;
      }
    }
  });
}


// ─────────────────────────────────────────────
// INICIALIZACIÓN
// ─────────────────────────────────────────────
function init() {
  createGround();
  createSquirrel();

  // Mostrar récord en pantalla de inicio
  const hsEl = document.getElementById('startHighscore');
  if (highScore > 0) {
    hsEl.innerHTML = 'Récord: <span>' + highScore.toLocaleString() + '</span>';
  }

  // Botones
  document.getElementById('btnPlay').addEventListener('click', startGame);
  document.getElementById('btnRestart').addEventListener('click', startGame);

  // Arrancar render loop
  requestAnimationFrame(gameLoop);
}

init();
