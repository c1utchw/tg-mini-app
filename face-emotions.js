// ============================================================
// face-emotions.js — переходы между эмоциями лица
//
// Каждая эмоция — отдельная функция. Функции работают с кристалликами
// SVG напрямую через CSS transition (задаётся через style.transform).
// Для перемещения кристалликов используется translate(), потому что
// атрибут points трогать тяжелее, а transform работает плавно через CSS.
//
// Используемые ID: определены в assets/face-shard-registry.json
// ============================================================

// Вспомогательная функция: плавно сдвинуть элемент SVG на (dx, dy) от home-позиции.
// duration — время анимации в мс.
function moveShard(el, dx, dy, duration) {
  el.style.transition = `transform ${duration}ms ease`;
  el.style.transform = `translate(${dx}px, ${dy}px)`;
}

// Вспомогательная функция: вернуть кристаллик на родную позицию (dx=0, dy=0).
function resetShard(el, duration) {
  el.style.transition = `transform ${duration}ms ease`;
  el.style.transform = 'translate(0, 0)';
}

// Сбросить ВСЕ кристаллики на home-позицию.
function resetAllShards(duration) {
  document.querySelectorAll('.shard').forEach(el => resetShard(el, duration));
}

// ============================================================
// НЕЙТРАЛЬ — спокойное состояние, все на месте
// ============================================================
function playNeutralEmotion() {
  resetAllShards(300);
}

// ============================================================
// РАДОСТЬ — кристаллики глаз чуть сжимаются (веки опускаются),
// рот немного растягивается вниз
// ============================================================
function playHappyEmotion() {
  resetAllShards(0); // сначала сброс без анимации

  // Верхние кристаллики левого глаза (outer-1, outer-17, outer-9) — вниз
  const happyLeftTop = ['eye-left-outer-1', 'eye-left-outer-17', 'eye-left-outer-9'];
  happyLeftTop.forEach(id => {
    const el = document.getElementById(id);
    if (el) moveShard(el, 0, 14, 250);
  });

  // Верхние кристаллики правого глаза — вниз
  const happyRightTop = ['eye-right-outer-5', 'eye-right-outer-15', 'eye-right-outer-20'];
  happyRightTop.forEach(id => {
    const el = document.getElementById(id);
    if (el) moveShard(el, 0, 14, 250);
  });

  // Кристаллики рта — чуть вниз и в стороны (улыбка шире)
  const happyMouthSides = ['mouth-outer-1', 'mouth-outer-2'];
  happyMouthSides.forEach(id => {
    const el = document.getElementById(id);
    if (el) moveShard(el, 8, 6, 250);
  });
  const happyMouthLeft = ['mouth-outer-6', 'mouth-outer-15'];
  happyMouthLeft.forEach(id => {
    const el = document.getElementById(id);
    if (el) moveShard(el, -8, 6, 250);
  });
}

// ============================================================
// ИСПУГ — только разлёт (управляется через face-shatter.js).
// Здесь — лишь сброс к нейтрали, если нужно.
// Реальная анимация испуга вызывается из triggerShake() в renderer.js.
// ============================================================
function playScaredEmotion() {
  // Разлёт обрабатывает face-shatter.js — здесь ничего не делаем.
  // CSS-анимация контейнера (класс 'scared') уже добавляется в renderer.js.
}

// ============================================================
// СКУКА — глаза полуприкрыты (верхние кристаллики ещё ниже),
// рот немного опускается
// ============================================================
function playBoredEmotion() {
  resetAllShards(0);

  const boredLeftTop = ['eye-left-outer-1', 'eye-left-outer-17', 'eye-left-outer-9',
                        'eye-left-outer-7', 'eye-left-outer-20'];
  boredLeftTop.forEach(id => {
    const el = document.getElementById(id);
    if (el) moveShard(el, 0, 20, 600);
  });

  const boredRightTop = ['eye-right-outer-5', 'eye-right-outer-15', 'eye-right-outer-20',
                         'eye-right-outer-10', 'eye-right-outer-0'];
  boredRightTop.forEach(id => {
    const el = document.getElementById(id);
    if (el) moveShard(el, 0, 20, 600);
  });

  // Рот чуть вверх (недовольство)
  const boredMouth = ['mouth-outer-0', 'mouth-outer-7', 'mouth-outer-8', 'mouth-outer-9'];
  boredMouth.forEach(id => {
    const el = document.getElementById(id);
    if (el) moveShard(el, 0, -8, 600);
  });
}
