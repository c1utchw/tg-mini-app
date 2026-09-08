// ============================================================
// face-physics.js — физика кристалликов
// ============================================================

const SVG_X_MIN =   0;
const SVG_X_MAX = 800;
const SVG_Y_MIN =   0;
const SVG_Y_MAX = 400;

// +25% скорость, пружина жёстче для быстрой реакции на гравитацию
const PARAMS_ASSEMBLED = {
  outer:     { k: 0.10,  d: 0.78, n: 0.30, max: 7.0  },
  core:      { k: 0.16,  d: 0.80, n: 0.15, max: 3.5  },
  highlight: { k: 0.28,  d: 0.83, n: 0.05, max: 1.2  },
};

const PARAMS_SCATTERED = {
  outer:     { k: 0.010, d: 0.97, n: 0.275, max: 9999 },
  core:      { k: 0.013, d: 0.97, n: 0.175, max: 9999 },
  highlight: { k: 0.015, d: 0.97, n: 0.100, max: 9999 },
};

const PARAMS_REASSEMBLING = {
  outer:     { k: 0.28,  d: 0.78, n: 0.04, max: 9999 },
  core:      { k: 0.34,  d: 0.80, n: 0.02, max: 9999 },
  highlight: { k: 0.44,  d: 0.82, n: 0.01, max: 9999 },
};

let PHYSICS_MODE = 'assembled';

// Вектор гравитации — смещает точку покоя пружины
let GRAVITY_X = 0;
let GRAVITY_Y = 0;

function setGravity(gx, gy)    { GRAVITY_X = gx; GRAVITY_Y = gy; }
function getGravityX()         { return GRAVITY_X; }
function getGravityY()         { return GRAVITY_Y; }
function getPhysicsMode()      { return PHYSICS_MODE; }

// ---- Класс одного кристаллика ----

class Shard {
  constructor(el) {
    this.el = el;
    this.id = el.id;
    this.type = this._detectType(el);

    this.homeX = parseFloat(el.getAttribute('data-home-x')) || 0;
    this.homeY = parseFloat(el.getAttribute('data-home-y')) || 0;

    this.dx = 0;
    this.dy = 0;
    this.vx = 0;
    this.vy = 0;

    this.scatterTargetDx = 0;
    this.scatterTargetDy = 0;

    this._noiseAngle  = Math.random() * Math.PI * 2;
    this._noiseTimer  = 0;
    this._noiseChange = 300 + Math.random() * 500;

    // Кеш последнего трансформа — избегаем лишних записей в DOM
    this._lastTx = null;
    this._lastTy = null;
  }

  applyImpulse(ix, iy) {
    this.vx += ix;
    this.vy += iy;
  }

  assignScatterTarget() {
    const corners = [
      { x: SVG_X_MIN + 60, y: SVG_Y_MIN + 60 },
      { x: SVG_X_MAX - 60, y: SVG_Y_MIN + 60 },
      { x: SVG_X_MIN + 60, y: SVG_Y_MAX - 60 },
      { x: SVG_X_MAX - 60, y: SVG_Y_MAX - 60 },
    ];
    const corner = corners[Math.floor(Math.random() * corners.length)];
    const spread = 80;
    const targetX = corner.x + (Math.random() * 2 - 1) * spread;
    const targetY = corner.y + (Math.random() * 2 - 1) * spread;
    this.scatterTargetDx = targetX - this.homeX;
    this.scatterTargetDy = targetY - this.homeY;
  }

