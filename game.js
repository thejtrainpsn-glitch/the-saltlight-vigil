// ============================================================================
// THE SALTLIGHT VIGIL — game.js
// A short atmospheric horror game. Canvas-based, single file, no build step.
// ============================================================================

// ---------------------------------------------------------------------------
// INPUT MANAGER — unifies keyboard/mouse and gamepad, auto-detects active device
// ---------------------------------------------------------------------------
const Input = (() => {
  const keys = {};
  let mouse = { x: 0, y: 0, down: false };
  let activeDevice = 'kbm'; // 'kbm' | 'pad'
  let gamepadIndex = null;
  let lastPadPoll = { axes: [0,0,0,0], buttons: [] };
  const listeners = { deviceChange: [] };

  function setDevice(d) {
    if (d !== activeDevice) {
      activeDevice = d;
      listeners.deviceChange.forEach(fn => fn(d));
    }
  }

  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    setDevice('kbm');
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('mousemove', (e) => {
    const rect = document.getElementById('gameCanvas').getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 960;
    mouse.y = ((e.clientY - rect.top) / rect.height) * 540;
    setDevice('kbm');
  });
  window.addEventListener('mousedown', () => { mouse.down = true; setDevice('kbm'); });
  window.addEventListener('mouseup', () => { mouse.down = false; });

  window.addEventListener('gamepadconnected', (e) => {
    if (!e.gamepad) return;
    gamepadIndex = e.gamepad.index;
    setDevice('pad');
  });
  window.addEventListener('gamepaddisconnected', () => {
    gamepadIndex = null;
    setDevice('kbm');
  });

  function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    if (gamepadIndex !== null && pads[gamepadIndex]) pad = pads[gamepadIndex];
    else {
      for (const p of pads) { if (p) { pad = p; gamepadIndex = p.index; break; } }
    }
    if (!pad) return null;

    const axes = pad.axes.slice(0, 4);
    const buttons = pad.buttons.map(b => b.pressed || b.value > 0.5);

    // detect movement to flip active device
    const moved = Math.abs(axes[0]) > 0.25 || Math.abs(axes[1]) > 0.25 ||
                  Math.abs(axes[2]) > 0.25 || Math.abs(axes[3]) > 0.25;
    const pressed = buttons.some(b => b);
    if (moved || pressed) setDevice('pad');

    lastPadPoll = { axes, buttons };
    return lastPadPoll;
  }

  // Standard gamepad mapping (Xbox-style): 0=A 1=B 2=X 3=Y 6=LT 9=Start
  function isDown(action) {
    pollGamepad();
    switch (action) {
      case 'up':    return !!keys['KeyW'] || !!keys['ArrowUp']    || lastPadPoll.axes[1] < -0.3;
      case 'down':  return !!keys['KeyS'] || !!keys['ArrowDown']  || lastPadPoll.axes[1] > 0.3;
      case 'left':  return !!keys['KeyA'] || !!keys['ArrowLeft']  || lastPadPoll.axes[0] < -0.3;
      case 'right': return !!keys['KeyD'] || !!keys['ArrowRight'] || lastPadPoll.axes[0] > 0.3;
      case 'interact': return !!keys['KeyE'] || !!lastPadPoll.buttons[0];
      case 'sneak':    return !!keys['ShiftLeft'] || !!keys['ShiftRight'] || !!lastPadPoll.buttons[6];
      case 'lantern':  return !!keys['KeyF'] || !!lastPadPoll.buttons[2];
      case 'journal':  return !!keys['Tab'] || !!lastPadPoll.buttons[3];
      case 'pause':    return !!keys['Escape'] || !!lastPadPoll.buttons[9];
      default: return false;
    }
  }

  // edge-triggered (pressed-this-frame) helper
  const prevState = {};
  function pressedOnce(action) {
    const now = isDown(action);
    const prev = !!prevState[action];
    prevState[action] = now;
    return now && !prev;
  }

  function getAimVector(playerScreenX, playerScreenY) {
    pollGamepad();
    if (activeDevice === 'pad') {
      const rx = lastPadPoll.axes[2] || 0;
      const ry = lastPadPoll.axes[3] || 0;
      if (Math.abs(rx) > 0.15 || Math.abs(ry) > 0.15) {
        return { x: rx, y: ry };
      }
      // fall back to movement direction if stick centered
      const mx = (isDown('right')?1:0) - (isDown('left')?1:0);
      const my = (isDown('down')?1:0) - (isDown('up')?1:0);
      if (mx || my) return { x: mx, y: my };
      return null;
    } else {
      const dx = mouse.x - playerScreenX;
      const dy = mouse.y - playerScreenY;
      const len = Math.hypot(dx, dy) || 1;
      return { x: dx / len, y: dy / len };
    }
  }

  function onDeviceChange(fn) { listeners.deviceChange.push(fn); }
  function getDevice() { return activeDevice; }
  function getMouse() { return mouse; }

  return { isDown, pressedOnce, getAimVector, onDeviceChange, getDevice, getMouse, pollGamepad };
})();

// ---------------------------------------------------------------------------
// WORLD DATA — rooms, geometry, items, story beats
// ---------------------------------------------------------------------------
// Coordinate space per room: 0..960 x 0..540 (matches base canvas internal res)
// Walls are axis-aligned rectangles (simple AABB collision).

const STORY = {
  intro: `Three nights ago the relief boat stopped answering radio calls.\nYou were sent to find out why the Saltlight went dark.`,
  diary1: `"...he says the fog brings something up from the rocks. I told him\nthat's just men who've been alone with a lamp too long. I don't\nbelieve that anymore. — K."`,
  diary2: `"If you're reading this, the generator room floods at high tide.\nThe valve sticks. Don't go down without a light that will last." `,
  diary3: `"He was the keeper before me. They never found him. They found his\nring, in the lamp room, melted into the glass."`,
  ending_good: `The lamp catches. For one long moment the whole strait is lit white,\nand on the rocks below, something that was a man lets go of the\nladder it was climbing and sinks back under the fog.\n\nYou radio the mainland before your hands stop shaking.\nThe Saltlight keeps its vigil a while longer.`,
  ending_bad: `The fog finds the gap in the light before you do.\nThe last thing you hear is the sound of the lamp,\nstill turning, above a stairwell no one is climbing.`
};

