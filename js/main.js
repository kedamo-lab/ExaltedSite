/* ============================================================
   EXALTED — общий скрипт сайта
   1. Шапка: эффект прокрутки
   2. Модалка профиля в стиле Discord (живые данные через API)
   3. Галерея: добавление/удаление видео
   ============================================================ */

(function () {
  'use strict';

  /* ---------- 1. Шапка ---------- */
  var header = document.querySelector('.site-header');
  if (header) {
    var onScroll = function () {
      header.classList.toggle('scrolled', window.scrollY > 24);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- 2. Discord-модалка профиля ---------- */

  var ROLE_DESCRIPTIONS = {
    'Owner': 'Основатель и владелец сообщества Exalted.',
    'Supp Owner': 'Заместитель владельца — помогает вести сообщество.',
    'Critic': 'Критик — следит за атмосферой и качеством контента.'
  };

  var ACTIVITY_TYPE = {
    0:  ['Играет в', '🎮'],
    1:  ['Стримит', '🎥'],
    2:  ['Слушает', '🎧'],
    3:  ['Смотрит', '📺'],
    4:  ['', '✨'],
    5:  ['Соревнуется в', '🏆']
  };

  var STATUS_RU = {
    online: 'В сети',
    idle: 'Не в сети? В сети — не активен',
    dnd: 'Не беспокоить',
    offline: 'Не в сети'
  };

  var modal = document.getElementById('member-modal');
  var adminNames = document.querySelectorAll('.admin-name');

  // Ссылки на элементы модалки
  var els = {
    banner: document.getElementById('modal-banner'),
    avatar: document.getElementById('modal-avatar-img'),
    display: document.getElementById('modal-display-name'),
    username: document.getElementById('modal-username'),
    nicknote: document.getElementById('modal-nicknote'),
    status: document.getElementById('modal-status'),
    loading: document.getElementById('modal-loading'),
    content: document.getElementById('modal-content'),
    about: document.getElementById('modal-about'),
    roles: document.getElementById('modal-roles'),
    activity: document.getElementById('modal-activity'),
    integrations: document.getElementById('modal-integrations'),
    since: document.getElementById('modal-since'),
    liveNote: document.getElementById('modal-live-note')
  };

  var currentLocal = null; // локальные данные активного члена

  function formatSince(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var yyyy = d.getFullYear();

    // Относительная длительность
    var months = (new Date().getFullYear() - yyyy) * 12 + (new Date().getMonth() - d.getMonth());
    var text = dd + '.' + mm + '.' + yyyy;
    if (months <= 0) return text + ' · только что';
    if (months < 12) {
      var y = Math.floor(months / 12);
      var m = months % 12;
      var parts = [];
      if (y > 0) parts.push(plural(y, ['год', 'года', 'лет']));
      if (m > 0) parts.push(plural(m, ['месяц', 'месяца', 'месяцев']));
      return text + ' · ' + parts.join(' ') + ' назад';
    }
    var years = Math.floor(months / 12);
    return text + ' · ' + plural(years, ['год', 'года', 'лет']) + ' назад';
  }

  function plural(n, forms) {
    var n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return n + ' ' + forms[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return n + ' ' + forms[1];
    return n + ' ' + forms[2];
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  // Первичное заполнение из локальных данных (мгновенный отклик)
  function fillLocal(local) {
    currentLocal = local;
    els.avatar.src = local.avatar;
    els.display.textContent = local.username;
    els.username.textContent = '@' + local.username;
    els.status.className = 'modal-status-dot';

    els.about.textContent = ROLE_DESCRIPTIONS[local.role] || 'Участник администрации Exalted.';

    var rolePill = document.createElement('span');
    rolePill.className = 'role-pill';
    rolePill.style.setProperty('--pill-color', local.accent || '#b39bff');
    var dot = document.createElement('span');
    dot.className = 'pill-dot';
    rolePill.appendChild(dot);
    rolePill.appendChild(document.createTextNode(local.role));
    els.roles.innerHTML = '';
    els.roles.appendChild(rolePill);

    els.activity.innerHTML = '<span class="no-activity">Проверяем активность…</span>';
    els.integrations.innerHTML = '<span class="integ-none">Загружаем…</span>';
    els.since.textContent = '—';
    els.liveNote.hidden = true;
  }

  // Заполнение живыми данными с сервера
  function fillLive(data) {
    els.avatar.src = data.avatar || currentLocal.avatar;
    if (data.banner) {
      var img = document.createElement('img');
      img.src = data.banner;
      els.banner.innerHTML = '';
      els.banner.appendChild(img);
    } else {
      els.banner.innerHTML = '';
    }

    var displayName = data.globalName || data.nickname || data.username || currentLocal.username;
    els.display.textContent = displayName;
    els.username.textContent = '@' + (data.username || currentLocal.username);
    els.status.className = 'modal-status-dot ' + (data.status || 'offline');
    els.status.title = STATUS_RU[data.status] || STATUS_RU.offline;

    if (data.nickname && data.nickname !== displayName) {
      els.nicknote.textContent = 'Ник на сервере: ' + data.nickname;
      els.nicknote.hidden = false;
    } else {
      els.nicknote.hidden = true;
    }

    // Роли
    var roles = data.roles || [];
    var roleEls = '';
    if (!roles.length) {
      roleEls = '<span class="role-pill pill-muted">Нет ролей</span>';
    }
    roles.forEach(function (r) {
      var color = r.color || '#b39bff';
      roleEls +=
        '<span class="role-pill" style="--pill-color:' + esc(color) + '">' +
        '<span class="pill-dot"></span>' + esc(r.name) +
        '</span>';
    });
    // Локальная роль всё равно первой (её нет в ролях сервера — для наглядности)
    if (currentLocal.role) {
      roleEls =
        '<span class="role-pill" style="--pill-color:' + esc(currentLocal.accent || '#b39bff') + '">' +
        '<span class="pill-dot"></span>' + esc(currentLocal.role) + '</span>' + roleEls;
    }
    els.roles.innerHTML = roleEls;

    // Активность
    var acts = (data.activities || []).filter(function (a) { return a.name; });
    if (acts.length) {
      var html = '';
      acts.forEach(function (a) {
        var meta = ACTIVITY_TYPE[a.type] || ['', '🎮'];
        var label = meta[0] ? meta[0] + ' ' + a.name : a.name;
        var detail = a.state ? '<div class="act-detail">' + esc(a.state) + '</div>' : '';
        html +=
          '<div class="activity-row">' +
          '<div class="activity-icon">' + meta[1] + '</div>' +
          '<div class="activity-meta">' +
          '<div class="act-type">' + esc(label) + '</div>' +
          '<div class="act-name">' + esc(a.name) + '</div>' +
          detail +
          '</div>' +
          '</div>';
      });
      els.activity.innerHTML = html;
    } else {
      els.activity.innerHTML = '<span class="no-activity">Сейчас ничем не занят</span>';
    }

    // Интеграции (боту недоступны)
    els.integrations.innerHTML =
      '<div class="integration">' +
      '<div class="integ-icon">🔗</div>' +
      '<div class="integ-name">Связанные приложения</div>' +
      '<div class="integ-state linked">скрыты</div>' +
      '</div>';

    // В участниках с
    if (data.joinedAt) {
      els.since.textContent = formatSince(data.joinedAt);
    }
  }

  function openModal(local) {
    fillLocal(local);
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Асинхронно подгружаем живые данные
    fetchMember(local.id).then(fillLive).catch(function () {
      els.liveNote.hidden = false;
      els.activity.innerHTML = '<span class="no-activity">Живая активность недоступна</span>';
      els.integrations.innerHTML = '<span class="integ-none">Связанные приложения скрыты</span>';
    }).finally(function () {
      els.loading.style.display = 'none';
      els.content.style.display = 'flex';
    });
  }

  function closeModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function fetchMember(id) {
    return fetch('/api/member/' + id)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        return data;
      });
  }

  // Открытие по клику на ник
  adminNames.forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      openModal({
        id: el.getAttribute('data-user-id'),
        username: el.getAttribute('data-username'),
        avatar: el.getAttribute('data-avatar'),
        role: el.getAttribute('data-role'),
        accent: getComputedStyle(el.closest('.admin-card')).getPropertyValue('--card-accent').trim() || '#b39bff'
      });
    });
  });

  // Закрытие
  if (modal) {
    document.getElementById('modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
    });
  }

  /* ---------- 3. Активность в войс-каналах (главная) ---------- */

  var voiceEl = document.getElementById('voice-activity');
  if (voiceEl) {
    var VOICE_REFRESH_MS = 30000;

    var VOICE_SPEAKER = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';

    function voiceMemberHtml(m) {
      var name = m.nickname || m.globalName || m.username || '';
      var badge = '';
      if (m.selfDeaf) badge = '<span class="voice-mute">🔇</span>';
      else if (m.selfMute) badge = '<span class="voice-mute">🎙</span>';
      return (
        '<span class="voice-member">' +
        '<span class="voice-avatar">' +
        '<img src="' + esc(m.avatar) + '" alt="" loading="lazy">' +
        badge +
        '</span>' +
        '<span class="voice-member-name">' + esc(name) + '</span>' +
        '</span>'
      );
    }

    function renderVoice(data) {
      var cats = data.categories || [];
      var hasAny = cats.some(function (c) { return (c.channels || []).length; });
      if (!hasAny) {
        voiceEl.innerHTML = '<p class="voice-empty">Отслеживаемых войс-каналов пока нет.</p>';
        return;
      }
      var html = '';
      cats.forEach(function (cat) {
        var chans = cat.channels || [];
        if (!chans.length) return;
        html += '<div class="voice-category">';
        html += '<h3 class="voice-cat-name">' + esc(cat.name) + '</h3>';
        html += '<div class="voice-channels">';
        chans.forEach(function (ch) {
          var members = ch.members || [];
          html += '<div class="voice-channel">';
          html += '<span class="voice-channel-name">' + VOICE_SPEAKER + esc(ch.name) + '</span>';
          if (!members.length) {
            html += '<span class="voice-channel-empty">никто не сидит</span>';
          } else {
            html += '<span class="voice-members">' + members.map(voiceMemberHtml).join('') + '</span>';
          }
          html += '</div>';
        });
        html += '</div>';
        html += '</div>';
      });
      voiceEl.innerHTML = html;
    }

    function loadVoice() {
      fetch('/api/voice')
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (data) {
          if (data.error) throw new Error(data.error);
          renderVoice(data);
        })
        .catch(function () {
          voiceEl.innerHTML =
            '<p class="voice-offline">Живые данные недоступны — запусти сервер (server → npm start), и войс-активность появится здесь.</p>';
        });
    }

    loadVoice();
    setInterval(loadVoice, VOICE_REFRESH_MS);
  }

  /* ---------- 4. Секретная зона администрации ---------- */

  // SHA-256 от пароля "ExaltedCom26" (сам пароль не хранится в коде)
  var ADMIN_PASS_HASH = '51b2236f03831a3a2dd6261747b48feed1576b8a0ed9234414ce4a0c6e96907d';

  // Режим администратора: sessionStorage доступен даже в приватном окне
  function readAdminSession() {
    try {
      return sessionStorage.getItem('exalted_admin') === '1';
    } catch (e) {
      return false;
    }
  }

  var adminUnlocked = readAdminSession();

  var SECRET_KEY_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l.757 -.757l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0z"/>' +
    '</svg>';

  function sha256Hex(str) {
    if (!window.crypto || !window.crypto.subtle) {
      return Promise.reject(new Error('no-webcrypto'));
    }
    return window.crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(str))
      .then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
      });
  }

  function buildAdminGate() {
    // Кнопка-ключ
    var keyBtn = document.createElement('button');
    keyBtn.className = 'admin-key';
    keyBtn.setAttribute('aria-label', 'Секретная зона администрации');
    keyBtn.title = 'Секретная зона';
    keyBtn.innerHTML = SECRET_KEY_SVG;
    document.body.appendChild(keyBtn);

    // Модалка
    var overlay = document.createElement('div');
    overlay.className = 'secret-overlay';
    overlay.id = 'secret-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="secret-card">' +
      '<button class="secret-close" id="secret-close" aria-label="Закрыть">✕</button>' +
      '<div class="secret-icon" id="secret-icon">' + SECRET_KEY_SVG + '</div>' +
      '<p class="secret-text">Ой-ой, кажется вы попали в секретное место администрации. ' +
      'Если вы не администратор, покиньте данную зону :)</p>' +
      '<form class="secret-form" id="secret-form">' +
      '<input type="password" id="secret-input" placeholder="Пароль администратора" autocomplete="off" spellcheck="false">' +
      '<button type="submit" class="btn btn-primary">Войти</button>' +
      '</form>' +
      '<p class="secret-msg" id="secret-msg"></p>' +
      '</div>';
    document.body.appendChild(overlay);

    var icon = document.getElementById('secret-icon');
    var form = document.getElementById('secret-form');
    var input = document.getElementById('secret-input');
    var msg = document.getElementById('secret-msg');

    // Уже открыт режим — просто показываем зелёный ключ
    var showUnlocked = function () {
      icon.classList.add('good');
      msg.textContent = 'Доступ уже разрешён';
      msg.className = 'secret-msg good';
    };

    var open = function () {
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      if (adminUnlocked) showUnlocked();
      else {
        icon.classList.remove('good', 'bad');
        msg.textContent = '';
        msg.className = 'secret-msg';
        setTimeout(function () { input.focus(); }, 80);
      }
    };

    var close = function () {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      icon.classList.remove('good', 'bad');
      input.classList.remove('input-bad');
    };

    keyBtn.addEventListener('click', open);

    document.getElementById('secret-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) close();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (adminUnlocked) { close(); return; }

      var value = input.value;
      if (!value) { input.focus(); return; }

      sha256Hex(value).then(function (hash) {
        if (hash === ADMIN_PASS_HASH) {
          adminUnlocked = true;
          sessionStorage.setItem('exalted_admin', '1');
          document.body.classList.add('is-admin');
          updateGalleryUi();
          icon.classList.remove('bad');
          icon.classList.add('good');
          msg.textContent = 'Доступ разрешён';
          msg.className = 'secret-msg good';
          setTimeout(close, 1500);
        } else {
          // Неверный пароль: красный ключ + резкое встряхивание
          icon.classList.remove('good');
          icon.classList.add('bad');
          input.classList.add('input-bad');
          input.value = '';
          msg.textContent = 'Неверный пароль';
          msg.className = 'secret-msg bad';
          setTimeout(function () {
            icon.classList.remove('bad'); // возврат к белому свечению
          }, 500);
          setTimeout(function () { input.focus(); }, 520);
        }
      }).catch(function () {
        msg.textContent = 'Хеширование недоступно в этом браузере';
        msg.className = 'secret-msg bad';
      });
    });
  }

  // Скрытие/показ элементов галереи в зависимости от режима админа
  function updateGalleryUi() {
    if (adminUnlocked) document.body.classList.add('is-admin');
    else document.body.classList.remove('is-admin');
  }

  // Восстановление сессии на всех страницах
  updateGalleryUi();
  buildAdminGate();

  /* ---------- 5. Галерея ---------- */

  var galleryGrid = document.getElementById('gallery-grid');
  if (!galleryGrid) return;

  function ytEmbed(url) {
    var m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/i);
    return m ? 'https://www.youtube.com/embed/' + m[1] : null;
  }

  // Встраивание медиа в ячейку
  function embedMedia(cell, src) {
    var placeholder = cell.querySelector('.cell-placeholder');
    var form = cell.querySelector('.cell-form');
    if (placeholder) placeholder.style.display = 'none';
    if (form) form.classList.remove('open');

    // Убираем старое медиа
    var old = cell.querySelector('video, iframe');
    if (old) old.remove();
    var oldActions = cell.querySelector('.cell-actions');
    if (oldActions) oldActions.remove();

    var media;
    var yt = ytEmbed(src);
    if (yt) {
      media = document.createElement('iframe');
      media.src = yt;
      media.setAttribute('allowfullscreen', '');
      media.setAttribute('loading', 'lazy');
      media.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    } else {
      media = document.createElement('video');
      media.src = src;
      media.setAttribute('controls', '');
      media.setAttribute('preload', 'metadata');
    }
    cell.appendChild(media);

    var actions = document.createElement('div');
    actions.className = 'cell-actions';
    var rm = document.createElement('button');
    rm.textContent = '✕';
    rm.title = 'Убрать видео';
    rm.addEventListener('click', function (e) {
      e.stopPropagation();
      removeVideo(cell);
    });
    actions.appendChild(rm);
    cell.appendChild(actions);
  }

  function removeVideo(cell) {
    if (!adminUnlocked) return; // только администраторы
    var media = cell.querySelector('video, iframe');
    if (media) media.remove();
    var actions = cell.querySelector('.cell-actions');
    if (actions) actions.remove();
    var placeholder = cell.querySelector('.cell-placeholder');
    if (placeholder) placeholder.style.display = 'flex';
    saveCells();
  }

  // Сохранение текущего состояния всех ячеек на сервере
  function saveCells() {
    var store = {};
    document.querySelectorAll('.gallery-cell').forEach(function (cell, i) {
      var media = cell.querySelector('video, iframe');
      if (media && media.src) {
        store[i] = media.src;
      }
    });
    
    fetch('/api/gallery', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': ADMIN_PASS_HASH
      },
      body: JSON.stringify(store)
    }).catch(function(err) {
      console.error('Ошибка сохранения галереи:', err);
    });
  }

  // Восстановление с сервера
  function restoreCells() {
    fetch('/api/gallery')
      .then(function(r) { return r.json(); })
      .then(function(store) {
        document.querySelectorAll('.gallery-cell').forEach(function (cell, i) {
          if (store[i]) embedMedia(cell, store[i]);
        });
      })
      .catch(function(err) {
        console.error('Ошибка загрузки галереи:', err);
      });
  }

  // Логика форм в ячейках
  document.addEventListener('click', function (e) {
    var placeholder = e.target.closest('.cell-placeholder');
    if (placeholder) {
      if (!adminUnlocked) return; // только администраторы
      var cell = placeholder.closest('.gallery-cell');
      var form = cell.querySelector('.cell-form');
      if (form) {
        form.classList.add('open');
        var input = form.querySelector('[data-cell-input]');
        if (input) input.focus();
      }
      return;
    }

    var addBtn = e.target.closest('[data-cell-add]');
    if (addBtn) {
      if (!adminUnlocked) return; // только администраторы
      var cell = addBtn.closest('.gallery-cell');
      var input = cell.querySelector('[data-cell-input]');
      var url = (input.value || '').trim();
      if (!url) return;
      embedMedia(cell, url);
      saveCells();
      input.value = '';
      return;
    }

    var cancelBtn = e.target.closest('[data-cell-cancel]');
    if (cancelBtn) {
      var cell = cancelBtn.closest('.gallery-cell');
      var form = cell.querySelector('.cell-form');
      if (form) form.classList.remove('open');
      return;
    }
  });

  restoreCells();
})();
