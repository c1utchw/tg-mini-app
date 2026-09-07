// ============================================================
// renderer.js — Telegram Mini App
//
// Управление:
//   iOS:     свайп по экрану = наклон, кнопка ⚡ = тряска
//   Android: гироскоп = наклон, быстрый свайп = тряска
//   Десктоп: стрелки / пробел
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
// Пробуем в порядке: Telegram API → браузерный
// ============================================================

let gyroEnabled = false;
let gyroBeta    = 0;
let gyroGamma   = 0;

// Тряска через акселерометр
let prevAccX = 0, prevAccY = 0, prevAccZ = 0;
const SHAKE_THRESHOLD = 20;
let lastAccShake = 0;

function checkAccShake(ax, ay, az) {
  const jerk = Math.hypot(ax - prevAccX, ay - prevAccY, az - prevAccZ);
  prevAccX = ax; prevAccY = ay; prevAccZ = az;
  if (jerk > SHAKE_THRESHOLD) {
    const now = Date.now();
    if (now - lastAccShake > SHAKE_COOLDOWN) {
      lastAccShake = now;
      triggerShake();
    }
  }
}

let usingTelegramSensors = false;

function tryStartTelegramSensors() {
  if (!TG) return false;
  let ok = false;

  if (TG.DeviceOrientation && typeof TG.DeviceOrientation.start === 'function') {
    try {
      TG.DeviceOrientation.start({ refresh_rate: 50, need_absolute: false });
      TG.DeviceOrientation.onChanged(() => {
        gyroBeta  = TG.DeviceOrientation.beta  || 0;
        gyroGamma = TG.DeviceOrientation.gamma || 0;
        gyroEnabled = true;
      });
      ok = true;
    } catch(e) {}
  }

  if (TG.Accelerometer && typeof TG.Accelerometer.start === 'function') {
    try {
      TG.Accelerometer.start({ refresh_rate: 60 });
      TG.Accelerometer.onChanged(() => {
        checkAccShake(
          TG.Accelerometer.x || 0,
          TG.Accelerometer.y || 0,
          TG.Accelerometer.z || 0
        );
      });
    } catch(e) {}
  }

  return ok;
}

function startBrowserSensors() {
  // DeviceOrientation (Android, десктоп)
  const doOrientation = () => {
    window.addEventListener('deviceorientation', e => {
      if (e.beta == null) return;
      gyroBeta  = e.beta;
      gyroGamma = e.gamma;
      gyroEnabled = true;
    }, { passive: true });
  };

  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(s => { if (s === 'granted') doOrientation(); })
      .catch(doOrientation);
  } else {
    doOrientation();
  }

  // DeviceMotion (Android, десктоп)
  const doMotion = () => {
    window.addEventListener('devicemotion', e => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      checkAccShake(a.x || 0, a.y || 0, a.z || 0);
    }, { passive: true });
  };

  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission()
      .then(s => { if (s === 'granted') doMotion(); })
      .catch(doMotion);
  } else {
    doMotion();
  }
}

// Калибровка нейтрального положения
let neutralBeta  = null;
let neutralGamma = null;
let calibFrames = 0, calibSumB = 0, calibSumG = 0;
const CALIB_FRAMES = 30;

function calibrateGyro() {
  if (neutralBeta !== null) return;
  calibSumB += gyroBeta;
  calibSumG += gyroGamma;
  if (++calibFrames >= CALIB_FRAMES) {
    neutralBeta  = calibSumB / CALIB_FRAMES;
    neutralGamma = calibSumG / CALIB_FRAMES;
  }
}

// Фильтр и применение наклона
let filteredBeta = 0, filteredGamma = 0;
const GYRO_FILTER    = 0.15;
const GYRO_DEADZONE  = 3.0;
const GYRO_MAX_ANGLE = 40.0;
const GYRO_STRENGTH  = 0.8;

function applyGyroTilt() {
  if (!gyroEnabled) return;
  calibrateGyro();
  if (neutralBeta === null) return;

  filteredGamma += ((gyroGamma - neutralGamma) - filteredGamma) * GYRO_FILTER;
  filteredBeta  += ((gyroBeta  - neutralBeta)  - filteredBeta)  * GYRO_FILTER;

  const dg = Math.abs(filteredGamma) < GYRO_DEADZONE ? 0 : filteredGamma;
  const db = Math.abs(filteredBeta)  < GYRO_DEADZONE ? 0 : filteredBeta;
  if (dg === 0 && db === 0) return;

  const ix = Math.max(-1, Math.min(1, dg / GYRO_MAX_ANGLE));
  const iy = Math.max(-1, Math.min(1, db / GYRO_MAX_ANGLE));
  applyTilt(ix * GYRO_STRENGTH, iy * GYRO_STRENGTH);
}