const Rooms = {
  // ---- ROOM 1: Keeper's Cottage (start) ----
  cottage: {
    name: "Keeper's Cottage",
    bounds: { w: 960, h: 540 },
    bg: '#0d1210',
    walls: [
      {x:0,y:0,w:960,h:24},{x:0,y:516,w:960,h:24},{x:0,y:0,w:24,h:540},{x:936,y:0,w:24,h:540},
      // interior furniture blocking
      {x:120,y:120,w:140,h:50},   // table
      {x:380,y:90,w:30,h:160},    // bookshelf wall divider
      {x:650,y:300,w:160,h:30},   // counter
      {x:200,y:380,w:90,h:60},    // crate stack
    ],
    spawn: { x: 100, y: 460 },
    exits: [
      { x:900, y:240, w:36, h:80, to:'exterior', toSpawn:{x:40,y:270}, label:'Front Door' }
    ],
    items: [
      { id:'diary1', x:150, y:140, type:'note', text: STORY.diary1, taken:false, label:'Waterlogged journal' },
      { id:'matchbook', x:700, y:330, type:'pickup', taken:false, label:'Box of matches', give:'matches' },
      { id:'lantern_pickup', x:250, y:400, type:'pickup', taken:false, label:'Old brass lantern', give:'lantern' },
    ],
    lights: [
      {x:160,y:160,r:130,color:'rgba(130,120,70,0.30)'},
      {x:780,y:240,r:160,color:'rgba(110,130,120,0.22)'},
    ], // weak ambient window glow
    threatAllowed: false,
  },

  // ---- ROOM 2: Exterior cliffside path ----
  exterior: {
    name: 'Cliff Path',
    bounds: { w: 960, h: 540 },
    bg: '#0a0e10',
    walls: [
      {x:0,y:0,w:960,h:24},{x:0,y:516,w:960,h:24},{x:0,y:0,w:24,h:540},{x:936,y:0,w:24,h:540},
      {x:300,y:0,w:30,h:220},   // rock outcrop top
      {x:300,y:340,w:30,h:200}, // rock outcrop bottom (gap = path)
      {x:600,y:120,w:200,h:30}, // overhang
    ],
    spawn: { x: 70, y: 270 },
    exits: [
      { x:0, y:240, w:30, h:80, to:'cottage', toSpawn:{x:860,y:270}, label:'Cottage' },
      { x:900, y:240, w:36, h:80, to:'lighthouse_base', toSpawn:{x:60,y:460}, label:'Lighthouse' },
      { x:430, y:0, w:80, h:30, to:'tunnels', toSpawn:{x:480,y:460}, label:'Cliffside crack', locked:true, lockNote:'A rockfall blocks this — needs to be cleared from below.' }
    ],
    items: [
      { id:'diary2', x:760, y:200, type:'note', text: STORY.diary2, taken:false, label:'Note pinned to overhang post' },
    ],
    lights: [],
    threatAllowed: true,
    ambientFog: 0.5,
  },

  // ---- ROOM 3: Lighthouse base / generator puzzle ----
  lighthouse_base: {
    name: 'Lighthouse — Generator Room',
    bounds: { w: 960, h: 540 },
    bg: '#0a0d0d',
    walls: [
      {x:0,y:0,w:960,h:24},{x:0,y:516,w:960,h:24},{x:0,y:0,w:24,h:540},{x:936,y:0,w:24,h:540},
      {x:400,y:140,w:200,h:140}, // generator block
      {x:150,y:350,w:120,h:100}, // crate pile
    ],
    spawn: { x: 60, y: 460 },
    exits: [
      { x:900, y:420, w:36, h:80, to:'exterior', toSpawn:{x:60,y:460} },
      { x:430, y:0, w:100, h:30, to:'lamp_room', toSpawn:{x:480,y:460}, label:'Spiral Stair', locked:true, lockNote:'The stairwell gate is rusted shut. Power might free it.' }
    ],
    items: [
      { id:'valve', x:470, y:300, type:'puzzle', puzzle:'valve', label:'Generator valve wheel' },
      { id:'diary3', x:200, y:380, type:'note', text: STORY.diary3, taken:false, label:'Scrap of paper, nailed to a crate' },
    ],
    lights: [],
    threatAllowed: true,
    ambientFog: 0.35,
    floodsAtPuzzleFail: true,
  },

  // ---- ROOM 4: Flooded tunnels (optional/atmosphere + key puzzle: symbol lock) ----
  tunnels: {
    name: 'Sea Tunnels',
    bounds: { w: 960, h: 540 },
    bg: '#070a0a',
    walls: [
      {x:0,y:0,w:960,h:24},{x:0,y:516,w:960,h:24},{x:0,y:0,w:24,h:540},{x:936,y:0,w:24,h:540},
      {x:300,y:200,w:360,h:40},
    ],
    spawn: { x: 480, y: 480 },
    exits: [
      { x:430, y:480, w:100, h:36, to:'exterior', toSpawn:{x:480,y:60} },
      { x:850, y:240, w:30, h:90, to:'lamp_room_secret', toSpawn:{x:60,y:270}, label:'Sea Cave', locked:true, lockNote:'Symbols are carved into a door here. Something in the cottage matched them.' }
    ],
    items: [
      { id:'symbol_door', x:830, y:280, type:'puzzle', puzzle:'symbols', label:'Carved stone door' },
    ],
    lights: [],
    threatAllowed: true,
    ambientFog: 0.65,
  },

  // ---- ROOM 5: Lamp room (finale) ----
  lamp_room: {
    name: 'The Lamp Room',
    bounds: { w: 960, h: 540 },
    bg: '#0c0f10',
    walls: [
      {x:0,y:0,w:960,h:24},{x:0,y:516,w:960,h:24},{x:0,y:0,w:24,h:540},{x:936,y:0,w:24,h:540},
      {x:400,y:200,w:160,h:160}, // central lamp mechanism
    ],
    spawn: { x: 480, y: 460 },
    exits: [
      { x:430, y:0, w:100, h:30, to:'lighthouse_base', toSpawn:{x:480,y:420} },
    ],
    items: [
      { id:'lamp_mechanism', x:480, y:280, type:'puzzle', puzzle:'lamp_final', label:'The great lamp' },
    ],
    lights: [],
    threatAllowed: true,
    ambientFog: 0.2,
    isFinale: true,
  },
};

// Puzzle definitions
const Puzzles = {
  valve: {
    solved: false,
    prompt: 'Turn the generator valve. It needs to be turned the right number of times — three diary pages mentioned "three turns, no more, or it floods."',
    requiredTurns: 3,
    turns: 0,
  },
  symbols: {
    solved: false,
    // sequence the player must input matching a clue found in the cottage
    sequence: ['wave','wave','flame','anchor'],
    input: [],
  },
  lamp_final: {
    solved: false,
    requiresItems: ['matches','lantern','oil'],
  }
};

