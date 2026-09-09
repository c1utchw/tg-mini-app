// ВРЕМЕННЫЙ ОТЛАДОЧНЫЙ ФАЙЛ. Для удаления: убрать этот файл и
// строку <script src="debug-skin-switcher.js"> из index.html —
// больше никаких следов в проекте не останется.

(function () {
  // Ждём загрузки DOM и SkinManager
  function init() {
    if (typeof SkinManager === 'undefined') {
      setTimeout(init, 100);
      return;
    }

    // --- Инжектируем стили ---
    const style = document.createElement('style');
    style.textContent = `
      #_dbg-skin-panel {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        gap: 5px;
        pointer-events: auto;
      }
      .dbg-skin-btn {
        padding: 6px 12px;
        border-radius: 8px;
        border: 1.5px solid rgba(127,239,234,0.5);
        background: rgba(0,0,0,0.75);
        color: #7FEFEA;
        font: 600 12px system-ui, sans-serif;
        cursor: pointer;
        letter-spacing: 0.04em;
        transition: background 0.15s;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        white-space: nowrap;
      }
      .dbg-skin-btn:active,
      .dbg-skin-btn.active {
        background: rgba(127,239,234,0.2);
      }
      .dbg-skin-btn.active {
        border-color: #7FEFEA;
        color: #fff;
      }
    `;
    document.head.appendChild(style);

    // --- Создаём панель ---
    const panel = document.createElement('div');
    panel.id = '_dbg-skin-panel';
    document.body.appendChild(panel);

    // --- Рендерим кнопки ---
    function renderButtons() {
      panel.innerHTML = '';
      const skins     = SkinManager.getSkins();
      const currentId = SkinManager.getCurrentSkinId();

      skins.forEach(skin => {
        const btn = document.createElement('button');
        btn.className  = 'dbg-skin-btn' + (skin.id === currentId ? ' active' : '');
        btn.textContent = skin.name;
        btn.dataset.id  = skin.id;

        const onClick = async (e) => {
          e.preventDefault();
          if (SkinManager.getCurrentSkinId() === skin.id) return;
          btn.textContent = '⏳';
          await SkinManager.loadSkin(skin.id);
          renderButtons();
        };

        btn.addEventListener('touchstart', onClick, { passive: false });
        btn.addEventListener('click', onClick);
        panel.appendChild(btn);
      });
    }

    renderButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
