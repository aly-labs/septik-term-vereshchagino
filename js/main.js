/* =========================================================
   main.js — вся интерактивность сайта ТЕРМИТ Верещагино
   Данные о ценах берутся из data/catalog.json (отдельный файл).
   Заявки отправляются на серверный эндпоинт (/api/lead),
   который уже сам передаёт их в n8n. Секретов в браузере нет.
   ========================================================= */
(function () {
  'use strict';

  var CFG = window.SITE_CONFIG || {};
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- Тост ---------------- */
  var toastEl = $('#toast');
  var toastTimer = null;
  function toast(msg, isError) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (isError ? ' is-err' : '');
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 4200);
  }

  /* ---------------- Телефон: маска ---------------- */
  function digitsOf(v) { return (v || '').replace(/\D/g, ''); }
  function formatPhone(v) {
    var d = digitsOf(v);
    if (d.startsWith('8')) d = '7' + d.slice(1);
    if (!d.startsWith('7')) d = '7' + d;
    d = d.slice(0, 11);
    var out = '+7';
    if (d.length > 1) out += ' (' + d.slice(1, 4);
    if (d.length >= 5) out += ') ' + d.slice(4, 7);
    if (d.length >= 8) out += '-' + d.slice(7, 9);
    if (d.length >= 10) out += '-' + d.slice(9, 11);
    return out;
  }
  function validPhone(v) { return digitsOf(v).replace(/^7|^8/, '').length === 10 || digitsOf(v).length === 11; }

  document.addEventListener('input', function (e) {
    if (e.target && e.target.matches('input[type="tel"]')) {
      e.target.value = formatPhone(e.target.value);
      e.target.removeAttribute('aria-invalid');
    }
  });

  /* ---------------- Header + бургер ---------------- */
  var header = $('#header');
  var burger = $('#burger');
  var nav = $('#nav');
  function onScroll() { if (header) header.classList.toggle('is-scrolled', window.scrollY > 8); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (burger && nav) {
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      burger.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    $$('.nav__link', nav).forEach(function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('is-open');
        burger.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------------- Reveal при прокрутке (с запасом для фоновых вкладок) ---------------- */
  var reveals = $$('.reveal');
  function revealAll() {
    reveals.forEach(function (el) { el.classList.add('is-visible'); });
  }
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealAll();
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function (el) { io.observe(el); });
    // Страховка: если вкладка неактивна/скрыта — просто показываем всё.
    setTimeout(revealAll, 2500);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') revealAll();
    });
  }

  /* ---------------- Аккордеон FAQ ---------------- */
  $$('.acc__item').forEach(function (item) {
    var q = $('.acc__q', item);
    if (!q) return;
    q.addEventListener('click', function () {
      var open = item.classList.toggle('is-open');
      q.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  /* ---------------- Год + гео-список + мессенджеры ---------------- */
  var yearEl = $('#year'); if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  if (CFG.serviceArea && $('#geoList')) {
    $('#geoList').innerHTML = CFG.serviceArea.map(function (c) { return '<li>' + c + '</li>'; }).join('');
  }
  if (CFG.phoneDisplay) {
    $$('[data-phone]').forEach(function (a) {
      a.textContent = a.classList.contains('mobilebar__btn') ? 'Позвонить' : CFG.phoneDisplay;
    });
  }
  var wa = $('#waBtn'), tg = $('#tgBtn');
  function messengerHref(v, kind) {
    if (!v) return '';
    if (/^https?:\/\//.test(v)) return v;
    var d = digitsOf(v);
    if (kind === 'whatsapp') return 'https://wa.me/' + d;
    return 'https://t.me/' + v.replace(/^@/, '');
  }
  if (wa && CFG.whatsapp) { wa.href = messengerHref(CFG.whatsapp, 'whatsapp'); wa.hidden = false; }
  if (tg && CFG.telegram) { tg.href = messengerHref(CFG.telegram, 'telegram'); tg.hidden = false; }
  var emailEl = $('#footerEmail');
  if (emailEl && CFG.email) { emailEl.textContent = CFG.email; emailEl.href = 'mailto:' + CFG.email; }

  /* =========================================================
     КАТАЛОГ (данные из data/catalog.json)
     ========================================================= */
  var CATALOG = null;
  var grid = $('#catalogGrid');
  var noneEl = $('#catalogNone');
  var metaEl = $('#catalogMeta');
  var state = { purpose: 'all', users: 'all', type: 'all' };
  var USER_BUCKETS = { '1-2': [1, 2], '3-4': [3, 4], '5-6': [5, 6], '6+': [7, 99] };
  var nf = new Intl.NumberFormat('ru-RU');

  function money(v) { return nf.format(v) + ' ' + (CATALOG.currency || '₽'); }

  function cardHTML(item) {
    var price = item.price
      ? '<b>' + money(item.price) + '</b><span>цена на оборудование</span>'
      : '<b class="reco__price--ask">Уточнить стоимость</b><span>по запросу</span>';
    var badge = item.priceConfirmed
      ? '<span class="card__badge">' + item.line + '</span>'
      : '<span class="card__badge card__badge--ask">Цена по запросу</span>';
    return '' +
      '<article class="card" id="card-' + item.slug + '" data-slug="' + item.slug + '">' +
        '<div class="card__media">' + badge +
          '<img src="' + item.image + '" alt="' + item.name + '" loading="lazy" width="240" height="180">' +
        '</div>' +
        '<div class="card__body">' +
          '<h3 class="card__title">' + item.name + '</h3>' +
          '<ul class="card__specs">' +
            '<li><span>Пользователей</span><b>' + item.usersText + '</b></li>' +
            '<li><span>Размеры</span><b>' + (item.dims || 'по техпаспорту') + '</b></li>' +
            '<li><span>Тип</span><b>' + (CATALOG.types[item.type] ? CATALOG.types[item.type].short : '') + '</b></li>' +
          '</ul>' +
          '<p class="card__desc">' + item.desc + '</p>' +
          '<div class="card__price">' + price + '</div>' +
          '<button class="btn btn--primary btn--block" type="button" data-lead="model" data-model="' + item.name + '">Узнать стоимость с монтажом</button>' +
        '</div>' +
      '</article>';
  }

  function matches(item) {
    if (state.type !== 'all' && item.type !== state.type) return false;
    if (state.purpose !== 'all' && item.purposes.indexOf(state.purpose) === -1) return false;
    if (state.users !== 'all') {
      var b = USER_BUCKETS[state.users];
      if (!(item.users[0] <= b[1] && item.users[1] >= b[0])) return false;
    }
    return true;
  }

  function renderCatalog() {
    if (!CATALOG) return;
    var items = CATALOG.items.filter(matches);
    grid.innerHTML = items.map(cardHTML).join('');
    if (noneEl) noneEl.hidden = items.length > 0;
    var reset = $('#filtersReset');
    if (reset) reset.hidden = (state.purpose === 'all' && state.users === 'all' && state.type === 'all');
    if (metaEl) metaEl.textContent = 'Показано моделей: ' + items.length + '. ' + (CATALOG.note || '');
  }

  // Фильтры
  $$('.chips').forEach(function (group) {
    var key = group.getAttribute('data-filter');
    group.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      state[key] = chip.getAttribute('data-value');
      $$('.chip', group).forEach(function (c) { c.classList.toggle('is-active', c === chip); });
      renderCatalog();
    });
  });
  var resetBtn = $('#filtersReset');
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      state = { purpose: 'all', users: 'all', type: 'all' };
      $$('.chips').forEach(function (group) {
        $$('.chip', group).forEach(function (c) { c.classList.toggle('is-active', c.getAttribute('data-value') === 'all'); });
      });
      renderCatalog();
    });
  }

  // Кнопки категорий (Блок 2): применить фильтр и прокрутить к каталогу
  $$('[data-purpose]').forEach(function (b) {
    b.addEventListener('click', function () {
      setChip('purpose', b.getAttribute('data-purpose'));
      state.users = 'all'; state.type = 'all';
      $$('.chips').forEach(function (g) {
        var k = g.getAttribute('data-filter');
        $$('.chip', g).forEach(function (c) { c.classList.toggle('is-active', (k === 'purpose' ? c.getAttribute('data-value') === state.purpose : c.getAttribute('data-value') === 'all')); });
      });
      renderCatalog();
      var target = $('#catalog');
      if (target) target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  });
  $$('[data-type]').forEach(function (b) {
    b.addEventListener('click', function () {
      state = { purpose: 'all', users: 'all', type: b.getAttribute('data-type') };
      $$('.chips').forEach(function (g) {
        var k = g.getAttribute('data-filter');
        $$('.chip', g).forEach(function (c) { c.classList.toggle('is-active', c.getAttribute('data-value') === (k === 'type' ? state.type : 'all')); });
      });
      renderCatalog();
      var target = $('#catalog');
      if (target) target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  });
  function setChip(key, value) {
    var group = $('.chips[data-filter="' + key + '"]');
    if (!group) return;
    $$('.chip', group).forEach(function (c) { c.classList.toggle('is-active', c.getAttribute('data-value') === value); });
    state[key] = value;
  }

  // Загрузка каталога
  function loadCatalog() {
    if (!grid) return;
    fetch('data/catalog.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        CATALOG = data;
        renderCatalog();
        handleCatalogDeepLink();
      })
      .catch(function (err) {
        console.error('Не удалось загрузить каталог:', err);
        grid.innerHTML = '';
        if (noneEl) {
          noneEl.hidden = false;
          noneEl.innerHTML = 'Каталог загрузится при открытии сайта через локальный сервер ' +
            '(<b>python server.py</b> → <b>http://localhost:8000</b>). ' +
            '<button class="linklike" type="button" data-lead="selection">Оставьте заявку</button> — подберём модель вручную.';
        }
        if (metaEl) metaEl.textContent = '';
      });
  }

  // ЧПУ: /catalog/<slug> — прокрутить к нужной модели
  function handleCatalogDeepLink() {
    var m = location.pathname.match(/\/catalog\/([^\/]+)\/?$/);
    if (!m || !CATALOG) return;
    var slug = decodeURIComponent(m[1]);
    var item = CATALOG.items.filter(function (i) { return i.slug === slug; })[0];
    if (!item) return;
    state = { purpose: 'all', users: 'all', type: 'all' };
    $$('.chips').forEach(function (g) {
      var k = g.getAttribute('data-filter');
      $$('.chip', g).forEach(function (c) { c.classList.toggle('is-active', (k === 'type' ? c.getAttribute('data-value') === item.type : c.getAttribute('data-value') === 'all')); });
    });
    state.type = item.type;
    renderCatalog();
    var el = document.getElementById('card-' + slug);
    if (el) {
      el.style.boxShadow = '0 0 0 3px ' + 'var(--lime)';
      el.scrollIntoView({ behavior: 'auto', block: 'center' });
    }
  }

  loadCatalog();

  /* =========================================================
     КАЛЬКУЛЯТОР (6 шагов)
     ========================================================= */
  var calcForm = $('#calcForm');
  var calcBar = $('#calcBar');
  var calcLabel = $('#calcStepLabel');
  var calcBack = $('#calcBack');
  var calcNext = $('#calcNext');
  var calcSubmit = $('#calcSubmit');
  var calcSummary = $('#calcSummary');
  var calcStep = 1;
  var CALC_TOTAL = 6;

  var LABELS = {
    q1: { dacha: 'Дача', house: 'Частный дом', permanent: 'Постоянное проживание', other: 'Другой объект' },
    q2: { '1-2': '1–2 человека', '3-4': '3–4 человека', '5-6': '5–6 человек', '6+': 'Более 6 человек' },
    q3: { unknown: 'Пока не знаю, нужна консультация', storage: 'Накопительная ёмкость', septic: 'Септик с доочисткой', station: 'Станция биологической очистки' },
    q4: { sand: 'Песок', clay: 'Глина', water: 'Высокий уровень грунтовых вод', unknown: 'Не знаю' },
    q5: { equip: 'Только оборудование', delivery: 'Оборудование и доставка', montage: 'Оборудование, доставка и монтаж', turnkey: 'Полный расчёт под ключ' }
  };

  function answers() {
    var a = {};
    ['q1', 'q2', 'q3', 'q4', 'q5'].forEach(function (n) {
      var el = calcForm.querySelector('input[name="' + n + '"]:checked');
      a[n] = el ? el.value : null;
    });
    return a;
  }

  function showStep(n) {
    calcStep = n;
    $$('.calc__step', calcForm).forEach(function (s) {
      s.classList.toggle('is-active', Number(s.getAttribute('data-step')) === n);
    });
    if (calcBar) calcBar.style.width = Math.round((n / CALC_TOTAL) * 100) + '%';
    if (calcLabel) calcLabel.textContent = 'Шаг ' + n + ' из ' + CALC_TOTAL;
    if (calcBack) calcBack.hidden = n === 1;
    if (calcNext) calcNext.hidden = n >= 6;
    if (calcSubmit) calcSubmit.hidden = n < 6;
    if (n === 6) buildSummary();
    var top = $('#calc');
    if (top && n > 1) top.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  function showCalcErr(step, on) {
    var el = calcForm.querySelector('.calc__err[data-err="' + step + '"]');
    if (el) el.hidden = !on;
  }

  if (calcNext) {
    calcNext.addEventListener('click', function () {
      var a = answers();
      var key = 'q' + calcStep;
      if (!a[key]) { showCalcErr(calcStep, true); return; }
      showCalcErr(calcStep, false);
      if (calcStep < 6) showStep(calcStep + 1);
    });
  }
  if (calcBack) {
    calcBack.addEventListener('click', function () { if (calcStep > 1) showStep(calcStep - 1); });
  }
  // Снимаем ошибку при выборе варианта
  if (calcForm) {
    calcForm.addEventListener('change', function (e) {
      if (e.target.name && e.target.name.indexOf('q') === 0) {
        showCalcErr(Number(e.target.name.slice(1)), false);
      }
    });
  }

  function recommend(a) {
    if (!CATALOG) return [];
    var type = (a.q3 === 'storage' || a.q3 === 'station') ? a.q3 : 'septic';
    var bucket = USER_BUCKETS[a.q2] || [1, 99];
    return CATALOG.items.filter(function (i) {
      if (i.type !== type) return false;
      return i.users[0] <= bucket[1] && i.users[1] >= bucket[0];
    }).slice(0, 3);
  }

  function buildSummary() {
    if (!calcSummary) return;
    var a = answers();
    var params = ['q1', 'q2', 'q3', 'q4', 'q5'].map(function (k) {
      var val = a[k] && LABELS[k][a[k]] ? LABELS[k][a[k]] : '—';
      var name = { q1: 'Объект', q2: 'Пользователи', q3: 'Тип системы', q4: 'Условия участка', q5: 'Состав расчёта' }[k];
      return '<li><b>' + name + ':</b> ' + val + '</li>';
    }).join('');

    var reco = recommend(a);
    var recoHTML = reco.length ? reco.map(function (i) {
      var price = i.price
        ? '<span class="reco__price">' + money(i.price) + '</span>'
        : '<span class="reco__price reco__price--ask">Уточнить стоимость</span>';
      return '<div class="reco"><span class="reco__name">' + i.name + '</span>' + price + '</div>';
    }).join('') : '<div class="reco"><span class="reco__name">Подберём модель после короткой консультации</span></div>';

    var todo = ['Стоимость доставки по вашему адресу'];
    if (a.q5 === 'montage' || a.q5 === 'turnkey') {
      todo.push('Земляные работы и подготовка котлована');
      todo.push('Монтаж, подключение и обратная засыпка');
      todo.push('Отвод очищенной воды с учётом грунта');
    } else if (a.q5 === 'delivery') {
      todo.push('Разгрузка и занос оборудования на участок');
    }
    todo.push('Актуальные цены на оборудование и комплектацию');

    calcSummary.innerHTML =
      '<p class="sum__title">Ваши параметры</p>' +
      '<ul class="sum__params">' + params + '</ul>' +
      '<p class="sum__title">Подходящее оборудование (цены — на оборудование)</p>' +
      '<div class="sum__reco">' + recoHTML + '</div>' +
      '<div class="sum__todo">Итоговую сумму считаем индивидуально. Уточним при расчёте:' +
        '<ul>' + todo.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' +
      '</div>';
  }

  /* =========================================================
     ОТПРАВКА ЗАЯВОК
     ========================================================= */
  function sendLead(payload) {
    return fetch(CFG.leadEndpoint || '/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(data.error || 'Сервер вернул ошибку ' + r.status);
        return data;
      });
    });
  }

  var OFFLINE_MSG = 'Не удалось отправить заявку. Позвоните нам' +
    (CFG.phoneDisplay ? ' по телефону ' + CFG.phoneDisplay : '') +
    ' — мы обязательно поможем.';

  if (calcForm) {
    calcForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var a = answers();
      var fd = new FormData(calcForm);
      var name = String(fd.get('name') || '').trim();
      var phone = String(fd.get('phone') || '').trim();
      var ok = true;
      if (!name) { ok = false; calcForm.querySelector('input[name="name"]').setAttribute('aria-invalid', 'true'); }
      if (!validPhone(phone)) { ok = false; calcForm.querySelector('input[name="phone"]').setAttribute('aria-invalid', 'true'); }
      if (!fd.get('consent')) ok = false;
      if (!ok) { showCalcErr(6, true); toast('Проверьте имя, телефон и согласие', true); return; }

      var reco = recommend(a).map(function (i) { return i.name; }).join(', ');
      var payload = {
        type: 'calculator',
        name: name, phone: phone,
        city: String(fd.get('city') || '').trim(),
        comment: String(fd.get('comment') || '').trim(),
        model: reco,
        answers: {
          'Объект': LABELS.q1[a.q1], 'Пользователи': LABELS.q2[a.q2],
          'Тип системы': LABELS.q3[a.q3], 'Условия участка': LABELS.q4[a.q4],
          'Состав расчёта': LABELS.q5[a.q5]
        },
        page: location.href
      };

      calcSubmit.disabled = true;
      calcSubmit.textContent = 'Отправляем…';
      sendLead(payload).then(function () {
        calcForm.reset();
        calcSummary.innerHTML = '<p class="form__ok">Заявка отправлена. Мы свяжемся с вами и уточним расчёт.</p>';
        $$('.calc__step', calcForm).forEach(function (s) { if (Number(s.getAttribute('data-step')) !== 6) s.classList.remove('is-active'); });
        showCalcErr(6, false);
        calcSubmit.hidden = true; calcBack.hidden = true;
        toast('Заявка отправлена. Спасибо!');
      }).catch(function (err) {
        console.error(err);
        toast(OFFLINE_MSG, true);
        calcSubmit.disabled = false;
        calcSubmit.textContent = 'Получить расчёт';
      });
    });
  }

  /* =========================================================
     МОДАЛЬНАЯ ФОРМА (звонок, подбор, монтаж, консультация)
     ========================================================= */
  var modal = $('#leadModal');
  var leadForm = $('#leadForm');
  var leadErr = $('#leadErr');
  var leadOk = $('#leadOk');
  var leadSubmit = $('#leadSubmit');
  var leadTitle = $('#leadModalTitle');
  var leadSub = $('#leadModalSub');
  var leadPreset = $('#leadPreset');
  var lastFocus = null;

  var MODAL_TITLES = {
    callback: ['Заказать звонок', 'Оставьте контакты — перезвоним и ответим на вопросы.'],
    selection: ['Подбор септика', 'Расскажите об объекте — подберём подходящие модели ТЕРМИТ.'],
    montage: ['Расчёт монтажа', 'Уточним условия участка и рассчитаем монтаж.'],
    consult: ['Получить консультацию', 'Поможем выбрать оборудование и рассчитать доставку и монтаж.'],
    delivery: ['Расчёт доставки', 'Укажите населённый пункт — рассчитаем доставку по адресу.'],
    model: ['Узнать стоимость с монтажом', 'Уточним условия участка и рассчитаем стоимость оборудования с монтажом.']
  };

  function openModal(type, model) {
    if (!modal) return;
    var t = MODAL_TITLES[type] || MODAL_TITLES.callback;
    if (leadTitle) leadTitle.textContent = model ? ('Стоимость: ' + model) : t[0];
    if (leadSub) leadSub.textContent = t[1];
    if (leadPreset) {
      if (model) { leadPreset.textContent = 'Интересует: ' + model; leadPreset.hidden = false; }
      else { leadPreset.hidden = true; leadPreset.textContent = ''; }
    }
    leadForm.setAttribute('data-type', type);
    leadForm.setAttribute('data-model', model || '');
    if (leadErr) leadErr.hidden = true;
    if (leadOk) leadOk.hidden = true;
    if (leadSubmit) { leadSubmit.disabled = false; leadSubmit.textContent = 'Отправить заявку'; }
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    var f = $('input[name="name"]', leadForm);
    if (f) setTimeout(function () { f.focus(); }, 60);
  }
  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-lead]');
    if (!el) return;
    e.preventDefault();
    var type = el.getAttribute('data-lead');
    var model = el.getAttribute('data-model') || '';
    if (type === 'model') model = el.getAttribute('data-model') || model;
    openModal(type, model);
  });
  $$('[data-close]', modal || document).forEach(function (el) { el.addEventListener('click', closeModal); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal && !modal.hidden) closeModal(); });

  if (leadForm) {
    leadForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(leadForm);
      var name = String(fd.get('name') || '').trim();
      var phone = String(fd.get('phone') || '').trim();
      var ok = true;
      if (!name) { ok = false; leadForm.querySelector('input[name="name"]').setAttribute('aria-invalid', 'true'); }
      if (!validPhone(phone)) { ok = false; leadForm.querySelector('input[name="phone"]').setAttribute('aria-invalid', 'true'); }
      if (!fd.get('consent')) ok = false;
      if (!ok) {
        if (leadErr) { leadErr.textContent = 'Укажите имя, корректный телефон и отметьте согласие.'; leadErr.hidden = false; }
        return;
      }
      if (leadErr) leadErr.hidden = true;

      var payload = {
        type: leadForm.getAttribute('data-type') || 'callback',
        model: leadForm.getAttribute('data-model') || '',
        name: name, phone: phone,
        city: String(fd.get('city') || '').trim(),
        comment: String(fd.get('comment') || '').trim(),
        page: location.href
      };

      leadSubmit.disabled = true;
      leadSubmit.textContent = 'Отправляем…';
      sendLead(payload).then(function () {
        leadForm.reset();
        if (leadOk) leadOk.hidden = false;
        leadSubmit.textContent = 'Отправлено';
        toast('Заявка отправлена. Спасибо!');
        setTimeout(closeModal, 1600);
      }).catch(function (err) {
        console.error(err);
        if (leadErr) { leadErr.textContent = OFFLINE_MSG; leadErr.hidden = false; }
        toast(OFFLINE_MSG, true);
        leadSubmit.disabled = false;
        leadSubmit.textContent = 'Отправить заявку';
      });
    });
  }
})();