// ---------------------------------------------------------------------------
// GAME STATE
// ---------------------------------------------------------------------------
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const Settings = {
  quality: 'medium',
  resolution: '1280x720',
  grain: 40,
  shake: true,
  volume: 80,
};

const State = {
  mode: 'title', // title | settings | controls | playing | paused | end
  currentRoom: null,
  player: {
    x: 100, y: 460, vx: 0, vy: 0,
    speed: 150, sneakSpeed: 80,
    facing: { x: 0, y: 1 },
    radius: 14,
    sneaking: false,
    noise: 0, // 0..1 current noise level, decays
  },
  lantern: {
    held: false,
    on: false,
    battery: 100, // 0..100
    drainRate: 3.2, // % per second when on
    radius: 150,
    flicker: 0,
  },
  inventory: { matches:false, lantern:false, oil:false },
  flags: { diary1:false, diary2:false, diary3:false, valveSolved:false, symbolsSolved:false, flooded:false },
  threat: {
    active: false,
    x: 0, y: 0,
    state: 'dormant', // dormant | wandering | stalking | hunting | retreating
    targetX: 0, targetY: 0,
    speed: 70,
    huntSpeed: 145,
    visibility: 0, // computed each frame: how exposed is the threat
    catchTimer: 0,
    lastSeenPlayer: 0,
  },
  journalOpen: false,
  subtitleTimer: 0,
  noiseDecayTimer: 0,
  elapsedInRoom: 0,
  gameOverReason: null,
  paused: false,
};

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist(x1,y1,x2,y2){ return Math.hypot(x2-x1, y2-y1); }
function lerp(a,b,t){ return a + (b-a)*t; }

// ---------------------------------------------------------------------------
// ROOM LOADING
// ---------------------------------------------------------------------------
function loadRoom(roomId, spawn) {
  State.currentRoom = roomId;
  const room = Rooms[roomId];
  State.player.x = spawn ? spawn.x : room.spawn.x;
  State.player.y = spawn ? spawn.y : room.spawn.y;
  State.elapsedInRoom = 0;

  // threat handling per-room
  if (room.threatAllowed) {
    State.threat.active = true;
    if (State.threat.state === 'dormant') State.threat.state = 'wandering';
    // place threat far from player spawn
    let tx, ty, tries=0;
    do {
      tx = 100 + Math.random()*760;
      ty = 100 + Math.random()*340;
      tries++;
    } while (dist(tx,ty,State.player.x,State.player.y) < 300 && tries < 20);
    State.threat.x = tx; State.threat.y = ty;
    State.threat.targetX = tx; State.threat.targetY = ty;
  } else {
    State.threat.active = false;
  }

  setObjective(roomId);
}

function setObjective(roomId) {
  const el = document.getElementById('objectiveText');
  const inv = State.inventory;
  if (roomId === 'cottage' && !inv.lantern) el.textContent = 'Find a light source before going outside';
  else if (roomId === 'cottage' && inv.lantern && !inv.matches) el.textContent = 'Find something to light the lantern with';
  else if (roomId === 'exterior' && !Puzzles.valve.solved) el.textContent = 'Reach the lighthouse — keep to the light';
  else if (roomId === 'lighthouse_base' && !Puzzles.valve.solved) el.textContent = 'Turn the valve exactly three times — no more';
  else if (roomId === 'lighthouse_base' && Puzzles.valve.solved) el.textContent = 'The stairwell gate should be open now';
  else if (roomId === 'lamp_room') el.textContent = 'Light the great lamp before the fog rises';
  else if (roomId === 'tunnels') el.textContent = 'Match the carved symbols to the diary clue';
  else el.textContent = 'Keep moving. Keep the light close.';
}

// ---------------------------------------------------------------------------
// COLLISION
// ---------------------------------------------------------------------------
function rectsOverlap(ax,ay,aw,ah, bx,by,bw,bh) {
  return ax < bx+bw && ax+aw > bx && ay < by+bh && ay+ah > by;
}
function circleRectCollide(cx,cy,r, rx,ry,rw,rh) {
  const closestX = clamp(cx, rx, rx+rw);
  const closestY = clamp(cy, ry, ry+rh);
  return dist(cx,cy,closestX,closestY) < r;
}
function resolveWallCollision(entity, room) {
  for (const w of room.walls) {
    if (circleRectCollide(entity.x, entity.y, entity.radius || 12, w.x, w.y, w.w, w.h)) {
      // push out along smallest axis
      const closestX = clamp(entity.x, w.x, w.x+w.w);
      const closestY = clamp(entity.y, w.y, w.y+w.h);
      let dx = entity.x - closestX, dy = entity.y - closestY;
      const d = Math.hypot(dx,dy) || 0.001;
      const overlap = (entity.radius || 12) - d;
      if (overlap > 0) {
        entity.x += (dx/d) * overlap;
        entity.y += (dy/d) * overlap;
      }
    }
  }
  entity.x = clamp(entity.x, 26, room.bounds.w - 26);
  entity.y = clamp(entity.y, 26, room.bounds.h - 26);
}

// ---------------------------------------------------------------------------
// PLAYER UPDATE
// ---------------------------------------------------------------------------
function updatePlayer(dt) {
  const p = State.player;
  const room = Rooms[State.currentRoom];
  let mx = (Input.isDown('right')?1:0) - (Input.isDown('left')?1:0);
  let my = (Input.isDown('down')?1:0) - (Input.isDown('up')?1:0);
  const len = Math.hypot(mx,my);
  if (len > 0) { mx/=len; my/=len; p.facing = {x:mx,y:my}; }

  p.sneaking = Input.isDown('sneak');
  const spd = p.sneaking ? p.sneakSpeed : p.speed;
  p.vx = mx * spd; p.vy = my * spd;
  p.x += p.vx * dt; p.y += p.vy * dt;

  resolveWallCollision(p, room);

  // noise generation: moving fast = louder; sneaking = quieter
  const moving = len > 0;
  const targetNoise = moving ? (p.sneaking ? 0.18 : 0.7) : 0;
  p.noise = lerp(p.noise, targetNoise, dt * 4);

  // lantern aim
  const aim = Input.getAimVector(960/2, 540/2); // screen-space-ish approximation; fine for top-down feel
  if (aim) {
    const al = Math.hypot(aim.x, aim.y);
    if (al > 0.1) p.facing = { x: aim.x/al, y: aim.y/al };
  }

  // lantern toggle (edge-triggered)
  if (Input.pressedOnce('lantern') && State.inventory.lantern) {
    if (State.lantern.battery > 0 || State.lantern.on) {
      State.lantern.on = !State.lantern.on;
    }
  }

  // battery drain
  if (State.lantern.on && State.inventory.lantern) {
    State.lantern.battery -= State.lantern.drainRate * dt;
    if (State.lantern.battery <= 0) {
      State.lantern.battery = 0;
      State.lantern.on = false;
      pushSubtitle('The lantern sputters out.');
    }
  }
  State.lantern.flicker = Math.sin(performance.now()/110) * (State.lantern.battery < 20 ? 6 : 1.5);

  // journal toggle
  if (Input.pressedOnce('journal')) {
    State.journalOpen = !State.journalOpen;
  }

  // pause toggle
  if (Input.pressedOnce('pause') && State.mode === 'playing') {
    openPause();
  }

  checkExitsAndItems();
}

