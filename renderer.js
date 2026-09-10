// ============================================================
// renderer.js — Telegram Mini App
// ============================================================

const pet   = document.getElementById('pet');
const stage = document.getElementById('stage');

const TG = window.Telegram && window.Telegram.WebApp;
if (TG) { TG.ready(); TG.expand(); }

// ============================================================
// ВИБРАЦИЯ
// ============================================================

function vibrate(pattern) {
  try {
    if (TG && TG.HapticFeedback) {
      const hf = TG.HapticFeedback;
      if (pattern === 'light')  { hf.impactOccurred('light');  return; }
      if (pattern === 'medium') { hf.impactOccurred('medium'); return; }
      if (pattern === 'heavy')  { hf.impactOccurred('heavy');  return; }
    }
  } catch(e) {}
  try {
    if (navigator.vibrate) {
      if (pattern === 'light')  navigator.vibrate(10);
      if (pattern === 'medium') navigator.vibrate(25);
      if (pattern === 'heavy')  navigator.vibrate([40, 20, 40]);
    }
  } catch(e) {}
}

// ============================================================
// ЭМОЦИИ
// ============================================================

const emotions = { current: 'idle' };
let lastInteractionTime = Date.now();
const BORED_TIMEOUT_MS = 15000;

function setEmotion(name) {
  if (emotions.current === name) return;
  emotions.current = name;
  pet.classList.remove('happy', 'scared', 'bored');
  if (name !== 'idle') pet.classList.add(name);
  switch (name) {
    case 'happy':  playHappyEmotion();   break;
    case 'bored':  playBoredEmotion();   break;
    case 'scared': playScaredEmotion();  break;
    default:       playNeutralEmotion(); break;
  }
}

function noteInteraction() {
  lastInteractionTime = Date.now();
  if (emotions.current === 'bored') {
    setEmotion('happy');
    setTimeout(() => { if (emotions.current === 'happy') setEmotion('idle'); }, 1000);
  }
}

// ============================================================
// ТРЯСКА
// ============================================================

let shakeActive   = false;
let lastShakeTime = 0;
const SHAKE_COOLDOWN = 1200;

function triggerShake() {
  if (shakeActive) return;
  const now = Date.now();
  if (now - lastShakeTime < SHAKE_COOLDOWN) return;
  lastShakeTime = now;
  shakeActive = true;
  noteInteraction();
  if (getFaceState() === 'assembled') { setEmotion('scared'); vibrate('heavy'); }
  else                                { setEmotion('happy');  vibrate('medium'); }
  triggerShatterEffect();
  setTimeout(() => {
    shakeActive = false;
    if (emotions.current === 'scared' || emotions.current === 'happy') setEmotion('idle');
  }, 1000);
}

// ============================================================
// ГИРОСКОП
// ============================================================

let gyroEnabled   = false;
let gyroBeta      = 0;
let gyroGamma     = 0;
let filteredBeta  = 0;
let filteredGamma = 0;
let neutralBeta   = null;
let neutralGamma  = null;
let calibFrames   = 0, calibSumB = 0, calibSumG = 0;

// Быстрый фильтр — отклик за ~3-4 кадра вместо 10+
const GYRO_FILTER    = 0.25;
const CALIB_FRAMES   = 20;
// Угол при котором достигается максимальное смещение — чем меньше, тем чувствительнее
const GYRO_MAX_ANGLE = 25.0;
// Максимальное смещение точки покоя в SVG-единицах
const GRAVITY_MAX    = 5.5;

// Акселерометр для тряски
let prevAccX = 0, prevAccY = 0, prevAccZ = 0;
const SHAKE_THRESHOLD = 18; // чуть чувствительнее

function checkAccShake(ax, ay, az) {
  const jerk = Math.hypot(ax - prevAccX, ay - prevAccY, az - prevAccZ);
  prevAccX = ax; prevAccY = ay; prevAccZ = az;
  if (jerk > SHAKE_THRESHOLD) {
    const now = Date.now();
    if (now - lastShakeTime > SHAKE_COOLDOWN) triggerShake();
  }
}

function startTelegramSensors() {
  if (!TG) return false;
  let ok = false;
  try {
    if (TG.DeviceOrientation && typeof TG.DeviceOrientation.start === 'function') {
      TG.DeviceOrientation.start({ refresh_rate: 30, need_absolute: false });
      TG.DeviceOrientation.onChanged(() => {
        gyroBeta    = TG.DeviceOrientation.beta  || 0;
        gyroGamma   = TG.DeviceOrientation.gamma || 0;
        gyroEnabled = true;
      });
      ok = true;
    }
  } catch(e) {}
  try {
    if (TG.Accelerometer && typeof TG.Accelerometer.start === 'function') {
      TG.Accelerometer.start({ refresh_rate: 60 });
      TG.Accelerometer.onChanged(() => {
        checkAccShake(TG.Accelerometer.x||0, TG.Accelerometer.y||0, TG.Accelerometer.z||0);
      });
    }
  } catch(e) {}
  return ok;
}

