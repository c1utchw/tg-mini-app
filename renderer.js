// ============================================================
// renderer.js — Telegram Mini App версия
//
// Управление:
//   - Наклон телефона → кристаллики ссыпаются в сторону наклона
//   - Резкая тряска телефона → разлёт / сборка
//   - Тап по экрану → радость
//   - Вибрация: лёгкая при молниях, сильная при разлёте
// ============================================================

const pet   = document.getElementById('pet');
const stage = document.getElementById('stage');

// --- Инициализация Telegram WebApp ---
if (window.Telegram && window.Telegram.WebApp) {
  Telegram.WebApp.ready();
  Telegram.WebApp.expand();
}

// ============================================================
// ВИБРАЦИЯ
// ============================================================

function vibrate(pattern) {
  // Telegram HapticFeedback (предпочтительно)
  try {
    if (window.Telegram && window.Telegram.WebApp && Telegram.WebApp.HapticFeedback) {
      const hf = Telegram.WebApp.HapticFeedback;
      if (pattern === 'light')  { hf.impactOccurred('light');  return; }
      if (pattern === 'medium') { hf.impactOccurred('medium'); return; }
      if (pattern === 'heavy')  { hf.impactOccurred('heavy');  return; }
    }
  } catch(e) {}
  // Fallback — navigator.vibrate
  try {
    if (!navigator.vibrate) return;
    if (pattern === 'light')  navigator.vibrate(10);
    if (pattern === 'medium') navigator.vibrate(25);
    if (pattern === 'heavy')  navigator.vibrate([40, 20, 40]);
  } catch(e) {}
}

// ============================================================
// ЭКРАН "TAP TO START" — запрашивает все разрешения по тапу
// ============================================================

let sensorsReady = false;