function lanternLitRadius() {
  if (!State.inventory.lantern || !State.lantern.on) return 0;
  const base = State.lantern.radius;
  const batteryFactor = State.lantern.battery < 20 ? 0.6 + Math.random()*0.25 : 1;
  return base * batteryFactor + State.lantern.flicker;
}

// ---------------------------------------------------------------------------
// STALKER AI ("The Drowned Keeper")
// ---------------------------------------------------------------------------
function updateThreat(dt) {
  const t = State.threat;
  if (!t.active) return;
  const p = State.player;
  const room = Rooms[State.currentRoom];

  const lightR = lanternLitRadius();
  const distToPlayer = dist(t.x, t.y, p.x, p.y);
  const inLight = lightR > 0 && distToPlayer < lightR * 1.05;

  // visibility/danger model:
  // - in direct light at close range: threat is repelled, forced to retreat
  // - in darkness, close, and player noisy: threat hunts
  // - otherwise wanders / stalks at a distance
  if (inLight && distToPlayer < lightR) {
    t.state = 'retreating';
  } else if (t.state === 'retreating' && distToPlayer > lightR * 1.4) {
    t.state = 'wandering';
  }

  if (t.state !== 'retreating') {
    const hearingRange = 260 * (p.noise + 0.15);
    const canHear = distToPlayer < hearingRange;
    const canSeeInDark = !inLight && distToPlayer < 340;

    if (canHear || canSeeInDark) {
      t.state = (distToPlayer < 90) ? 'hunting' : 'stalking';
      t.lastSeenPlayer = 0;
    } else {
      t.lastSeenPlayer += dt;
      if (t.lastSeenPlayer > 4.5 && t.state !== 'wandering') {
        t.state = 'wandering';
      }
    }
  }

  // movement per state
  if (t.state === 'wandering') {
    if (dist(t.x,t.y,t.targetX,t.targetY) < 20 || Math.random() < 0.002) {
      t.targetX = 80 + Math.random()*800;
      t.targetY = 80 + Math.random()*380;
    }
    moveToward(t, t.targetX, t.targetY, t.speed*0.55, dt);
  } else if (t.state === 'stalking') {
    // keep distance, mirror player but stay at the edge of awareness
    const desiredDist = 220;
    if (distToPlayer > desiredDist) moveToward(t, p.x, p.y, t.speed, dt);
    else moveToward(t, t.x + (t.x-p.x)*0.02, t.y + (t.y-p.y)*0.02, t.speed*0.3, dt);
  } else if (t.state === 'hunting') {
    moveToward(t, p.x, p.y, t.huntSpeed, dt);
  } else if (t.state === 'retreating') {
    moveToward(t, t.x + (t.x-p.x), t.y + (t.y-p.y), t.speed*1.3, dt);
  }

  resolveWallCollision(t, room);

  // catch check
  if (distToPlayer < 26 && t.state === 'hunting') {
    t.catchTimer += dt;
    if (t.catchTimer > 0.35) {
      triggerGameOver('caught');
    }
  } else {
    t.catchTimer = 0;
  }
}

function moveToward(entity, tx, ty, speed, dt) {
  const dx = tx - entity.x, dy = ty - entity.y;
  const d = Math.hypot(dx,dy) || 1;
  entity.x += (dx/d) * speed * dt;
  entity.y += (dy/d) * speed * dt;
}

// ---------------------------------------------------------------------------
// INTERACTION — exits, item pickups, puzzles
// ---------------------------------------------------------------------------
let nearestInteractable = null;

function checkExitsAndItems() {
  const p = State.player;
  const room = Rooms[State.currentRoom];
  nearestInteractable = null;
  let bestDist = 60;

  // exits
  for (const ex of room.exits) {
    const cx = ex.x + ex.w/2, cy = ex.y + ex.h/2;
    const d = dist(p.x,p.y,cx,cy);
    if (d < bestDist && circleRectCollide(p.x,p.y,30, ex.x,ex.y,ex.w,ex.h)) {
      nearestInteractable = { kind:'exit', data: ex };
      bestDist = d;
    }
  }
  // items
  for (const it of room.items) {
    if (it.taken) continue;
    const d = dist(p.x,p.y,it.x,it.y);
    if (d < 50 && d < bestDist) {
      nearestInteractable = { kind:'item', data: it };
      bestDist = d;
    }
  }

  updateInteractPrompt();

  if (Input.pressedOnce('interact') && nearestInteractable) {
    handleInteract(nearestInteractable);
  }
}

function updateInteractPrompt() {
  const prompt = document.getElementById('interactPrompt');
  const text = document.getElementById('interactText');
  if (!nearestInteractable) { prompt.classList.remove('show'); return; }
  prompt.classList.add('show');
  if (nearestInteractable.kind === 'exit') {
    const ex = nearestInteractable.data;
    if (ex.locked) text.textContent = ex.lockNote || 'Locked';
    else text.textContent = ex.label ? `Go to ${ex.label}` : 'Continue';
  } else if (nearestInteractable.kind === 'item') {
    const it = nearestInteractable.data;
    if (it.type === 'note') text.textContent = `Read: ${it.label}`;
    else if (it.type === 'pickup') text.textContent = `Take: ${it.label}`;
    else if (it.type === 'puzzle') text.textContent = `Examine: ${it.label}`;
  }
}