function startBrowserSensors() {
  const doOrientation = () => {
    window.addEventListener('deviceorientation', e => {
      if (e.beta == null) return;
      gyroBeta    = e.beta;
      gyroGamma   = e.gamma;
      gyroEnabled = true;
    }, { passive: true });
  };
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(s => { if (s === 'granted') doOrientation(); }).catch(doOrientation);
  } else { doOrientation(); }

  const doMotion = () => {
    window.addEventListener('devicemotion', e => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      checkAccShake(a.x||0, a.y||0, a.z||0);
    }, { passive: true });
  };
  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission()
      .then(s => { if (s === 'granted') doMotion(); }).catch(doMotion);
  } else { doMotion(); }
}

function calibrateGyro() {
  if (neutralBeta !== null) return;
  calibSumB += gyroBeta;
  calibSumG += gyroGamma;
  if (++calibFrames >= CALIB_FRAMES) {
    neutralBeta  = calibSumB / CALIB_FRAMES;
    neutralGamma = calibSumG / CALIB_FRAMES;
  }
}

function applyGyroTilt() {
  if (!gyroEnabled) return;
  calibrateGyro();
  if (neutralBeta === null) return;

  const rawG = gyroGamma - neutralGamma;
  const rawB = gyroBeta  - neutralBeta;

  filteredGamma += (rawG - filteredGamma) * GYRO_FILTER;
  filteredBeta  += (rawB - filteredBeta)  * GYRO_FILTER;

  const gx = Math.max(-1, Math.min(1, filteredGamma / GYRO_MAX_ANGLE)) * GRAVITY_MAX;
  const gy = Math.max(-1, Math.min(1, filteredBeta  / GYRO_MAX_ANGLE)) * GRAVITY_MAX;

  setGravity(gx, gy);

  if (getFaceState() === 'scattered') {
    applyTiltToAll(gx * 0.04, gy * 0.04);
  }
}

// ============================================================
// ЭКРАН "TAP TO START"
// ============================================================

function createStartScreen() {
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed','inset:0','z-index:9999',
    'background:rgba(0,0,0,0.82)',
    'display:flex','align-items:center','justify-content:center',
    'cursor:pointer','touch-action:manipulation'
  ].join(';');
  const box = document.createElement('div');
  box.style.cssText = 'text-align:center;color:#7FEFEA;font-family:system-ui,sans-serif';
  box.innerHTML =
    '<div style="font-size:54px;margin-bottom:14px">👾</div>' +
    '<div style="font-size:22px;font-weight:600;letter-spacing:.05em">Tap to wake up</div>' +
    '<div style="font-size:13px;opacity:.5;margin-top:8px;letter-spacing:.08em">' +
    'tilt to move · ⚡ to shatter</div>';
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function activate() {
    overlay.remove();
    const hasTg = startTelegramSensors();
    if (!hasTg) startBrowserSensors();
    vibrate('light');
  }
  overlay.addEventListener('touchstart', activate, { once: true, passive: true });
  overlay.addEventListener('click',      activate, { once: true });
}

// ============================================================
// КНОПКА ⚡
// ============================================================

function createShakeButton() {
  const btn = document.createElement('button');
  btn.textContent = '⚡';
  btn.style.cssText = [
    'position:fixed','right:16px',
    'bottom:calc(20px + env(safe-area-inset-bottom))',
    'z-index:8000','width:54px','height:54px','border-radius:50%',
    'background:rgba(184,92,255,0.18)',
    'border:1.5px solid rgba(184,92,255,0.55)',
    'color:#B85CFF','font-size:24px','cursor:pointer',
    '-webkit-tap-highlight-color:transparent',
    'touch-action:manipulation','padding:0',
    'display:flex','align-items:center','justify-content:center'
  ].join(';');
  btn.addEventListener('touchstart', e => { e.preventDefault(); triggerShake(); }, { passive: false });
  btn.addEventListener('mousedown',  e => { e.preventDefault(); triggerShake(); });
  document.body.appendChild(btn);
}

// ============================================================
// D-PAD кнопки (для десктопа и мобила без гироскопа)
// ============================================================