function createStartScreen() {
  const overlay = document.createElement('div');
  overlay.id = 'start-overlay';
  overlay.innerHTML = `
    <div id="start-content">
      <div id="start-icon">👾</div>
      <div id="start-text">Tap to wake up</div>
      <div id="start-hint">shake to shatter • tilt to move</div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Стили оверлея
  const style = document.createElement('style');
  style.textContent = `
    #start-overlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,0.75);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    #start-content {
      text-align: center; color: #7FEFEA;
      font-family: system-ui, sans-serif;
      animation: pulse 2s ease-in-out infinite;
    }
    #start-icon { font-size: 56px; margin-bottom: 16px; }
    #start-text { font-size: 22px; font-weight: 600; letter-spacing: 0.05em; }
    #start-hint { font-size: 13px; opacity: 0.55; margin-top: 8px; letter-spacing: 0.08em; }
    @keyframes pulse {
      0%,100% { opacity: 1; transform: scale(1); }
      50%      { opacity: 0.7; transform: scale(0.97); }
    }
  `;
  document.head.appendChild(style);

  const activate = () => {
    if (sensorsReady) return;
    sensorsReady = true;
    overlay.remove();
    style.remove();
    // Запрашиваем разрешения сразу из user gesture
    requestMotionPermission();
    requestOrientationPermission();
    // Тестовая вибрация чтобы убедиться что работает
    vibrate('light');
  };

  overlay.addEventListener('touchstart', activate, { once: true, passive: true });
  overlay.addEventListener('click',      activate, { once: true });
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
// ТРЯСКА ТЕЛЕФОНА (DeviceMotion)
// ============================================================

let shakeActive   = false;
let lastShakeTime = 0;
const SHAKE_THRESHOLD = 22;
const SHAKE_COOLDOWN  = 1200;

let prevAx = 0, prevAy = 0, prevAz = 0;

function onDeviceMotion(e) {
  const acc = e.accelerationIncludingGravity;
  if (!acc) return;

  const ax = acc.x || 0;
  const ay = acc.y || 0;
  const az = acc.z || 0;

  const jerk = Math.hypot(ax - prevAx, ay - prevAy, az - prevAz);
  prevAx = ax; prevAy = ay; prevAz = az;

  if (jerk > SHAKE_THRESHOLD) {
    const now = Date.now();
    if (now - lastShakeTime > SHAKE_COOLDOWN) {
      lastShakeTime = now;
      triggerShake();
    }
  }
}

function enableMotion() {
  window.addEventListener('devicemotion', onDeviceMotion, { passive: true });
}

function requestMotionPermission() {
  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    // iOS 13+
    DeviceMotionEvent.requestPermission()
      .then(state => { if (state === 'granted') enableMotion(); })
      .catch(() => enableMotion()); // на некоторых устройствах reject = просто включаем
  } else {
    enableMotion();
  }
}

// ============================================================
// ГИРОСКОП — НАКЛОН (DeviceOrientation)
// ============================================================

let gyroEnabled   = false;
let gyroBeta      = 0;
let gyroGamma     = 0;
let filteredBeta  = 0;
let filteredGamma = 0;

const GYRO_FILTER  = 0.15;
const GYRO_DEADZONE  = 3.0;
const GYRO_MAX_ANGLE = 40.0;
const GYRO_STRENGTH  = 0.8;

// Калибровка нейтрального положения
let neutralBeta  = null;
let neutralGamma = null;
let calibFrames  = 0;
let calibSumB    = 0, calibSumG = 0;
const CALIB_FRAMES = 30;

function onDeviceOrientation(e) {
  if (e.beta === null) return;
  gyroBeta    = e.beta;
  gyroGamma   = e.gamma;
  gyroEnabled = true;
}

function enableOrientation() {
  window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
}

function requestOrientationPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(state => { if (state === 'granted') enableOrientation(); })
      .catch(() => enableOrientation());
  } else {
    enableOrientation();
  }
}

function calibrateGyro() {
  if (neutralBeta !== null) return;
  calibSumB += gyroBeta;
  calibSumG += gyroGamma;
  calibFrames++;
  if (calibFrames >= CALIB_FRAMES) {
    neutralBeta  = calibSumB / CALIB_FRAMES;
    neutralGamma = calibSumG / CALIB_FRAMES;
  }
}

const TILT_IMPULSE_ASSEMBLED = 0.225;
const TILT_IMPULSE_SCATTERED = 0.688;

function applyGyroTilt() {
  if (!gyroEnabled) return;
  calibrateGyro();
  if (neutralBeta === null) return;

  const rawGamma = gyroGamma - neutralGamma;
  const rawBeta  = gyroBeta  - neutralBeta;

  filteredGamma += (rawGamma - filteredGamma) * GYRO_FILTER;
  filteredBeta  += (rawBeta  - filteredBeta)  * GYRO_FILTER;

  const dg = Math.abs(filteredGamma) < GYRO_DEADZONE ? 0 : filteredGamma;
  const db = Math.abs(filteredBeta)  < GYRO_DEADZONE ? 0 : filteredBeta;
  if (dg === 0 && db === 0) return;

  const ix = Math.max(-1, Math.min(1, dg / GYRO_MAX_ANGLE));
  const iy = Math.max(-1, Math.min(1, db / GYRO_MAX_ANGLE));
  applyTilt(ix * GYRO_STRENGTH, iy * GYRO_STRENGTH);
}

// ============================================================
// ТАП / СВАЙП
// ============================================================

let touchStartX = 0, touchStartY = 0;
let touchLastX  = 0, touchLastY  = 0;

stage.addEventListener('touchstart', e => {
  const t = e.touches[0];
  touchStartX = touchLastX = t.clientX;
  touchStartY = touchLastY = t.clientY;
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
    applyTilt((dx / norm) * 0.6, (dy / norm) * 0.6);
  }
}, { passive: true });

stage.addEventListener('touchend', e => {
  if (!sensorsReady) return;
  const totalDist = Math.hypot(
    e.changedTouches[0].clientX - touchStartX,
    e.changedTouches[0].clientY - touchStartY
  );
  if (totalDist < 12) {
    noteInteraction();
    setEmotion('happy');
    vibrate('light');
    applyImpulseToGroup('eye-left',  0, -0.75, { outer: 1.0, core: 0.5, highlight: 0.1 });
    applyImpulseToGroup('eye-right', 0, -0.75, { outer: 1.0, core: 0.5, highlight: 0.1 });
    setTimeout(() => { if (emotions.current === 'happy') setEmotion('idle'); }, 1200);
  }
}, { passive: true });

// Клик мышью (десктоп/тест)
pet.addEventListener('mousedown', () => {
  noteInteraction();
  setEmotion('happy');
  applyImpulseToGroup('eye-left',  0, -0.75, { outer: 1.0, core: 0.5, highlight: 0.1 });
  applyImpulseToGroup('eye-right', 0, -0.75, { outer: 1.0, core: 0.5, highlight: 0.1 });
  setTimeout(() => { if (emotions.current === 'happy') setEmotion('idle'); }, 1200);
});

// Пробел — тряска (для теста на десктопе)
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && !shakeActive) triggerShake();
});

// ============================================================
// ОБЩАЯ ФУНКЦИЯ НАКЛОНА
// ============================================================

function applyTilt(ix, iy) {
  if (getFaceState() === 'scattered') {
    applyTiltToAll(ix * TILT_IMPULSE_SCATTERED, iy * TILT_IMPULSE_SCATTERED);
  } else {
    const f = TILT_IMPULSE_ASSEMBLED;
    applyImpulseToGroup('eye-left',  ix * f, iy * f, { outer: 1.0, core: 0.4, highlight: 0.15 });
    applyImpulseToGroup('eye-right', ix * f, iy * f, { outer: 1.0, core: 0.4, highlight: 0.15 });
    applyImpulseToGroup('mouth',     ix * f * 0.5, iy * f * 0.5, { outer: 1.0, core: 0.4, highlight: 0.15 });
  }
}

// ============================================================
// ТРЯСКА
// ============================================================

function triggerShake() {
  if (shakeActive) return;
  shakeActive = true;
  noteInteraction();

  if (getFaceState() === 'assembled') {
    setEmotion('scared');
    vibrate('heavy');
  } else {
    setEmotion('happy');
    vibrate('medium');
  }

  triggerShatterEffect();

  setTimeout(() => {
    shakeActive = false;
    if (emotions.current === 'scared' || emotions.current === 'happy') setEmotion('idle');
  }, 1000);
}

// ============================================================
// ВИБРАЦИЯ ОТ МОЛНИЙ
// ============================================================

let lastBoltVibrateTime = 0;
let lastSnapVibrateTime = 0;
const BOLT_VIBRATE_INTERVAL = 300;
const SNAP_VIBRATE_INTERVAL = 150;

window.onBoltVisible = function(opacity) {
  if (opacity < 0.3) return;
  const now = Date.now();
  if (now - lastBoltVibrateTime < BOLT_VIBRATE_INTERVAL) return;
  lastBoltVibrateTime = now;
  vibrate('light');
};

window.onBoltSnap = function() {
  const now = Date.now();
  if (now - lastSnapVibrateTime < SNAP_VIBRATE_INTERVAL) return;
  lastSnapVibrateTime = now;
  vibrate('medium');
};

// ============================================================
// СКУКА
// ============================================================

function updateBoredom() {
  if (Date.now() - lastInteractionTime > BORED_TIMEOUT_MS && emotions.current === 'idle') {
    setEmotion('bored');
  }
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
createStartScreen(); // показываем оверлей — разрешения запросятся по тапу
requestAnimationFrame(tick);

const pet   = document.getElementById('pet');
const stage = document.getElementById('stage');

// --- Инициализация Telegram WebApp ---
if (window.Telegram && window.Telegram.WebApp) {
  Telegram.WebApp.ready();
  Telegram.WebApp.expand();
}

// ============================================================
// ВИБРАЦИЯ
// ============================================================

function vibrate(pattern) {
  // Telegram HapticFeedback (предпочтительно)
  if (window.Telegram && window.Telegram.WebApp && Telegram.WebApp.HapticFeedback) {
    const hf = Telegram.WebApp.HapticFeedback;
    if (pattern === 'light')  { hf.impactOccurred('light');  return; }
    if (pattern === 'medium') { hf.impactOccurred('medium'); return; }
    if (pattern === 'heavy')  { hf.impactOccurred('heavy');  return; }
  }
  // Fallback — navigator.vibrate
  if (!navigator.vibrate) return;
  if (pattern === 'light')  navigator.vibrate(10);
  if (pattern === 'medium') navigator.vibrate(25);
  if (pattern === 'heavy')  navigator.vibrate([40, 20, 40]);
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
// ТРЯСКА ТЕЛЕФОНА (DeviceMotion)
// ============================================================

let shakeActive      = false;
let lastShakeTime    = 0;
const SHAKE_THRESHOLD = 22;   // ускорение в м/с² для срабатывания
const SHAKE_COOLDOWN  = 1200; // мс между срабатываниями

// Накопленная скорость для определения тряски
let motionVelX = 0, motionVelY = 0, motionVelZ = 0;

function onDeviceMotion(e) {
  const acc = e.accelerationIncludingGravity;
  if (!acc) return;

  // Берём абсолютное ускорение (отфильтровываем гравитацию через дифф)
  const ax = acc.x || 0;
  const ay = acc.y || 0;
  const az = acc.z || 0;

  // Высокочастотный фильтр: оставляем только резкие изменения
  motionVelX = motionVelX * 0.8 + ax * 0.2;
  motionVelY = motionVelY * 0.8 + ay * 0.2;
  motionVelZ = motionVelZ * 0.8 + az * 0.2;

  const jerkX = ax - motionVelX;
  const jerkY = ay - motionVelY;
  const jerkZ = az - motionVelZ;
  const jerk  = Math.hypot(jerkX, jerkY, jerkZ);

  if (jerk > SHAKE_THRESHOLD) {
    const now = Date.now();
    if (now - lastShakeTime > SHAKE_COOLDOWN) {
      lastShakeTime = now;
      triggerShake();
    }
  }
}

function enableMotion() {
  window.addEventListener('devicemotion', onDeviceMotion, { passive: true });
}

// iOS 13+ требует явного разрешения
function requestMotionPermission() {
  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission()
      .then(state => { if (state === 'granted') enableMotion(); })
      .catch(() => {});
  } else {
    enableMotion();
  }
}

requestMotionPermission();
// Повторная попытка при первом тапе (на случай если не успело)
document.addEventListener('touchstart', () => requestMotionPermission(), { once: true });

// ============================================================
// ГИРОСКОП — НАКЛОН (DeviceOrientation)
// ============================================================

let gyroEnabled = false;
let gyroBeta    = 0;  // наклон вперёд/назад (-180..180), вертикаль = 90
let gyroGamma   = 0;  // наклон влево/вправо (-90..90)
let gyroAlpha   = 0;  // поворот по Z (компас, не используем для наклона)

// Низкочастотный фильтр — сглаживаем резкие скачки
let filteredBeta  = 0;
let filteredGamma = 0;
const GYRO_FILTER = 0.15; // 0=стоит на месте, 1=мгновенно

function onDeviceOrientation(e) {
  gyroBeta  = e.beta  || 0;
  gyroGamma = e.gamma || 0;
  gyroAlpha = e.alpha || 0;
  gyroEnabled = true;
}

function enableOrientation() {
  window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
}

function requestOrientationPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(state => { if (state === 'granted') enableOrientation(); })
      .catch(() => {});
  } else {
    enableOrientation();
  }
}

requestOrientationPermission();
document.addEventListener('touchstart', () => requestOrientationPermission(), { once: true });

// Нейтральное положение (калибровка при первом получении данных)
let neutralBeta  = null;
let neutralGamma = null;
const NEUTRAL_CALIBRATION_FRAMES = 30;
let calibrationFrames = 0;
let calibrationSumB = 0, calibrationSumG = 0;

function calibrateGyro() {
  if (neutralBeta !== null) return;
  calibrationSumB += gyroBeta;
  calibrationSumG += gyroGamma;
  calibrationFrames++;
  if (calibrationFrames >= NEUTRAL_CALIBRATION_FRAMES) {
    neutralBeta  = calibrationSumB / NEUTRAL_CALIBRATION_FRAMES;
    neutralGamma = calibrationSumG / NEUTRAL_CALIBRATION_FRAMES;
    console.log(`[gyro] нейтраль: beta=${neutralBeta.toFixed(1)}, gamma=${neutralGamma.toFixed(1)}`);
  }
}

// Чувствительность наклона → импульс
const TILT_IMPULSE_ASSEMBLED = 0.225; // +25% от 0.18
const TILT_IMPULSE_SCATTERED = 0.688; // +25% от 0.55
const GYRO_DEADZONE   = 3.0;  // градусы — игнорируем мелкое дрожание
const GYRO_MAX_ANGLE  = 40.0; // градусы — максимальный наклон
const GYRO_STRENGTH   = 0.8;  // общая сила наклона

function applyGyroTilt() {
  if (!gyroEnabled) return;

  calibrateGyro();
  if (neutralBeta === null) return;

  // Отклонение от нейтрали
  const rawGamma = gyroGamma - neutralGamma;
  const rawBeta  = gyroBeta  - neutralBeta;

  // Низкочастотный фильтр — плавное движение
  filteredGamma += (rawGamma - filteredGamma) * GYRO_FILTER;
  filteredBeta  += (rawBeta  - filteredBeta)  * GYRO_FILTER;

  // Мёртвая зона
  const dg = Math.abs(filteredGamma) < GYRO_DEADZONE ? 0 : filteredGamma;
  const db = Math.abs(filteredBeta)  < GYRO_DEADZONE ? 0 : filteredBeta;

  if (dg === 0 && db === 0) return;

  // Нормируем по максимальному углу → [-1, 1]
  const ix = Math.max(-1, Math.min(1, dg / GYRO_MAX_ANGLE));
  const iy = Math.max(-1, Math.min(1, db / GYRO_MAX_ANGLE));

  applyTilt(ix * GYRO_STRENGTH, iy * GYRO_STRENGTH);
}

// ============================================================
// СВАЙП — тап по экрану = радость, свайп = тоже наклон
// ============================================================

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
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    noteInteraction();
    const norm = Math.hypot(dx, dy) || 1;
    applyTilt((dx / norm) * 0.6, (dy / norm) * 0.6);
  }
}, { passive: true });

stage.addEventListener('touchend', e => {
  const totalDist = Math.hypot(
    e.changedTouches[0].clientX - touchStartX,
    e.changedTouches[0].clientY - touchStartY
  );
  if (totalDist < 12) {
    noteInteraction();
    setEmotion('happy');
    vibrate('light');
    applyImpulseToGroup('eye-left',  0, -0.75, { outer: 1.0, core: 0.5, highlight: 0.1 });
    applyImpulseToGroup('eye-right', 0, -0.75, { outer: 1.0, core: 0.5, highlight: 0.1 });
    setTimeout(() => { if (emotions.current === 'happy') setEmotion('idle'); }, 1200);
  }
}, { passive: true });

// Клик мышью (десктоп/тест)
pet.addEventListener('mousedown', () => {
  noteInteraction();
  setEmotion('happy');
  applyImpulseToGroup('eye-left',  0, -0.75, { outer: 1.0, core: 0.5, highlight: 0.1 });
  applyImpulseToGroup('eye-right', 0, -0.75, { outer: 1.0, core: 0.5, highlight: 0.1 });
  setTimeout(() => { if (emotions.current === 'happy') setEmotion('idle'); }, 1200);
});

// Пробел — тряска (для теста на десктопе)
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && !shakeActive) triggerShake();
});

// ============================================================
// ОБЩАЯ ФУНКЦИЯ НАКЛОНА
// ============================================================

function applyTilt(ix, iy) {
  if (getFaceState() === 'scattered') {
    applyTiltToAll(ix * TILT_IMPULSE_SCATTERED, iy * TILT_IMPULSE_SCATTERED);
  } else {
    const f = TILT_IMPULSE_ASSEMBLED;
    applyImpulseToGroup('eye-left',  ix * f, iy * f, { outer: 1.0, core: 0.4, highlight: 0.15 });
    applyImpulseToGroup('eye-right', ix * f, iy * f, { outer: 1.0, core: 0.4, highlight: 0.15 });
    applyImpulseToGroup('mouth',     ix * f * 0.5, iy * f * 0.5, { outer: 1.0, core: 0.4, highlight: 0.15 });
  }
}

// ============================================================
// ТРЯСКА
// ============================================================

function triggerShake() {
  if (shakeActive) return;
  shakeActive = true;
  noteInteraction();

  if (getFaceState() === 'assembled') {
    setEmotion('scared');
    vibrate('heavy'); // сильная вибрация при разлёте
  } else {
    setEmotion('happy');
    vibrate('medium'); // средняя при сборке
  }

  triggerShatterEffect();

  setTimeout(() => {
    shakeActive = false;
    if (emotions.current === 'scared' || emotions.current === 'happy') setEmotion('idle');
  }, 1000);
}

// ============================================================
// ВИБРАЦИЯ ОТ МОЛНИЙ
// Вызывается из face-bolts.js через глобальный колбэк
// ============================================================

// Дроссель чтобы вибрации не спамили каждый кадр
let lastBoltVibrateTime  = 0;
let lastSnapVibrateTime  = 0;
const BOLT_VIBRATE_INTERVAL = 300; // мс между лёгкими вибрациями
const SNAP_VIBRATE_INTERVAL = 150; // мс между средними (snap быстрее)

window.onBoltVisible = function(opacity) {
  // opacity: 0..1 — чем ярче молния, тем заметнее вибрация
  if (opacity < 0.3) return; // совсем слабые — игнорируем
  const now = Date.now();
  if (now - lastBoltVibrateTime < BOLT_VIBRATE_INTERVAL) return;
  lastBoltVibrateTime = now;
  vibrate('light');
};

window.onBoltSnap = function() {
  const now = Date.now();
  if (now - lastSnapVibrateTime < SNAP_VIBRATE_INTERVAL) return;
  lastSnapVibrateTime = now;
  vibrate('medium');
};

// ============================================================
// СКУКА
// ============================================================

function updateBoredom() {
  if (Date.now() - lastInteractionTime > BORED_TIMEOUT_MS && emotions.current === 'idle') {
    setEmotion('bored');
  }
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
requestAnimationFrame(tick);
