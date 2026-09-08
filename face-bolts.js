// ============================================================
// face-bolts.js — молнии как визуализация притяжения
//
// ЛОГИКА:
//   - В покое все молнии СКРЫТЫ (opacity 0)
//   - Молния появляется, когда кристаллик, к которому она привязана,
//     отлетает дальше BOLT_APPEAR_DIST от home-позиции
//   - Чем дальше кристаллик — тем ярче молния (до max opacity)
//   - Молния РАСТЯГИВАЕТСЯ вслед за кристалликом (эластичная связь)
//   - Средняя точка слегка дрожит (эффект электрического разряда)
//   - Если кристаллик улетает дальше BOLT_SNAP_DIST — молния "рвётся":
//     резкая вспышка и исчезновение до возврата кристаллика
//
// ПРИВЯЗКА молнии к кристаллику:
//   Первая точка polyline (p0) совпадает с data-home-x/y одного кристаллика,
//   последняя точка (p2) — с data-home-x/y другого (или это просто конечная точка).
//   При каждом тике мы читаем текущее смещение кристаллика из face-physics.js
//   через getShardOffset() и обновляем координаты молнии.
// ============================================================

// Расстояние отлёта (в SVG-единицах), при котором молния начинает появляться.
// В assembled-режиме — высокий порог (молнии в покое не видны).
// В reassembling — порог снижается программно через setBoltMode().
const BOLT_APPEAR_DIST_NORMAL      = 4.5;
const BOLT_APPEAR_DIST_REASSEMBLE  = 0.5;  // почти сразу видны при сборке

// Расстояние максимальной яркости
const BOLT_MAX_OPACITY_DIST_NORMAL     = 10.0;
const BOLT_MAX_OPACITY_DIST_REASSEMBLE = 3.0;  // быстро набирают яркость

// Максимальная opacity
const BOLT_MAX_OPACITY_NORMAL     = 0.75;
const BOLT_MAX_OPACITY_REASSEMBLE = 1.0;   // при сборке — полная яркость

// Расстояние разрыва — в reassemble не рвём никогда (кристаллы летят издалека)
const BOLT_SNAP_DIST_NORMAL     = 25.0;
const BOLT_SNAP_DIST_REASSEMBLE = 9999;

// Амплитуда дрожания средней точки
const BOLT_FLICKER_AMP = 3.5;

// Текущий режим молний: 'normal' | 'reassemble'
let BOLT_MODE = 'normal';

function setBoltMode(mode) { BOLT_MODE = mode; }

// ---- Класс одной молнии ----

class Bolt {
  constructor(polylineEl) {
    this.el = polylineEl;

    // Читаем исходные 3 точки из атрибута points: "x0,y0 x1,y1 x2,y2"
    const pts = this._parsePoints(polylineEl.getAttribute('points'));
    this.home0 = { x: pts[0].x, y: pts[0].y }; // начало — привязано к кристаллику A
    this.home1 = { x: pts[1].x, y: pts[1].y }; // середина — дрожит
    this.home2 = { x: pts[2].x, y: pts[2].y }; // конец — привязано к кристаллику B

    // Текущая средняя точка (меняется при дрожании)
    this.mid = { x: pts[1].x, y: pts[1].y };

    // id кристалликов, к которым привязаны крайние точки
    // (определяем при initBolts по совпадению координат)
    this.shardId0 = null; // id кристаллика для точки p0
    this.shardId2 = null; // id кристаллика для точки p2

    // Состояние: 'hidden' | 'visible' | 'snapped'
    this.state = 'hidden';

    // Сразу скрываем
    this.el.setAttribute('opacity', '0');

    // Таймер дрожания средней точки
    this._flickerTimer   = 0;
    this._flickerChange  = 80 + Math.random() * 120;
    this._flickerAngle   = Math.random() * Math.PI * 2;
  }

  // Тик — вызывается каждый кадр
  tick(dt) {
    // Получаем текущие смещения привязанных кристалликов
    const off0 = this.shardId0 ? getShardOffset(this.shardId0) : { dx: 0, dy: 0 };
    const off2 = this.shardId2 ? getShardOffset(this.shardId2) : { dx: 0, dy: 0 };

    const dist0 = Math.hypot(off0.dx, off0.dy);
    const dist2 = Math.hypot(off2.dx, off2.dy);
    const maxDist = Math.max(dist0, dist2);

    // Выбираем пороги по текущему режиму
    const appearDist  = BOLT_MODE === 'reassemble' ? BOLT_APPEAR_DIST_REASSEMBLE  : BOLT_APPEAR_DIST_NORMAL;
    const maxOpDist   = BOLT_MODE === 'reassemble' ? BOLT_MAX_OPACITY_DIST_REASSEMBLE : BOLT_MAX_OPACITY_DIST_NORMAL;
    const maxOpacity  = BOLT_MODE === 'reassemble' ? BOLT_MAX_OPACITY_REASSEMBLE   : BOLT_MAX_OPACITY_NORMAL;
    const snapDist    = BOLT_MODE === 'reassemble' ? BOLT_SNAP_DIST_REASSEMBLE      : BOLT_SNAP_DIST_NORMAL;

    if (maxDist > snapDist) {
      if (this.state !== 'snapped') this._doSnap();
      return;
    }

    if (this.state === 'snapped') {
      if (maxDist < appearDist * 2) this._doReconnect();
      else return;
    }

    if (maxDist < appearDist) {
      if (this.state !== 'hidden') {
        this.state = 'hidden';
        this.el.setAttribute('opacity', '0');
      }
      return;
    }

    this.state = 'visible';
    const t = Math.min((maxDist - appearDist) / (maxOpDist - appearDist), 1.0);
    const opacity = t * maxOpacity;

    // Вибрация пропорционально яркости молнии (лёгкая)
    if (typeof window.onBoltVisible === 'function') window.onBoltVisible(opacity);

    // Дрожание средней точки
    this._flickerTimer += dt;
    if (this._flickerTimer >= this._flickerChange) {
      this._flickerAngle  = Math.random() * Math.PI * 2;
      this._flickerTimer  = 0;
      this._flickerChange = 80 + Math.random() * 120;
    }
    const flickAmp = BOLT_FLICKER_AMP * t;
    this.mid = {
      x: (this.home1.x + off0.dx * 0.5 + off2.dx * 0.5) + Math.cos(this._flickerAngle) * flickAmp,
      y: (this.home1.y + off0.dy * 0.5 + off2.dy * 0.5) + Math.sin(this._flickerAngle) * flickAmp,
    };

    this._render(off0, off2, opacity);
  }

