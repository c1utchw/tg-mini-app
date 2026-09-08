// ============================================================
// face-physics.js — физика кристалликов с двумя режимами
//
// РЕЖИМЫ (глобальная переменная PHYSICS_MODE):
//   'assembled'  — кристаллики у home-позиций, слабое дрожание
//   'scattered'  — кристаллики свободно плавают по SVG,
//                  пружина к home отключена, действует только
//                  "гравитация к углу" + шум + наклон
//   'reassembling' — переходный: сильная пружина тянет домой
//                    (активна во время второй тряски)
//
// SVG viewBox: "80 95 640 250" — видимая область.
// Центр лица в SVG-координатах: ~400, ~210.
// При разлёте каждый кристаллик получает "угловую цель" —
// случайную точку в одном из четырёх углов SVG-пространства.
// ============================================================

// Границы SVG в которых живут кристаллики (исходный viewBox 0 0 800 400)
const SVG_X_MIN =   0;
const SVG_X_MAX = 800;
const SVG_Y_MIN =   0;
const SVG_Y_MAX = 400;

// Параметры физики для режима assembled (покой) — +25% к скорости (k, n)
const PARAMS_ASSEMBLED = {
  outer:     { k: 0.050, d: 0.82, n: 0.35, max: 7.0  },
  core:      { k: 0.088, d: 0.85, n: 0.175, max: 3.5  },
  highlight: { k: 0.175, d: 0.88, n: 0.063, max: 1.2  },
};

// Параметры физики для режима scattered — +25%
const PARAMS_SCATTERED = {
  outer:     { k: 0.010, d: 0.97, n: 0.275, max: 9999 },
  core:      { k: 0.013, d: 0.97, n: 0.175, max: 9999 },
  highlight: { k: 0.015, d: 0.97, n: 0.100, max: 9999 },
};

// Параметры физики для режима reassembling (сборка домой) — +25%
const PARAMS_REASSEMBLING = {
  outer:     { k: 0.225, d: 0.80, n: 0.063, max: 9999 },
  core:      { k: 0.275, d: 0.82, n: 0.038, max: 9999 },
  highlight: { k: 0.350, d: 0.84, n: 0.013, max: 9999 },
};

// Текущий режим — читается в Shard.tick()
let PHYSICS_MODE = 'assembled';

// ============================================================
// ВЕКТОР ГРАВИТАЦИИ
// Смещает точку равновесия пружины — кристаллики "висят"
// в сторону наклона как под силой тяжести.
// Устанавливается из renderer.js через setGravity(gx, gy).
// gx, gy — в SVG-единицах, типичные значения ±0..8
// ============================================================
let GRAVITY_X = 0;
let GRAVITY_Y = 0;

function setGravity(gx, gy) {
  GRAVITY_X = gx;
  GRAVITY_Y = gy;
}

// ---- Класс одного кристаллика ----

class Shard {
  constructor(el) {
    this.el = el;
    this.id = el.id;
    this.type = this._detectType(el);

    // home-позиция в SVG-координатах (из data-атрибутов)
    this.homeX = parseFloat(el.getAttribute('data-home-x')) || 0;
    this.homeY = parseFloat(el.getAttribute('data-home-y')) || 0;

    // Текущее смещение от home (SVG-единицы)
    this.dx = 0;
    this.dy = 0;

    // Скорость
    this.vx = 0;
    this.vy = 0;

    // "Угловая цель" в режиме scattered — точка в одном из углов SVG.
    // Задаётся при переходе в scattered.
    this.scatterTargetDx = 0;
    this.scatterTargetDy = 0;

    // Шум
    this._noiseAngle  = Math.random() * Math.PI * 2;
    this._noiseTimer  = 0;
    this._noiseChange = 300 + Math.random() * 500;
  }

  applyImpulse(ix, iy) {
    this.vx += ix;
    this.vy += iy;
  }

  // Назначить угловую цель для scattered-режима
  assignScatterTarget() {
    // Четыре угла SVG с небольшим разбросом внутри каждого угла
    const corners = [
      { x: SVG_X_MIN + 60,  y: SVG_Y_MIN + 60  },
      { x: SVG_X_MAX - 60,  y: SVG_Y_MIN + 60  },
      { x: SVG_X_MIN + 60,  y: SVG_Y_MAX - 60  },
      { x: SVG_X_MAX - 60,  y: SVG_Y_MAX - 60  },
    ];
    const corner = corners[Math.floor(Math.random() * corners.length)];
    // Разброс внутри угла ±80 SVG-единиц
    const spread = 80;
    const targetX = corner.x + (Math.random() * 2 - 1) * spread;
    const targetY = corner.y + (Math.random() * 2 - 1) * spread;
    // Сохраняем как смещение от home
    this.scatterTargetDx = targetX - this.homeX;
    this.scatterTargetDy = targetY - this.homeY;
  }

