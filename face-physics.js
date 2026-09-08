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

// Scattered — свободный полёт, только шум + затухание + гравитация
// Никакого притяжения к углам — кристаллы просто плавают
const PARAMS_SCATTERED = {
  outer:     { k: 0.0,  d: 0.985, n: 0.12, max: 9999 },
  core:      { k: 0.0,  d: 0.985, n: 0.08, max: 9999 },
  highlight: { k: 0.0,  d: 0.990, n: 0.03, max: 9999 },
};

const PARAMS_REASSEMBLING = {
  // Высокое d (затухание) — кристалл быстро теряет скорость у цели, вбивается как гвоздь
  // Высокое k — жёсткая пружина удерживает у home после удара
  outer:     { k: 0.22, d: 0.70, n: 0.01, max: 9999 },
  core:      { k: 0.28, d: 0.72, n: 0.005, max: 9999 },
  highlight: { k: 0.38, d: 0.75, n: 0.002, max: 9999 },
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

    // --- Пружина / свободный полёт ---
    if (PHYSICS_MODE === 'scattered') {
      // Свободный полёт — только гравитация как постоянное ускорение
      // Разные типы имеют разную "массу" — outer тяжелее, highlight лёгкий
      const gravScale =
        this.type === 'outer'     ? 1.0 :
        this.type === 'core'      ? 0.7 :
        /* highlight */              0.3;
      this.vx += GRAVITY_X * gravScale * 0.015 * dtNorm;
      this.vy += GRAVITY_Y * gravScale * 0.015 * dtNorm;
    } else {
      // Точка покоя смещена гравитацией (assembled / reassembling)
      const gravScale =
        this.type === 'outer'     ? 1.0 :
        this.type === 'core'      ? 0.6 :
        /* highlight */              0.2;
      const eqX = PHYSICS_MODE === 'reassembling' ? 0 : GRAVITY_X * gravScale;
      const eqY = PHYSICS_MODE === 'reassembling' ? 0 : GRAVITY_Y * gravScale;
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

    // --- Круговой барьер (только в scattered) ---
    // SVG viewBox: "80 95 640 250" — центр видимой области ~(400, 220)
    // Радиус барьера = половина минимальной стороны viewBox минус отступ
    if (PHYSICS_MODE === 'scattered') {
      const BARRIER_CX = 400;
      const BARRIER_CY = 220;
      const BARRIER_R  = 290; // вписывается в видимую часть с небольшим отступом
      const BOUNCE     = 0.45; // упругость отскока

      const wx = this.homeX + this.dx - BARRIER_CX;
      const wy = this.homeY + this.dy - BARRIER_CY;
      const wd = Math.hypot(wx, wy);

      if (wd > BARRIER_R) {
        // Нормаль к стенке (от центра наружу)
        const nx = wx / wd;
        const ny = wy / wd;
        // Отталкиваем обратно внутрь
        const over = wd - BARRIER_R;
        this.dx -= nx * over;
        this.dy -= ny * over;
        // Отражаем скорость — убираем компоненту в сторону стенки
        const dot = this.vx * nx + this.vy * ny;
        if (dot > 0) {
          this.vx -= (1 + BOUNCE) * dot * nx;
          this.vy -= (1 + BOUNCE) * dot * ny;
        }
      }
    }

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

    // --- Удар о home в режиме reassembling ---
    // Когда кристалл был далеко и теперь близко — он "врезался"
    if (PHYSICS_MODE === 'reassembling' && !this._landed) {
      const distNow = Math.hypot(this.dx, this.dy);
      if (this._prevDist !== undefined && this._prevDist > 15 && distNow < 8) {
        this._landed = true;
        if (typeof window.onShardLanded === 'function') {
          window.onShardLanded(this.id, this.homeX, this.homeY);
        }
      }
      this._prevDist = distNow;
    }
    // Сброс флага при новом разлёте
    if (PHYSICS_MODE === 'scattered') {
      this._landed = false;
      this._prevDist = undefined;
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
  // Взрыв от центра лица — каждый кристалл получает импульс наружу от home
  // Направление = от центра SVG (400, 210) к home-позиции кристалла
  const CX = 400, CY = 210;
  const force = 20;
  const len = SHARDS.length;
  for (let i = 0; i < len; i++) {
    const shard = SHARDS[i];
    const dx = shard.homeX - CX;
    const dy = shard.homeY - CY;
    const dist = Math.hypot(dx, dy) || 1;
    const mag = force * (0.5 + Math.random() * 0.8);
    // Добавляем случайный разброс
    shard.applyImpulse(
      (dx / dist) * mag + (Math.random() - 0.5) * 8,
      (dy / dist) * mag + (Math.random() - 0.5) * 8
    );
  }
}

function enterReassembling(onDone) {
  PHYSICS_MODE = 'reassembling';

  // Перемешиваем кристаллы случайно
  const shuffled = SHARDS.slice().sort(() => Math.random() - 0.5);

  // Волны: каждые WAVE_INTERVAL мс запускаем следующий кристалл
  const WAVE_INTERVAL = 450; // ~2.5x медленнее (было 180мс)

  shuffled.forEach((shard, i) => {
    const delay = i * WAVE_INTERVAL + Math.random() * 60;
    setTimeout(() => {
      if (PHYSICS_MODE !== 'reassembling' && PHYSICS_MODE !== 'assembled') return;

      // Резкий сильный импульс прямо к home — как метеорит
      const dist  = Math.hypot(shard.dx, shard.dy);
      const angle = Math.atan2(-shard.dy, -shard.dx);
      // Сила пропорциональна расстоянию, минимум 25 — всегда летит быстро
      const mag = Math.max(25, dist * 0.8);
      // Сбрасываем текущую скорость и даём точный импульс к цели
      shard.vx = Math.cos(angle) * mag;
      shard.vy = Math.sin(angle) * mag;

    }, delay);
  });

  // Общее время = все кристаллы + запас на долёт последнего
  const totalTime = shuffled.length * WAVE_INTERVAL + 3000;

  setTimeout(() => {
    PHYSICS_MODE = 'assembled';
    if (onDone) onDone();
  }, totalTime);
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