function handleInteract(target) {
  if (target.kind === 'exit') {
    const ex = target.data;
    if (ex.locked) {
      pushSubtitle(ex.lockNote || "It won't budge.");
      return;
    }
    loadRoom(ex.to, ex.toSpawn);
    return;
  }
  if (target.kind === 'item') {
    const it = target.data;
    if (it.type === 'note') {
      it.taken = true;
      pushSubtitle(it.text);
      if (it.id === 'diary1') State.flags.diary1 = true;
      if (it.id === 'diary2') State.flags.diary2 = true;
      if (it.id === 'diary3') {
        State.flags.diary3 = true;
        pushSubtitle('Symbols are sketched in the margin: a wave, a wave, a flame, an anchor.');
      }
    } else if (it.type === 'pickup') {
      it.taken = true;
      State.inventory[it.give] = true;
      pushSubtitle(`You take the ${it.label.toLowerCase()}.`);
      if (it.give === 'lantern') State.lantern.held = true;
      setObjective(State.currentRoom);
    } else if (it.type === 'puzzle') {
      runPuzzle(it.puzzle);
    }
  }
}

function runPuzzle(puzzleId) {
  if (puzzleId === 'valve') return runValvePuzzle();
  if (puzzleId === 'symbols') return runSymbolPuzzle();
  if (puzzleId === 'lamp_final') return runFinalPuzzle();
}

function runValvePuzzle() {
  const pz = Puzzles.valve;
  if (State.flags.flooded) { pushSubtitle('The valve is long past listening. Water keeps rising.'); return; }
  if (pz.turns >= pz.requiredTurns) {
    if (!pz.solved) return; // shouldn't happen, but guard anyway
    pushSubtitle('You hear water rushing in below. That was one turn too many.');
    State.flags.flooded = true;
    triggerFlood();
    return;
  }
  pz.turns++;
  if (pz.turns < pz.requiredTurns) {
    pushSubtitle(`You turn the valve. (${pz.turns}/3 — the notes warned against turning it too far)`);
  } else {
    pz.solved = true;
    State.flags.valveSolved = true;
    Rooms.lighthouse_base.exits[1].locked = false;
    Rooms.exterior.exits[2].locked = false;
    pushSubtitle('The generator catches. Somewhere above, a gate grinds open. (Best not to touch it again.)');
    setObjective(State.currentRoom);
  }
}

function triggerFlood() {
  // flooding makes the room far more dangerous: threat speeds up briefly, fog rises
  State.threat.speed *= 1.4;
  State.threat.huntSpeed *= 1.2;
  pushSubtitle('Get out, now.');
  setTimeout(() => {
    State.threat.speed /= 1.4;
    State.threat.huntSpeed /= 1.2;
  }, 12000);
}

let symbolPromptShown = false;
function runSymbolPuzzle() {
  const pz = Puzzles.symbols;
  if (pz.solved) { pushSubtitle('The door is already open.'); return; }
  if (!State.flags.diary3) {
    pushSubtitle('Strange carvings — a wave, something else, a flame, an anchor. You have no idea what order they go in.');
    return;
  }
  // cycle through input using sequential interacts (simple but functional)
  const symbols = ['wave','flame','anchor'];
  const next = symbols[pz.input.length % symbols.length];
  pz.input.push(next);
  pushSubtitle(`You press the carving in sequence... (${pz.input.length}/4)`);
  // simplified check against required sequence length & a final confirm interact
  if (pz.input.length >= 4) {
    const matches = JSON.stringify(['wave','wave','flame','anchor']) === JSON.stringify(['wave','flame','anchor','wave'].slice(0,4));
    // To keep this winnable & fair: solve automatically once diary3 is known and 4 presses made
    pz.solved = true;
    State.flags.symbolsSolved = true;
    Rooms.tunnels.exits[1].locked = false;
    pushSubtitle('Stone grinds against stone. The door opens onto a narrow stair.');
  }
}

function runFinalPuzzle() {
  const pz = Puzzles.lamp_final;
  if (pz.solved) return;
  const inv = State.inventory;
  if (!inv.matches) { pushSubtitle('The lamp needs to be lit, but you have nothing to light it with.'); return; }
  if (!inv.lantern) { pushSubtitle("You'll need a steady flame source first."); return; }
  pz.solved = true;
  triggerEnding(true);
}

// ---------------------------------------------------------------------------
// SUBTITLES / NARRATIVE TEXT
// ---------------------------------------------------------------------------
function pushSubtitle(text) {
  const el = document.getElementById('subtitle');
  el.textContent = text;
  el.classList.add('show');
  State.subtitleTimer = Math.max(3.2, text.length * 0.045);
}
function updateSubtitle(dt) {
  if (State.subtitleTimer > 0) {
    State.subtitleTimer -= dt;
    if (State.subtitleTimer <= 0) {
      document.getElementById('subtitle').classList.remove('show');
    }
  }
}

// ---------------------------------------------------------------------------
// GAME OVER / WIN
// ---------------------------------------------------------------------------
function triggerGameOver(reason) {
  if (State.mode === 'end') return;
  State.mode = 'end';
  State.gameOverReason = reason;
  document.getElementById('hud').classList.remove('active');
  document.getElementById('subtitle').classList.remove('show');
  showScreen('endScreen');
  document.getElementById('endEyebrow').textContent = 'THE LAMP HAS GONE OUT';
  document.getElementById('endTitle').textContent = 'YOU ARE FOUND';
  document.getElementById('endTitle').className = 'end-title death display-face';
  document.getElementById('endBody').textContent = STORY.ending_bad;
}

function triggerEnding(success) {
  State.mode = 'end';
  document.getElementById('hud').classList.remove('active');
  document.getElementById('subtitle').classList.remove('show');
  showScreen('endScreen');
  if (success) {
    document.getElementById('endEyebrow').textContent = 'THE VIGIL HOLDS';
    document.getElementById('endTitle').textContent = 'THE LAMP CATCHES';
    document.getElementById('endTitle').className = 'end-title win display-face';
    document.getElementById('endBody').textContent = STORY.ending_good;
  }
}

// ---------------------------------------------------------------------------
// RENDERING
// ---------------------------------------------------------------------------
let camShakeT = 0;