  tick(dt) {
    const dtNorm = dt / 16.67;

    // Выбираем параметры по текущему режиму
    let params;
    if      (PHYSICS_MODE === 'scattered')     params = PARAMS_SCATTERED[this.type];
    else if (PHYSICS_MODE === 'reassembling')  params = PARAMS_REASSEMBLING[this.type];
    else                                        params = PARAMS_ASSEMBLED[this.type];

    // --- Шум ---
    this._noiseTimer += dt;
    if (this._noiseTimer >= this._noiseChange) {
      this._noiseAngle  = Math.random() * Math.PI * 2;
      this._noiseTimer  = 0;
      this._noiseChange = 300 + Math.random() * 500;
    }
    const nf = this._noiseTimer / this._noiseChange;
    const ns = Math.sin(nf * Math.PI) * params.n;
    this.vx += Math.cos(this._noiseAngle) * ns * dtNorm;
    this.vy += Math.sin(this._noiseAngle) * ns * dtNorm;

    // --- Пружина ---
    // В assembled/reassembling — тянет к (0,0) от home + гравитационное смещение
    // В scattered — тянет к scatterTarget
    if (PHYSICS_MODE === 'scattered') {
      this.vx += (this.scatterTargetDx - this.dx) * params.k * dtNorm;
      this.vy += (this.scatterTargetDy - this.dy) * params.k * dtNorm;
    } else {
      // Точка равновесия = (0,0) + гравитационное смещение
      // Чем тяжелее тип (outer > core > highlight), тем сильнее смещается
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
    this.vx *= Math.pow(params.d, dtNorm);
    this.vy *= Math.pow(params.d, dtNorm);

    // --- Интеграция ---
    this.dx += this.vx * dtNorm;
    this.dy += this.vy * dtNorm;

    // --- Ограничение max (только в assembled) ---
    if (PHYSICS_MODE === 'assembled' && params.max < 9999) {
      // Меряем расстояние от точки равновесия (с учётом гравитации)
      const gravScale = this.type === 'outer' ? 1.0 : this.type === 'core' ? 0.6 : 0.2;
      const eqX = GRAVITY_X * gravScale;
      const eqY = GRAVITY_Y * gravScale;
      const dist = Math.hypot(this.dx - eqX, this.dy - eqY);
      if (dist > params.max) {
        const sc = params.max / dist;
        this.dx = eqX + (this.dx - eqX) * sc;
        this.dy = eqY + (this.dy - eqY) * sc;
      }
    }

    // --- Рендер ---
    this.el.style.transform = `translate(${this.dx.toFixed(2)}px, ${this.dy.toFixed(2)}px)`;
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
  console.log(`[face-physics] Инициализировано ${SHARDS.length} кристалликов`);
}

function tickPhysics(dt) {
  for (let i = 0; i < SHARDS.length; i++) SHARDS[i].tick(dt);
}

function getShardOffset(shardId) {
  const s = SHARD_MAP[shardId];
  return s ? { dx: s.dx, dy: s.dy } : { dx: 0, dy: 0 };
}

function applyImpulseToShard(shardId, ix, iy) {
  const s = SHARD_MAP[shardId];
  if (s) s.applyImpulse(ix, iy);
}

// Применить импульс ко всем кристалликам (или группе по префиксу)
// prefix = '' → все; prefix = 'eye-left' → только левый глаз
function applyImpulseToAll(ix, iy, scaleByType, prefix) {
  SHARDS.forEach(shard => {
    if (prefix && !shard.id.startsWith(prefix)) return;
    const scale = scaleByType ? (scaleByType[shard.type] || 1.0) : 1.0;
    shard.applyImpulse(
      ix * scale + (Math.random() - 0.5) * Math.abs(ix) * 0.4,
      iy * scale + (Math.random() - 0.5) * Math.abs(iy) * 0.4
    );
  });
}

// Старое имя — для совместимости с renderer.js
function applyImpulseToGroup(groupId, ix, iy, scaleByType) {
  applyImpulseToAll(ix, iy, scaleByType, groupId);
}

// ---- Смена режима ----

// Переключиться в scattered: назначить угловые цели и дать импульс
function enterScattered() {
  PHYSICS_MODE = 'scattered';
  const force = 17.5; // +25%
  SHARDS.forEach(shard => {
    shard.assignScatterTarget();
    // Начальный импульс в сторону цели
    const angle = Math.atan2(shard.scatterTargetDy - shard.dy, shard.scatterTargetDx - shard.dx);
    const mag   = force * (0.6 + Math.random() * 0.4);
    shard.applyImpulse(Math.cos(angle) * mag, Math.sin(angle) * mag);
  });
}

// Переключиться в reassembling: сильная пружина тянет домой
// Через delay мс автоматически переходим в assembled
function enterReassembling(onDone) {
  PHYSICS_MODE = 'reassembling';
  // Пока кристаллики летят домой — даём небольшой импульс к (0,0)
  SHARDS.forEach(shard => {
    const angle = Math.atan2(-shard.dy, -shard.dx);
    const dist  = Math.hypot(shard.dx, shard.dy);
    const mag   = Math.min(dist * 0.3, 18);
    shard.applyImpulse(Math.cos(angle) * mag, Math.sin(angle) * mag);
  });
  // После ~1.5 сек переходим в assembled (кристаллики уже дома)
  setTimeout(() => {
    PHYSICS_MODE = 'assembled';
    if (onDone) onDone();
  }, 1500);
}

// Применить тягу наклона ко всем кристалликам (работает в обоих режимах)
function applyTiltToAll(ix, iy) {
  SHARDS.forEach(shard => {
    const scale =
      shard.type === 'outer'     ? 1.0 :
      shard.type === 'core'      ? 0.5 :
      /* highlight */              0.15;
    shard.applyImpulse(ix * scale, iy * scale);
  });
}