function createDpad() {
  // Стили
  const style = document.createElement('style');
  style.textContent = `
    #_dpad {
      position: fixed;
      right: 80px;
      bottom: calc(16px + env(safe-area-inset-bottom));
      z-index: 8000;
      display: grid;
      grid-template-columns: 44px 44px 44px;
      grid-template-rows: 44px 44px 44px;
      gap: 3px;
      pointer-events: auto;
    }
    .dpad-btn {
      width: 44px; height: 44px;
      border-radius: 10px;
      background: rgba(255,255,255,0.07);
      border: 1.5px solid rgba(127,239,234,0.25);
      color: rgba(127,239,234,0.8);
      font-size: 16px;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      user-select: none;
      transition: background 0.1s;
    }
    .dpad-btn:active, .dpad-btn.pressed {
      background: rgba(127,239,234,0.18);
      border-color: rgba(127,239,234,0.6);
    }
    .dpad-empty { background: none !important; border: none !important; pointer-events: none; }
  `;
  document.head.appendChild(style);

  const pad = document.createElement('div');
  pad.id = '_dpad';

  // Сетка 3x3: UP в середине верхнего ряда, LEFT/RIGHT в среднем, DOWN в нижнем
  const layout = [
    null,   'up',    null,
    'left', null,   'right',
    null,   'down',  null,
  ];
  const icons = { up: '▲', left: '◀', right: '▶', down: '▼' };

  layout.forEach(dir => {
    const cell = document.createElement('button');
    if (!dir) {
      cell.className = 'dpad-btn dpad-empty';
      cell.disabled = true;
    } else {
      cell.className = 'dpad-btn';
      cell.textContent = icons[dir];
      cell.dataset.dir = dir;

      // Touch и mouse — держим нажатым
      const press = (e) => {
        e.preventDefault();
        cell.classList.add('pressed');
        _heldKeys.add('Arrow' + dir.charAt(0).toUpperCase() + dir.slice(1));
      };
      const release = (e) => {
        e.preventDefault();
        cell.classList.remove('pressed');
        _heldKeys.delete('Arrow' + dir.charAt(0).toUpperCase() + dir.slice(1));
      };
      cell.addEventListener('touchstart',  press,   { passive: false });
      cell.addEventListener('touchend',    release, { passive: false });
      cell.addEventListener('touchcancel', release, { passive: false });
      cell.addEventListener('mousedown',   press);
      cell.addEventListener('mouseup',     release);
      cell.addEventListener('mouseleave',  release);
    }
    pad.appendChild(cell);
  });

  document.body.appendChild(pad);
}

// ============================================================
// СВАЙП / ТАП
// ============================================================

const TILT_IMPULSE_ASSEMBLED = 0.225;
const TILT_IMPULSE_SCATTERED = 0.688;

let touchStartX = 0, touchStartY = 0;
let touchLastX  = 0, touchLastY  = 0;

stage.addEventListener('touchstart', e => {
  const t = e.touches[0];
  touchStartX = touchLastX = t.clientX;
  touchStartY = touchLastY = t.clientY;
}, { passive: true });

stage.addEventListener('touchmove', e => {
  const t = e.touches[0];
  const dx = t.clientX - touchLastX;
  const dy = t.clientY - touchLastY;
  touchLastX = t.clientX;
  touchLastY = t.clientY;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return;
  noteInteraction();
  const power = Math.max(0.2, Math.min(2.0, dist / 6));
  applySwipeImpulse(dx / dist * power, dy / dist * power);
}, { passive: true });

stage.addEventListener('touchend', e => {
  const d = Math.hypot(
    e.changedTouches[0].clientX - touchStartX,
    e.changedTouches[0].clientY - touchStartY
  );
  if (d < 12) {
    noteInteraction();
    setEmotion('happy');
    vibrate('light');
    applyImpulseToGroup('eye-left',  0, -0.75, { outer: 1.0, core: 0.5, highlight: 0.1 });
    applyImpulseToGroup('eye-right', 0, -0.75, { outer: 1.0, core: 0.5, highlight: 0.1 });
    setTimeout(() => { if (emotions.current === 'happy') setEmotion('idle'); }, 1200);
  }
}, { passive: true });

pet.addEventListener('mousedown', () => {
  noteInteraction(); setEmotion('happy');
  applyImpulseToGroup('eye-left',  0, -0.75, { outer: 1.0, core: 0.5, highlight: 0.1 });
  applyImpulseToGroup('eye-right', 0, -0.75, { outer: 1.0, core: 0.5, highlight: 0.1 });
  setTimeout(() => { if (emotions.current === 'happy') setEmotion('idle'); }, 1200);
});

// Стрелки на десктопе — плавно нарастающий наклон при удержании
const _heldKeys  = new Set();
let   _tiltAccX  = 0;  // текущее накопленное смещение гравитации от клавиш
let   _tiltAccY  = 0;
const TILT_ACCEL  = 0.32;  // разгон за кадр (x4 от начального)
const TILT_MAX    = 5.5;   // максимальное смещение (= GRAVITY_MAX)
const TILT_DECAY  = 0.88;  // затухание когда клавиша отпущена

