// ============================================================
// renderer.js — Telegram Mini App
//
// Гравитация: наклон телефона смещает точку покоя кристалликов.
// Телефон лежит горизонтально = кристаллики по центру.
// Телефон наклонён вправо = кристаллики смещаются вправо.
// Свайп = разовый импульс. Кнопка ⚡ = тряска/сборка.
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
// СЕНСОРЫ УСТРОЙСТВА
// ============================================================

let gyroEnabled  = false;
let gyroBeta     = 0;   // наклон вперёд/назад
let gyroGamma    = 0;   // наклон влево/вправо

// Низкочастотный фильтр для плавности
let filteredBeta  = 0;
let filteredGamma = 0;
const GYRO_FILTER = 0.08; // медленно сглаживает → плавное "течение"

// Калибровка нейтрального положения (первые 30 кадров)
let neutralBeta  = null;
let neutralGamma = null;
let calibFrames  = 0, calibSumB = 0, calibSumG = 0;
const CALIB_FRAMES = 30;

// Для тряски через акселерометр
let prevAccX = 0, prevAccY = 0, prevAccZ = 0;
const SHAKE_THRESHOLD = 20;

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
      TG.DeviceOrientation.start({ refresh_rate: 50, need_absolute: false });
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

// Максимальное смещение гравитации (SVG-единицы)
// outer max = 7.0 — берём чуть меньше чтобы оставался зазор
const GRAVITY_MAX    = 5.5;
const GYRO_MAX_ANGLE = 45.0; // градусов для полного отклонения

function applyGyroTilt() {
  if (!gyroEnabled) return;
  calibrateGyro();
  if (neutralBeta === null) return;

  // Отклонение от нейтрали
  const rawG = gyroGamma - neutralGamma;
  const rawB = gyroBeta  - neutralBeta;

  // Плавный фильтр
  filteredGamma += (rawG - filteredGamma) * GYRO_FILTER;
  filteredBeta  += (rawB - filteredBeta)  * GYRO_FILTER;

  // Нормируем в [-1, 1] и переводим в SVG-единицы гравитации
  const gx = Math.max(-1, Math.min(1, filteredGamma / GYRO_MAX_ANGLE)) * GRAVITY_MAX;
  const gy = Math.max(-1, Math.min(1, filteredBeta  / GYRO_MAX_ANGLE)) * GRAVITY_MAX;

  // Устанавливаем гравитацию (смещает точку покоя пружины)
  setGravity(gx, gy);

  // В разлёте — дополнительно толкаем осколки
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
// КНОПКА ТРЯСКИ ⚡
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
  btn.addEventListener('touchstart', e => { e.preventDefault(); triggerShake(); },
    { passive: false });
  btn.addEventListener('mousedown', e => { e.preventDefault(); triggerShake(); });
  document.body.appendChild(btn);
}

// ============================================================
// СВАЙП / ТАП — разовые импульсы
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
  applyImpulse(dx / dist * power, dy / dist * power);
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

window.addEventListener('keydown', e => {
  if (e.code === 'Space') triggerShake();
  // Стрелки — смещают гравитацию для теста на десктопе
  const step = 1.5;
  if (e.code === 'ArrowLeft')  setGravity(GRAVITY_X - step, GRAVITY_Y);
  if (e.code === 'ArrowRight') setGravity(GRAVITY_X + step, GRAVITY_Y);
  if (e.code === 'ArrowUp')    setGravity(GRAVITY_X, GRAVITY_Y - step);
  if (e.code === 'ArrowDown')  setGravity(GRAVITY_X, GRAVITY_Y + step);
  // R — сброс гравитации
  if (e.code === 'KeyR')       setGravity(0, 0);
});

// ============================================================
// РАЗОВЫЙ ИМПУЛЬС (свайп)
// ============================================================

function applyImpulse(ix, iy) {
  if (getFaceState() === 'scattered') {
    applyTiltToAll(ix * TILT_IMPULSE_SCATTERED, iy * TILT_IMPULSE_SCATTERED);
  } else {
    const f = TILT_IMPULSE_ASSEMBLED;
    applyImpulseToGroup('eye-left',  ix * f, iy * f,
      { outer: 1.0, core: 0.4, highlight: 0.15 });
    applyImpulseToGroup('eye-right', ix * f, iy * f,
      { outer: 1.0, core: 0.4, highlight: 0.15 });
    applyImpulseToGroup('mouth', ix * f * 0.5, iy * f * 0.5,
      { outer: 1.0, core: 0.4, highlight: 0.15 });
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

// ============================================================
// СКУКА
// ============================================================

function updateBoredom() {
  if (Date.now() - lastInteractionTime > BORED_TIMEOUT_MS && emotions.current === 'idle')
    setEmotion('bored');
}

// ============================================================
// ГЛАВНЫЙ ТИК
// ============================================================

let lastTickTime = performance.now();

function tick() {
  const now = performance.now();
  const dt  = Math.min(now - lastTickTime, 50);
  lastTickTime = now;
  applyGyroTilt();
  tickPhysics(dt);
  tickBolts(dt);
  updateBoredom();
  // дебаг
  dbg.textContent =
    'gyro: '   + (gyroEnabled ? 'ON' : 'OFF') + '\n' +
    'beta:  '  + gyroBeta.toFixed(1)  + '\n' +
    'gamma: '  + gyroGamma.toFixed(1) + '\n' +
    'nB: '     + (neutralBeta  !== null ? neutralBeta.toFixed(1)  : '...') + '\n' +
    'nG: '     + (neutralGamma !== null ? neutralGamma.toFixed(1) : '...') + '\n' +
    'fB: '     + filteredBeta.toFixed(2)  + '\n' +
    'fG: '     + filteredGamma.toFixed(2) + '\n' +
    'gx: '     + GRAVITY_X.toFixed(2) + '\n' +
    'gy: '     + GRAVITY_Y.toFixed(2);
  requestAnimationFrame(tick);
}

// ============================================================
// СТАРТ
// ============================================================

initPhysics();
initBolts();
createStartScreen();
createShakeButton();

// Дебаг-худ — покажет данные гироскопа
const dbg = document.createElement('div');
dbg.style.cssText = 'position:fixed;top:8px;left:8px;z-index:9998;background:rgba(0,0,0,.7);color:#0ff;font:11px/1.6 monospace;padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre';
document.body.appendChild(dbg);

requestAnimationFrame(tick);