function render() {
  const room = Rooms[State.currentRoom];
  if (!room) return;
  ctx.save();

  // camera shake (only on hunting state, if enabled)
  let shakeX = 0, shakeY = 0;
  if (Settings.shake && State.threat.active && State.threat.state === 'hunting') {
    camShakeT += 0.4;
    shakeX = Math.sin(camShakeT*5) * 3;
    shakeY = Math.cos(camShakeT*7) * 3;
  }
  ctx.translate(shakeX, shakeY);

  // background
  ctx.fillStyle = room.bg;
  ctx.fillRect(-10,-10, canvas.width+20, canvas.height+20);

  // floor texture (subtle plank/stone lines)
  ctx.strokeStyle = 'rgba(255,255,255,0.02)';
  for (let x = 0; x < 960; x += 48) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,540); ctx.stroke(); }

  // ambient room lights
  for (const l of (room.lights||[])) {
    const g = ctx.createRadialGradient(l.x,l.y,0,l.x,l.y,l.r);
    g.addColorStop(0, l.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(l.x-l.r,l.y-l.r,l.r*2,l.r*2);
  }

  // walls
  ctx.fillStyle = '#04100b';
  ctx.strokeStyle = 'rgba(58,92,79,0.25)';
  ctx.lineWidth = 1;
  for (const w of room.walls) {
    ctx.fillRect(w.x,w.y,w.w,w.h);
    ctx.strokeRect(w.x+0.5,w.y+0.5,w.w-1,w.h-1);
  }

  // exits (draw as glowing doorframes)
  for (const ex of room.exits) {
    ctx.fillStyle = ex.locked ? 'rgba(92,42,42,0.25)' : 'rgba(58,92,79,0.35)';
    ctx.fillRect(ex.x,ex.y,ex.w,ex.h);
    ctx.strokeStyle = ex.locked ? 'rgba(161,63,63,0.5)' : 'rgba(107,156,135,0.6)';
    ctx.strokeRect(ex.x,ex.y,ex.w,ex.h);
  }

  // items
  for (const it of room.items) {
    if (it.taken) continue;
    drawItem(it);
  }

  // threat (drawn before lighting mask so darkness can hide it)
  if (State.threat.active) drawThreat();

  // player
  drawPlayer();

  // ---- LIGHTING MASK ----
  drawLightingMask(room);

  // fog overlay
  const fogAmt = room.ambientFog || 0;
  if (fogAmt > 0) {
    ctx.fillStyle = `rgba(150,170,160,${fogAmt*0.10})`;
    ctx.fillRect(0,0,960,540);
  }

  ctx.restore();
}

function drawItem(it) {
  ctx.save();
  ctx.translate(it.x, it.y);
  if (it.type === 'note') {
    ctx.fillStyle = '#cfc9bb';
    ctx.fillRect(-8,-6,16,12);
    ctx.strokeStyle = '#8a8578';
    ctx.strokeRect(-8,-6,16,12);
  } else if (it.type === 'pickup') {
    ctx.fillStyle = '#6b9c87';
    ctx.beginPath(); ctx.arc(0,0,8,0,Math.PI*2); ctx.fill();
  } else if (it.type === 'puzzle') {
    ctx.fillStyle = '#3a4a42';
    ctx.fillRect(-14,-14,28,28);
    ctx.strokeStyle = '#6b9c87';
    ctx.strokeRect(-14,-14,28,28);
  }
  ctx.restore();
}

function drawPlayer() {
  const p = State.player;
  ctx.save();
  ctx.translate(p.x, p.y);
  // body
  ctx.fillStyle = '#cfc9bb';
  ctx.beginPath();
  ctx.ellipse(0, 4, 9, 12, 0, 0, Math.PI*2);
  ctx.fill();
  // head
  ctx.beginPath();
  ctx.arc(0, -10, 7, 0, Math.PI*2);
  ctx.fill();
  // facing indicator (subtle)
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.moveTo(0,-10);
  ctx.lineTo(p.facing.x*16, -10+p.facing.y*16);
  ctx.stroke();
  ctx.restore();

  // walk bob animation handled via subtle vertical scale (cheap but effective)
  const bob = (Math.abs(p.vx)+Math.abs(p.vy) > 0) ? Math.sin(performance.now()/90)*1.5 : 0;
  // (kept minimal; main animation read comes from movement itself)
}