  tick(dt) {
    const dtNorm = dt / 16.67;

    let params;
    if      (PHYSICS_MODE === 'scattered')    params = PARAMS_SCATTERED[this.type];
    else if (PHYSICS_MODE === 'reassembling') params = PARAMS_REASSEMBLING[this.type];
    else                                       params = PARAMS_ASSEMBLED[this.type];

    // --- Шум ---
    this._noiseTimer += dt;
    if (this._noiseTimer >= this._noiseChange) {
      this._noiseAngle  = Math.random() * Math.PI * 2;
      this._noiseTimer  = 0;
      this._noiseChange = 300 + Math.random() * 500;
    }
    const ns = Math.sin(this._noiseTimer / this._noiseChange * Math.PI) * params.n;
    this.vx += Math.cos(this._noiseAngle) * ns * dtNorm;
    this.vy += Math.sin(this._noiseAngle) * ns * dtNorm;

    // --- Пружина ---
    if (PHYSICS_MODE === 'scattered') {
      this.vx += (this.scatterTargetDx - this.dx) * params.k * dtNorm;
      this.vy += (this.scatterTargetDy - this.dy) * params.k * dtNorm;
    } else {
      // Точка покоя смещена гравитацией
      const gravScale =
        this.type === 'outer'     ? 1.0 :
        this.type === 'core'      ? 0.6 :
        /* highlight */              0.2;
      const eqX = GRAVITY_X * gravScale;
      const eqY = GRAVITY_Y * gravScale;
      this.vx += (eqX - this.dx) * params.k * dtNorm;
      this.vy += (eqY - this.dy) * params.k * dtNorm;
    }

    // --- Затухание ---
    const damp = Math.pow(params.d, dtNorm);
    this.vx *= damp;
    this.vy *= damp;

    // --- Интеграция ---
    this.dx += this.vx * dtNorm;
    this.dy += this.vy * dtNorm;

    // --- Ограничение max (assembled) ---
    if (PHYSICS_MODE === 'assembled' && params.max < 9999) {
      const gravScale =
        this.type === 'outer' ? 1.0 : this.type === 'core' ? 0.6 : 0.2;
      const eqX = GRAVITY_X * gravScale;
      const eqY = GRAVITY_Y * gravScale;
      const dist = Math.hypot(this.dx - eqX, this.dy - eqY);
      if (dist > params.max) {
        const sc = params.max / dist;
        this.dx = eqX + (this.dx - eqX) * sc;
        this.dy = eqY + (this.dy - eqY) * sc;
      }
    }

    // --- Рендер — только если позиция изменилась на >0.1px ---
    const tx = (this.dx * 10 | 0) / 10;
    const ty = (this.dy * 10 | 0) / 10;
    if (tx !== this._lastTx || ty !== this._lastTy) {
      this._lastTx = tx;
      this._lastTy = ty;
      this.el.style.transform = `translate(${tx}px,${ty}px)`;
    }
  }

  _detectType(el) {
    if (el.classList.contains('shard-outer'))     return 'outer';
    if (el.classList.contains('shard-core'))      return 'core';
    if (el.classList.contains('shard-highlight')) return 'highlight';
    return 'outer';
  }
}

// ============================================================
// Глобальный реестр
// ============================================================

const SHARDS    = [];
const SHARD_MAP = {};

function initPhysics() {
  document.querySelectorAll('.shard').forEach(el => {
    el.style.transition = 'none';
    const shard = new Shard(el);
    SHARDS.push(shard);
    SHARD_MAP[el.id] = shard;
  });
}

function tickPhysics(dt) {
  const len = SHARDS.length;
  for (let i = 0; i < len; i++) SHARDS[i].tick(dt);
}

function getShardOffset(shardId) {
  const s = SHARD_MAP[shardId];
  return s ? { dx: s.dx, dy: s.dy } : { dx: 0, dy: 0 };
}

function applyImpulseToShard(shardId, ix, iy) {
  const s = SHARD_MAP[shardId];
  if (s) s.applyImpulse(ix, iy);
}

function applyImpulseToAll(ix, iy, scaleByType, prefix) {
  const len = SHARDS.length;
  for (let i = 0; i < len; i++) {
    const shard = SHARDS[i];
    if (prefix && !shard.id.startsWith(prefix)) continue;
    const scale = scaleByType ? (scaleByType[shard.type] || 1.0) : 1.0;
    shard.applyImpulse(
      ix * scale + (Math.random() - 0.5) * Math.abs(ix) * 0.4,
      iy * scale + (Math.random() - 0.5) * Math.abs(iy) * 0.4
    );
  }
}

function applyImpulseToGroup(groupId, ix, iy, scaleByType) {
  applyImpulseToAll(ix, iy, scaleByType, groupId);
}

// ---- Смена режима ----

function enterScattered() {
  PHYSICS_MODE = 'scattered';
  const force = 17.5;
  const len = SHARDS.length;
  for (let i = 0; i < len; i++) {
    const shard = SHARDS[i];
    shard.assignScatterTarget();
    const angle = Math.atan2(shard.scatterTargetDy - shard.dy, shard.scatterTargetDx - shard.dx);
    const mag   = force * (0.6 + Math.random() * 0.4);
    shard.applyImpulse(Math.cos(angle) * mag, Math.sin(angle) * mag);
  }
}

function enterReassembling(onDone) {
  PHYSICS_MODE = 'reassembling';
  const len = SHARDS.length;
  for (let i = 0; i < len; i++) {
    const shard = SHARDS[i];
    const angle = Math.atan2(-shard.dy, -shard.dx);
    const dist  = Math.hypot(shard.dx, shard.dy);
    const mag   = Math.min(dist * 0.3, 18);
    shard.applyImpulse(Math.cos(angle) * mag, Math.sin(angle) * mag);
  }
  setTimeout(() => {
    PHYSICS_MODE = 'assembled';
    if (onDone) onDone();
  }, 1500);
}

function applyTiltToAll(ix, iy) {
  const len = SHARDS.length;
  for (let i = 0; i < len; i++) {
    const shard = SHARDS[i];
    const scale =
      shard.type === 'outer'     ? 1.0 :
      shard.type === 'core'      ? 0.5 :
      /* highlight */              0.15;
    shard.applyImpulse(ix * scale, iy * scale);
  }
}
