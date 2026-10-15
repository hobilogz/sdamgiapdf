// content.js — Sdamgia PDF Cleaner: удаление шапки, очистка ватермарок (ЕГЭ, ОГЭ, ВПР) и сохранение в чистый PDF

(function initSdamgiaCleaner() {
  if (window.__sdamgiaCleanerInitialized) return;
  window.__sdamgiaCleanerInitialized = true;

  const storage = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync)
    ? chrome.storage.sync
    : ((typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome.storage.local : null);

  let currentSettings = {
    autoUncheckNumbers: true,
    cleanWatermark: true,
    downloadFolder: ''
  };

  let hasAutoUnchecked = false;

  function loadSettings(callback) {
    if (storage) {
      storage.get(currentSettings, (items) => {
        if (items) currentSettings = Object.assign(currentSettings, items);
        if (callback) callback();
      });
    } else if (callback) {
      callback();
    }
  }

  // Список проектов системы «Сдам ГИА»
  const PROJECTS = [
    'ОГЭ', 'ЕГЭ', 'ГВЭ', 'ВПР', 'Урок', 'Олимп',
    'ЦТ и ЦЭ', 'ЦТ', 'ЦЭ', 'ЕНТ', 'СПО', 'ФГ'
  ];

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function isPrintVariantPage() {
    const url = window.location.href;
    const search = window.location.search;
    return url.includes('print=true') ||
           new URLSearchParams(search).get('print') === 'true' ||
           window.location.hash.includes('print=true');
  }

  /**
   * Автоматическое выключение чекбокса "№№ заданий"
   */
  function uncheckTaskNumbers(force = false) {
    if (!currentSettings.autoUncheckNumbers) return;
    if (hasAutoUnchecked && !force) return;

    let cb = document.getElementById('cb_num');
    if (!cb) {
      const labels = document.querySelectorAll('label');
      for (const lbl of labels) {
        const text = lbl.textContent || '';
        if (text.includes('№№ заданий') || text.includes('№ заданий')) {
          cb = lbl.querySelector('input[type="checkbox"]');
          if (cb) break;
        }
      }
    }

    if (cb && cb.checked) {
      cb.click();
      if (cb.checked) {
        cb.checked = false;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
      hasAutoUnchecked = true;
      console.log('[Sdamgia PDF Cleaner] Чекбокс "№№ заданий" выключен.');
    }
  }

  /**
   * Очистка ватермарки с одного изображения (SVG или растр):
   * Удаляет "решуегэ.рф", "решуогэ.рф", "решувпр.рф", "решуцт.рф" и т.п.
   */
  async function cleanSingleImage(img) {
    if (!img || img.__sdamgiaCleaned) return;
    img.__sdamgiaCleaned = true;

    const src = img.src || img.getAttribute('src') || '';
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) return;

    try {
      // 1. Проверяем векторный SVG
      const resp = await fetch(src);
      const contentType = resp.headers.get('content-type') || '';
      const text = await resp.text();

      const isSvg = contentType.includes('svg') || text.includes('<svg');
      if (isSvg) {
        const hasWatermarkGroup = /<g\b[^>]*fill-opacity:\s*0\.[2-6][^>]*>[\s\S]*?<\/g>/i.test(text) ||
                                  text.includes('fill-opacity:0.4') ||
                                  /решу(егэ|огэ|впр|цт|гвэ)/i.test(text);

        if (hasWatermarkGroup) {
          let cleanSvg = text;
          cleanSvg = cleanSvg.replace(/<g\b[^>]*fill-opacity:\s*0\.[2-6][^>]*>[\s\S]*?<\/g>/gi, '');
          cleanSvg = cleanSvg.replace(/<!--File created and owned by https?:\/\/sdamgia\.ru[\s\S]*?-->/gi, '');

          const blob = new Blob([cleanSvg], { type: 'image/svg+xml' });
          img.src = URL.createObjectURL(blob);
          return;
        }
      }

      // 2. Растровый PNG/JPEG на белом фоне
      if (!img.complete) {
        await new Promise(r => { img.onload = r; img.onerror = r; });
      }

      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) return;

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const checkH = Math.min(50, h);
      const checkW = Math.min(150, w);
      const startX = w - checkW;
      const startY = h - checkH;

      const imgData = ctx.getImageData(startX, startY, checkW, checkH);
      const data = imgData.data;
      let modified = false;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Ватермарки (решуегэ, решуогэ, решувпр) нанесены серым полупрозрачным цветом (120-225)
        const isGrey = Math.abs(r - g) < 20 && Math.abs(g - b) < 20 && Math.abs(r - b) < 20;
        if (isGrey && r >= 125 && r <= 228) {
          data[i] = 255;
          data[i + 1] = 255;
          data[i + 2] = 255;
          modified = true;
        }
      }

      if (modified) {
        ctx.putImageData(imgData, startX, startY);
        img.src = canvas.toDataURL('image/png');
      }
    } catch (err) {
      // Игнорируем единичные ошибки
    }
  }

  /**
   * Очистка ватермарок на всех чертежах страницы варианта
   */
  async function cleanAllWatermarks() {
    if (!currentSettings.cleanWatermark) return;

    const images = Array.from(document.querySelectorAll('img')).filter(img => {
      const src = img.getAttribute('src') || '';
      return src.includes('get_file') || src.includes('/formula/') === false;
    });

    await Promise.all(images.map(img => cleanSingleImage(img)));
  }

  function isMatchingHeaderLeft(rawText) {
    const text = (rawText || '').trim().replace(/\u00A0/g, ' ');
    if (!text.startsWith('РЕШУ')) return false;

    const matchesAnyProject = PROJECTS.some(proj => {
      const escaped = proj.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      return new RegExp('^РЕШУ\\s+' + escaped, 'i').test(text);
    });

    return matchesAnyProject || text.includes('—') || text.includes('-');
  }

  function isMatchingHeaderRight(rawText) {
    const text = (rawText || '').trim().replace(/\u00A0/g, ' ');
    return text.startsWith('Вариант №') ||
           text.startsWith('Вариант N') ||
           /^Вариант\s*№?\s*\d+/i.test(text);
  }

  function findHeaderStart() {
    const elements = document.querySelectorAll('div, span, p, b, strong');
    for (const el of elements) {
      if (el.children.length === 0 && isMatchingHeaderLeft(el.textContent)) {
        return el.closest('div');
      }
    }
    for (const el of elements) {
      if (el.children.length === 0 && isMatchingHeaderRight(el.textContent)) {
        return el.closest('div');
      }
    }
    return null;
  }

  function removeSdamgiaHeader() {
    const headerNode = findHeaderStart();
    if (!headerNode) {
      console.warn('[Sdamgia PDF Cleaner] Шапка не найдена.');
      return;
    }

    const parent = headerNode.parentElement;
    if (!parent) return;

    const children = Array.from(parent.children);
    const hasTaskChild = children.some(child => {
      const normStyle = (child.getAttribute('style') || '').toLowerCase().replace(/\s+/g, '');
      return (normStyle.includes('position:relative') || child.style.position === 'relative') &&
             !normStyle.includes('border-top');
    });

    if (hasTaskChild) {
      for (const child of children) {
        const normStyle = (child.getAttribute('style') || '').toLowerCase().replace(/\s+/g, '');
        const isTaskStart = (normStyle.includes('position:relative') || child.style.position === 'relative') &&
                            !normStyle.includes('border-top');
        if (isTaskStart) break;
        child.remove();
      }
      console.log('[Sdamgia PDF Cleaner] Шапка успешно удалена.');
    } else {
      const prev = headerNode.previousElementSibling;
      if (prev && (prev.getAttribute('style') || '').includes('border-top')) {
        prev.remove();
      }
      const next = headerNode.nextElementSibling;
      if (next && isMatchingHeaderRight(next.textContent)) {
        const nextNext = next.nextElementSibling;
        if (nextNext && (nextNext.getAttribute('style') || '').includes('clear:both')) {
          nextNext.remove();
        }
        next.remove();
      }
      headerNode.remove();
    }
  }

  function getFormattedDate() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  }

  function getVariantId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('id') || '';
  }

  function setCheckbox(id, checked) {
    let cb = document.getElementById(id);
    if (!cb) {
      const labels = document.querySelectorAll('label');
      for (const lbl of labels) {
        const text = lbl.textContent || '';
        if ((id === 'cb_num' && (text.includes('№№ заданий') || text.includes('№ заданий'))) ||
            (id === 'cb_sol' && text.includes('Решения')) ||
            (id === 'cb_ans' && text.includes('Ответы')) ||
            (id === 'cb_key' && text.includes('Ключ'))) {
          cb = lbl.querySelector('input[type="checkbox"]');
          if (cb) break;
        }
      }
    }
    if (cb && cb.checked !== checked) {
      cb.checked = checked;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  let buttonMode = 'student'; // 'student' или 'teacher'

  /**
   * Подготовка и сохранение варианта ученика
   */
  async function saveStudentPDF() {
    const btn = document.getElementById('sdamgia-clean-pdf-btn');
    if (btn) btn.style.display = 'none';

    try {
      // 1. Выключаем номера заданий, решения, ответы, ключ
      setCheckbox('cb_num', false);
      setCheckbox('cb_sol', false);
      setCheckbox('cb_ans', false);
      setCheckbox('cb_key', false);

      // 2. Имя файла: просто дата создания/скачки (например, 15.10.2026)
      document.title = getFormattedDate();

      // 3. Очистка ватермарок и шапки
      if (currentSettings.cleanWatermark) {
        await cleanAllWatermarks();
      }
      await sleep(100);
      removeSdamgiaHeader();
      await sleep(100);

      window.print();
    } catch (err) {
      console.error('[Sdamgia PDF Cleaner] Ошибка сохранения варианта ученика:', err);
      window.print();
    } finally {
      const span = document.querySelector('#sdamgia-btn-student span');
      if (span) span.textContent = 'Вариант ученика';
    }
  }

  /**
   * Подготовка и сохранение варианта учителя
   */
  async function saveTeacherPDF() {
    try {
      // 1. Включаем номера заданий, решения, ответы, ключ
      setCheckbox('cb_num', true);
      setCheckbox('cb_sol', true);
      setCheckbox('cb_ans', true);
      setCheckbox('cb_key', true);

      // 2. Имя файла: Вариант_<номер>_<дата>
      const vid = getVariantId();
      document.title = vid ? `Вариант_${vid}_${getFormattedDate()}` : `Вариант_${getFormattedDate()}`;

      // 3. Очистка ватермарок (в том числе в появившихся решениях)
      if (currentSettings.cleanWatermark) {
        await cleanAllWatermarks();
      }
      await sleep(100);
      removeSdamgiaHeader();
      await sleep(100);

      window.print();
    } catch (err) {
      console.error('[Sdamgia PDF Cleaner] Ошибка сохранения варианта учителя:', err);
      window.print();
    } finally {
      const span = document.querySelector('#sdamgia-btn-teacher span');
      if (span) span.textContent = 'Вариант учителя';
    }
  }

  /**
   * Внедрение двух удобных кнопок в правый верхний угол (Ученик и Учитель)
   */
  function injectDownloadButton() {
    if (document.getElementById('sdamgia-clean-pdf-panel')) return;

    if (!document.getElementById('sdamgia-clean-pdf-styles')) {
      const styleTag = document.createElement('style');
      styleTag.id = 'sdamgia-clean-pdf-styles';
      styleTag.textContent = `
        @media print {
          #sdamgia-clean-pdf-panel,
          .sdamgia-pdf-no-print {
            display: none !important;
            visibility: hidden !important;
          }
        }
        #sdamgia-clean-pdf-panel {
          position: fixed;
          top: 16px;
          right: 20px;
          z-index: 2147483647;
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }
        .sdamgia-action-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #ffffff !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          font-size: 13.5px;
          font-weight: 600;
          letter-spacing: 0.2px;
          line-height: 1;
          padding: 10px 16px;
          border-radius: 22px;
          border: 1px solid rgba(255, 255, 255, 0.25);
          cursor: pointer;
          user-select: none;
          text-decoration: none !important;
          transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.2s ease;
        }
        .sdamgia-btn-student {
          background: linear-gradient(135deg, #1d4ed8 0%, #0d47a1 100%);
          box-shadow: 0 4px 14px rgba(13, 71, 161, 0.38), 0 2px 6px rgba(0, 0, 0, 0.15);
        }
        .sdamgia-btn-student:hover {
          background: linear-gradient(135deg, #2563eb 0%, #1565c0 100%);
          box-shadow: 0 6px 18px rgba(13, 71, 161, 0.48), 0 3px 8px rgba(0, 0, 0, 0.2);
          transform: translateY(-2px);
        }
        .sdamgia-btn-teacher {
          background: linear-gradient(135deg, #059669 0%, #047857 100%);
          box-shadow: 0 4px 14px rgba(4, 120, 87, 0.38), 0 2px 6px rgba(0, 0, 0, 0.15);
        }
        .sdamgia-btn-teacher:hover {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          box-shadow: 0 6px 18px rgba(4, 120, 87, 0.48), 0 3px 8px rgba(0, 0, 0, 0.2);
          transform: translateY(-2px);
        }
        .sdamgia-action-btn:active {
          transform: translateY(0);
        }
        .sdamgia-action-btn svg {
          flex-shrink: 0;
          width: 17px;
          height: 17px;
          fill: currentColor;
        }
      `;
      (document.head || document.documentElement).appendChild(styleTag);
    }

    const panel = document.createElement('div');
    panel.id = 'sdamgia-clean-pdf-panel';
    panel.className = 'no_print sdamgia-pdf-no-print';

    const downloadIconSvg = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
      </svg>
    `;

    // 1. Кнопка "Вариант ученика"
    const btnStudent = document.createElement('button');
    btnStudent.id = 'sdamgia-btn-student';
    btnStudent.type = 'button';
    btnStudent.className = 'sdamgia-action-btn sdamgia-btn-student';
    btnStudent.title = 'Сохранить чистый вариант ученика (без решений, ответов и номеров заданий каталога)';
    btnStudent.innerHTML = `${downloadIconSvg}<span>Вариант ученика</span>`;
    btnStudent.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const span = btnStudent.querySelector('span');
      if (span) span.textContent = 'Подготовка...';
      saveStudentPDF();
    });

    // 2. Кнопка "Вариант учителя"
    const btnTeacher = document.createElement('button');
    btnTeacher.id = 'sdamgia-btn-teacher';
    btnTeacher.type = 'button';
    btnTeacher.className = 'sdamgia-action-btn sdamgia-btn-teacher';
    btnTeacher.title = 'Сохранить вариант учителя (с решениями, ответами, ключом и номерами заданий)';
    btnTeacher.innerHTML = `${downloadIconSvg}<span>Вариант учителя</span>`;
    btnTeacher.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const span = btnTeacher.querySelector('span');
      if (span) span.textContent = 'Подготовка...';
      saveTeacherPDF();
    });

    panel.appendChild(btnStudent);
    panel.appendChild(btnTeacher);
    document.body.appendChild(panel);
  }

  function checkAndInject() {
    if (isPrintVariantPage()) {
      uncheckTaskNumbers();
      if (document.body) {
        injectDownloadButton();
      }
    }
  }

  loadSettings(() => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', checkAndInject);
    } else {
      checkAndInject();
    }
    setTimeout(checkAndInject, 100);
    setTimeout(checkAndInject, 400);
  });

  setInterval(checkAndInject, 1000);

  // Слушаем клик по иконке расширения в панели Chrome
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request && request.action === 'cleanAndPrint') {
        cleanAndSavePDF();
        sendResponse({ status: 'ok' });
      } else if (request && request.action === 'settingsUpdated') {
        if (request.settings) {
          currentSettings = Object.assign(currentSettings, request.settings);
          if (currentSettings.autoUncheckNumbers) {
            uncheckTaskNumbers(true);
          }
        }
        sendResponse({ status: 'ok' });
      }
    });
  }
})();