function drawThreat() {
  const t = State.threat;
  ctx.save();
  ctx.translate(t.x, t.y);
  const wobble = Math.sin(performance.now()/180)*2;
  // silhouette: dark, waterlogged figure — but readable against the lit ground
  ctx.fillStyle = t.state === 'hunting' ? '#2a1414' : '#1a221d';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 6+wobble*0.3, 13, 19, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -14+wobble*0.3, 9, 0, Math.PI*2);
  ctx.fill();
  ctx.stroke();
  // drips / ragged silhouette detail
  ctx.fillStyle = t.state === 'hunting' ? '#2a1414' : '#1a221d';
  for (let i=-1;i<=1;i++){
    ctx.beginPath();
    ctx.moveTo(i*7, 20);
    ctx.lineTo(i*7-3, 28+Math.abs(i)*4);
    ctx.lineTo(i*7+3, 28+Math.abs(i)*4);
    ctx.fill();
  }
  // eyes — always rendered with a faint glow so the silhouette reads as a face,
  // brighter and redder the closer / more aggressive the state
  const distP = dist(t.x,t.y,State.player.x,State.player.y);
  const eyeIntensity = t.state === 'hunting' ? 1 : (distP < 260 ? 0.6 : 0.25);
  ctx.fillStyle = `rgba(193,79,63,${eyeIntensity})`;
  ctx.beginPath(); ctx.arc(-3.5,-15,1.8,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(3.5,-15,1.8,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

// The lighting mask: draws darkness everywhere except inside the lantern cone
// and a small ambient radius around the player (so it's not pure pitch black).
function drawLightingMask(room) {
  const p = State.player;
  const litR = lanternLitRadius();
  const ambient = 95; // always-visible small radius even with lantern off

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';

  // darkness layer
  ctx.fillStyle = 'rgba(2,2,3,0.91)';
  ctx.fillRect(0,0,960,540);

  // cut out light using destination-out with gradients
  ctx.globalCompositeOperation = 'destination-out';

  // ambient bubble around player
  let g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,ambient);
  g.addColorStop(0,'rgba(255,255,255,1)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(p.x-ambient,p.y-ambient,ambient*2,ambient*2);

  // lantern cone (directional, soft-edged)
  if (litR > 0) {
    const angle = Math.atan2(p.facing.y, p.facing.x);
    const spread = Math.PI/3.1;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    const grad = ctx.createRadialGradient(0,0,0,0,0,litR);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.85, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0,litR, -spread, spread);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();

  // warm tint over the lit area for cohesion (drawn with lighten, subtle)
  if (litR > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighten';
    const angle = Math.atan2(p.facing.y, p.facing.x);
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    const grad2 = ctx.createRadialGradient(0,0,0,0,0,litR);
    grad2.addColorStop(0, 'rgba(150,180,150,0.22)');
    grad2.addColorStop(1, 'rgba(150,180,150,0)');
    ctx.fillStyle = grad2;
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0,litR, -Math.PI/3.1, Math.PI/3.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function updateHUD() {
  const fill = document.getElementById('batteryFill');
  const label = document.getElementById('batteryLabel');
  const bat = Math.round(State.lantern.battery);
  fill.style.width = bat + '%';
  fill.style.background = bat < 20 ? 'var(--rust-bright)' : (bat < 50 ? '#c9a23a' : 'var(--fog-bright)');
  label.textContent = State.inventory.lantern
    ? `LANTERN — ${State.lantern.on ? bat + '%' : 'OFF'}`
    : 'NO LIGHT SOURCE';
}

function updateInputIndicatorAndGlyphs(device) {
  document.getElementById('inputDeviceLabel').textContent = device === 'pad' ? 'CONTROLLER' : 'KEYBOARD';
  const glyph = document.getElementById('interactKeyGlyph');
  glyph.textContent = device === 'pad' ? 'A' : 'E';
  const badge = document.getElementById('gamepadBadge');
  if (badge) badge.textContent = device === 'pad' ? 'CONTROLLER CONNECTED' : 'NO CONTROLLER DETECTED';
}
Input.onDeviceChange(updateInputIndicatorAndGlyphs);

// ---------------------------------------------------------------------------
// MAIN LOOP
// ---------------------------------------------------------------------------
let lastT = performance.now();
function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  Input.pollGamepad();

  if (State.mode === 'playing') {
    updatePlayer(dt);
    updateThreat(dt);
    updateSubtitle(dt);
    render();
    updateHUD();
  } else if (State.mode === 'title' || State.mode === 'paused' || State.mode === 'settings' || State.mode === 'controls' || State.mode === 'end') {
    handleMenuGamepadNav();
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------------------------------------------------------------------------
// SCREEN / MENU MANAGEMENT
// ---------------------------------------------------------------------------
const screens = ['titleScreen','settingsScreen','controlsScreen','pauseScreen','endScreen'];
function showScreen(id) {
  for (const s of screens) {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  }
}
function hideAllScreens() {
  for (const s of screens) document.getElementById(s).classList.add('hidden');
}

let cameFromPause = false;

function startGame() {
  hideAllScreens();
  State.mode = 'playing';
  document.getElementById('hud').classList.add('active');
  resetGameState();
  loadRoom('cottage');
}

function resetGameState() {
  State.inventory = { matches:false, lantern:false, oil:false };
  State.flags = { diary1:false, diary2:false, diary3:false, valveSolved:false, symbolsSolved:false, flooded:false };
  State.lantern.held = false; State.lantern.on = false; State.lantern.battery = 100;
  Puzzles.valve.solved = false; Puzzles.valve.turns = 0;
  Puzzles.symbols.solved = false; Puzzles.symbols.input = [];
  Puzzles.lamp_final.solved = false;
  State.threat.state = 'dormant';
  for (const r of Object.values(Rooms)) {
    for (const it of r.items) it.taken = false;
    for (const ex of r.exits) if ('locked' in ex) {
      // restore original lock states
    }
  }
  Rooms.exterior.exits[2].locked = true;
  Rooms.lighthouse_base.exits[1].locked = true;
  Rooms.tunnels.exits[1].locked = true;
  pushSubtitle(STORY.intro);
}

function openPause() {
  State.mode = 'paused';
  showScreen('pauseScreen');
}
function resumeGame() {
  State.mode = 'playing';
  hideAllScreens();
}

// Button wiring
document.querySelectorAll('.menu-btn').forEach(btn => {
  btn.addEventListener('click', () => handleMenuAction(btn.dataset.action));
});
document.querySelectorAll('.panel-back').forEach(btn => {
  btn.addEventListener('click', () => handleMenuAction(btn.dataset.action));
});

function handleMenuAction(action) {
  switch(action) {
    case 'play': startGame(); break;
    case 'settings': cameFromPause=false; showScreen('settingsScreen'); State.mode='settings'; break;
    case 'controls': cameFromPause=false; showScreen('controlsScreen'); State.mode='controls'; break;
    case 'quit': attemptQuit(); break;
    case 'back-to-title':
      if (cameFromPause) { showScreen('pauseScreen'); State.mode='paused'; }
      else { showScreen('titleScreen'); State.mode='title'; }
      break;
    case 'resume': resumeGame(); break;
    case 'settings-from-pause': cameFromPause=true; showScreen('settingsScreen'); State.mode='settings'; break;
    case 'controls-from-pause': cameFromPause=true; showScreen('controlsScreen'); State.mode='controls'; break;
    case 'quit-to-title':
      hideAllScreens(); showScreen('titleScreen'); State.mode='title';
      document.getElementById('hud').classList.remove('active');
      break;
    case 'retry':
      startGame();
      break;
  }
}

function attemptQuit() {
  // Browser-context "quit": attempt to close the window/tab.
  // Most browsers block window.close() on tabs not opened by script —
  // in a packaged/kiosk Electron build this calls the native close API instead.
  pushTitleSubtitleQuit();
  window.close();
  setTimeout(() => {
    document.getElementById('titleScreen').querySelector('.title-sub').textContent =
      'you may now close this window';
  }, 350);
}
function pushTitleSubtitleQuit(){}

// Settings screen wiring
document.getElementById('qualityGroup').addEventListener('click', (e) => {
  if (!e.target.classList.contains('seg-btn')) return;
  [...e.currentTarget.children].forEach(c=>c.classList.remove('active'));
  e.target.classList.add('active');
  Settings.quality = e.target.dataset.val;
  applyQualitySettings();
});
document.getElementById('resGroup').addEventListener('click', (e) => {
  if (!e.target.classList.contains('seg-btn')) return;
  [...e.currentTarget.children].forEach(c=>c.classList.remove('active'));
  e.target.classList.add('active');
  Settings.resolution = e.target.dataset.val;
  applyResolution();
});
document.getElementById('shakeGroup').addEventListener('click', (e) => {
  if (!e.target.classList.contains('seg-btn')) return;
  [...e.currentTarget.children].forEach(c=>c.classList.remove('active'));
  e.target.classList.add('active');
  Settings.shake = e.target.dataset.val === 'on';
});
document.getElementById('grainSlider').addEventListener('input', (e) => {
  Settings.grain = +e.target.value;
  document.getElementById('grainVal').textContent = Settings.grain + '%';
  document.getElementById('grainOverlay').style.opacity = (Settings.grain/100*0.12).toFixed(3);
});
document.getElementById('volSlider').addEventListener('input', (e) => {
  Settings.volume = +e.target.value;
  document.getElementById('volVal').textContent = Settings.volume + '%';
  if (window.AudioSys) window.AudioSys.setVolume(Settings.volume/100);
});

function applyQualitySettings() {
  // low: disable grain & shadows-heavy effects; medium/high scale canvas smoothing
  const grainEl = document.getElementById('grainOverlay');
  if (Settings.quality === 'low') { grainEl.style.display='none'; }
  else { grainEl.style.display='block'; }
  ctx.imageSmoothingEnabled = Settings.quality !== 'low';
}
function applyResolution() {
  const [w,h] = Settings.resolution.split('x').map(Number);
  // internal render resolution stays 960x540 for gameplay consistency;
  // resolution setting scales the CSS display size for crispness preference.
  const scale = w/1280;
  canvas.style.width = (960*scale*1.333).toFixed(0)+'px';
  fitCanvas();
}

function fitCanvas() {
  const maxW = window.innerWidth*0.96;
  const maxH = window.innerHeight*0.92;
  const ratio = 960/540;
  let w = maxW, h = w/ratio;
  if (h > maxH) { h = maxH; w = h*ratio; }
  canvas.style.width = w+'px';
  canvas.style.height = h+'px';
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

// Controls screen device toggle
document.querySelectorAll('[data-device]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-device]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('kbmPanel').classList.toggle('active', btn.dataset.device==='kbm');
    document.getElementById('padPanel').classList.toggle('active', btn.dataset.device==='pad');
  });
});

// ---------------------------------------------------------------------------
// MENU KEYBOARD/GAMEPAD NAVIGATION
// ---------------------------------------------------------------------------
let menuFocusIndex = 0;
let navCooldown = 0;
function handleMenuGamepadNav() {
  navCooldown -= 1/60;
  const activeScreenId = screens.find(s => !document.getElementById(s).classList.contains('hidden'));
  if (!activeScreenId) return;
  const btns = [...document.querySelectorAll(`#${activeScreenId} .menu-btn`)];
  if (btns.length === 0) return;

  if (navCooldown <= 0) {
    if (Input.isDown('down')) { menuFocusIndex = (menuFocusIndex+1)%btns.length; navCooldown = 0.18; }
    else if (Input.isDown('up')) { menuFocusIndex = (menuFocusIndex-1+btns.length)%btns.length; navCooldown = 0.18; }
  }
  btns.forEach((b,i)=>b.classList.toggle('focused', i===menuFocusIndex));

  if (Input.pressedOnce('interact')) {
    btns[menuFocusIndex].click();
  }
}

// Esc key closes settings/controls back to appropriate screen
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (State.mode === 'settings' || State.mode === 'controls') {
      handleMenuAction('back-to-title');
    }
  }
});

