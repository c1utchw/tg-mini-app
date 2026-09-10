// ============================================================
// skin-manager.js — единственная точка откуда лицо появляется в DOM
//
// Использование:
//   await SkinManager.init()           — загрузить манифест, применить дефолтный скин
//   await SkinManager.loadSkin('cloud') — сменить скин
//   SkinManager.getSkins()             — список { id, name } из манифеста
// ============================================================

const SkinManager = (() => {

  let _manifest  = [];
  let _currentId = null;

  // Контейнер куда вставляется инлайн SVG
  // В index.html должен быть <div id="pet-face"></div>
  const _getFaceContainer = () => document.getElementById('pet-face');

  // ---- Загрузка манифеста ----
  async function _loadManifest() {
    const res  = await fetch('assets/skins-manifest.json');
    _manifest  = await res.json();
  }

  // ---- Парсинг SVG-текста → только содержимое <svg> ----
  // Возвращает { svgEl, viewBox } — готовый SVGElement для вставки в DOM
  function _parseSvg(text) {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(text, 'image/svg+xml');
    const srcSvg = doc.querySelector('svg');
    if (!srcSvg) throw new Error('Не найден <svg> в скине');
    return srcSvg;
  }

  // ---- Основная функция смены скина ----
  async function loadSkin(skinId) {
    const skin = _manifest.find(s => s.id === skinId);
    if (!skin) { console.error(`[SkinManager] Скин '${skinId}' не найден`); return; }

    // 1. Загружаем SVG
    const res  = await fetch(skin.path);
    const text = await res.text();
    const srcSvg = _parseSvg(text);

    // 2. Переносим нужные атрибуты на целевой SVG
    //    В index.html уже есть #face-svg с нашим viewBox и фильтрами.
    //    Мы полностью заменяем содержимое pet-face новым SVG-элементом,
    //    присваивая ему id="face-svg" чтобы вся логика продолжала работать.
    srcSvg.id = 'face-svg';
    srcSvg.style.width  = '100%';
    srcSvg.style.height = '100%';
    srcSvg.style.display = 'block';

    // Удаляем <metadata> с C2PA (не нужен в браузере, экономим память)
    const meta = srcSvg.querySelector('metadata');
    if (meta) meta.remove();

    // 3. Останавливаем старую физику / молнии (сбрасываем массивы)
    _teardown();

    // 4. Вставляем новый SVG
    const container = _getFaceContainer();
    container.innerHTML = '';
    container.appendChild(srcSvg);

    _currentId = skinId;

    // Устанавливаем физический вес скина
    if (typeof setSkinWeight === 'function') {
      setSkinWeight(skin.weight !== undefined ? skin.weight : 1.0);
    }

    // 5. Переинициализируем всю логику на новых элементах
    _reinit();

    console.log(`[SkinManager] Скин загружен: ${skin.name}`);
  }

  // ---- Сброс старого состояния ----
  function _teardown() {
    if (typeof SHARDS !== 'undefined')    SHARDS.length = 0;
    if (typeof SHARD_MAP !== 'undefined') { for (const k in SHARD_MAP) delete SHARD_MAP[k]; }
    if (typeof BOLTS !== 'undefined')     BOLTS.length = 0;
    if (typeof BOLT_MAP !== 'undefined')  { for (const k in BOLT_MAP) delete BOLT_MAP[k]; }
    if (typeof setGravity        === 'function') setGravity(0, 0);
    if (typeof resetPhysicsMode  === 'function') resetPhysicsMode();
    if (typeof resetFaceState    === 'function') resetFaceState();
    if (typeof setBoltMode       === 'function') setBoltMode('normal');
  }

  // ---- Переинициализация логики на новых DOM-элементах ----
  function _reinit() {
    // Переинициализируем физику (заново сканирует .shard в DOM)
    if (typeof initPhysics === 'function') initPhysics();
    // Переинициализируем молнии (заново сканирует .lightning-bolt в DOM)
    if (typeof initBolts   === 'function') initBolts();
    // Сбрасываем эмоции на нейтраль
    if (typeof playNeutralEmotion === 'function') playNeutralEmotion();
  }

  // ---- Публичное API ----
  async function init(defaultSkinId = 'crystal') {
    await _loadManifest();
    await loadSkin(defaultSkinId);
  }

  function getSkins() {
    return _manifest.map(s => ({ id: s.id, name: s.name }));
  }

  function getCurrentSkinId() {
    return _currentId;
  }

  return { init, loadSkin, getSkins, getCurrentSkinId };

})();