// ============================================================
// ЭКРАН "TAP TO START"
// ============================================================

let sensorsReady = false;

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
    '<div style="font-size:13px;opacity:.5;margin-top:8px;letter-spacing:.08em">swipe to move · ⚡ to shatter</div>';
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function activate() {
    if (sensorsReady) return;
    sensorsReady = true;
    overlay.remove();
    usingTelegramSensors = tryStartTelegramSensors();
    if (!usingTelegramSensors) startBrowserSensors();
    vibrate('light');
  }

  overlay.addEventListener('touchstart', activate, { once: true, passive: true });
  overlay.addEventListener('click',      activate, { once: true });
}

// ============================================================
// КНОПКА ТРЯСКИ (маленькая, в правом нижнем углу)
// ============================================================

function createShakeButton() {
  const btn = document.createElement('button');
  btn.textContent = '⚡';
  btn.style.cssText = [
    'position:fixed',
    'right:16px',
    'bottom:calc(16px + env(safe-area-inset-bottom))',
    'z-index:8000',
    'width:52px','height:52px',
    'border-radius:50%',
    'background:rgba(184,92,255,0.18)',
    'border:1.5px solid rgba(184,92,255,0.55)',
    'color:#B85CFF','font-size:22px',
    'cursor:pointer',
    '-webkit-tap-highlight-color:transparent',
    'touch-action:manipulation',
    'display:flex','align-items:center','justify-content:center'
  ].join(';');

  const doShake = (e) => {
    e.preventDefault();
    triggerShake();
  };
  btn.addEventListener('touchstart', doShake, { passive: false });
  btn.addEventListener('mousedown',  doShake);
  document.body.appendChild(btn);
}

// ============================================================
// СВАЙП — основное управление на мобиле
// Медленный свайп = наклон, быстрый свайп = импульс
// ============================================================

const TILT_IMPULSE_ASSEMBLED = 0.225;
const TILT_IMPULSE_SCATTERED = 0.688;

let touchStartX = 0, touchStartY = 0;
let touchLastX  = 0, touchLastY  = 0;
let touchStartTime = 0;

stage.addEventListener('touchstart', e => {
  const t = e.touches[0];
  touchStartX = touchLastX = t.clientX;
  touchStartY = touchLastY = t.clientY;
  touchStartTime = Date.now();
}, { passive: true });

stage.addEventListener('touchmove', e => {
  if (!sensorsReady) return;
  const t = e.touches[0];
  const dx = t.clientX - touchLastX;
  const dy = t.clientY - touchLastY;
  touchLastX = t.clientX;
  touchLastY = t.clientY;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    noteInteraction();
    const norm = Math.hypot(dx, dy) || 1;
    // Сила пропорциональна скорости движения пальца
    const speed = Math.hypot(dx, dy);
    const power = Math.min(speed / 8, 1.5);
    applyTilt((dx / norm) * power, (dy / norm) * power);
  }
}, { passive: true });

stage.addEventListener('touchend', e => {
  if (!sensorsReady) return;
  const totalDist = Math.hypot(
    e.changedTouches[0].clientX - touchStartX,
    e.changedTouches[0].clientY - touchStartY
  );
  const duration = Date.now() - touchStartTime;

  if (totalDist < 12) {
    // Тап
    noteInteraction();
    setEmotion('happy');
    vibrate('light');
    applyImpulseToGroup('eye-left',  0, -0.75, { outer: 1.0, core: 0.5, highlight: 0.1 });
    applyImpulseToGroup('eye-right', 0, -0.75, { outer: 1.0, core: 0.5, highlight: 0.1 });
    setTimeout(() => { if (emotions.current === 'happy') setEmotion('idle'); }, 1200);
  }
}, { passive: true });

// Десктоп
pet.addEventListener('mousedown', () => {
  noteInteraction(); setEmotion('happy');
  applyImpulseToGroup('eye-left',  0, -0.75, { outer: 1.0, core: 0.5, highlight: 0.1 });
  applyImpulseToGroup('eye-right', 0, -0.75, { outer: 1.0, core: 0.5, highlight: 0.1 });
  setTimeout(() => { if (emotions.current === 'happy') setEmotion('idle'); }, 1200);
});

window.addEventListener('keydown', e => {
  if (e.code === 'Space' && !shakeActive) triggerShake();
});

// ============================================================
// НАКЛОН
// ============================================================

function applyTilt(ix, iy) {
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
  requestAnimationFrame(tick);
}

// ============================================================
// СТАРТ
// ============================================================

initPhysics();
initBolts();
createStartScreen();
createShakeButton();
requestAnimationFrame(tick);