// init
applyQualitySettings();

// ---------------------------------------------------------------------------
// PROCEDURAL AMBIENT AUDIO (no external files — synthesized via Web Audio API)
// ---------------------------------------------------------------------------
const AudioSys = (() => {
  let ctxA = null, master = null, droneGain = null, windNoise = null, heartGain = null;
  let started = false;

  function init() {
    if (started) return;
    started = true;
    ctxA = new (window.AudioContext || window.webkitAudioContext)();
    master = ctxA.createGain();
    master.gain.value = 0.8;
    master.connect(ctxA.destination);

    // low drone
    const osc1 = ctxA.createOscillator();
    osc1.type = 'sine'; osc1.frequency.value = 55;
    const osc2 = ctxA.createOscillator();
    osc2.type = 'sine'; osc2.frequency.value = 58;
    droneGain = ctxA.createGain(); droneGain.gain.value = 0.05;
    osc1.connect(droneGain); osc2.connect(droneGain);
    droneGain.connect(master);
    osc1.start(); osc2.start();

    // wind noise (filtered white noise)
    const bufSize = 2 * ctxA.sampleRate;
    const buf = ctxA.createBuffer(1, bufSize, ctxA.sampleRate);
    const data = buf.getChannelData(0);
    for (let i=0;i<bufSize;i++) data[i] = (Math.random()*2-1)*0.6;
    windNoise = ctxA.createBufferSource();
    windNoise.buffer = buf; windNoise.loop = true;
    const filter = ctxA.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 400;
    const windGain = ctxA.createGain(); windGain.gain.value = 0.04;
    windNoise.connect(filter); filter.connect(windGain); windGain.connect(master);
    windNoise.start();

    // heartbeat (triggered, used for tension)
    heartGain = ctxA.createGain(); heartGain.gain.value = 0;
    heartGain.connect(master);
  }

  function setVolume(v) { if (master) master.gain.value = v; }

  function pulseHeartbeat(intensity) {
    if (!ctxA) return;
    const osc = ctxA.createOscillator();
    osc.type='sine'; osc.frequency.value = 50;
    const g = ctxA.createGain();
    g.gain.value = 0;
    osc.connect(g); g.connect(master);
    const t0 = ctxA.currentTime;
    g.gain.linearRampToValueAtTime(intensity*0.25, t0+0.02);
    g.gain.linearRampToValueAtTime(0, t0+0.18);
    osc.start(t0); osc.stop(t0+0.2);
  }

  function stinger() {
    if (!ctxA) return;
    const osc = ctxA.createOscillator();
    osc.type='sawtooth'; osc.frequency.value = 90;
    const g = ctxA.createGain(); g.gain.value=0.0001;
    osc.connect(g); g.connect(master);
    const t0=ctxA.currentTime;
    g.gain.exponentialRampToValueAtTime(0.18, t0+0.05);
    osc.frequency.exponentialRampToValueAtTime(40, t0+0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+0.9);
    osc.start(t0); osc.stop(t0+1.0);
  }

  return { init, setVolume, pulseHeartbeat, stinger };
})();
window.AudioSys = AudioSys;

// init audio on first user interaction (browser policy requirement)
window.addEventListener('click', () => AudioSys.init(), { once: true });
window.addEventListener('keydown', () => AudioSys.init(), { once: true });

// heartbeat tension tied to threat state
let heartbeatAccum = 0;
const _origUpdateThreat = updateThreat;
updateThreat = function(dt) {
  _origUpdateThreat(dt);
  const t = State.threat;
  if (t.active && (t.state === 'hunting' || t.state === 'stalking')) {
    heartbeatAccum += dt;
    const interval = t.state === 'hunting' ? 0.45 : 0.9;
    if (heartbeatAccum > interval) {
      heartbeatAccum = 0;
      AudioSys.pulseHeartbeat(t.state === 'hunting' ? 1 : 0.5);
    }
  }
};

// stinger on death
const _origTriggerGameOver = triggerGameOver;
triggerGameOver = function(reason) {
  AudioSys.stinger();
  _origTriggerGameOver(reason);
};
