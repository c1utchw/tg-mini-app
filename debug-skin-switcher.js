// ВРЕМЕННЫЙ ОТЛАДОЧНЫЙ ФАЙЛ. Для удаления: убрать этот файл и
// строку <script src="debug-skin-switcher.js"> из index.html —
// больше никаких следов в проекте не останется.

(function () {

  // Стили панели — всё инлайн, не трогаем style.css
  const CSS = `
    #_dbg-skin-panel {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .dbg-skin-btn {
      padding: 7px 14px;
      border-radius: 10px;
      border: 1.5px solid rgba(127,239,234,0.45);
      background: rgba(0,0,0,0.80);
      color: #7FEFEA;
      font: 600 13px system-ui,sans-serif;
      cursor: pointer;
      letter-spacing: 0.04em;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      white-space: nowrap;
      min-width: 90px;
      text-align: center;
    }
    .dbg-skin-btn.active {
      border-color: #7FEFEA;
      background: rgba(127,239,234,0.18);
      color: #fff;
    }
  `;

  // Инжектируем стили
  const styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  // Создаём панель сразу — она будет видна всегда
  const panel = document.createElement('div');
  panel.id = '_dbg-skin-panel';
  document.body.appendChild(panel);

  let _loading = false;

  function renderButtons() {
    panel.innerHTML = '';

    // Если SkinManager ещё не готов — показываем плейсхолдер
    if (typeof SkinManager === 'undefined' || !SkinManager.getSkins().length) {
      const p = document.createElement('div');
      p.style.cssText = 'color:#7FEFEA;font:11px system-ui;opacity:.5;padding:6px';
      p.textContent = '…';
      panel.appendChild(p);
      return;
    }

    const skins     = SkinManager.getSkins();
    const currentId = SkinManager.getCurrentSkinId();

    skins.forEach(skin => {
      const btn = document.createElement('button');
      btn.className   = 'dbg-skin-btn' + (skin.id === currentId ? ' active' : '');
      btn.textContent = skin.name;

      const pick = async (e) => {
        e.preventDefault();
        if (_loading || SkinManager.getCurrentSkinId() === skin.id) return;
        _loading = true;
        btn.textContent = '…';
        await SkinManager.loadSkin(skin.id);
        _loading = false;
        renderButtons();
      };

      btn.addEventListener('touchstart', pick, { passive: false });
      btn.addEventListener('click',      pick);
      panel.appendChild(btn);
    });
  }

  // Первый рендер — сразу и потом по таймеру пока SkinManager не готов
  renderButtons();

  const waitForManager = setInterval(() => {
    if (typeof SkinManager !== 'undefined' && SkinManager.getSkins().length > 0) {
      clearInterval(waitForManager);
      renderButtons();
    }
  }, 100);

})();