  // ---- Приватные методы ----

  _doSnap() {
    this.state = 'snapped';
    // Вспышка: кратковременно ярко, потом гаснет
    this.el.setAttribute('opacity', '1');
    // Вибрация при разрыве молнии (средняя)
    if (typeof window.onBoltSnap === 'function') window.onBoltSnap();
    setTimeout(() => {
      if (this.state === 'snapped') this.el.setAttribute('opacity', '0');
    }, 60);
  }

  _doReconnect() {
    this.state = 'hidden';
    this.el.setAttribute('opacity', '0');
    this.mid = { x: this.home1.x, y: this.home1.y };
  }

  _render(off0, off2, opacity) {
    const x0 = (this.home0.x + off0.dx).toFixed(2);
    const y0 = (this.home0.y + off0.dy).toFixed(2);
    const x1 = this.mid.x.toFixed(2);
    const y1 = this.mid.y.toFixed(2);
    const x2 = (this.home2.x + off2.dx).toFixed(2);
    const y2 = (this.home2.y + off2.dy).toFixed(2);
    this.el.setAttribute('points', `${x0},${y0} ${x1},${y1} ${x2},${y2}`);
    this.el.setAttribute('opacity', opacity.toFixed(3));
  }

  _parsePoints(str) {
    return str.trim().split(/\s+/).map(pair => {
      const [x, y] = pair.split(',').map(Number);
      return { x, y };
    });
  }
}

// ============================================================
// Инициализация
// ============================================================

const BOLTS = [];
const BOLT_MAP = {};

function initBolts() {
  // Строим карту: "home_x,home_y" → shardId
  const homeToShard = {};
  document.querySelectorAll('.shard').forEach(el => {
    const hx = parseFloat(el.getAttribute('data-home-x'));
    const hy = parseFloat(el.getAttribute('data-home-y'));
    const key = `${hx.toFixed(1)},${hy.toFixed(1)}`;
    homeToShard[key] = el.id;
  });

  const TOLERANCE = 3.0;

  // ---- Перемещаем все bolt-группы в самый низ SVG (под все кристаллики) ----
  // В SVG "низ" = первый дочерний элемент (он рисуется первым, значит под остальными).
  const svg = document.getElementById('face-svg');
  const boltGroups = svg.querySelectorAll('.shard-layer-bolts');
  // Вставляем все bolt-группы в начало SVG, сохраняя их порядок между собой
  // (insertBefore с firstChild — каждая следующая окажется раньше предыдущей,
  //  поэтому идём в обратном порядке)
  const boltGroupsArray = Array.from(boltGroups).reverse();
  boltGroupsArray.forEach(g => {
    svg.insertBefore(g, svg.firstChild);
  });

  document.querySelectorAll('.lightning-bolt').forEach(el => {
    const bolt = new Bolt(el);
    bolt.shardId0 = _findNearestShard(homeToShard, bolt.home0.x, bolt.home0.y, TOLERANCE);
    bolt.shardId2 = _findNearestShard(homeToShard, bolt.home2.x, bolt.home2.y, TOLERANCE);
    BOLTS.push(bolt);
    BOLT_MAP[el.id] = bolt;
  });

  console.log(`[face-bolts] Инициализировано ${BOLTS.length} молний`);
}

// Ищем ближайший кристаллик к точке (x, y) в радиусе tolerance
function _findNearestShard(homeToShard, x, y, tolerance) {
  let bestId   = null;
  let bestDist = tolerance;
  for (const key in homeToShard) {
    const [kx, ky] = key.split(',').map(Number);
    const d = Math.hypot(kx - x, ky - y);
    if (d < bestDist) {
      bestDist = d;
      bestId   = homeToShard[key];
    }
  }
  return bestId;
}

// Обновить все молнии за один кадр
function tickBolts(dt) {
  for (let i = 0; i < BOLTS.length; i++) {
    BOLTS[i].tick(dt);
  }
}

// ============================================================
// Устаревшие функции — оставлены для совместимости с face-shatter.js.
// Теперь молнии читают смещения сами из face-physics.js,
// поэтому эти функции ничего не делают.
// ============================================================
function updateBoltsForShard(shardId, dx, dy) { /* управляется через face-physics.js */ }
function resetAllBoltOffsets()                 { /* управляется через face-physics.js */ }