window.addEventListener('keydown', e => {
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)) {
    e.preventDefault();
    _heldKeys.add(e.code);
  }
  if (e.code === 'Space') { triggerShake(); }
  if (e.code === 'KeyR')  { _tiltAccX = 0; _tiltAccY = 0; setGravity(0, 0); }
});
window.addEventListener('keyup', e => _heldKeys.delete(e.code));

function applyKeyboardTilt() {
  if (_heldKeys.size > 0) {
    if (_heldKeys.has('ArrowLeft'))  _tiltAccX = Math.max(-TILT_MAX, _tiltAccX - TILT_ACCEL);
    if (_heldKeys.has('ArrowRight')) _tiltAccX = Math.min( TILT_MAX, _tiltAccX + TILT_ACCEL);
    if (_heldKeys.has('ArrowUp'))    _tiltAccY = Math.max(-TILT_MAX, _tiltAccY - TILT_ACCEL);
    if (_heldKeys.has('ArrowDown'))  _tiltAccY = Math.min( TILT_MAX, _tiltAccY + TILT_ACCEL);
  } else {
    // Плавно возвращаем к нулю когда клавиши отпущены
    _tiltAccX *= TILT_DECAY;
    _tiltAccY *= TILT_DECAY;
    if (Math.abs(_tiltAccX) < 0.01) _tiltAccX = 0;
    if (Math.abs(_tiltAccY) < 0.01) _tiltAccY = 0;
  }
  // Применяем только если нет гироскопа (на мобиле гироскоп перезаписывает)
  if (!gyroEnabled) {
    setGravity(_tiltAccX, _tiltAccY);
  }
}

function applySwipeImpulse(ix, iy) {
  if (getFaceState() === 'scattered') {
    applyTiltToAll(ix * TILT_IMPULSE_SCATTERED, iy * TILT_IMPULSE_SCATTERED);
  } else {
    const f = TILT_IMPULSE_ASSEMBLED;
    applyImpulseToGroup('eye-left',  ix * f, iy * f, { outer: 1.0, core: 0.4, highlight: 0.15 });
    applyImpulseToGroup('eye-right', ix * f, iy * f, { outer: 1.0, core: 0.4, highlight: 0.15 });
    applyImpulseToGroup('mouth', ix * f * 0.5, iy * f * 0.5, { outer: 1.0, core: 0.4, highlight: 0.15 });
  }
}

// ============================================================
// ВИБРАЦИЯ ОТ МОЛНИЙ
// ============================================================

let lastBoltVibrateTime = 0;
let lastSnapVibrateTime = 0;

window.onBoltVisible = function(opacity) {
  if (opacity < 0.3) return;
  const now = Date.now();
  if (now - lastBoltVibrateTime < 300) return;
  lastBoltVibrateTime = now;
  vibrate('light');
};

window.onBoltSnap = function() {
  const now = Date.now();
  if (now - lastSnapVibrateTime < 150) return;
  lastSnapVibrateTime = now;
  vibrate('medium');
};

// Кристалл врезался в своё место — вспышка молний + вибрация
window.onShardLanded = function(shardId, hx, hy) {
  vibrate('medium');
  // Кратковременная вспышка всех молний рядом с этим кристаллом
  flashBoltsNear(hx, hy, 60);
};

// ============================================================
// СКУКА
// ============================================================

function updateBoredom() {
  if (Date.now() - lastInteractionTime > BORED_TIMEOUT_MS && emotions.current === 'idle')
    setEmotion('bored');
}

// ============================================================
// ГЛАВНЫЙ ТИК — оптимизирован
// ============================================================

let lastTickTime = performance.now();
// Счётчик для скуки — не проверяем каждый кадр
let boredCounter = 0;

function tick() {
  const now = performance.now();
  const dt  = Math.min(now - lastTickTime, 50);
  lastTickTime = now;

  applyKeyboardTilt();
  applyGyroTilt();
  tickPhysics(dt);
  tickBolts(dt);

  // Скука проверяем раз в 60 кадров (~1 сек)
  if (++boredCounter >= 60) {
    boredCounter = 0;
    updateBoredom();
  }

  requestAnimationFrame(tick);
}

// ============================================================
// СТАРТ
// ============================================================

createShakeButton();
createDpad();
requestAnimationFrame(tick);

// Загружаем дефолтный скин — он вызовет initPhysics + initBolts,
// после чего показываем стартовый экран
SkinManager.init('crystal')
  .then(() => { createStartScreen(); })
  .catch(err => { console.error('[renderer] Скин не загружен:', err); createStartScreen(); });
