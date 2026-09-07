// ============================================================
// renderer.js — Telegram Mini App версия
//
// Убрано:     window.petAPI (Electron IPC — размер/позиция окна)
// Добавлено:  тач-кнопки D-pad, свайп, гироскоп устройства (DeviceMotion)
// ============================================================

const pet   = document.getElementById('pet');
const stage = document.getElementById('stage');

// --- Инициализация Telegram WebApp ---
if (window.Telegram && window.Telegram.WebApp) {
  Telegram.WebApp.ready();
  Telegram.WebApp.expand(); // разворачиваем на весь экран
}

// --- Эмоции ---
const emotions = { current: 'idle' };
let lastInteractionTime = Date.now();
const BORED_TIMEOUT_MS  = 15000;

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
// КЛАВИАТУРНОЕ УПРАВЛЕНИЕ (для десктоп-браузера / тестирования)
// ============================================================

const pressedKeys = new Set();
let   shakeActive = false;

const TILT_IMPULSE_ASSEMBLED = 0.18;
const TILT_IMPULSE_SCATTERED = 0.55;

window.addEventListener('keydown', e => {
  pressedKeys.add(e.code);
  if (e.code === 'Space' && !shakeActive) triggerShake();
});
window.addEventListener('keyup', e => pressedKeys.delete(e.code));

function applyKeyboardTilt() {
  let ix = 0, iy = 0;
  if (pressedKeys.has('ArrowLeft'))  ix -= 1;
  if (pressedKeys.has('ArrowRight')) ix += 1;
  if (pressedKeys.has('ArrowUp'))    iy -= 1;
  if (pressedKeys.has('ArrowDown'))  iy += 1;
  if (ix === 0 && iy === 0) return;

  noteInteraction();
  applyTilt(ix, iy);
}

// ============================================================
// КНОПКИ D-PAD (тач-управление)
// ============================================================

// Удерживание кнопки — непрерывный наклон
const heldButtons = new Set();

document.querySelectorAll('.ctrl-btn[data-dir]').forEach(btn => {
  const dir = btn.dataset.dir;

  const startPress = (e) => {
    e.preventDefault();
    heldButtons.add(dir);
    noteInteraction();
  };
  const endPress = (e) => {
    e.preventDefault();
    heldButtons.delete(dir);
  };

  btn.addEventListener('touchstart', startPress, { passive: false });
  btn.addEventListener('touchend',   endPress,   { passive: false });
  btn.addEventListener('mousedown',  startPress);
  btn.addEventListener('mouseup',    endPress);
  btn.addEventListener('mouseleave', endPress);
});

// Кнопка тряски
const shakeBtn = document.getElementById('btn-shake');
if (shakeBtn) {
  const doShake = (e) => { e.preventDefault(); if (!shakeActive) triggerShake(); };
  shakeBtn.addEventListener('touchstart', doShake, { passive: false });
  shakeBtn.addEventListener('mousedown',  doShake);
}

function applyButtonTilt() {
  if (heldButtons.size === 0) return;
  let ix = 0, iy = 0;
  if (heldButtons.has('left'))  ix -= 1;
  if (heldButtons.has('right')) ix += 1;
  if (heldButtons.has('up'))    iy -= 1;
  if (heldButtons.has('down'))  iy += 1;
  applyTilt(ix, iy);
}

// ============================================================
// СВАЙП (дополнительный жест по экрану питомца)
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
    applyTilt(dx / norm, dy / norm);
  }
}, { passive: true });

// Тап по питомцу = радость
stage.addEventListener('touchend', e => {
  const totalDist = Math.hypot(
    e.changedTouches[0].clientX - touchStartX,
    e.changedTouches[0].clientY - touchStartY
  );
  if (totalDist < 10) {
    noteInteraction();
    setEmotion('happy');
    applyImpulseToGroup('eye-left',  0, -0.6, { outer: 1.0, core: 0.5, highlight: 0.1 });
    applyImpulseToGroup('eye-right', 0, -0.6, { outer: 1.0, core: 0.5, highlight: 0.1 });
    setTimeout(() => { if (emotions.current === 'happy') setEmotion('idle'); }, 1200);
  }
}, { passive: true });

// ============================================================
// ГИРОСКОП УСТРОЙСТВА (наклон телефона)
// ============================================================

let gyroEnabled = false;

// Запрашиваем разрешение (нужно на iOS 13+)
function requestGyro() {
  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission()
      .then(state => { if (state === 'granted') enableGyro(); })
      .catch(() => {});
  } else {
    enableGyro();
  }
}

function enableGyro() {
  window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
  gyroEnabled = true;
}

let gyroBeta  = 0; // наклон вперёд/назад (-180..180)
let gyroGamma = 0; // наклон влево/вправо (-90..90)

function onDeviceOrientation(e) {
  gyroBeta  = e.beta  || 0;
  gyroGamma = e.gamma || 0;
}

// Пробуем включить гироскоп автоматически или по первому тапу
requestGyro();
document.addEventListener('touchstart', () => {
  if (!gyroEnabled) requestGyro();
}, { once: true });

const GYRO_SCALE = 0.004; // чувствительность

function applyGyroTilt() {
  if (!gyroEnabled) return;
  // gamma: влево-вправо (−90..90), beta: вперёд-назад (−180..180)
  const ix = Math.max(-1, Math.min(1, gyroGamma * GYRO_SCALE * 60));
  const iy = Math.max(-1, Math.min(1, (gyroBeta - 45) * GYRO_SCALE * 40));
  if (Math.abs(ix) < 0.05 && Math.abs(iy) < 0.05) return;
  applyTilt(ix * 0.5, iy * 0.5);
}

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
// ТРЯСКА (Space / кнопка ⚡)
// ============================================================

function triggerShake() {
  if (shakeActive) return;
  shakeActive = true;
  noteInteraction();

  if (getFaceState() === 'assembled') {
    setEmotion('scared');
  } else {
    setEmotion('happy');
  }

  triggerShatterEffect();

  setTimeout(() => {
    shakeActive = false;
    if (emotions.current === 'scared' || emotions.current === 'happy') setEmotion('idle');
  }, 1000);
}

// ============================================================
// СКУКА
// ============================================================

function updateBoredom() {
  if (Date.now() - lastInteractionTime > BORED_TIMEOUT_MS && emotions.current === 'idle') {
    setEmotion('bored');
  }
}

// ============================================================
// КЛИК МЫШЬЮ (десктоп / тест)
// ============================================================

pet.addEventListener('mousedown', () => {
  noteInteraction();
  setEmotion('happy');
  applyImpulseToGroup('eye-left',  0, -0.6, { outer: 1.0, core: 0.5, highlight: 0.1 });
  applyImpulseToGroup('eye-right', 0, -0.6, { outer: 1.0, core: 0.5, highlight: 0.1 });
  setTimeout(() => { if (emotions.current === 'happy') setEmotion('idle'); }, 1200);
});

// ============================================================
// ГЛАВНЫЙ ТИК
// ============================================================

let lastTickTime = performance.now();

function tick() {
  const now = performance.now();
  const dt  = Math.min(now - lastTickTime, 50);
  lastTickTime = now;

  applyKeyboardTilt();
  applyButtonTilt();
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
