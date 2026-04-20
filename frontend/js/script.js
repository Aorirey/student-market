// --- JAVASCRIPT ЛОГИКА ---

// API: на Render и при запуске Express на том же origin — тот же хост/протокол; при Live Server (другой порт) — бэкенд :3000
const __host = window.location.hostname;
const __isLocal = __host === 'localhost' || __host === '127.0.0.1';
const __devSplit = __isLocal && window.location.port && window.location.port !== '3000';
const API_URL = __devSplit
    ? `${window.location.protocol}//${__host}:3000/api`
    : `${window.location.origin}/api`;

// Текущий пользователь (хранится в sessionStorage)
let currentUser = null;
function getRegistrationConsents() {
    const offer = document.getElementById('register-consent-offer');
    const privacy = document.getElementById('register-consent-privacy');
    const pdn = document.getElementById('register-consent-pdn');
    return {
        offerAccepted: Boolean(offer && offer.checked),
        privacyAccepted: Boolean(privacy && privacy.checked),
        personalDataAccepted: Boolean(pdn && pdn.checked)
    };
}

function hasAllRegistrationConsents(consents) {
    return Boolean(consents.offerAccepted && consents.privacyAccepted && consents.personalDataAccepted);
}

/** Закрытие по клику на фон только если pointerdown был на фоне (не при выделении текста с отпусканием за пределами формы). */
let authModalCloseFromBackdrop = false;

function isStaffUser(u = currentUser) {
    return Boolean(u && (u.isAdmin || u.isModerator));
}

function authToken() {
    if (!currentUser) return '';
    return currentUser.token || currentUser.accessToken || '';
}

/** JSON + Bearer для защищённых POST/PATCH (логин/регистрация не используют). */
function authJsonHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const t = authToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    return headers;
}

/** Bearer для GET/DELETE/PATCH без тела. */
function authBearerHeaders(extra = {}) {
    const headers = { ...extra };
    const t = authToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    return headers;
}

// ============================================
// БЕЗОПАСНОСТЬ: XSS защита (A08)
// ============================================

// Экранирование HTML для защиты от XSS
function escapeHTML(str) {
    if (!str) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;'
    };
    return String(str).replace(/[&<>"'/]/g, char => map[char]);
}

// Безопасная вставка текста (защита от XSS)
function setSafeText(element, text) {
    const el = typeof element === 'string' ? document.getElementById(element) : element;
    if (el) {
        el.textContent = text;
    }
}

// Валидация email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Валидация числовых значений
function isValidNumber(value, min = 1, max = 1000000) {
    const num = typeof value === 'string' ? parseInt(value, 10) : value;
    return !isNaN(num) && num >= min && num <= max;
}

// ==================== УТИЛИТЫ ====================

// Форматирование даты в московском времени
function formatMoscowTime(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        hour12: false,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Форматирование короткой даты в московском времени
function formatMoscowDate(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('ru-RU', {
        timeZone: 'Europe/Moscow'
    });
}

// Закрыть все кастомные выпадающие списки (кроме optional — исключить из закрытия)
function closeAllUiCustomSelects(exceptWrapper) {
    document.querySelectorAll('.ui-custom-select.open').forEach((w) => {
        if (exceptWrapper && w === exceptWrapper) return;
        w.classList.remove('open');
        const tr = w.querySelector('.ui-custom-select__trigger');
        if (tr) tr.setAttribute('aria-expanded', 'false');
    });
}

function bindUiCustomSelectOutsideCloseOnce() {
    if (window.__uiCustomSelectOutsideBound) return;
    window.__uiCustomSelectOutsideBound = true;
    document.addEventListener('click', (event) => {
        if (!event.target.closest('.ui-custom-select')) {
            closeAllUiCustomSelects(null);
        }
        if (!event.target.closest('.ui-combobox')) {
            closeAllFilterComboboxes(null);
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeAllUiCustomSelects(null);
            closeAllFilterComboboxes(null);
        }
    });
}

/**
 * Кастомный выпадающий список: нативный <select> остаётся для значения и совместимости с кодом.
 * @param {HTMLSelectElement} nativeSelect
 * @param {{ compact?: boolean }} options — compact: узкий триггер для панели фильтров категорий
 */
function initCustomSelect(nativeSelect, options = {}) {
    if (!nativeSelect || nativeSelect.tagName !== 'SELECT' || nativeSelect.dataset.uiCustom === '1') return;

    nativeSelect.dataset.uiCustom = '1';
    nativeSelect.classList.add('ui-custom-select__native');

    const compact = Boolean(options.compact);
    const parent = nativeSelect.parentNode;
    if (!parent) return;

    const wrapper = document.createElement('div');
    wrapper.className = compact ? 'ui-custom-select ui-custom-select--compact' : 'ui-custom-select';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ui-custom-select__trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const ariaLabel = nativeSelect.getAttribute('aria-label') || (nativeSelect.id ? document.querySelector(`label[for="${nativeSelect.id}"]`)?.textContent?.trim() : '') || 'Выбор';
    trigger.setAttribute('aria-label', ariaLabel);

    const valSpan = document.createElement('span');
    valSpan.className = 'ui-custom-select__value';
    const chev = document.createElement('span');
    chev.className = 'ui-custom-select__chevron';
    chev.setAttribute('aria-hidden', 'true');
    chev.textContent = '▾';
    trigger.appendChild(valSpan);
    trigger.appendChild(chev);

    const menu = document.createElement('div');
    menu.className = 'ui-custom-select__menu';
    menu.setAttribute('role', 'listbox');
    if (nativeSelect.id) {
        menu.id = `${nativeSelect.id}-listbox`;
        trigger.setAttribute('aria-controls', menu.id);
    }
    if (!compact) {
        menu.style.maxHeight = 'min(360px, 55vh)';
    }

    function syncTriggerText() {
        const idx = nativeSelect.selectedIndex;
        const opt = idx >= 0 ? nativeSelect.options[idx] : null;
        valSpan.textContent = opt ? opt.textContent : '';
    }

    function updateOptionHighlight() {
        const v = nativeSelect.value;
        menu.querySelectorAll('.ui-custom-select__option').forEach((btn) => {
            btn.classList.toggle('is-selected', btn.dataset.value === v);
        });
    }

    function appendOptionButton(optionEl) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ui-custom-select__option';
        btn.setAttribute('role', 'option');
        btn.dataset.value = optionEl.value;
        btn.textContent = optionEl.textContent;
        if (optionEl.value === nativeSelect.value) btn.classList.add('is-selected');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            nativeSelect.value = optionEl.value;
            nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
            closeAllUiCustomSelects(null);
            syncTriggerText();
            updateOptionHighlight();
        });
        menu.appendChild(btn);
    }

    function rebuildMenu() {
        menu.innerHTML = '';
        Array.from(nativeSelect.children).forEach((node) => {
            if (node.tagName === 'OPTGROUP') {
                const gl = document.createElement('div');
                gl.className = 'ui-custom-select__group-label';
                gl.textContent = node.label || '';
                menu.appendChild(gl);
                node.querySelectorAll('option').forEach((opt) => appendOptionButton(opt));
            } else if (node.tagName === 'OPTION') {
                appendOptionButton(node);
            }
        });
        syncTriggerText();
        updateOptionHighlight();
    }

    parent.insertBefore(wrapper, nativeSelect);
    wrapper.appendChild(nativeSelect);
    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);

    nativeSelect.addEventListener('change', () => {
        syncTriggerText();
        updateOptionHighlight();
    });

    const mo = new MutationObserver(() => {
        rebuildMenu();
    });
    mo.observe(nativeSelect, { childList: true, subtree: false });

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        bindUiCustomSelectOutsideCloseOnce();
        closeAllFilterComboboxes(null);
        const opening = !wrapper.classList.contains('open');
        closeAllUiCustomSelects(opening ? wrapper : null);
        if (opening) {
            wrapper.classList.add('open');
            trigger.setAttribute('aria-expanded', 'true');
        } else {
            wrapper.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
        }
    });

    rebuildMenu();
}

function isCatalogFilterSelect(sel) {
    return Boolean(
        sel &&
        sel.matches &&
        sel.matches(
            'select[data-filter-university], select[data-filter-teacher], select[data-filter="practices"], select[data-filter="labs"], select[data-filter="courses"]'
        )
    );
}

/** Поисковый combobox: фильтры каталога + университет и дисциплина в форме «Добавить товар» */
function isSearchableComboboxSelect(sel) {
    return (
        isCatalogFilterSelect(sel) ||
        Boolean(sel && (sel.id === 'product-university' || sel.id === 'product-discipline'))
    );
}

function initAllPageCustomSelects() {
    bindUiCustomSelectOutsideCloseOnce();

    document.querySelectorAll('select').forEach((sel) => {
        if (sel.classList.contains('ui-custom-select__native')) return;
        if (sel.dataset.uiCustom === '1') return;
        if (isSearchableComboboxSelect(sel)) return;
        const compact = Boolean(sel.closest('.filter-section'));
        initCustomSelect(sel, { compact });
    });
}

// ==================== ПОИСКОВЫЕ COMBOBOX ДЛЯ ФИЛЬТРОВ КАТАЛОГА ====================

function closeAllFilterComboboxes(exceptWrapper) {
    document.querySelectorAll('.ui-combobox.open').forEach((w) => {
        if (exceptWrapper && w === exceptWrapper) return;
        w.classList.remove('open');
        const inp = w.querySelector('.ui-combobox__input');
        if (inp) inp.setAttribute('aria-expanded', 'false');
    });
}

function initFilterCombobox(nativeSelect) {
    if (!nativeSelect || nativeSelect.tagName !== 'SELECT' || nativeSelect.dataset.filterCombobox === '1') return;
    if (!isSearchableComboboxSelect(nativeSelect)) return;
    if (nativeSelect.id === 'product-discipline') return;

    const clearedValue = nativeSelect.id === 'product-university' ? '' : 'all';

    nativeSelect.dataset.filterCombobox = '1';
    nativeSelect.classList.add('ui-custom-select__native');

    const parent = nativeSelect.parentNode;
    if (!parent) return;

    const wrap = document.createElement('div');
    wrap.className =
        nativeSelect.id === 'product-university' ? 'ui-combobox ui-combobox--form-field' : 'ui-combobox ui-combobox--compact';

    const control = document.createElement('div');
    control.className = 'ui-combobox__control';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ui-combobox__input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.id = `${nativeSelect.id}-cb`;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    const idForCss = nativeSelect.id
        ? typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
            ? CSS.escape(nativeSelect.id)
            : nativeSelect.id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        : '';
    const ariaLabel =
        nativeSelect.getAttribute('aria-label') ||
        (nativeSelect.id ? document.querySelector(`label[for="${idForCss}"]`)?.textContent?.trim() : '') ||
        'Выбор';
    input.setAttribute('aria-label', ariaLabel);

    const listId = `${nativeSelect.id}-listbox`;
    const menu = document.createElement('ul');
    menu.className = 'ui-combobox__menu';
    menu.id = listId;
    menu.setAttribute('role', 'listbox');
    input.setAttribute('aria-controls', listId);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'ui-combobox__clear';
    clearBtn.setAttribute('aria-label', nativeSelect.id === 'product-university' ? 'Сбросить выбор' : 'Сбросить фильтр');
    clearBtn.textContent = '×';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'ui-combobox__toggle';
    toggleBtn.setAttribute('aria-label', 'Открыть список');
    toggleBtn.setAttribute('tabindex', '-1');
    const chev = document.createElement('span');
    chev.className = 'ui-combobox__chevron';
    chev.setAttribute('aria-hidden', 'true');
    chev.textContent = '▾';
    toggleBtn.appendChild(chev);

    const label = nativeSelect.id ? document.querySelector(`label[for="${idForCss}"]`) : null;
    if (label) label.setAttribute('for', input.id);

    let menuShowsAll = true;
    let closeTimer = null;

    function getOptions() {
        return Array.from(nativeSelect.options).map((o) => ({ value: o.value, label: o.textContent.trim() }));
    }

    function selectedLabel() {
        const opt = nativeSelect.options[nativeSelect.selectedIndex];
        return opt ? opt.textContent.trim() : '';
    }

    function syncClearVisibility() {
        clearBtn.style.display = nativeSelect.value === clearedValue ? 'none' : '';
    }

    function syncInputFromSelect() {
        input.value = selectedLabel();
        syncClearVisibility();
    }

    function filteredOptions(query) {
        const q = (query || '').trim().toLowerCase();
        const all = getOptions();
        if (!q) return all;
        return all.filter((o) => o.label.toLowerCase().includes(q));
    }

    function renderMenu() {
        menu.innerHTML = '';
        const opts = menuShowsAll ? getOptions() : filteredOptions(input.value);
        if (opts.length === 0) {
            const li = document.createElement('li');
            li.className = 'ui-combobox__empty';
            li.setAttribute('role', 'presentation');
            li.textContent = 'Ничего не найдено';
            menu.appendChild(li);
            return;
        }
        opts.forEach((o) => {
            const li = document.createElement('li');
            li.className = 'ui-combobox__option';
            li.setAttribute('role', 'option');
            li.dataset.value = o.value;
            li.textContent = o.label;
            if (o.value === nativeSelect.value) li.classList.add('is-selected');
            li.addEventListener('mousedown', (e) => {
                e.preventDefault();
                nativeSelect.value = o.value;
                nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                menuShowsAll = true;
                syncInputFromSelect();
                closeMenu();
            });
            menu.appendChild(li);
        });
    }

    function openMenu() {
        bindUiCustomSelectOutsideCloseOnce();
        closeAllUiCustomSelects(null);
        closeAllFilterComboboxes(wrap);
        wrap.classList.add('open');
        input.setAttribute('aria-expanded', 'true');
        input.value = '';
        menuShowsAll = false;
        renderMenu();
    }

    function closeMenu() {
        wrap.classList.remove('open');
        input.setAttribute('aria-expanded', 'false');
        menuShowsAll = true;
        syncInputFromSelect();
    }

    function scheduleClose() {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
            if (!wrap.contains(document.activeElement)) {
                closeMenu();
            }
        }, 0);
    }

    nativeSelect.addEventListener('change', () => {
        syncInputFromSelect();
        if (wrap.classList.contains('open')) renderMenu();
    });

    const mo = new MutationObserver(() => {
        syncInputFromSelect();
        if (wrap.classList.contains('open')) renderMenu();
    });
    mo.observe(nativeSelect, { childList: true, subtree: false });

    input.addEventListener('focus', () => {
        menuShowsAll = true;
        openMenu();
    });

    input.addEventListener('click', () => {
        if (!wrap.classList.contains('open')) openMenu();
    });

    input.addEventListener('input', () => {
        menuShowsAll = false;
        if (!wrap.classList.contains('open')) wrap.classList.add('open');
        input.setAttribute('aria-expanded', 'true');
        renderMenu();
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeMenu();
            input.blur();
        }
    });

    input.addEventListener('blur', scheduleClose);

    toggleBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
    });
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (wrap.classList.contains('open')) {
            closeMenu();
        } else {
            input.focus();
            openMenu();
        }
    });

    clearBtn.addEventListener('mousedown', (e) => e.preventDefault());
    clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        nativeSelect.value = clearedValue;
        nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        menuShowsAll = true;
        syncInputFromSelect();
        if (wrap.classList.contains('open')) renderMenu();
    });

    parent.insertBefore(wrap, nativeSelect);
    control.appendChild(input);
    control.appendChild(clearBtn);
    control.appendChild(toggleBtn);
    wrap.appendChild(control);
    wrap.appendChild(menu);
    wrap.appendChild(nativeSelect);

    nativeSelect._filterComboboxSync = syncInputFromSelect;
    nativeSelect._filterComboboxOpen = openMenu;
    nativeSelect._filterComboboxClose = closeMenu;

    syncInputFromSelect();
}

const PRODUCT_DISCIPLINE_MAX_LEN = 100;

/**
 * Дисциплина в форме товара: поиск по подсказкам + произвольный текст (сохраняется в value и уходит в API).
 */
function initProductDisciplineCombobox(nativeSelect) {
    if (!nativeSelect || nativeSelect.tagName !== 'SELECT' || nativeSelect.dataset.filterCombobox === '1') return;
    if (nativeSelect.id !== 'product-discipline') return;

    nativeSelect.dataset.filterCombobox = '1';
    nativeSelect.classList.add('ui-custom-select__native');

    const clearedValue = '';
    const parent = nativeSelect.parentNode;
    if (!parent) return;

    const wrap = document.createElement('div');
    wrap.className = 'ui-combobox ui-combobox--form-field';

    const control = document.createElement('div');
    control.className = 'ui-combobox__control';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ui-combobox__input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.id = `${nativeSelect.id}-cb`;
    input.placeholder = 'Введите дисциплину или выберите из списка';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    const idForCss =
        nativeSelect.id && typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
            ? CSS.escape(nativeSelect.id)
            : nativeSelect.id;
    const ariaLabel =
        nativeSelect.getAttribute('aria-label') ||
        (nativeSelect.id ? document.querySelector(`label[for="${idForCss}"]`)?.textContent?.trim() : '') ||
        'Дисциплина';
    input.setAttribute('aria-label', ariaLabel);

    const listId = `${nativeSelect.id}-listbox`;
    const menu = document.createElement('ul');
    menu.className = 'ui-combobox__menu';
    menu.id = listId;
    menu.setAttribute('role', 'listbox');
    input.setAttribute('aria-controls', listId);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'ui-combobox__clear';
    clearBtn.setAttribute('aria-label', 'Очистить');
    clearBtn.textContent = '×';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'ui-combobox__toggle';
    toggleBtn.setAttribute('aria-label', 'Открыть список');
    toggleBtn.setAttribute('tabindex', '-1');
    const chev = document.createElement('span');
    chev.className = 'ui-combobox__chevron';
    chev.setAttribute('aria-hidden', 'true');
    chev.textContent = '▾';
    toggleBtn.appendChild(chev);

    const label = nativeSelect.id ? document.querySelector(`label[for="${idForCss}"]`) : null;
    if (label) label.setAttribute('for', input.id);

    let menuShowsAll = true;
    let closeTimer = null;

    function getPresetOptions() {
        return Array.from(nativeSelect.options)
            .filter((o) => o.value.trim() !== '')
            .map((o) => ({ value: o.value, label: o.textContent.trim() }));
    }

    function selectedLabel() {
        const opt = nativeSelect.options[nativeSelect.selectedIndex];
        return opt && opt.value.trim() !== '' ? opt.textContent.trim() : '';
    }

    function syncClearVisibility() {
        clearBtn.style.display = nativeSelect.value === clearedValue ? 'none' : '';
    }

    function syncInputFromSelect() {
        input.value = selectedLabel();
        syncClearVisibility();
    }

    function ensureOptionForValue(text) {
        const t = text.trim().slice(0, PRODUCT_DISCIPLINE_MAX_LEN);
        if (!t) return;
        const exists = Array.from(nativeSelect.options).some(
            (o) => o.value === t || o.textContent.trim().toLowerCase() === t.toLowerCase()
        );
        if (!exists) {
            const op = document.createElement('option');
            op.value = t;
            op.textContent = t;
            nativeSelect.appendChild(op);
        }
    }

    /**
     * @param {boolean} forceFreetext — true: Enter / «Использовать» — сохранить введённый текст как дисциплину,
     *   даже если есть несколько частичных совпадений. false: blur — не создавать кастом при неоднозначном вводе.
     */
    function commitDisciplineInput(forceFreetext) {
        const raw = input.value.trim().slice(0, PRODUCT_DISCIPLINE_MAX_LEN);
        if (!raw) {
            nativeSelect.value = clearedValue;
            nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
            syncInputFromSelect();
            return;
        }
        const opts = Array.from(nativeSelect.options).filter((o) => o.value.trim() !== '');
        const match = opts.find(
            (o) => o.value === raw || o.textContent.trim().toLowerCase() === raw.toLowerCase()
        );
        if (match) {
            nativeSelect.value = match.value;
            nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
            syncInputFromSelect();
            return;
        }
        const presets = getPresetOptions();
        const needle = raw.toLowerCase();
        const substr = presets.filter((o) => o.label.toLowerCase().includes(needle));
        if (substr.length === 1) {
            nativeSelect.value = substr[0].value;
            nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
            syncInputFromSelect();
            return;
        }
        if (substr.length === 0 || forceFreetext) {
            ensureOptionForValue(raw);
            nativeSelect.value = raw;
            nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
            syncInputFromSelect();
            return;
        }
        syncInputFromSelect();
    }

    function filteredOptions(query) {
        const q = (query || '').trim().toLowerCase();
        const all = getPresetOptions();
        if (!q) return all;
        return all.filter((o) => o.label.toLowerCase().includes(q));
    }

    function renderMenu() {
        menu.innerHTML = '';
        const q = input.value.trim();
        const opts = menuShowsAll && !q ? getPresetOptions() : filteredOptions(input.value);

        if (opts.length === 0 && q) {
            const li = document.createElement('li');
            li.className = 'ui-combobox__option ui-combobox__option--custom';
            li.setAttribute('role', 'option');
            const short = q.length > 70 ? `${q.slice(0, 70)}…` : q;
            li.textContent = `Использовать «${short}»`;
            li.addEventListener('mousedown', (e) => {
                e.preventDefault();
                commitDisciplineInput(true);
                menuShowsAll = true;
                closeMenu();
            });
            menu.appendChild(li);
            return;
        }

        if (opts.length === 0) {
            const li = document.createElement('li');
            li.className = 'ui-combobox__empty';
            li.setAttribute('role', 'presentation');
            li.textContent = 'Начните ввод или выберите из списка';
            menu.appendChild(li);
            return;
        }

        opts.forEach((o) => {
            const li = document.createElement('li');
            li.className = 'ui-combobox__option';
            li.setAttribute('role', 'option');
            li.dataset.value = o.value;
            li.textContent = o.label;
            if (o.value === nativeSelect.value) li.classList.add('is-selected');
            li.addEventListener('mousedown', (e) => {
                e.preventDefault();
                nativeSelect.value = o.value;
                nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                menuShowsAll = true;
                syncInputFromSelect();
                closeMenu();
            });
            menu.appendChild(li);
        });
    }

    function openMenu() {
        bindUiCustomSelectOutsideCloseOnce();
        closeAllUiCustomSelects(null);
        closeAllFilterComboboxes(wrap);
        wrap.classList.add('open');
        input.setAttribute('aria-expanded', 'true');
        menuShowsAll = !input.value.trim();
        renderMenu();
    }

    function closeMenu() {
        wrap.classList.remove('open');
        input.setAttribute('aria-expanded', 'false');
        menuShowsAll = true;
        syncInputFromSelect();
    }

    function scheduleClose() {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
            if (!wrap.contains(document.activeElement)) {
                commitDisciplineInput(false);
                closeMenu();
            }
        }, 0);
    }

    nativeSelect.addEventListener('change', () => {
        syncInputFromSelect();
        if (wrap.classList.contains('open')) renderMenu();
    });

    const mo = new MutationObserver(() => {
        syncInputFromSelect();
        if (wrap.classList.contains('open')) renderMenu();
    });
    mo.observe(nativeSelect, { childList: true, subtree: false });

    input.addEventListener('focus', () => {
        openMenu();
    });

    input.addEventListener('click', () => {
        if (!wrap.classList.contains('open')) openMenu();
    });

    input.addEventListener('input', () => {
        menuShowsAll = false;
        if (!wrap.classList.contains('open')) wrap.classList.add('open');
        input.setAttribute('aria-expanded', 'true');
        renderMenu();
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            syncInputFromSelect();
            closeMenu();
            input.blur();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            commitDisciplineInput(true);
            closeMenu();
            input.blur();
        }
    });

    input.addEventListener('blur', scheduleClose);

    toggleBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
    });
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (wrap.classList.contains('open')) {
            commitDisciplineInput(false);
            closeMenu();
        } else {
            input.focus();
            openMenu();
        }
    });

    clearBtn.addEventListener('mousedown', (e) => e.preventDefault());
    clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        nativeSelect.value = clearedValue;
        nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        menuShowsAll = true;
        syncInputFromSelect();
        if (wrap.classList.contains('open')) renderMenu();
    });

    parent.insertBefore(wrap, nativeSelect);
    control.appendChild(input);
    control.appendChild(clearBtn);
    control.appendChild(toggleBtn);
    wrap.appendChild(control);
    wrap.appendChild(menu);
    wrap.appendChild(nativeSelect);

    nativeSelect._filterComboboxSync = syncInputFromSelect;
    nativeSelect._filterComboboxOpen = openMenu;
    nativeSelect._filterComboboxClose = closeMenu;
    nativeSelect._commitProductDisciplineInput = (force) => commitDisciplineInput(force);

    syncInputFromSelect();
}

function syncFilterComboboxFromSelect(sel) {
    if (sel && typeof sel._filterComboboxSync === 'function') sel._filterComboboxSync();
}

function initAllFilterComboboxes() {
    document
        .querySelectorAll(
            'select[data-filter-university], select[data-filter-teacher], select[data-filter="practices"], select[data-filter="labs"], select[data-filter="courses"], select#product-university'
        )
        .forEach(initFilterCombobox);
    const disciplineSel = document.getElementById('product-discipline');
    if (disciplineSel) initProductDisciplineCombobox(disciplineSel);
}

// Проверка авторизации
async function checkAuth() {
    const authButtons = document.getElementById('auth-buttons');
    const userMenu = document.getElementById('user-menu');
    const btnAdmin = document.getElementById('btn-admin');
    const userName = document.getElementById('user-name');

    if (currentUser) {
        authButtons.style.display = 'none';
        userMenu.style.display = 'flex';
        if (userName) userName.textContent = currentUser.name;
        const balanceEl = document.getElementById('user-balance');
        if (balanceEl) balanceEl.textContent = currentUser.balance != null ? currentUser.balance : 0;

        const btnMod = document.getElementById('btn-moderator');
        if (currentUser.isAdmin) {
            btnAdmin.style.display = 'block';
            if (btnMod) btnMod.style.display = 'none';
        } else if (currentUser.isModerator) {
            btnAdmin.style.display = 'none';
            if (btnMod) btnMod.style.display = 'block';
        } else {
            btnAdmin.style.display = 'none';
            if (btnMod) btnMod.style.display = 'none';
        }

        // Показываем аватар если есть
        if (currentUser.photoUrl) {
            if (userName) {
                userName.innerHTML = `<img src="${currentUser.photoUrl}" style="width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-right:8px;">${currentUser.name}`;
            }
        }

        // Загружаем уведомления
        loadNotifications();

        const blockedHint = document.getElementById('cabinet-selling-blocked-hint');
        const submitProdBtn = document.getElementById('btn-submit-product');
        const productTypeSel = document.getElementById('product-type');
        if (currentUser.isBlocked) {
            if (blockedHint) blockedHint.style.display = 'block';
            if (submitProdBtn && productTypeSel && !productTypeSel.dataset.blockSyncAttached) {
                productTypeSel.dataset.blockSyncAttached = '1';
                const syncSubmitState = () => {
                    submitProdBtn.disabled = productTypeSel.value === 'product';
                };
                productTypeSel.addEventListener('change', syncSubmitState);
                syncSubmitState();
            }
        } else {
            if (blockedHint) blockedHint.style.display = 'none';
            if (submitProdBtn) submitProdBtn.disabled = false;
        }

        // Автообновление уведомлений каждые 30 секунд
        if (notificationInterval) clearInterval(notificationInterval);
        notificationInterval = setInterval(loadNotifications, 30000); // 30 секунд вместо 5
    } else {
        authButtons.style.display = 'flex';
        userMenu.style.display = 'none';
        btnAdmin.style.display = 'none';
        if (notificationInterval) {
            clearInterval(notificationInterval);
            notificationInterval = null;
        }
    }
}

// Регистрация
async function register() {
    const name = document.getElementById('register-name').value.trim();
    const loginValue = document.getElementById('register-login').value.trim();
    const password = document.getElementById('register-password').value;
    const consents = getRegistrationConsents();
    const errorEl = document.getElementById('register-error-message');

    // Сбрасываем ошибку
    if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }

    if (!name || !loginValue || !password) {
        showAuthError(errorEl, 'Заполните все поля!');
        return;
    }

    // Проверка логина
    const loginRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!loginRegex.test(loginValue)) {
        showAuthError(errorEl, 'Логин: только латинские буквы, цифры и _ (3-20 символов)');
        return;
    }

    // Проверка пароля
    if (password.length < 6) {
        showAuthError(errorEl, 'Пароль должен быть не менее 6 символов');
        return;
    }

    if (!hasAllRegistrationConsents(consents)) {
        showAuthError(errorEl, 'Для регистрации необходимо принять оферту, соглашение и дать согласие на обработку ПДн');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, login: loginValue, password, consents })
        });

        const data = await response.json();

        if (!response.ok) {
            showAuthError(errorEl, data.error || 'Ошибка регистрации');
            return;
        }

        // Сохраняем сессию
        clearChatStateForSessionChange();
        currentUser = data;
        sessionStorage.setItem('currentUser', JSON.stringify(data));

        // Очистка формы
        document.getElementById('register-name').value = '';
        document.getElementById('register-login').value = '';
        document.getElementById('register-password').value = '';
        if (errorEl) { errorEl.style.display = 'none'; }

        closeModal();
        checkAuth();
        showToast('Успешно', 'Добро пожаловать, ' + data.name + '!', 'success');
    } catch (error) {
        showAuthError(errorEl, 'Ошибка подключения к серверу');
        console.error('[REGISTER] Ошибка:', error);
    }
}

// Вход
async function login() {
    const loginValue = document.getElementById('login-login').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error-message');

    // Сбрасываем ошибку
    if (errorEl) {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
    }

    if (!loginValue || !password) {
        showAuthError(errorEl, 'Заполните все поля!');
        return;
    }

    console.log('[LOGIN] Попытка входа:', loginValue, 'API_URL:', API_URL);

    try {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: loginValue, password })
        });

        console.log('[LOGIN] Ответ сервера:', response.status);

        const data = await response.json();
        console.log('[LOGIN] Данные ответа:', data);

        if (!response.ok) {
            showAuthError(errorEl, data.error || 'Неверный логин или пароль');
            return;
        }

        clearChatStateForSessionChange();
        currentUser = data;
        sessionStorage.setItem('currentUser', JSON.stringify(data));

        // Очистка формы
        document.getElementById('login-login').value = '';
        document.getElementById('login-password').value = '';
        if (errorEl) { errorEl.style.display = 'none'; }

        closeModal();
        checkAuth();
        showToast('Успешно', 'Добро пожаловать, ' + data.name + '!', 'success');
    } catch (error) {
        showAuthError(errorEl, 'Ошибка подключения к серверу');
        console.error('[LOGIN] Ошибка:', error);
    }
}

// Показать ошибку в модалке авторизации
function showAuthError(errorEl, message) {
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    }
}

// Авторизация через ВКонтакте
async function loginWithVK() {
    try {
        // Получаем конфиг VK
        const configRes = await fetch(`${API_URL}/config/vk`);
        const config = await configRes.json();

        if (!config.clientId) {
            showToast('Ошибка', 'VK авторизация не настроена', 'error');
            return;
        }

        const redirectUri = config.redirectUri || `${window.location.origin}/auth/vk/callback`;
        const authUrl = `https://oauth.vk.com/authorize?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=email`;

        // Открываем VK OAuth в новом окне
        const authWindow = window.open(authUrl, 'vk_auth', 'width=600,height=500');

        // Слушаем сообщение от окна
        const handler = async (event) => {
            if (event.data && event.data.type === 'vk_auth_code') {
                window.removeEventListener('message', handler);
                authWindow.close();

                const code = event.data.code;
                const response = await fetch(`${API_URL}/auth/vk`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code })
                });

                const data = await response.json();
                if (!response.ok) {
                    showToast('Ошибка', data.error || 'Ошибка входа через VK', 'error');
                    return;
                }

                clearChatStateForSessionChange();
                currentUser = data;
                sessionStorage.setItem('currentUser', JSON.stringify(data));
                closeModal();
                checkAuth();
                showToast('Успешно', `Добро пожаловать, ${data.name}!`, 'success');
            }
        };

        window.addEventListener('message', handler);
    } catch (error) {
        showToast('Ошибка', 'Ошибка подключения к VK', 'error');
        console.error('[VK] Ошибка:', error);
    }
}

// Выход
function logout() {
    clearChatStateForSessionChange();
    currentUser = null;
    sessionStorage.removeItem('currentUser');
    checkAuth();
    openTab('practices');
    showToast('Информация', 'Вы вышли из аккаунта!', 'info');
}

// ==================== МОДАЛЬНОЕ ОКНО ====================

function openModal(type) {
    const modal = document.getElementById('auth-modal');
    modal.classList.add('active');
}

function closeModal() {
    authModalCloseFromBackdrop = false;
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.remove('active');
}

// ==================== УВЕДОМЛЕНИЯ ====================

// Универсальная функция показа toast-уведомлений
function showToast(title, message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type]}</span>
        <div class="toast-content">
            <div class="toast-title">${escapeHTML(title)}</div>
            <div class="toast-message">${escapeHTML(message)}</div>
        </div>
        <button class="toast-close" data-action="close-toast">×</button>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function showSuccessNotification(balance) {
    showToast('Спасибо за покупку!', `Ваш баланс: ${balance} ₽`, 'success', 4000);
}

function showErrorNotification(missingAmount) {
    showToast('Недостаточно средств', `Вам не хватает: ${missingAmount} ₽`, 'error', 5000);
}

function showAdminNotification(title, message) {
    showToast('Админ-панель', message, 'info', 3000);
}

// ==================== ВКЛАДКИ ====================

// Переключение типа формы (товар/запрос)
function toggleProductType() {
    const type = document.getElementById('product-type').value;
    const productFields = document.getElementById('product-fields');
    const customFields = document.getElementById('custom-fields');
    const btnSubmit = document.getElementById('btn-submit-product');

    if (type === 'custom') {
        productFields.style.display = 'none';
        customFields.style.display = 'flex';
        btnSubmit.textContent = 'Создать запрос';
    } else {
        productFields.style.display = 'flex';
        customFields.style.display = 'none';
        btnSubmit.textContent = 'Добавить товар';
    }
}

function openTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.admin-tab').forEach(btn => {
        btn.classList.remove('active');
    });

    document.getElementById(tabName).classList.add('active');

    const tabButtons = document.querySelectorAll('.tab-btn');
    if (tabName === 'practices') tabButtons[0].classList.add('active');
    if (tabName === 'labs') tabButtons[1].classList.add('active');
    if (tabName === 'courses') tabButtons[2].classList.add('active');
    if (tabName === 'custom') {
        tabButtons[3].classList.add('active');
        renderCustomRequests('all');
        return;
    }

    const select = document.getElementById(`select-${tabName}`);
    if (select) {
        select.value = 'all';
    }

    const uni = document.getElementById(`select-university-${tabName}`);
    if (uni) uni.value = 'all';

    const teacher = document.getElementById(`select-teacher-${tabName}`);
    if (teacher) teacher.value = 'all';

    const search = document.getElementById(`search-${tabName}`);
    if (search) search.value = '';

    if (select) {
        syncFilterComboboxFromSelect(select);
        syncFilterComboboxFromSelect(uni);
        syncFilterComboboxFromSelect(teacher);
        renderProducts(tabName, 'all', 'all', 'all', '');
    }
}

function openCabinet() {
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.admin-tab').forEach(btn => {
        btn.classList.remove('active');
    });

    document.getElementById('cabinet').classList.add('active');
    loadCabinetData();
}

function openAdminPanel() {
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.cabinet-tab').forEach(btn => {
        btn.classList.remove('active');
    });

    document.querySelectorAll('.admin-section').forEach(section => {
        section.classList.remove('active');
    });
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.classList.remove('active');
    });

    const adminPanel = document.getElementById('admin-panel');
    const titleEl = document.getElementById('admin-panel-title');
    const isModNotAdmin = currentUser && currentUser.isModerator && !currentUser.isAdmin;
    adminPanel.classList.remove('admin-panel--moderator');
    if (titleEl) {
        titleEl.textContent = isModNotAdmin ? '🛡️ Панель модератора' : '🛡️ Панель администратора';
    }

    const modSection = document.getElementById('admin-moderation');
    const modTab = document.querySelector('[data-admin-tab="moderation"]');
    if (modSection) modSection.classList.add('active');
    if (modTab) modTab.classList.add('active');

    stopAdminChatMessagesPoll(true);
    const admMsg = document.getElementById('admin-chats-messages');
    if (admMsg) admMsg.innerHTML = '';
    const admHead = document.getElementById('admin-chats-thread-head');
    if (admHead) admHead.textContent = '';
    adminPanel.classList.add('active');
    loadAdminData();
}

function switchCabinetTab(type) {
    document.querySelectorAll('.cabinet-section').forEach(section => {
        section.classList.remove('active');
    });
    document.querySelectorAll('.cabinet-tab').forEach(tab => {
        tab.classList.remove('active');
    });

    document.getElementById(`cabinet-${type}`).classList.add('active');
    
    // Находим кнопку и добавляем active
    const buttons = document.querySelectorAll('.cabinet-tab');
    buttons.forEach(btn => {
        if (btn.textContent.toLowerCase().includes(type.toLowerCase()) || 
            (type === 'buyer' && btn.textContent.includes('Покупатель')) ||
            (type === 'sales' && btn.textContent.includes('продажи')) ||
            (type === 'products' && btn.textContent.includes('товары')) ||
            (type === 'chats' && btn.textContent.includes('Чаты')) ||
            (type === 'add' && btn.textContent.includes('Добавить'))) {
            btn.classList.add('active');
        }
    });

    if (type === 'sales') {
        loadSalesData();
    } else if (type === 'products') {
        loadProductsData();
    } else if (type === 'chats') {
        loadChatsList();
    } else if (type === 'add') {
        // Ничего не загружаем, просто показываем форму
    } else {
        loadCabinetData();
    }
}

function switchAdminTab(type) {
    document.querySelectorAll('.admin-section').forEach(section => {
        section.classList.remove('active');
    });
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.classList.remove('active');
    });

    document.getElementById(`admin-${type}`).classList.add('active');

    document.querySelectorAll('.admin-tab').forEach(btn => {
        if (btn.dataset.adminTab === type) {
            btn.classList.add('active');
        }
    });

    stopAdminChatMessagesPoll(type !== 'chats');
    if (type === 'chats') {
        loadAdminChatConversations();
    } else if (type === 'support') {
        loadAdminSupportStaffUI();
    } else {
        loadAdminData();
    }
}

// ==================== ТОВАРЫ ====================

// Отрисовка товаров
// Обновление списка университетов и преподавателей в фильтрах
function updateUniversityFilters() {
    const categories = ['practices', 'labs', 'courses'];
    categories.forEach(category => {
        // Обновляем университеты
        const uniSelect = document.getElementById(`select-university-${category}`);
        if (uniSelect) {
            const currentUniValue = uniSelect.value;
            uniSelect.innerHTML = '<option value="all">Все университеты</option>';
            const uniqueUniversities = new Set();
            document.querySelectorAll(`[data-category="${category}"]`).forEach(card => {
                const infoElements = card.querySelectorAll('.card-info');
                infoElements.forEach(el => {
                    if (el.textContent && !el.textContent.includes('Преподаватель') && !el.textContent.includes('Срок')) {
                        uniqueUniversities.add(el.textContent.trim());
                    }
                });
            });
            uniqueUniversities.forEach(uni => {
                const option = document.createElement('option');
                option.value = uni;
                option.textContent = uni;
                uniSelect.appendChild(option);
            });
            if (currentUniValue && [...uniSelect.options].some(opt => opt.value === currentUniValue)) {
                uniSelect.value = currentUniValue;
            }
        }

        // Обновляем преподавателей
        const teacherSelect = document.getElementById(`select-teacher-${category}`);
        if (teacherSelect) {
            const currentTeacherValue = teacherSelect.value;
            teacherSelect.innerHTML = '<option value="all">Все преподаватели</option>';
            const uniqueTeachers = new Set();
            document.querySelectorAll(`[data-category="${category}"]`).forEach(card => {
                const infoElements = card.querySelectorAll('.card-info');
                infoElements.forEach(el => {
                    if (el.textContent && el.textContent.includes('Преподаватель:')) {
                        const teacherName = el.textContent.replace('Преподаватель:', '').trim();
                        if (teacherName) {
                            uniqueTeachers.add(teacherName);
                        }
                    }
                });
            });
            uniqueTeachers.forEach(teacher => {
                const option = document.createElement('option');
                option.value = teacher;
                option.textContent = teacher;
                teacherSelect.appendChild(option);
            });
            if (currentTeacherValue && [...teacherSelect.options].some(opt => opt.value === currentTeacherValue)) {
                teacherSelect.value = currentTeacherValue;
            }
        }
    });
}

async function renderProducts(category, filterDiscipline, filterUniversity, filterTeacher, searchText) {
    const grid = document.getElementById(`grid-${category}`);
    if (!grid) return;

    grid.innerHTML = '';

    try {
        const response = await fetch(`${API_URL}/products`);
        const data = await response.json();

        // Поддержка обоих форматов ответа: { products: [...], pagination: {...} } и [...]
        const products = Array.isArray(data) ? data : (data.products || []);

        const items = products.filter(p => p.category === category);

        if (items.length === 0) {
            grid.innerHTML = '<p style="color: var(--text-secondary);">Нет товаров в этой категории</p>';
            return;
        }

        items.forEach(item => {
            // Фильтр по дисциплине
            if (filterDiscipline && filterDiscipline !== 'all' && item.discipline !== filterDiscipline) {
                return;
            }

            // Фильтр по университету
            if (filterUniversity && filterUniversity !== 'all' && item.university !== filterUniversity) {
                return;
            }

            // Фильтр по преподавателю
            const teacherVal = item.teacher || item.teacherName || '';
            if (filterTeacher && filterTeacher !== 'all' && filterTeacher.trim() &&
                teacherVal.toLowerCase() !== filterTeacher.toLowerCase()) {
                return;
            }

            // Поиск по названию, дисциплине, университету, преподавателю
            if (searchText && searchText.trim()) {
                const query = searchText.toLowerCase().trim();
                const haystack = `${item.title} ${item.discipline} ${item.university || ''} ${teacherVal}`.toLowerCase();
                if (!haystack.includes(query)) {
                    return;
                }
            }

            const card = document.createElement('div');
            card.className = 'product-card';
            card.setAttribute('data-category', item.category);

            // БЕЗОПАСНОСТЬ: Используем textContent для пользовательских данных
            const titleEl = document.createElement('h3');
            titleEl.className = 'card-title';
            titleEl.textContent = item.title;

            const sellerLink = document.createElement('a');
            sellerLink.href = '#';
            sellerLink.className = 'seller-link';
            sellerLink.textContent = item.sellerName;
            sellerLink.onclick = (e) => openSellerPage(item.sellerId, item.sellerName, e);

            const disciplineEl = document.createElement('p');
            disciplineEl.className = 'card-discipline';
            disciplineEl.innerHTML = 'Продавец: ';
            disciplineEl.appendChild(sellerLink);

            const tagEl = document.createElement('span');
            tagEl.className = 'card-tag';
            tagEl.textContent = item.discipline;

            const priceEl = document.createElement('span');
            priceEl.className = 'price';
            priceEl.textContent = `${item.price} ₽`;

            const buyBtn = document.createElement('button');
            buyBtn.className = 'buy-btn';

            // Проверяем, является ли текущий пользователь продавцом
            if (currentUser && item.sellerId === currentUser.id) {
                buyBtn.textContent = 'Ваш товар';
                buyBtn.disabled = true;
                buyBtn.style.cursor = 'default';
                buyBtn.style.opacity = '0.6';
            } else {
                buyBtn.textContent = 'Купить';
                buyBtn.onclick = () => buyProduct(item.id);
            }

            const footer = document.createElement('div');
            footer.className = 'card-footer';
            footer.appendChild(priceEl);
            footer.appendChild(buyBtn);

            const contentDiv = document.createElement('div');
            contentDiv.appendChild(tagEl);
            contentDiv.appendChild(titleEl);
            contentDiv.appendChild(disciplineEl);

            // Добавляем университет, преподавателя и срок, если они есть
            if (item.university) {
                const universityEl = document.createElement('p');
                universityEl.className = 'card-info';
                universityEl.textContent = item.university;
                contentDiv.appendChild(universityEl);
            }

            const displayTeacher = item.teacher || item.teacherName;
            if (displayTeacher) {
                const teacherEl = document.createElement('p');
                teacherEl.className = 'card-info';
                teacherEl.textContent = `Преподаватель: ${displayTeacher}`;
                contentDiv.appendChild(teacherEl);
            }

            if (item.deadline) {
                const deadlineDate = new Date(item.deadline);
                const deadlineStr = deadlineDate.toLocaleDateString('ru-RU');
                const deadlineEl = document.createElement('p');
                deadlineEl.className = 'card-info';
                deadlineEl.textContent = `Срок сдачи: ${deadlineStr}`;
                contentDiv.appendChild(deadlineEl);
            }

            card.appendChild(contentDiv);
            card.appendChild(footer);
            grid.appendChild(card);
        });

        // Обновляем фильтры по университетам после рендера
        updateUniversityFilters();
    } catch (error) {
        console.error('Ошибка загрузки товаров:', error);
        grid.innerHTML = '<p style="color: var(--text-secondary);">Ошибка загрузки товаров</p>';
    }
}

// Фильтрация
function filterProducts(category) {
    const discipline = document.getElementById(`select-${category}`)?.value || 'all';
    const university = document.getElementById(`select-university-${category}`)?.value || 'all';
    const teacher = document.getElementById(`select-teacher-${category}`)?.value || 'all';
    const search = document.getElementById(`search-${category}`)?.value || '';
    renderProducts(category, discipline, university, teacher, search);
}

// Фильтрация индивидуальных запросов
function filterCustomRequests() {
    const select = document.getElementById('select-custom');
    const value = select.value;
    renderCustomRequests(value);
}

// Отрисовка индивидуальных запросов
async function renderCustomRequests(filter) {
    const grid = document.getElementById('grid-custom');
    if (!grid) return;

    grid.innerHTML = '';

    try {
        const response = await fetch(`${API_URL}/custom-requests`);
        const requests = await response.json();

        let items = requests;
        if (filter === 'with_file') {
            items = requests.filter(r => r.fileName !== null);
        } else if (filter === 'without_file') {
            items = requests.filter(r => r.fileName === null);
        }

        if (items.length === 0) {
            grid.innerHTML = '<p style="color: var(--text-secondary);">Нет индивидуальных запросов</p>';
            return;
        }

        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'product-card';
            card.setAttribute('data-category', 'custom');

            const fileIcon = item.fileName ? '📎 ' : '';
            const hasFile = item.fileName ? '<span style="font-size: 0.8rem; color: var(--success);">• С файлом</span>' : '';

            // БЕЗОПАСНОСТЬ: Используем textContent
            const titleEl = document.createElement('h3');
            titleEl.className = 'card-title';
            titleEl.textContent = fileIcon + item.title;
            
            const descEl = document.createElement('p');
            descEl.className = 'card-discipline';
            descEl.textContent = item.description || 'Без описания';
            
            const requesterLink = document.createElement('a');
            requesterLink.href = '#';
            requesterLink.className = 'seller-link';
            requesterLink.textContent = item.requesterName;
            requesterLink.onclick = (e) => openSellerPage(item.requesterId, item.requesterName, e);
            
            const requesterEl = document.createElement('p');
            requesterEl.className = 'card-discipline';
            requesterEl.innerHTML = 'Заказчик: ';
            requesterEl.appendChild(requesterLink);
            
            const tagEl = document.createElement('span');
            tagEl.className = 'card-tag';
            tagEl.textContent = 'Индивидуальный заказ';
            
            const priceEl = document.createElement('span');
            priceEl.className = 'price';
            priceEl.textContent = `${item.budget} ₽`;
            
            const contactBtn = document.createElement('button');
            contactBtn.className = 'buy-btn';
            contactBtn.textContent = 'Откликнуться';
            contactBtn.onclick = () => contactRequester(item.requesterId, item.title);
            
            const footer = document.createElement('div');
            footer.className = 'card-footer';
            footer.appendChild(priceEl);
            footer.appendChild(contactBtn);
            
            const contentDiv = document.createElement('div');
            contentDiv.appendChild(tagEl);
            contentDiv.appendChild(titleEl);
            contentDiv.appendChild(descEl);
            contentDiv.appendChild(requesterEl);
            if (item.fileName) {
                const fileNote = document.createElement('span');
                fileNote.style.fontSize = '0.8rem';
                fileNote.style.color = 'var(--success)';
                fileNote.textContent = '• С файлом';
                contentDiv.appendChild(fileNote);
            }
            
            card.appendChild(contentDiv);
            card.appendChild(footer);
            grid.appendChild(card);
        });
    } catch (error) {
        console.error('Ошибка загрузки запросов:', error);
        grid.innerHTML = '<p style="color: var(--text-secondary);">Ошибка загрузки запросов</p>';
    }
}

// Отклик на индивидуальный запрос
function contactRequester(requesterId, requestTitle) {
    if (!currentUser) {
        openModal('login');
        return;
    }
    showToast('Информация', 'Функция отклика будет доступна в ближайшее время', 'info');
}

// Открытие страницы продавца
async function openSellerPage(sellerId, sellerName, event) {
    if (event) event.preventDefault();

    // Скрываем все вкладки
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Показываем страницу продавца
    document.getElementById('seller-page').classList.add('active');

    // БЕЗОПАСНОСТЬ: Используем textContent
    setSafeText('seller-page-name', sellerName);
    const joinedClear = document.getElementById('seller-page-joined');
    if (joinedClear) {
        joinedClear.textContent = '';
        joinedClear.hidden = true;
    }

    // Загружаем товары продавца
    try {
        const productsResponse = await fetch(`${API_URL}/products`);
        const productsData = await productsResponse.json();
        const products = Array.isArray(productsData) ? productsData : (productsData.products || []);
        const sellerProducts = products.filter(p => p.sellerId === sellerId && p.status === 'approved');

        const productsGrid = document.getElementById('seller-products-grid');
        productsGrid.innerHTML = '';

        if (sellerProducts.length === 0) {
            productsGrid.innerHTML = '<p style="color: var(--text-secondary);">У продавца нет товаров</p>';
        } else {
            sellerProducts.forEach(item => {
                const card = document.createElement('div');
                card.className = 'product-card';
                
                const titleEl = document.createElement('h3');
                titleEl.className = 'card-title';
                titleEl.textContent = item.title;
                
                const catEl = document.createElement('p');
                catEl.className = 'card-discipline';
                catEl.textContent = item.category;
                
                const tagEl = document.createElement('span');
                tagEl.className = 'card-tag';
                tagEl.textContent = item.discipline;
                
                const priceEl = document.createElement('span');
                priceEl.className = 'price';
                priceEl.textContent = `${item.price} ₽`;

                const buyBtn = document.createElement('button');
                buyBtn.className = 'buy-btn';
                
                // Проверяем, является ли текущий пользователь продавцом
                if (currentUser && item.sellerId === currentUser.id) {
                    buyBtn.textContent = 'Ваш товар';
                    buyBtn.disabled = true;
                    buyBtn.style.cursor = 'default';
                    buyBtn.style.opacity = '0.6';
                } else {
                    buyBtn.textContent = 'Купить';
                    buyBtn.onclick = () => buyProduct(item.id);
                }

                const footer = document.createElement('div');
                footer.className = 'card-footer';
                footer.appendChild(priceEl);
                footer.appendChild(buyBtn);
                
                const contentDiv = document.createElement('div');
                contentDiv.appendChild(tagEl);
                contentDiv.appendChild(titleEl);
                contentDiv.appendChild(catEl);
                
                card.appendChild(contentDiv);
                card.appendChild(footer);
                productsGrid.appendChild(card);
            });
        }

        // Загружаем отзывы о продавце
        const reviewsResponse = await fetch(`${API_URL}/users/${sellerId}/reviews`);
        const reviews = await reviewsResponse.json();

        const reviewsList = document.getElementById('seller-reviews-list');
        reviewsList.innerHTML = '';

        if (reviews.length === 0) {
            reviewsList.innerHTML = '<p style="color: var(--text-secondary);">Отзывов пока нет</p>';
        } else {
            reviews.forEach(review => {
                const reviewItem = document.createElement('div');
                reviewItem.className = 'review-item';
                
                const header = document.createElement('div');
                header.className = 'review-header';
                
                const stars = document.createElement('span');
                stars.className = 'review-stars';
                stars.textContent = '⭐'.repeat(review.rating);
                
                const date = document.createElement('span');
                date.className = 'review-date';
                date.textContent = formatMoscowDate(review.createdAt);
                
                header.appendChild(stars);
                header.appendChild(date);
                
                const comment = document.createElement('p');
                comment.className = 'review-comment';
                comment.textContent = review.comment || 'Без комментария';
                
                const buyer = document.createElement('p');
                buyer.className = 'review-buyer';
                buyer.textContent = `Покупатель: ${review.buyerName || 'Аноним'}`;
                
                reviewItem.appendChild(header);
                reviewItem.appendChild(comment);
                reviewItem.appendChild(buyer);
                reviewsList.appendChild(reviewItem);
            });
        }

        // Загружаем данные продавца (дата регистрации — из публичного профиля)
        const userOpts = currentUser ? { headers: authBearerHeaders() } : {};
        const userResponse = await fetch(`${API_URL}/users/${sellerId}`, userOpts);
        const user = userResponse.ok ? await userResponse.json() : {};

        // Количество продаж: свои — полный список; чужой профиль — только публичный счётчик (без id покупок)
        let soldCount = '—';
        if (currentUser && String(sellerId) === String(currentUser.id)) {
            const salesResponse = await fetch(`${API_URL}/users/${currentUser.id}/sales`, { headers: authBearerHeaders() });
            if (salesResponse.ok) {
                const s = await salesResponse.json();
                soldCount = Array.isArray(s) ? s.length : '—';
            }
        } else {
            const countRes = await fetch(`${API_URL}/users/${sellerId}/sales-count`);
            if (countRes.ok) {
                const j = await countRes.json();
                soldCount = typeof j.count === 'number' ? j.count : '—';
            }
        }

        // Вычисляем рейтинг из отзывов
        const avgRating = reviews.length > 0
            ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
            : '--';

        const ratingEl = document.getElementById('seller-page-rating');
        ratingEl.innerHTML = `Рейтинг: <strong>${escapeHTML(avgRating)} ⭐</strong> | Продано работ: <strong>${soldCount}</strong> | Товаров на сайте: <strong>${sellerProducts.length}</strong>`;

        const joinedEl = document.getElementById('seller-page-joined');
        if (joinedEl) {
            if (user && user.createdAt && !user.error) {
                joinedEl.textContent = `Зарегистрирован: ${formatMoscowDate(user.createdAt)}`;
                joinedEl.hidden = false;
            } else {
                joinedEl.textContent = '';
                joinedEl.hidden = true;
            }
        }

    } catch (error) {
        console.error('Ошибка загрузки страницы продавца:', error);
    }
}

// Возврат со страницы продавца
function backFromSeller() {
    document.getElementById('seller-page').classList.remove('active');
    openTab('practices');
}

// Добавление товара
document.getElementById('add-product-form')?.addEventListener('submit', async function(e) {
    e.preventDefault();

    if (!currentUser) {
        showToast('Ошибка', 'Сначала войдите в аккаунт!', 'error');
        return;
    }

    const type = document.getElementById('product-type').value;

    if (type === 'custom') {
        // Создание индивидуального запроса
        const title = document.getElementById('custom-title').value;
        const university = document.getElementById('custom-university').value;
        const teacher = document.getElementById('custom-teacher').value;
        const description = document.getElementById('custom-description').value;
        const budget = parseInt(document.getElementById('custom-budget').value);
        const deadline = document.getElementById('custom-deadline').value;
        const fileInput = document.getElementById('custom-file');

        if (!title || !budget) {
            showToast('Ошибка', 'Заполните название и бюджет!', 'error');
            return;
        }

        let fileName = null;
        let fileData = null;

        if (fileInput.files[0]) {
            const file = fileInput.files[0];
            const reader = new FileReader();

            reader.onload = async function(event) {
                fileName = file.name;
                fileData = event.target.result.split(',')[1];

                await submitCustomRequest(title, university, teacher, description, budget, deadline, fileName, fileData);
            };

            reader.readAsDataURL(file);
        } else {
            await submitCustomRequest(title, university, teacher, description, budget, deadline, null, null);
        }
    } else {
        // Создание готового товара
        const disciplineSelect = document.getElementById('product-discipline');
        if (disciplineSelect && typeof disciplineSelect._commitProductDisciplineInput === 'function') {
            disciplineSelect._commitProductDisciplineInput(true);
        }

        const title = document.getElementById('product-title').value.trim();
        const university = (document.getElementById('product-university').value || '').trim();
        const teacher = document.getElementById('product-teacher').value.trim();
        const category = document.getElementById('product-category').value;
        const discipline = (disciplineSelect && disciplineSelect.value ? disciplineSelect.value : '').trim();
        const priceRaw = document.getElementById('product-price').value;
        const price = parseInt(priceRaw, 10);
        const deadlineEl = document.getElementById('product-deadline');
        const deadlineDays = deadlineEl ? parseInt(deadlineEl.value, 10) : NaN;

        const missing = [];
        if (!title) missing.push('название работы');
        if (!university) missing.push('университет');
        if (!teacher) missing.push('ФИО преподавателя');
        if (!category) missing.push('категорию');
        if (!discipline) missing.push('дисциплину');
        if (!priceRaw.trim() || Number.isNaN(price) || price < 1) missing.push('цену (от 1 ₽)');
        if (!deadlineEl || !deadlineEl.value || Number.isNaN(deadlineDays) || deadlineDays < 1) {
            missing.push('срок сдачи');
        }

        if (missing.length) {
            showToast('Ошибка', `Заполните все поля: ${missing.join(', ')}.`, 'error');
            return;
        }

        // Вычисляем дату дедлайна
        const deadlineDate = new Date();
        deadlineDate.setDate(deadlineDate.getDate() + deadlineDays);
        const deadline = deadlineDate.toISOString();

        if (currentUser.isBlocked) {
            showToast('Ограничение', 'Вы не можете выставлять товары. Обратитесь в техподдержку.', 'error');
            return;
        }

        try {
            const response = await fetch(`${API_URL}/products`, {
                method: 'POST',
                headers: authJsonHeaders(),
                body: JSON.stringify({
                    title,
                    university,
                    teacher,
                    category,
                    discipline,
                    price,
                    sellerId: currentUser.id,
                    sellerName: currentUser.name,
                    deadline
                })
            });

            const data = await response.json();

            if (!response.ok) {
                showToast('Ошибка', data.error || 'Ошибка добавления товара', 'error');
                return;
            }

            document.getElementById('product-title').value = '';
            document.getElementById('product-price').value = '';
            const discEl = document.getElementById('product-discipline');
            if (discEl) {
                discEl.value = '';
                discEl.dispatchEvent(new Event('change', { bubbles: true }));
                syncFilterComboboxFromSelect(discEl);
            }

            showToast('Информация', 'Товар отправлен на модерацию! Администратор проверит его в ближайшее время.', 'info');
            loadProductsData();
        } catch (error) {
            showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
            console.error(error);
        }
    }
});

// Функция отправки индивидуального запроса
async function submitCustomRequest(title, university, teacher, description, budget, deadline, fileName, fileData) {
    try {
        const response = await fetch(`${API_URL}/custom-requests`, {
            method: 'POST',
            headers: authJsonHeaders(),
            body: JSON.stringify({
                title,
                university,
                teacher,
                description,
                budget,
                deadline,
                requesterId: currentUser.id,
                requesterName: currentUser.name,
                fileName,
                fileData
            })
        });

        const data = await response.json();

        if (!response.ok) {
            showToast('Ошибка', data.error || 'Ошибка создания запроса', 'error');
            return;
        }

        document.getElementById('custom-title').value = '';
        document.getElementById('custom-university').value = '';
        document.getElementById('custom-teacher').value = '';
        document.getElementById('custom-description').value = '';
        document.getElementById('custom-budget').value = '';
        document.getElementById('custom-deadline').value = '';
        document.getElementById('custom-file').value = '';

        showToast('Информация', 'Запрос отправлен на модерацию! Администратор проверит его в ближайшее время.', 'info');
    } catch (error) {
        showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
        console.error(error);
    }
}

// Удаление товара
async function deleteProduct(productId) {
    if (!confirm('Удалить этот товар?')) return;

    try {
        const response = await fetch(`${API_URL}/products/${productId}`, {
            method: 'DELETE',
            headers: authBearerHeaders()
        });

        if (!response.ok) {
            showToast('Ошибка', 'Ошибка удаления товара', 'error');
            return;
        }

        showToast('Успешно', 'Товар удалён', 'success');
        loadCabinetData();
        renderProducts('practices', 'all', 'all', 'all', '');
        renderProducts('labs', 'all', 'all', 'all', '');
        renderProducts('courses', 'all', 'all', 'all', '');
    } catch (error) {
        showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
        console.error(error);
    }
}

// Покупка товара (открывает модальное окно подтверждения)
async function buyProduct(productId) {
    if (!currentUser) {
        openModal('login');
        return;
    }

    try {
        // Получаем информацию о товаре
        const productsResponse = await fetch(`${API_URL}/products`);
        const products = await productsResponse.json();
        const product = products.find(p => p.id === productId);

        if (!product) {
            showToast('Ошибка', 'Товар не найден', 'error');
            return;
        }

        // Получаем актуальные данные пользователя
        const userResponse = await fetch(`${API_URL}/users/${currentUser.id}`, { headers: authBearerHeaders() });
        const user = await userResponse.json();

        if (user.balance < product.price) {
            const missingAmount = product.price - user.balance;
            showErrorNotification(missingAmount);
            return;
        }

        // Открываем модальное окно подтверждения
        openPurchaseConfirmModal(product, user);
    } catch (error) {
        showToast('Ошибка', 'Ошибка покупки', 'error');
        console.error(error);
    }
}

// Открыть модальное окно подтверждения покупки
function openPurchaseConfirmModal(product, user) {
    const modal = document.getElementById('confirm-purchase-modal');
    if (!modal) {
        showToast('Ошибка', 'Модальное окно подтверждения не найдено', 'error');
        return;
    }
    
    document.getElementById('confirm-product-title').textContent = product.title;
    document.getElementById('confirm-product-price').textContent = product.price;
    document.getElementById('confirm-user-balance').textContent = user.balance;
    document.getElementById('confirm-balance-after').textContent = user.balance - product.price;
    
    // Сохраняем данные для последующего подтверждения
    modal.dataset.productId = product.id;
    modal.dataset.productTitle = product.title;
    modal.dataset.productPrice = product.price;
    modal.dataset.sellerId = product.sellerId;
    modal.dataset.userBalance = user.balance;
    modal.dataset.deadline = product.deadline || '';
    
    modal.classList.add('active');
}

// Закрыть модальное окно подтверждения покупки
function closePurchaseConfirmModal() {
    const modal = document.getElementById('confirm-purchase-modal');
    if (modal) {
        modal.classList.remove('active');
        delete modal.dataset.productId;
        delete modal.dataset.productTitle;
        delete modal.dataset.productPrice;
        delete modal.dataset.sellerId;
        delete modal.dataset.userBalance;
    }
}

// Подтверждение покупки
async function confirmPurchase() {
    const modal = document.getElementById('confirm-purchase-modal');
    if (!modal || !modal.dataset.productId) {
        showToast('Ошибка', 'Данные покупки не найдены', 'error');
        return;
    }

    const productId = parseInt(modal.dataset.productId);
    const productTitle = modal.dataset.productTitle;
    const productPrice = parseInt(modal.dataset.productPrice);
    const sellerId = modal.dataset.sellerId;
    const userBalance = parseInt(modal.dataset.userBalance);
    const deadline = modal.dataset.deadline;

    try {
        // Создаём покупку (списание с баланса только на сервере)
        const purchaseResponse = await fetch(`${API_URL}/purchases`, {
            method: 'POST',
            headers: authJsonHeaders(),
            body: JSON.stringify({
                productId: productId,
                title: productTitle,
                price: productPrice,
                buyerId: currentUser.id,
                sellerId: sellerId,
                deadline
            })
        });

        const purchase = await purchaseResponse.json();
        if (!purchaseResponse.ok) {
            showToast('Ошибка', purchase.error || 'Не удалось совершить покупку', 'error');
            return;
        }

        const newBalance = purchase.buyerBalance != null ? purchase.buyerBalance : userBalance - productPrice;
        currentUser = { ...currentUser, balance: newBalance };
        sessionStorage.setItem('currentUser', JSON.stringify(currentUser));

        // Создаём чат для покупки
        await fetch(`${API_URL}/chat`, {
            method: 'POST',
            headers: authJsonHeaders(),
            body: JSON.stringify({
                purchaseId: purchase.id,
                senderId: sellerId,
                receiverId: currentUser.id,
                message: `Чат по заказу: ${productTitle}. Покупатель: ${currentUser.name}`
            })
        });

        // Создаём уведомление для продавца
        await fetch(`${API_URL}/notifications`, {
            method: 'POST',
            headers: authJsonHeaders(),
            body: JSON.stringify({
                userId: sellerId,
                title: 'Новая покупка!',
                message: `Вашу работу "${productTitle}" купили! Срок сдачи: ${new Date(deadline).toLocaleDateString()}`,
                type: 'sale'
            })
        });

        closePurchaseConfirmModal();
        showSuccessNotification(newBalance);
        checkAuth();
        
        // Уведомление о пути к товару
        showToast('Покупка успешна!', 'Товар доступен в Личном кабинете → вкладка "Покупатель"', 'success', 5000);
    } catch (error) {
        showToast('Ошибка', 'Ошибка покупки', 'error');
        console.error(error);
    }
}

// ==================== ЛИЧНЫЙ КАБИНЕТ ====================

const WALLET_TOPUP_FEE = 0.07;

function updateWalletTopupPreview() {
    const el = document.getElementById('wallet-topup-net');
    const out = document.getElementById('wallet-topup-preview');
    if (!el || !out) return;
    const net = parseInt(el.value, 10);
    if (!net || net < 1) {
        out.textContent = '';
        return;
    }
    const fee = Math.max(0, Math.round(net * WALLET_TOPUP_FEE));
    out.textContent = `К оплате через эквайера: ${net + fee} ₽ (на баланс ${net} ₽, комиссия ${fee} ₽). Сейчас кнопка «Пополнить» зачисляет без реальной оплаты.`;
}

async function walletTopup() {
    if (!currentUser) return;
    const input = document.getElementById('wallet-topup-net');
    const net = parseInt(input && input.value, 10);
    if (!net || net < 1) {
        showToast('Ошибка', 'Укажите сумму пополнения', 'error');
        return;
    }
    try {
        const res = await fetch(`${API_URL}/wallet/topup`, {
            method: 'POST',
            headers: { ...authBearerHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ netAmount: net })
        });
        const data = await res.json();
        if (!res.ok) {
            showToast('Ошибка', data.error || 'Не удалось пополнить', 'error');
            return;
        }
        showToast('Баланс', `${data.message}. Зачислено ${data.credited} ₽.`, 'success', 5000);
        input.value = '';
        updateWalletTopupPreview();
        await loadCabinetData();
        await loadSalesData();
    } catch (e) {
        console.error(e);
        showToast('Ошибка', 'Сеть или сервер', 'error');
    }
}

async function walletWithdrawSbp() {
    if (!currentUser) return;
    const amtEl = document.getElementById('wallet-withdraw-amount');
    const phoneEl = document.getElementById('wallet-withdraw-phone');
    const amount = parseInt(amtEl && amtEl.value, 10);
    const phone = phoneEl && phoneEl.value.trim();
    if (!amount || amount < 10) {
        showToast('Ошибка', 'Минимальная сумма вывода 10 ₽', 'error');
        return;
    }
    try {
        const res = await fetch(`${API_URL}/wallet/withdraw-sbp`, {
            method: 'POST',
            headers: { ...authBearerHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount, phone })
        });
        const data = await res.json();
        if (!res.ok) {
            showToast('Ошибка', data.error || 'Вывод недоступен', 'error');
            return;
        }
        showToast('Вывод', `${data.message} Комиссия ${data.fee} ₽, к получению ${data.netPayout} ₽.`, 'success', 6000);
        amtEl.value = '';
        phoneEl.value = '';
        await loadSalesData();
    } catch (e) {
        console.error(e);
        showToast('Ошибка', 'Сеть или сервер', 'error');
    }
}

async function confirmPurchaseCompletion(purchaseId) {
    if (!currentUser || !purchaseId) return;
    try {
        const res = await fetch(`${API_URL}/purchases/${purchaseId}/confirm-completion`, {
            method: 'POST',
            headers: authBearerHeaders()
        });
        const data = await res.json();
        if (!res.ok) {
            showToast('Ошибка', data.error || 'Не удалось подтвердить', 'error');
            return;
        }
        showToast('Заказ', data.message || 'Выполнение подтверждено', 'success', 4000);
        await loadCabinetData();
        await loadSalesData();
        await updateChatPurchaseActions();
    } catch (e) {
        console.error(e);
        showToast('Ошибка', 'Сеть или сервер', 'error');
    }
}

async function updateChatPurchaseActions() {
    const host = document.getElementById('chat-purchase-actions');
    if (!host || !currentUser || !currentChatPurchaseId) {
        return;
    }
    host.innerHTML = '';
    if (currentChatPurchaseId === 'new') return;
    try {
        const res = await fetch(`${API_URL}/purchases/${currentChatPurchaseId}`, { headers: authBearerHeaders() });
        if (!res.ok) return;
        const p = await res.json();
        const canConfirm =
            currentUser.id === p.buyerId &&
            p.status === 'active' &&
            p.fileAttached &&
            (p.buyerConfirmedAt == null || p.buyerConfirmedAt === '');
        if (!canConfirm) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-signup btn-confirm-order';
        btn.dataset.action = 'confirm-purchase-completion';
        btn.dataset.purchaseId = String(p.id);
        btn.textContent = 'Подтвердить выполнение заказа';
        host.appendChild(btn);
    } catch (e) {
        console.error(e);
    }
}

async function loadCabinetData() {
    if (!currentUser) return;

    try {
        // Получаем актуальные данные пользователя
        const userResponse = await fetch(`${API_URL}/users/${currentUser.id}`, { headers: authBearerHeaders() });
        const user = await userResponse.json();
        document.getElementById('user-balance').textContent = user.balance != null ? user.balance : 0;

        // Загружаем покупки (для заказчика)
        const purchasesResponse = await fetch(`${API_URL}/users/${currentUser.id}/purchases`, { headers: authBearerHeaders() });
        const purchases = await purchasesResponse.json();

        const purchasesList = document.getElementById('purchases-list');
        purchasesList.innerHTML = '';

        if (purchases.length === 0) {
            purchasesList.innerHTML = '<p style="color: var(--text-secondary);">Покупок пока нет</p>';
        } else {
            for (const purchase of purchases) {
                const item = document.createElement('div');
                item.className = 'purchase-item';

                let fileAction = '';
                if (purchase.fileAttached) {
                    fileAction = `<button class="btn-view" data-action="view-purchase-file" data-purchase-id="${purchase.id}">📄 Смотреть работу</button>`;
                } else {
                    fileAction = '<span style="color: var(--text-secondary); font-size: 0.9em;">Файл ещё не загружен продавцом</span>';
                }

                const canConfirmOrder =
                    purchase.status === 'active' &&
                    purchase.fileAttached &&
                    (purchase.buyerConfirmedAt == null || purchase.buyerConfirmedAt === '');
                const confirmOrderBtn = canConfirmOrder
                    ? `<button type="button" class="btn-signup btn-confirm-order" data-action="confirm-purchase-completion" data-purchase-id="${purchase.id}">Подтвердить выполнение заказа</button>`
                    : '';

                const confirmedLabel =
                    purchase.buyerConfirmedAt != null && purchase.buyerConfirmedAt !== ''
                        ? '<span class="purchase-confirmed-label" style="color: var(--accent-warm); font-size: 0.85em;">Выполнение подтверждено</span>'
                        : '';

                // Кнопка оставить отзыв (если файла ещё нет или уже есть отзыв)
                const reviewBtn = !purchase.fileAttached
                    ? ''
                    : `<button class="btn-review" data-action="open-review-modal" data-purchase-id="${purchase.id}" data-seller-id="${escapeHTML(purchase.sellerId)}" data-product-title="${escapeHTML(purchase.title)}">✎ Оставить отзыв</button>`;

                const infoDiv = document.createElement('div');
                infoDiv.className = 'info';
                
                const titleEl = document.createElement('span');
                titleEl.className = 'title';
                titleEl.textContent = purchase.title;
                
                const metaEl = document.createElement('span');
                metaEl.className = 'meta';
                metaEl.textContent = `${purchase.price} ₽ • ${formatMoscowDate(purchase.date)}`;
                
                infoDiv.appendChild(titleEl);
                infoDiv.appendChild(metaEl);
                
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'purchase-actions';
                actionsDiv.innerHTML = fileAction + confirmOrderBtn + confirmedLabel + reviewBtn;
                
                item.appendChild(infoDiv);
                item.appendChild(actionsDiv);
                purchasesList.appendChild(item);
            }
        }

        // Загружаем отзывы (если есть рейтинг)
        const ratingElement = document.getElementById('user-rating');
        if (ratingElement) {
            ratingElement.textContent = user.rating ? user.rating.toFixed(1) : 'Нет отзывов';
        }

        updateWalletTopupPreview();
    } catch (error) {
        console.error('Ошибка загрузки данных кабинета:', error);
    }
}

// Загрузка данных о продажах
async function loadSalesData() {
    if (!currentUser) return;

    try {
        const wRes = await fetch(`${API_URL}/wallet`, { headers: authBearerHeaders() });
        if (wRes.ok) {
            const w = await wRes.json();
            const sw = document.getElementById('seller-withdrawable');
            const sm = document.getElementById('seller-maturing');
            const sa = document.getElementById('seller-awaiting');
            if (sw) sw.textContent = w.sellerWithdrawable != null ? w.sellerWithdrawable : 0;
            if (sm) sm.textContent = w.sellerMaturing != null ? w.sellerMaturing : 0;
            if (sa) sa.textContent = w.sellerAwaitingBuyerConfirm != null ? w.sellerAwaitingBuyerConfirm : 0;
        }

        console.log('[SALES] Загрузка продаж для пользователя:', currentUser.id);
        // Загружаем продажи (для продавца)
        const salesResponse = await fetch(`${API_URL}/users/${currentUser.id}/sales`, { headers: authBearerHeaders() });
        const sales = await salesResponse.json();
        console.log('[SALES] Получено продаж:', sales.length, sales);

        const sellerSalesList = document.getElementById('seller-sales-list');
        if (sellerSalesList) {
            sellerSalesList.innerHTML = '';

            if (sales.length === 0) {
                sellerSalesList.innerHTML = '<p style="color: var(--text-secondary);">Продаж пока не было</p>';
            } else {
                for (const sale of sales) {
                    const item = document.createElement('div');
                    item.className = 'seller-product-item';

                    let fileAction = '';
                    const escapedBuyerId = escapeHTML(sale.buyerId);
                    const escapedSellerId = escapeHTML(sale.sellerId);
                    if (sale.fileAttached) {
                        fileAction = `<button class="btn-replace" data-action="open-upload-modal" data-sale-id="${sale.id}" data-buyer-id="${escapedBuyerId}" data-seller-id="${escapedSellerId}">📝 Заменить файл</button>`;
                    } else {
                        fileAction = `<button class="btn-upload" data-action="open-upload-modal" data-sale-id="${sale.id}" data-buyer-id="${escapedBuyerId}" data-seller-id="${escapedSellerId}">📤 Прикрепить работу</button>`;
                    }
                    
                    // Кнопка перехода в чат
                    const chatButton = `<button class="btn-chat-sale" data-action="open-chat-from-sale" data-purchase-id="${sale.id}" data-buyer-id="${escapedBuyerId}" data-seller-id="${escapedSellerId}" data-title="${escapeHTML(sale.title)}">💬 Чат</button>`;

                    // Вычисляем срок до конца сдачи
                    let deadlineInfo = '';
                    if (sale.deadline) {
                        const deadlineDate = new Date(sale.deadline);
                        const now = new Date();
                        const diffTime = deadlineDate - now;
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                        let deadlineClass = 'deadline-normal';
                        let deadlineText = '';

                        if (diffDays < 0) {
                            deadlineClass = 'deadline-expired';
                            deadlineText = `⏰ Срок истёк ${Math.abs(diffDays)} дн. назад`;
                        } else if (diffDays === 0) {
                            deadlineClass = 'deadline-urgent';
                            deadlineText = `⏰ Срок сдачи сегодня!`;
                        } else if (diffDays <= 3) {
                            deadlineClass = 'deadline-urgent';
                            deadlineText = `⏰ Осталось ${diffDays} дн.`;
                        } else {
                            deadlineText = `⏰ Срок сдачи: ${deadlineDate.toLocaleDateString()} (${diffDays} дн.)`;
                        }

                        deadlineInfo = `<span class="product-deadline ${deadlineClass}">${deadlineText}</span>`;
                    }

                    const infoDiv = document.createElement('div');
                    infoDiv.className = 'info';
                    
                    const titleEl = document.createElement('span');
                    titleEl.className = 'title';
                    titleEl.textContent = sale.title;
                    
                    const metaEl = document.createElement('span');
                    metaEl.className = 'meta';
                    metaEl.textContent = `${sale.price} ₽ • ${formatMoscowDate(sale.date)} • Покупатель: ${sale.buyerName || sale.buyerId}`;
                    
                    infoDiv.appendChild(titleEl);
                    infoDiv.appendChild(metaEl);
                    if (deadlineInfo) {
                        const deadlineSpan = document.createElement('span');
                        deadlineSpan.innerHTML = deadlineInfo;
                        infoDiv.appendChild(deadlineSpan);
                    }
                    
                    const actionsDiv = document.createElement('div');
                    actionsDiv.className = 'sale-actions';
                    actionsDiv.innerHTML = fileAction + chatButton;
                    
                    item.appendChild(infoDiv);
                    item.appendChild(actionsDiv);
                    sellerSalesList.appendChild(item);
                }
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки данных о продажах:', error);
    }
}

// Загрузка данных о товарах
async function loadProductsData() {
    if (!currentUser) return;

    try {
        // Загружаем товары продавца
        const productsResponse = await fetch(`${API_URL}/users/${currentUser.id}/products`, { headers: authBearerHeaders() });
        const userProducts = await productsResponse.json();

        const sellerProductsList = document.getElementById('seller-products-list');
        sellerProductsList.innerHTML = '';

        if (userProducts.length === 0) {
            sellerProductsList.innerHTML = '<p style="color: var(--text-secondary);">Товаров пока нет</p>';
        } else {
            userProducts.forEach(product => {
                const item = document.createElement('div');
                item.className = 'seller-product-item';

                let statusHtml = '';
                if (product.status === 'pending') {
                    statusHtml = '<span class="product-status status-pending">На проверке</span>';
                } else if (product.status === 'approved') {
                    statusHtml = '<span class="product-status status-approved">Опубликован</span>';
                } else {
                    statusHtml = '<span class="product-status status-rejected">Отклонён</span>';
                }

                const infoDiv = document.createElement('div');
                infoDiv.className = 'info';
                
                const titleEl = document.createElement('span');
                titleEl.className = 'title';
                titleEl.textContent = product.title;
                
                const metaEl = document.createElement('span');
                metaEl.className = 'meta';
                metaEl.innerHTML = `${product.price} ₽ • ${statusHtml}`;
                
                infoDiv.appendChild(titleEl);
                infoDiv.appendChild(metaEl);
                
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-btn';
                deleteBtn.textContent = 'Удалить';
                deleteBtn.onclick = () => deleteProduct(product.id);
                
                item.appendChild(infoDiv);
                item.appendChild(deleteBtn);
                sellerProductsList.appendChild(item);
            });
        }
    } catch (error) {
        console.error('Ошибка загрузки данных о товарах:', error);
    }
}

// ==================== АДМИН-ПАНЕЛЬ ====================

function productCategoryLabelRu(category) {
    const map = {
        practices: 'Практические работы',
        labs: 'Лабораторные работы',
        courses: 'Курсовые работы'
    };
    return map[category] || category || '—';
}

function formatProductDeadlineHuman(deadline) {
    if (deadline == null || deadline === '') return '—';
    const d = new Date(deadline);
    if (Number.isNaN(d.getTime())) return String(deadline);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Все поля товара для модерации (только textContent). */
function appendProductModerationDetails(container, product) {
    const lines = [
        ['Категория', productCategoryLabelRu(product.category)],
        ['Дисциплина', product.discipline || '—'],
        ['Университет', (product.university && String(product.university).trim()) || '—'],
        ['Преподаватель', (product.teacher && String(product.teacher).trim()) || '—'],
        ['Цена', `${product.price} ₽`],
        ['Срок сдачи', formatProductDeadlineHuman(product.deadline)],
        ['Продавец', product.sellerName || '—']
    ];
    if (product.sellerId) {
        lines.push(['ID продавца', String(product.sellerId)]);
    }
    lines.forEach(([label, value]) => {
        const line = document.createElement('span');
        line.className = 'meta admin-product-detail-line';
        line.textContent = `${label}: ${value}`;
        container.appendChild(line);
    });
}

async function loadAdminData() {
    if (!currentUser || !isStaffUser()) return;

    try {
        // Загружаем ВСЕ товары (включая pending)
        const productsResponse = await fetch(`${API_URL}/products/all`, { headers: authBearerHeaders() });
        const products = await productsResponse.json();

        // Товары на проверке
        const pendingProducts = products.filter(p => p.status === 'pending');
        const pendingList = document.getElementById('pending-products-list');
        pendingList.innerHTML = '';

        if (pendingProducts.length === 0) {
            pendingList.innerHTML = '<p style="color: var(--text-secondary);">Нет товаров на проверке</p>';
        } else {
            pendingProducts.forEach(product => {
                const item = document.createElement('div');
                item.className = 'pending-product-item';
                
                const infoDiv = document.createElement('div');
                infoDiv.className = 'info';
                
                const titleEl = document.createElement('span');
                titleEl.className = 'title';
                titleEl.textContent = product.title;

                const detailsEl = document.createElement('div');
                detailsEl.className = 'admin-product-details';
                appendProductModerationDetails(detailsEl, product);

                infoDiv.appendChild(titleEl);
                infoDiv.appendChild(detailsEl);
                
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'admin-actions';
                
                const approveBtn = document.createElement('button');
                approveBtn.className = 'btn-approve';
                approveBtn.textContent = '✓ Одобрить';
                approveBtn.onclick = () => approveProduct(product.id);
                
                const rejectBtn = document.createElement('button');
                rejectBtn.className = 'btn-reject';
                rejectBtn.textContent = '✗ Отклонить';
                rejectBtn.onclick = () => rejectProduct(product.id);
                
                actionsDiv.appendChild(approveBtn);
                actionsDiv.appendChild(rejectBtn);
                
                item.appendChild(infoDiv);
                item.appendChild(actionsDiv);
                pendingList.appendChild(item);
            });
        }

        // Опубликованные товары
        const approvedProducts = products.filter(p => p.status === 'approved');
        const approvedList = document.getElementById('approved-products-list');
        approvedList.innerHTML = '';

        if (approvedProducts.length === 0) {
            approvedList.innerHTML = '<p style="color: var(--text-secondary);">Нет опубликованных товаров</p>';
        } else {
            approvedProducts.forEach(product => {
                const item = document.createElement('div');
                item.className = 'admin-product-item';
                
                const infoDiv = document.createElement('div');
                infoDiv.className = 'info';
                
                const titleEl = document.createElement('span');
                titleEl.className = 'title';
                titleEl.textContent = product.title;

                const detailsEl = document.createElement('div');
                detailsEl.className = 'admin-product-details';
                appendProductModerationDetails(detailsEl, product);
                
                infoDiv.appendChild(titleEl);
                infoDiv.appendChild(detailsEl);
                
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'admin-actions';
                
                const rejectBtn = document.createElement('button');
                rejectBtn.className = 'btn-reject';
                rejectBtn.textContent = '✗ Скрыть';
                rejectBtn.onclick = () => rejectProduct(product.id);
                
                actionsDiv.appendChild(rejectBtn);
                
                item.appendChild(infoDiv);
                item.appendChild(actionsDiv);
                approvedList.appendChild(item);
            });
        }

        // Загружаем ВСЕ индивидуальные запросы
        const requestsResponse = await fetch(`${API_URL}/custom-requests/all`, { headers: authBearerHeaders() });
        const requests = await requestsResponse.json();

        // Запросы на проверке
        const pendingRequests = requests.filter(r => r.status === 'pending');
        const pendingRequestsList = document.getElementById('pending-requests-list');
        pendingRequestsList.innerHTML = '';

        if (pendingRequests.length === 0) {
            pendingRequestsList.innerHTML = '<p style="color: var(--text-secondary);">Нет запросов на проверке</p>';
        } else {
            pendingRequests.forEach(request => {
                const item = document.createElement('div');
                item.className = 'pending-product-item';
                const hasFile = request.fileName ? '📎 С файлом' : 'Без файла';
                
                const infoDiv = document.createElement('div');
                infoDiv.className = 'info';
                
                const titleEl = document.createElement('span');
                titleEl.className = 'title';
                titleEl.textContent = request.title;
                
                const metaEl = document.createElement('span');
                metaEl.className = 'meta';
                metaEl.textContent = `${request.description ? request.description.substring(0, 50) + '...' : 'Без описания'} • ${request.budget} ₽ • ${hasFile}`;
                
                const requesterEl = document.createElement('span');
                requesterEl.className = 'meta';
                requesterEl.textContent = `Заказчик: ${request.requesterName}`;
                
                infoDiv.appendChild(titleEl);
                infoDiv.appendChild(metaEl);
                infoDiv.appendChild(requesterEl);
                
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'admin-actions';
                
                const approveBtn = document.createElement('button');
                approveBtn.className = 'btn-approve';
                approveBtn.textContent = '✓ Одобрить';
                approveBtn.onclick = () => approveCustomRequest(request.id);
                
                const rejectBtn = document.createElement('button');
                rejectBtn.className = 'btn-reject';
                rejectBtn.textContent = '✗ Отклонить';
                rejectBtn.onclick = () => rejectCustomRequest(request.id);
                
                actionsDiv.appendChild(approveBtn);
                actionsDiv.appendChild(rejectBtn);
                
                item.appendChild(infoDiv);
                item.appendChild(actionsDiv);
                pendingRequestsList.appendChild(item);
            });
        }

        // Опубликованные запросы
        const approvedRequests = requests.filter(r => r.status === 'approved');
        const approvedRequestsList = document.getElementById('approved-requests-list');
        approvedRequestsList.innerHTML = '';

        if (approvedRequests.length === 0) {
            approvedRequestsList.innerHTML = '<p style="color: var(--text-secondary);">Нет опубликованных запросов</p>';
        } else {
            approvedRequests.forEach(request => {
                const item = document.createElement('div');
                item.className = 'admin-product-item';
                const hasFile = request.fileName ? '📎 С файлом' : 'Без файла';
                
                const infoDiv = document.createElement('div');
                infoDiv.className = 'info';
                
                const titleEl = document.createElement('span');
                titleEl.className = 'title';
                titleEl.textContent = request.title;
                
                const metaEl = document.createElement('span');
                metaEl.className = 'meta';
                metaEl.textContent = `${request.budget} ₽ • ${hasFile} • Заказчик: ${request.requesterName}`;
                
                infoDiv.appendChild(titleEl);
                infoDiv.appendChild(metaEl);
                
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'admin-actions';
                
                const rejectBtn = document.createElement('button');
                rejectBtn.className = 'btn-reject';
                rejectBtn.textContent = '✗ Скрыть';
                rejectBtn.onclick = () => rejectCustomRequest(request.id);
                
                actionsDiv.appendChild(rejectBtn);
                
                item.appendChild(infoDiv);
                item.appendChild(actionsDiv);
                approvedRequestsList.appendChild(item);
            });
        }

        // Загружаем пользователей
        const usersResponse = await fetch(`${API_URL}/users`, { headers: authBearerHeaders() });
        const users = await usersResponse.json();

        const usersList = document.getElementById('users-list');
        usersList.innerHTML = '';

        const regularUsers = users.filter(u => !u.isAdmin);

        if (regularUsers.length === 0) {
            usersList.innerHTML = '<p style="color: var(--text-secondary);">Нет пользователей</p>';
        } else {
            regularUsers.forEach(user => {
                const item = document.createElement('div');
                item.className = 'user-item';

                const statusClass = user.isBlocked ? 'user-status-blocked' : 'user-status-active';
                const statusText = user.isBlocked ? 'Заблокирован' : 'Активен';

                const infoDiv = document.createElement('div');
                infoDiv.className = 'info';
                
                const nameEl = document.createElement('span');
                nameEl.className = 'name';
                nameEl.textContent = user.name;
                
                const emailEl = document.createElement('span');
                emailEl.className = 'email';
                emailEl.textContent = `${user.email} • Баланс: ${user.balance} ₽`;
                
                infoDiv.appendChild(nameEl);
                infoDiv.appendChild(emailEl);
                
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'user-actions';
                
                const statusSpan = document.createElement('span');
                statusSpan.className = `user-status ${statusClass}`;
                statusSpan.textContent = statusText;

                const actionBtn = document.createElement('button');
                if (user.isBlocked) {
                    actionBtn.className = 'btn-unblock';
                    actionBtn.textContent = 'Разблокировать';
                    actionBtn.onclick = () => unblockUser(user.id);
                } else {
                    actionBtn.className = 'btn-block';
                    actionBtn.textContent = 'Заблокировать';
                    actionBtn.onclick = () => blockUser(user.id);
                }

                actionsDiv.appendChild(statusSpan);
                actionsDiv.appendChild(actionBtn);

                if (isStaffUser()) {
                    const modBtn = document.createElement('button');
                    modBtn.className = user.isModerator ? 'btn-reject' : 'btn-approve';
                    modBtn.textContent = user.isModerator ? 'Снять модератора' : 'Сделать модератором';
                    modBtn.style.marginLeft = '0.35rem';
                    modBtn.onclick = () => setUserModerator(user.id, !user.isModerator);
                    actionsDiv.appendChild(modBtn);
                }

                item.appendChild(infoDiv);
                item.appendChild(actionsDiv);
                usersList.appendChild(item);
            });
        }
    } catch (error) {
        console.error('Ошибка загрузки админ-панели:', error);
    }
}

// Одобрение товара
async function approveProduct(productId) {
    try {
        const response = await fetch(`${API_URL}/products/${productId}/approve`, {
            method: 'PATCH',
            headers: authBearerHeaders()
        });

        if (!response.ok) {
            showToast('Ошибка', 'Ошибка одобрения товара', 'error');
            return;
        }

        showToast('Успешно', 'Товар одобрен', 'success');
        loadAdminData();
        renderProducts('practices', 'all', 'all', 'all', '');
        renderProducts('labs', 'all', 'all', 'all', '');
        renderProducts('courses', 'all', 'all', 'all', '');
    } catch (error) {
        showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
        console.error(error);
    }
}

// Отклонение товара
async function rejectProduct(productId) {
    try {
        const response = await fetch(`${API_URL}/products/${productId}/reject`, {
            method: 'PATCH',
            headers: authBearerHeaders()
        });

        if (!response.ok) {
            showToast('Ошибка', 'Ошибка отклонения товара', 'error');
            return;
        }

        showToast('Информация', 'Товар отклонён', 'info');
        loadAdminData();
        renderProducts('practices', 'all', 'all', 'all', '');
        renderProducts('labs', 'all', 'all', 'all', '');
        renderProducts('courses', 'all', 'all', 'all', '');
    } catch (error) {
        showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
        console.error(error);
    }
}

// Одобрение индивидуального запроса
async function approveCustomRequest(requestId) {
    try {
        const response = await fetch(`${API_URL}/custom-requests/${requestId}/approve`, {
            method: 'PATCH',
            headers: authBearerHeaders()
        });

        if (!response.ok) {
            showToast('Ошибка', 'Ошибка одобрения запроса', 'error');
            return;
        }

        showToast('Успешно', 'Запрос одобрен', 'success');
        loadAdminData();
        renderCustomRequests('all');
    } catch (error) {
        showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
        console.error(error);
    }
}

// Отклонение индивидуального запроса
async function rejectCustomRequest(requestId) {
    try {
        const response = await fetch(`${API_URL}/custom-requests/${requestId}/reject`, {
            method: 'PATCH',
            headers: authBearerHeaders()
        });

        if (!response.ok) {
            showToast('Ошибка', 'Ошибка отклонения запроса', 'error');
            return;
        }

        showToast('Информация', 'Запрос отклонён', 'info');
        loadAdminData();
        renderCustomRequests('all');
    } catch (error) {
        showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
        console.error(error);
    }
}

let adminChatSelectedPurchaseId = null;
let adminChatCurrentConv = null;
let adminChatMessagesInterval = null;
let adminSupportSelectedTicketId = null;

function openSupportModal() {
    if (!currentUser) {
        openModal('login');
        showToast('Информация', 'Войдите в аккаунт, чтобы обратиться в поддержку', 'info');
        return;
    }
    const modal = document.getElementById('support-modal');
    if (modal) modal.classList.add('active');
    loadMySupportTicketsIntoModal();
}

function closeSupportModal() {
    const modal = document.getElementById('support-modal');
    if (modal) modal.classList.remove('active');
}

async function loadMySupportTicketsIntoModal() {
    const el = document.getElementById('support-my-tickets');
    if (!el || !currentUser) return;
    el.textContent = 'Загрузка…';
    try {
        const r = await fetch(`${API_URL}/support/my-tickets`, { headers: authBearerHeaders() });
        const rows = await r.json();
        if (!r.ok) {
            el.innerHTML = '';
            return;
        }
        el.innerHTML = '';
        if (!rows.length) {
            el.innerHTML = '<p style="color:var(--text-secondary)">Пока нет обращений</p>';
            return;
        }
        rows.forEach((t) => {
            const d = document.createElement('div');
            d.className = 'support-ticket-row';
            const strong = document.createElement('strong');
            strong.textContent = `#${t.id}`;
            d.appendChild(strong);
            d.appendChild(document.createTextNode(' · '));
            const sub = document.createElement('span');
            sub.textContent = t.subject || '';
            d.appendChild(sub);
            const st = document.createElement('span');
            st.style.color = 'var(--text-muted)';
            st.textContent = ` (${t.status})`;
            d.appendChild(st);
            el.appendChild(d);
        });
    } catch {
        el.innerHTML = '';
    }
}

async function loadAdminSupportStaffUI() {
    if (!isStaffUser()) return;
    const listEl = document.getElementById('admin-support-tickets-list');
    const headEl = document.getElementById('admin-support-thread-head');
    const msgEl = document.getElementById('admin-support-thread-messages');
    const replyWrap = document.getElementById('admin-support-reply-wrap');
    if (!listEl) return;
    listEl.innerHTML = '<p style="color:var(--text-secondary)">Загрузка…</p>';
    if (headEl) headEl.textContent = '';
    if (msgEl) msgEl.innerHTML = '';
    if (replyWrap) replyWrap.style.display = 'none';
    adminSupportSelectedTicketId = null;
    try {
        const r = await fetch(`${API_URL}/support/tickets`, { headers: authBearerHeaders() });
        const tickets = await r.json();
        if (!r.ok) {
            listEl.innerHTML = `<p style="color:var(--danger)">${escapeHTML(tickets.error || 'Ошибка')}</p>`;
            return;
        }
        listEl.innerHTML = '';
        if (!tickets.length) {
            listEl.innerHTML = '<p style="color:var(--text-secondary)">Нет обращений</p>';
            return;
        }
        tickets.forEach((t) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'admin-chat-conv-item';
            item.dataset.ticketId = String(t.id);
            const title = document.createElement('span');
            title.className = 'admin-chat-conv-item__title';
            title.textContent = `#${t.id} · ${t.subject || ''}`;
            const meta = document.createElement('span');
            meta.className = 'admin-chat-conv-item__meta';
            meta.textContent = `${t.userName || ''} · ${t.status || ''}`;
            item.appendChild(title);
            item.appendChild(meta);
            item.addEventListener('click', () => selectAdminSupportTicket(t.id));
            listEl.appendChild(item);
        });
    } catch {
        listEl.innerHTML = '<p style="color:var(--danger)">Ошибка сети</p>';
    }
}

async function selectAdminSupportTicket(ticketId) {
    adminSupportSelectedTicketId = ticketId;
    document.querySelectorAll('#admin-support-tickets-list .admin-chat-conv-item').forEach((el) => {
        el.classList.toggle('is-selected', el.dataset.ticketId === String(ticketId));
    });
    const headEl = document.getElementById('admin-support-thread-head');
    const msgEl = document.getElementById('admin-support-thread-messages');
    const replyWrap = document.getElementById('admin-support-reply-wrap');
    const ta = document.getElementById('admin-support-reply-text');
    try {
        const r = await fetch(`${API_URL}/support/tickets/${ticketId}`, { headers: authBearerHeaders() });
        const data = await r.json();
        if (!r.ok) return;
        const { ticket, messages } = data;
        if (headEl) {
            headEl.textContent = `#${ticket.id} · ${ticket.subject} · ${ticket.status}`;
        }
        const senderDisplayName = (ticket && ticket.userName ? String(ticket.userName).trim() : '') || 'Пользователь';
        if (msgEl) {
            msgEl.innerHTML = '';
            const intro = document.createElement('div');
            intro.className = 'admin-chat-msg';
            const introSender = document.createElement('div');
            introSender.className = 'admin-chat-msg-sender';
            introSender.textContent = `Отправитель: ${senderDisplayName}`;
            const introText = document.createElement('div');
            introText.className = 'admin-chat-msg-text';
            introText.textContent = ticket.body || '';
            const introMeta = document.createElement('div');
            introMeta.className = 'admin-chat-msg-meta';
            introMeta.textContent = 'Текст обращения';
            intro.appendChild(introSender);
            intro.appendChild(introText);
            intro.appendChild(introMeta);
            msgEl.appendChild(intro);
            (messages || []).forEach((m) => {
                const w = document.createElement('div');
                w.className = 'admin-chat-msg';
                const who = document.createElement('div');
                who.className = 'admin-chat-msg-sender';
                who.textContent = m.isStaff ? 'Поддержка' : senderDisplayName;
                const tx = document.createElement('div');
                tx.className = 'admin-chat-msg-text';
                tx.textContent = m.message || '';
                w.appendChild(who);
                w.appendChild(tx);
                msgEl.appendChild(w);
            });
        }
        if (replyWrap && ta) {
            ta.value = '';
            replyWrap.style.display = ticket.status === 'open' ? 'block' : 'none';
        }
    } catch {
        /* ignore */
    }
}

async function sendAdminSupportReply() {
    if (!adminSupportSelectedTicketId || !currentUser) return;
    const ta = document.getElementById('admin-support-reply-text');
    const text = (ta && ta.value.trim()) || '';
    if (!text) {
        showToast('Ошибка', 'Введите текст ответа', 'error');
        return;
    }
    try {
        const r = await fetch(`${API_URL}/support/tickets/${adminSupportSelectedTicketId}/messages`, {
            method: 'POST',
            headers: authJsonHeaders(),
            body: JSON.stringify({ message: text })
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            showToast('Ошибка', err.error || 'Не отправлено', 'error');
            return;
        }
        showToast('Успешно', 'Ответ отправлен', 'success');
        if (ta) ta.value = '';
        await selectAdminSupportTicket(adminSupportSelectedTicketId);
        loadAdminSupportStaffUI();
    } catch {
        showToast('Ошибка', 'Ошибка сети', 'error');
    }
}

async function closeAdminSupportTicket() {
    if (!adminSupportSelectedTicketId) return;
    try {
        const r = await fetch(`${API_URL}/support/tickets/${adminSupportSelectedTicketId}/close`, {
            method: 'PATCH',
            headers: authBearerHeaders()
        });
        if (!r.ok) return;
        showToast('Информация', 'Обращение закрыто', 'info');
        loadAdminSupportStaffUI();
    } catch {
        /* ignore */
    }
}

async function syncCurrentUserFromServer() {
    if (!authToken()) return;
    try {
        const r = await fetch(`${API_URL}/auth/me`, { headers: authBearerHeaders() });
        if (!r.ok) return;
        const me = await r.json();
        const token = currentUser.token || currentUser.accessToken;
        const refreshToken = currentUser.refreshToken;
        currentUser = {
            ...currentUser,
            ...me,
            photoUrl: me.photo_url || currentUser.photoUrl,
            token: token || currentUser.token,
            refreshToken: refreshToken || currentUser.refreshToken
        };
        sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
    } catch {
        /* ignore */
    }
}

function stopAdminChatMessagesPoll(clearSelection = false) {
    if (adminChatMessagesInterval) {
        clearInterval(adminChatMessagesInterval);
        adminChatMessagesInterval = null;
        revokeChatAttachmentBlobUrls();
    }
    if (clearSelection) {
        adminChatSelectedPurchaseId = null;
        adminChatCurrentConv = null;
    }
}

async function loadAdminChatConversations() {
    if (!currentUser || !isStaffUser()) return;

    const listEl = document.getElementById('admin-chats-conversations-list');
    const headEl = document.getElementById('admin-chats-thread-head');
    const msgEl = document.getElementById('admin-chats-messages');
    if (!listEl) return;

    listEl.innerHTML = '<p style="color: var(--text-secondary);">Загрузка…</p>';
    if (headEl) headEl.textContent = '';
    if (msgEl) msgEl.innerHTML = '';

    try {
        const response = await fetch(`${API_URL}/admin/chat-conversations`, { headers: authBearerHeaders() });
        const data = await response.json();

        if (!response.ok) {
            listEl.innerHTML = `<p style="color: var(--danger);">${escapeHTML(data.error || 'Ошибка загрузки')}</p>`;
            return;
        }

        const conversations = Array.isArray(data) ? data : [];
        listEl.innerHTML = '';

        if (conversations.length === 0) {
            listEl.innerHTML = '<p style="color: var(--text-secondary);">Нет переписок с сообщениями</p>';
            return;
        }

        conversations.forEach((c) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'admin-chat-conv-item';
            item.dataset.purchaseId = String(c.purchaseId);

            const title = document.createElement('span');
            title.className = 'admin-chat-conv-item__title';
            title.textContent = c.title || `Заказ #${c.purchaseId}`;

            const meta = document.createElement('span');
            meta.className = 'admin-chat-conv-item__meta';
            const pair = `${c.buyerName || 'Покупатель'} ↔ ${c.sellerName || 'Продавец'}`;
            const when = c.lastTime ? formatMoscowDate(c.lastTime) : '';
            const cnt = typeof c.messageCount === 'number' ? c.messageCount : '';
            meta.textContent = [pair, when && `${when}`, cnt && `${cnt} сообщ.`].filter(Boolean).join(' · ');

            const preview = document.createElement('span');
            preview.className = 'admin-chat-conv-item__preview';
            const lm = (c.lastMessage || '').trim();
            preview.textContent = lm.length > 120 ? `${lm.slice(0, 120)}…` : lm;

            item.appendChild(title);
            item.appendChild(meta);
            if (lm) item.appendChild(preview);

            item.addEventListener('click', () => selectAdminChatConversation(c));
            listEl.appendChild(item);
        });
    } catch (error) {
        console.error('Ошибка загрузки переписок (админ):', error);
        listEl.innerHTML = '<p style="color: var(--danger);">Ошибка подключения</p>';
    }
}

async function loadAdminChatThreadMessages() {
    if (!adminChatSelectedPurchaseId || !currentUser || !isStaffUser()) return;

    const msgContainer = document.getElementById('admin-chats-messages');
    if (!msgContainer) return;

    try {
        const response = await fetch(
            `${API_URL}/chat/${adminChatSelectedPurchaseId}?limit=200`,
            { headers: authBearerHeaders() }
        );
        const raw = await response.json();
        const messages = Array.isArray(raw) ? raw : (raw.messages || []);

        if (!response.ok) {
            revokeChatAttachmentBlobUrls();
            msgContainer.innerHTML = `<p style="color: var(--danger);">${escapeHTML(raw.error || 'Нет доступа к чату')}</p>`;
            return;
        }

        revokeChatAttachmentBlobUrls();
        msgContainer.innerHTML = '';
        const conv = adminChatCurrentConv;

        messages.forEach((msg) => {
            const wrap = document.createElement('div');
            wrap.className = 'admin-chat-msg';

            const who = document.createElement('div');
            who.className = 'admin-chat-msg-sender';
            if (conv && String(msg.senderId) === String(conv.buyerId)) {
                who.textContent = `Покупатель (${conv.buyerName || msg.senderId})`;
            } else if (conv && String(msg.senderId) === String(conv.sellerId)) {
                who.textContent = `Продавец (${conv.sellerName || msg.senderId})`;
            } else {
                who.textContent = `Участник (${msg.senderId})`;
            }
            wrap.appendChild(who);

            if (msg.message) {
                const text = document.createElement('div');
                text.className = 'admin-chat-msg-text';
                text.textContent = msg.message;
                wrap.appendChild(text);
            }
            if (msg.fileName) {
                appendChatFileAttachment(wrap, msg, 'admin-chat-msg-file');
            }
            if (msg.createdAt) {
                const meta = document.createElement('div');
                meta.className = 'admin-chat-msg-meta';
                meta.textContent = formatMoscowTime(msg.createdAt);
                wrap.appendChild(meta);
            }

            msgContainer.appendChild(wrap);
        });

        msgContainer.scrollTop = msgContainer.scrollHeight;
    } catch (error) {
        console.error('Ошибка загрузки сообщений (админ):', error);
    }
}

function selectAdminChatConversation(conv) {
    document.querySelectorAll('.admin-chat-conv-item').forEach((el) => {
        el.classList.toggle('is-selected', String(conv.purchaseId) === el.dataset.purchaseId);
    });

    const headEl = document.getElementById('admin-chats-thread-head');
    if (headEl) {
        headEl.textContent =
            `${conv.title || 'Заказ'} · #${conv.purchaseId} · ${conv.buyerName || 'Покупатель'} ↔ ${conv.sellerName || 'Продавец'}`;
    }

    stopAdminChatMessagesPoll(false);
    adminChatSelectedPurchaseId = conv.purchaseId;
    adminChatCurrentConv = conv;
    adminChatMessagesInterval = setInterval(loadAdminChatThreadMessages, 4000);
    loadAdminChatThreadMessages();
}

// Блокировка пользователя
async function blockUser(userId) {
    try {
        const response = await fetch(`${API_URL}/users/${userId}/block`, {
            method: 'PATCH',
            headers: authJsonHeaders(),
            body: JSON.stringify({ isBlocked: true })
        });

        if (!response.ok) {
            showToast('Ошибка', 'Ошибка блокировки', 'error');
            return;
        }

        const user = await response.json();
        showToast('Успешно', `Пользователь ${user.name} заблокирован`, 'success');
        loadAdminData();
    } catch (error) {
        showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
        console.error(error);
    }
}

async function setUserModerator(userId, isModerator) {
    try {
        const response = await fetch(`${API_URL}/users/${userId}/moderator`, {
            method: 'PATCH',
            headers: authJsonHeaders(),
            body: JSON.stringify({ isModerator })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            showToast('Ошибка', err.error || 'Не удалось изменить роль', 'error');
            return;
        }
        showToast('Успешно', isModerator ? 'Пользователь назначен модератором' : 'Роль модератора снята', 'success');
        loadAdminData();
    } catch (error) {
        showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
        console.error(error);
    }
}

// Разблокировка пользователя
async function unblockUser(userId) {
    try {
        const response = await fetch(`${API_URL}/users/${userId}/block`, {
            method: 'PATCH',
            headers: authJsonHeaders(),
            body: JSON.stringify({ isBlocked: false })
        });

        if (!response.ok) {
            showToast('Ошибка', 'Ошибка разблокировки', 'error');
            return;
        }

        const user = await response.json();
        showToast('Успешно', `Пользователь ${user.name} разблокирован`, 'success');
        loadAdminData();
    } catch (error) {
        showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
        console.error(error);
    }
}

// ==================== ФАЙЛЫ РАБОТ ====================

// Открыть модальное окно загрузки файла
function openUploadModal(purchaseId, buyerId, sellerId) {
    const modal = document.getElementById('upload-modal');
    if (!modal) {
        showToast('Ошибка', 'Модальное окно загрузки не найдено', 'error');
        return;
    }
    document.getElementById('upload-purchase-id').value = purchaseId;
    document.getElementById('upload-seller-id').value = sellerId || currentUser.id;
    document.getElementById('upload-buyer-id').value = buyerId;
    modal.classList.add('active');
}

// Закрыть модальное окно загрузки
function closeUploadModal() {
    const modal = document.getElementById('upload-modal');
    if (modal) {
        modal.classList.remove('active');
        document.getElementById('upload-file').value = '';
    }
}

// Написать покупателю из модального окна загрузки
async function contactSellerFromModal() {
    const purchaseId = document.getElementById('upload-purchase-id').value;
    const sellerId = document.getElementById('upload-seller-id').value;
    const buyerId = document.getElementById('upload-buyer-id').value;

    // Получаем имя покупателя
    let buyerName = 'Покупатель';
    try {
        const buyerResponse = await fetch(`${API_URL}/users/${buyerId}`, { headers: authBearerHeaders() });
        const buyer = await buyerResponse.json();
        if (buyer && buyer.name) {
            buyerName = buyer.name;
        }
    } catch (error) {
        console.error('Ошибка получения имени покупателя:', error);
    }

    closeUploadModal();
    openChat(purchaseId, buyerName, 'Заказ');
}

// Написать продавцу из модального окна подтверждения
function contactSellerFromConfirm() {
    const modal = document.getElementById('confirm-purchase-modal');
    const purchaseId = 'new'; // Новый чат будет создан после покупки
    const sellerId = modal.dataset.sellerId;
    const productTitle = modal.dataset.productTitle;
    
    showToast('Информация', 'Чат появится после подтверждения покупки', 'info');
}

// Загрузка файла работы
async function uploadWorkFile() {
    const purchaseId = document.getElementById('upload-purchase-id').value;
    const fileInput = document.getElementById('upload-file');

    if (!fileInput.files[0]) {
        showToast('Ошибка', 'Выберите файл!', 'error');
        return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async function(e) {
        try {
            const response = await fetch(`${API_URL}/purchases/${purchaseId}/file`, {
                method: 'POST',
                headers: authJsonHeaders(),
                body: JSON.stringify({
                    fileName: file.name,
                    fileData: e.target.result.split(',')[1] // Убираем data:image/...;base64,
                })
            });

            if (!response.ok) {
                const error = await response.json();
                showToast('Ошибка', error.error || 'Ошибка загрузки файла', 'error');
                return;
            }

            closeUploadModal();
            showToast('Успешно', 'Файл загружен!', 'success');
            loadCabinetData();
        } catch (error) {
            showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
            console.error(error);
        }
    };

    reader.readAsDataURL(file);
}

// Просмотр файла работы
async function viewPurchaseFile(purchaseId) {
    try {
        const response = await fetch(`${API_URL}/purchases/${purchaseId}/file`, { headers: authBearerHeaders() });

        if (!response.ok) {
            showToast('Ошибка', 'Файл не найден', 'error');
            return;
        }

        const data = await response.json();

        // Скачивание файла
        const link = document.createElement('a');
        link.href = `data:application/octet-stream;base64,${data.fileData}`;
        link.download = data.fileName;
        link.click();
        showToast('Информация', 'Файл скачивается', 'info');
    } catch (error) {
        showToast('Ошибка', 'Ошибка загрузки файла', 'error');
        console.error(error);
    }
}

// ==================== ОТЗЫВЫ ====================

// Открыть модальное окно отзыва
function openReviewModal(purchaseId, sellerId, productTitle) {
    const modal = document.getElementById('review-modal');
    if (!modal) {
        showToast('Ошибка', 'Модальное окно отзыва не найдено', 'error');
        return;
    }
    document.getElementById('review-purchase-id').value = purchaseId;
    document.getElementById('review-seller-id').value = sellerId;
    document.getElementById('review-product-title').textContent = productTitle;
    document.getElementById('review-comment').value = '';
    document.getElementById('review-rating').value = '5';
    modal.classList.add('active');
}

// Закрыть модальное окно отзыва
function closeReviewModal() {
    const modal = document.getElementById('review-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// Отправка отзыва
async function submitReview() {
    const purchaseId = document.getElementById('review-purchase-id').value;
    const sellerId = document.getElementById('review-seller-id').value;
    const rating = parseInt(document.getElementById('review-rating').value);
    const comment = document.getElementById('review-comment').value;

    try {
        const response = await fetch(`${API_URL}/reviews`, {
            method: 'POST',
            headers: authJsonHeaders(),
            body: JSON.stringify({
                purchaseId: parseInt(purchaseId),
                buyerId: currentUser.id,
                sellerId: sellerId,
                rating: rating,
                comment: comment
            })
        });

        const data = await response.json();

        if (!response.ok) {
            showToast('Ошибка', data.error || 'Ошибка отправки отзыва', 'error');
            return;
        }

        closeReviewModal();
        showToast('Успешно', 'Отзыв добавлен!', 'success');
        loadCabinetData();
    } catch (error) {
        showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
        console.error(error);
    }
}

// ==================== ЧАТЫ ====================

let currentChatPurchaseId = null;
let currentChatInterval = null;
let selectedFileForChat = null;
/** Blob URL для превью вложений в чате — освобождаем при перерисовке. */
let chatAttachmentBlobUrls = [];

function revokeChatAttachmentBlobUrls() {
    chatAttachmentBlobUrls.forEach((u) => URL.revokeObjectURL(u));
    chatAttachmentBlobUrls = [];
}

/** Нормализует MIME (некоторые ОС дают image/jpg вместо image/jpeg). */
function normalizeChatFileMime(mime) {
    if (!mime) return '';
    const m = String(mime).trim().toLowerCase();
    if (m === 'image/jpg') return 'image/jpeg';
    return String(mime).trim();
}

function chatFileDataToBase64(fileData) {
    if (fileData == null || fileData === '') return '';
    if (typeof fileData === 'string') return fileData;
    if (typeof fileData === 'object' && fileData.type === 'Buffer' && Array.isArray(fileData.data)) {
        const bytes = new Uint8Array(fileData.data);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
    }
    return '';
}

function isChatImageFile(fileType, fileName) {
    const m = (normalizeChatFileMime(fileType) || '').toLowerCase();
    if (m.startsWith('image/')) return true;
    return /\.(png|jpe?g|gif|webp)$/i.test(fileName || '');
}

/**
 * Вложение в сообщении: для изображений — превью + ссылка скачать, иначе только ссылка.
 * @param {HTMLElement} container
 * @param {object} msg
 * @param {string} fileDivClass
 */
function appendChatFileAttachment(container, msg, fileDivClass) {
    if (!msg.fileName) return;

    const fileDiv = document.createElement('div');
    fileDiv.className = fileDivClass;

    const b64 = chatFileDataToBase64(msg.fileData);
    const mime = normalizeChatFileMime(msg.fileType) || 'application/octet-stream';
    const dataHref = b64 ? `data:${mime};base64,${b64}` : '';
    const isImage = isChatImageFile(msg.fileType, msg.fileName) && Boolean(b64);

    const iconSpan = document.createElement('span');
    iconSpan.textContent = `${getFileIcon(msg.fileType)} `;
    fileDiv.appendChild(iconSpan);

    if (isImage && dataHref) {
        let displaySrc = '';
        try {
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const blob = new Blob([bytes], { type: mime || 'image/png' });
            displaySrc = URL.createObjectURL(blob);
            chatAttachmentBlobUrls.push(displaySrc);
        } catch (e) {
            displaySrc = dataHref;
        }
        if (displaySrc) {
            const img = document.createElement('img');
            img.className = 'chat-file-preview-img';
            img.src = displaySrc;
            img.alt = msg.fileName;
            img.loading = 'lazy';
            img.decoding = 'async';
            fileDiv.appendChild(img);
        }
    }

    if (dataHref) {
        const link = document.createElement('a');
        link.href = dataHref;
        link.download = msg.fileName;
        link.textContent = isImage ? 'Скачать' : msg.fileName;
        link.rel = 'noopener noreferrer';
        if (isImage) link.className = 'chat-file-download-link';
        fileDiv.appendChild(link);
    } else {
        const span = document.createElement('span');
        span.textContent = msg.fileName;
        fileDiv.appendChild(span);
    }

    container.appendChild(fileDiv);
}

// Загрузка списка чатов
async function loadChatsList() {
    if (!currentUser) return;

    try {
        // Загружаем все покупки и продажи пользователя
        const purchasesResponse = await fetch(`${API_URL}/users/${currentUser.id}/purchases`, { headers: authBearerHeaders() });
        const purchases = await purchasesResponse.json();
        
        const salesResponse = await fetch(`${API_URL}/users/${currentUser.id}/sales`, { headers: authBearerHeaders() });
        const sales = await salesResponse.json();

        const chatsListContent = document.getElementById('chats-list-content');
        chatsListContent.innerHTML = '';

        // Объединяем покупки и продажи
        const allChats = [
            ...purchases.map(p => ({ ...p, type: 'buyer', counterpartName: p.sellerName || 'Продавец' })),
            ...sales.map(s => ({ ...s, type: 'seller', counterpartName: s.buyerName || 'Покупатель' }))
        ];

        if (allChats.length === 0) {
            chatsListContent.innerHTML = '<p class="no-chats-message">У вас пока нет чатов<br>Совершите покупку или создайте запрос</p>';
            return;
        }

        allChats.forEach(chat => {
            const chatItem = document.createElement('div');
            chatItem.className = 'chat-item';
            chatItem.dataset.action = 'open-chat';
            chatItem.dataset.chatId = chat.id;
            chatItem.dataset.counterpartName = chat.counterpartName;
            chatItem.dataset.chatTitle = chat.title;
            chatItem.innerHTML = `
                <div class="chat-item-name">${escapeHTML(chat.counterpartName)}</div>
                <div class="chat-item-title">${escapeHTML(chat.title)}</div>
            `;
            chatsListContent.appendChild(chatItem);
        });
    } catch (error) {
        console.error('Ошибка загрузки чатов:', error);
    }
}

// Открытие чата
async function openChat(purchaseId, counterpartName, purchaseTitle) {
    currentChatPurchaseId = purchaseId;

    document.getElementById('chat-list').style.display = 'block';
    document.getElementById('chat-window').style.display = 'flex';
    document.getElementById('chat-with-name').textContent = `${counterpartName} (${purchaseTitle})`;

    // Загружаем сообщения
    await loadChatMessages();
    await updateChatPurchaseActions();

    // Автообновление каждые 3 секунды
    if (currentChatInterval) clearInterval(currentChatInterval);
    currentChatInterval = setInterval(loadChatMessages, 3000);

    // Фокус на поле ввода для мобильных
    const messageInput = document.getElementById('chat-message-input');
    if (messageInput) {
        setTimeout(() => {
            messageInput.focus();
        }, 300);
    }
}

// Загрузка сообщений чата
async function loadChatMessages() {
    if (!currentChatPurchaseId) return;

    try {
        const response = await fetch(`${API_URL}/chat/${currentChatPurchaseId}`, { headers: authBearerHeaders() });
        const raw = await response.json();
        if (!response.ok) {
            console.error('Ошибка загрузки сообщений:', raw);
            if (response.status === 403 || response.status === 404) {
                showToast('Информация', (raw && raw.error) || 'Нет доступа к этому чату', 'info');
                closeChatWindow();
            }
            return;
        }
        const messages = Array.isArray(raw) ? raw : (raw.messages || []);

        const messagesContainer = document.getElementById('chat-messages');
        revokeChatAttachmentBlobUrls();
        messagesContainer.innerHTML = '';

        messages.forEach(msg => {
            const messageDiv = document.createElement('div');
            const isSent = String(msg.senderId) === String(currentUser.id);
            messageDiv.className = `chat-message ${isSent ? 'sent' : 'received'}`;

            // БЕЗОПАСНОСТЬ: Используем textContent вместо innerHTML
            if (msg.message) {
                const msgEl = document.createElement('div');
                msgEl.textContent = msg.message;
                messageDiv.appendChild(msgEl);
            }
            if (msg.fileName) {
                appendChatFileAttachment(messageDiv, msg, 'chat-message-file');
            }
            if (msg.createdAt) {
                const metaDiv = document.createElement('div');
                metaDiv.className = 'chat-message-meta';
                metaDiv.textContent = formatMoscowTime(msg.createdAt);
                messageDiv.appendChild(metaDiv);
            }

            messagesContainer.appendChild(messageDiv);
        });

        // Прокрутка вниз
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        await updateChatPurchaseActions();
    } catch (error) {
        console.error('Ошибка загрузки сообщений:', error);
    }
}

// Закрыть окно чата
function closeChatWindow() {
    if (currentChatInterval) {
        clearInterval(currentChatInterval);
        currentChatInterval = null;
    }
    revokeChatAttachmentBlobUrls();
    currentChatPurchaseId = null;
    const cap = document.getElementById('chat-purchase-actions');
    if (cap) cap.innerHTML = '';
    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) messagesContainer.innerHTML = '';
    const chatWin = document.getElementById('chat-window');
    const chatList = document.getElementById('chat-list');
    if (chatWin) chatWin.style.display = 'none';
    if (chatList) chatList.style.display = 'block';
    const chatWithName = document.getElementById('chat-with-name');
    if (chatWithName) chatWithName.textContent = '';
    selectedFileForChat = null;
    updateFilePreview();
}

/** Сброс UI чатов при смене аккаунта / выходе (чаты только текущего пользователя; админ/мод перезагрузят модераторские чаты сами). */
function clearChatStateForSessionChange() {
    closeChatWindow();
    const chatsListContent = document.getElementById('chats-list-content');
    if (chatsListContent) chatsListContent.innerHTML = '';
    stopAdminChatMessagesPoll(true);
    const admMsg = document.getElementById('admin-chats-messages');
    if (admMsg) admMsg.innerHTML = '';
    const admHead = document.getElementById('admin-chats-thread-head');
    if (admHead) admHead.textContent = '';
    const admList = document.getElementById('admin-chats-conversations-list');
    if (admList) admList.innerHTML = '';
}

// Открыть чат из уведомления
async function openChatFromNotification(notificationId) {
    try {
        console.log('[CHAT-NOTIFICATION] Открываем чат из уведомления:', notificationId);

        // Сначала получим уведомление, чтобы узнать ID покупки
        const notificationsResponse = await fetch(`${API_URL}/notifications/${currentUser.id}`, { headers: authBearerHeaders() });
        const notifications = await notificationsResponse.json();
        const notification = notifications.find(n => n.id === notificationId);

        if (!notification) {
            showToast('Ошибка', 'Уведомление не найдено', 'error');
            return;
        }

        console.log('[CHAT-NOTIFICATION] Найдено уведомление:', notification);

        // Извлекаем ID покупки из сообщения уведомления
        // Сообщение формата: "Ваш товар test куплен за 1 ₽" или "Вашу работу "test" купили!"
        let purchaseId = null;
        let counterpartName = null;
        let title = null;

        // Получаем все покупки где пользователь продавец
        const salesResponse = await fetch(`${API_URL}/users/${currentUser.id}/sales`, { headers: authBearerHeaders() });
        const sales = await salesResponse.json();
        console.log('[CHAT-NOTIFICATION] Продажи:', sales);

        // Ищем последнюю активную продажу
        const sale = sales.find(s => s.status === 'active');

        if (sale) {
            // Мы продавец - открываем чат с покупателем
            purchaseId = sale.id;
            title = sale.title;
            const buyerResponse = await fetch(`${API_URL}/users/${sale.buyerId}`, { headers: authBearerHeaders() });
            const buyer = await buyerResponse.json();
            counterpartName = buyer.name || 'Покупатель';
        } else {
            // Если не нашли активных продаж
            console.log('[CHAT-NOTIFICATION] Нет активных продаж');
            document.querySelectorAll('.cabinet-tab').forEach(tab => tab.classList.remove('active'));
            document.querySelector('[data-cabinet-tab="chats"]').classList.add('active');
            document.querySelectorAll('.cabinet-section').forEach(section => section.classList.remove('active'));
            document.getElementById('cabinet-chats').classList.add('active');
            return;
        }

        console.log('[CHAT-NOTIFICATION] Открываем чат:', purchaseId, counterpartName, title);

        // Переходим на вкладку чатов
        document.querySelectorAll('.cabinet-tab').forEach(tab => tab.classList.remove('active'));
        document.querySelector('[data-cabinet-tab="chats"]').classList.add('active');

        document.querySelectorAll('.cabinet-section').forEach(section => section.classList.remove('active'));
        document.getElementById('cabinet-chats').classList.add('active');

        // Открываем чат
        await openChat(purchaseId, counterpartName, title);
    } catch (error) {
        console.error('[CHAT-NOTIFICATION] Ошибка:', error);
        showToast('Ошибка', 'Не удалось открыть чат: ' + error.message, 'error');
    }
}

// Открыть чат из раздела "Мои продажи"
async function openChatFromSale(purchaseId, buyerId, sellerId, title) {
    try {
        // Определяем имя собеседника (покупателя)
        const buyerResponse = await fetch(`${API_URL}/users/${buyerId}`, { headers: authBearerHeaders() });
        const buyer = await buyerResponse.json();
        const counterpartName = buyer.name || 'Покупатель';
        
        // Переходим на вкладку чатов
        document.querySelectorAll('.cabinet-tab').forEach(tab => tab.classList.remove('active'));
        document.querySelector('[data-cabinet-tab="chats"]').classList.add('active');
        
        document.querySelectorAll('.cabinet-section').forEach(section => section.classList.remove('active'));
        document.getElementById('cabinet-chats').classList.add('active');
        
        // Открываем чат
        await openChat(purchaseId, counterpartName, title);
    } catch (error) {
        console.error('Ошибка открытия чата из продаж:', error);
        showToast('Ошибка', 'Не удалось открыть чат', 'error');
    }
}

// Отправка сообщения
async function sendMessage() {
    const messageInput = document.getElementById('chat-message-input');
    const message = messageInput.value.trim();

    if (!message && !selectedFileForChat) {
        showToast('Ошибка', 'Введите сообщение или прикрепите файл', 'error');
        return;
    }

    try {
        // Получаем информацию о покупке для определения получателя
        const purchasesResponse = await fetch(`${API_URL}/users/${currentUser.id}/purchases`, { headers: authBearerHeaders() });
        const purchases = await purchasesResponse.json();
        const purchase = purchases.find(p => p.id === currentChatPurchaseId);
        
        let receiverId;
        if (purchase) {
            receiverId = purchase.sellerId;
        } else {
            const salesResponse = await fetch(`${API_URL}/users/${currentUser.id}/sales`, { headers: authBearerHeaders() });
            const sales = await salesResponse.json();
            const sale = sales.find(s => s.id === currentChatPurchaseId);
            receiverId = sale ? sale.buyerId : null;
        }

        if (!receiverId) {
            showToast('Ошибка', 'Не удалось определить получателя', 'error');
            return;
        }

        const payload = {
            purchaseId: currentChatPurchaseId,
            senderId: currentUser.id,
            receiverId: receiverId,
            message: message || null
        };

        if (selectedFileForChat) {
            payload.fileName = selectedFileForChat.name;
            payload.fileData = selectedFileForChat.data;
            payload.fileType = selectedFileForChat.type;
        }

        await fetch(`${API_URL}/chat`, {
            method: 'POST',
            headers: authJsonHeaders(),
            body: JSON.stringify(payload)
        });

        messageInput.value = '';
        selectedFileForChat = null;
        updateFilePreview();
        await loadChatMessages();
    } catch (error) {
        showToast('Ошибка', 'Ошибка отправки сообщения', 'error');
        console.error(error);
    }
}

// Обработка нажатия Enter в чате
function handleChatKeyPress(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        sendMessage();
    }
}

// Выбор файла для чата
function handleChatFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let effectiveType = file.type;
    if (!effectiveType || effectiveType === 'application/octet-stream') {
        if (ext === 'png') effectiveType = 'image/png';
        else if (ext === 'jpg' || ext === 'jpeg') effectiveType = 'image/jpeg';
        else if (ext === 'pdf') effectiveType = 'application/pdf';
        else if (ext === 'doc') effectiveType = 'application/msword';
        else if (ext === 'docx') {
            effectiveType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        }
    }

    // Проверка типа файла
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg', 'image/jpg'];
    if (!allowedTypes.includes(effectiveType)) {
        showToast('Ошибка', 'Разрешены только файлы: PDF, DOC, DOCX, PNG, JPG', 'error');
        event.target.value = '';
        return;
    }

    // Проверка размера (макс 10MB)
    if (file.size > 10 * 1024 * 1024) {
        showToast('Ошибка', 'Размер файла не должен превышать 10MB', 'error');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        selectedFileForChat = {
            name: file.name,
            data: e.target.result.split(',')[1],
            type: normalizeChatFileMime(effectiveType) || effectiveType
        };
        updateFilePreview();
    };
    reader.readAsDataURL(file);
}

// Обновление превью файла
function updateFilePreview() {
    const preview = document.getElementById('attached-file-preview');
    if (selectedFileForChat) {
        preview.style.display = 'flex';
        preview.innerHTML = `
            <span>📎 Прикреплён файл: ${escapeHTML(selectedFileForChat.name)}</span>
            <button data-action="clear-selected-file">×</button>
        `;
    } else {
        preview.style.display = 'none';
    }
}

// Очистить выбранный файл
function clearSelectedFile() {
    selectedFileForChat = null;
    document.getElementById('chat-file-input').value = '';
    updateFilePreview();
}

// Иконка файла
function getFileIcon(fileType) {
    if (!fileType) return '📎';
    if (fileType.includes('pdf')) return '📄';
    if (fileType.includes('word')) return '📝';
    if (fileType.includes('image')) return '🖼️';
    return '📎';
}

// ==================== УВЕДОМЛЕНИЯ ====================

let notificationInterval = null;

// Загрузка уведомлений
async function loadNotifications() {
    if (!currentUser) return;

    try {
        const response = await fetch(`${API_URL}/notifications/${currentUser.id}`, { headers: authBearerHeaders() });

        // Обработка ошибки 400/404
        if (!response.ok) {
            if (response.status === 400 || response.status === 404) {
                // Пользователь не найден или некорректный ID
                console.log('Уведомления не загружены: пользователь не найден');
                return;
            }
            throw new Error(`HTTP error: ${response.status}`);
        }

        const notifications = await response.json();

        // Проверка что notifications это массив
        if (!Array.isArray(notifications)) {
            console.error('notifications не является массивом:', notifications);
            return;
        }

        const notificationsList = document.getElementById('notifications-list');
        const notificationBadge = document.getElementById('notification-badge');

        if (notifications.length === 0) {
            notificationsList.innerHTML = '<p class="no-notifications">Нет уведомлений</p>';
            notificationBadge.style.display = 'none';
            return;
        }

        // Считаем непрочитанные
        const unreadCount = notifications.filter(n => !n.isRead).length;
        if (unreadCount > 0) {
            notificationBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
            notificationBadge.style.display = 'flex';
        } else {
            notificationBadge.style.display = 'none';
        }

        // Функция декодирования HTML-сущностей
        function decodeHTML(str) {
            if (!str) return str;
            const map = {
                '&amp;': '&',
                '&lt;': '<',
                '&gt;': '>',
                '&quot;': '"',
                '&#x27;': "'",
                '&#x2F;': '/'
            };
            let result = String(str);
            for (const [encoded, decoded] of Object.entries(map)) {
                result = result.replace(new RegExp(encoded, 'g'), decoded);
            }
            return result;
        }

        notificationsList.innerHTML = '';
        notifications.slice(0, 10).forEach(notification => {
            const item = document.createElement('div');
            item.className = `notification-item ${notification.isRead ? 'read' : 'unread'}`;

            // Декодируем HTML-сущности для корректного отображения
            const decodedTitle = decodeHTML(notification.title);
            const decodedMessage = decodeHTML(notification.message);

            // БЕЗОПАСНОСТЬ: Используем textContent для предотвращения XSS
            const titleEl = document.createElement('div');
            titleEl.className = 'notification-title';
            titleEl.textContent = decodedTitle;

            const messageEl = document.createElement('div');
            messageEl.className = 'notification-message';
            messageEl.textContent = decodedMessage;

            const timeEl = document.createElement('div');
            timeEl.className = 'notification-time';
            timeEl.textContent = formatMoscowTime(notification.createdAt);

            item.appendChild(titleEl);
            item.appendChild(messageEl);
            item.appendChild(timeEl);

            // Добавляем кнопку "Перейти к обсуждению" для уведомлений о покупках
            if (notification.type === 'purchase') {
                const actionBtn = document.createElement('button');
                actionBtn.className = 'notification-action-btn';
                actionBtn.textContent = '💬 Перейти к обсуждению';
                actionBtn.dataset.action = 'open-chat-from-notification';
                actionBtn.dataset.notificationId = notification.id;
                item.appendChild(actionBtn);
            }

            if (!notification.isRead) {
                item.dataset.action = 'mark-notification-read';
                item.dataset.notificationId = notification.id;
            }
            notificationsList.appendChild(item);
        });
    } catch (error) {
        console.error('Ошибка загрузки уведомлений:', error.message);
    }
}

// Показать/скрыть уведомления
function toggleNotifications() {
    const dropdown = document.getElementById('notifications-dropdown');
    if (dropdown.style.display === 'none') {
        dropdown.style.display = 'block';
        loadNotifications();
    } else {
        dropdown.style.display = 'none';
    }
}

// Отметить уведомление прочитанным
async function markNotificationRead(notificationId) {
    try {
        await fetch(`${API_URL}/notifications/${notificationId}/read`, {
            method: 'PATCH',
            headers: authBearerHeaders()
        });
        loadNotifications();
    } catch (error) {
        console.error('Ошибка отметки уведомления:', error);
    }
}

// Отметить все уведомления прочитанными
async function markAllNotificationsRead() {
    if (!currentUser) return;

    try {
        const response = await fetch(`${API_URL}/notifications/${currentUser.id}`, { headers: authBearerHeaders() });
        const notifications = await response.json();

        for (const notification of notifications) {
            if (!notification.isRead) {
                await fetch(`${API_URL}/notifications/${notification.id}/read`, {
                    method: 'PATCH',
                    headers: authBearerHeaders()
                });
            }
        }
        loadNotifications();
    } catch (error) {
        console.error('Ошибка отметки уведомлений:', error);
    }
}

// ==================== EVENT DELEGATION (CSP-safe) ====================

function setupEventListeners() {
    // Обработчик кликов по всему документу
    document.addEventListener('click', function(event) {
        const target = event.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;

        switch (action) {
            case 'open-modal':
                openModal(target.dataset.modal);
                break;
            case 'toggle-notifications':
                toggleNotifications();
                break;
            case 'open-cabinet':
                openCabinet();
                break;
            case 'open-admin':
                openAdminPanel();
                break;
            case 'admin-chats-refresh':
                loadAdminChatConversations();
                break;
            case 'open-support-modal':
                openSupportModal();
                break;
            case 'close-support-modal':
                closeSupportModal();
                break;
            case 'admin-support-refresh':
                loadAdminSupportStaffUI();
                break;
            case 'admin-support-send':
                sendAdminSupportReply();
                break;
            case 'admin-support-close':
                closeAdminSupportTicket();
                break;
            case 'logout':
                logout();
                break;
            case 'mark-all-notifications-read':
                markAllNotificationsRead();
                break;
            case 'close-chat-window':
                closeChatWindow();
                break;
            case 'trigger-chat-file':
                document.getElementById('chat-file-input').click();
                break;
            case 'send-message':
                sendMessage();
                break;
            case 'back-from-seller':
                backFromSeller();
                break;
            case 'close-modal':
                closeModal();
                break;
            case 'register':
                openModal('register');
                break;
            case 'vk-login':
                loginWithVK();
                break;
            case 'close-upload-modal':
                closeUploadModal();
                break;
            case 'upload-work-file':
                uploadWorkFile();
                break;
            case 'contact-seller-from-modal':
                contactSellerFromModal();
                break;
            case 'close-review-modal':
                closeReviewModal();
                break;
            case 'submit-review':
                submitReview();
                break;
            case 'close-purchase-confirm-modal':
                closePurchaseConfirmModal();
                break;
            case 'confirm-purchase':
                confirmPurchase();
                break;
            case 'wallet-topup':
                walletTopup();
                break;
            case 'wallet-withdraw':
                walletWithdrawSbp();
                break;
            case 'confirm-purchase-completion':
                confirmPurchaseCompletion(parseInt(target.dataset.purchaseId, 10));
                break;
            case 'contact-seller-from-confirm':
                contactSellerFromConfirm();
                break;
            case 'close-toast':
                const toast = target.closest('.toast');
                if (toast) toast.remove();
                break;
            case 'clear-selected-file':
                clearSelectedFile();
                break;
            case 'mark-notification-read':
                markNotificationRead(target.dataset.notificationId);
                break;
            case 'open-chat-from-notification':
                openChatFromNotification(parseInt(target.dataset.notificationId));
                break;
            case 'view-purchase-file':
                viewPurchaseFile(parseInt(target.dataset.purchaseId));
                break;
            case 'open-review-modal':
                openReviewModal(
                    parseInt(target.dataset.purchaseId),
                    target.dataset.sellerId,
                    target.dataset.productTitle
                );
                break;
            case 'open-upload-modal':
                openUploadModal(
                    parseInt(target.dataset.saleId),
                    target.dataset.buyerId,
                    target.dataset.sellerId
                );
                break;
            case 'open-chat':
                openChat(
                    parseInt(target.dataset.chatId),
                    target.dataset.counterpartName,
                    target.dataset.chatTitle
                );
                break;
            case 'open-chat-from-sale':
                openChatFromSale(
                    parseInt(target.dataset.purchaseId),
                    target.dataset.buyerId,
                    target.dataset.sellerId,
                    target.dataset.title
                );
                break;
        }
    });

    // Обработчик для вкладок
    document.addEventListener('click', function(event) {
        const tabBtn = event.target.closest('[data-tab]');
        if (tabBtn) {
            openTab(tabBtn.dataset.tab);
            return;
        }

        const cabinetTab = event.target.closest('[data-cabinet-tab]');
        if (cabinetTab) {
            switchCabinetTab(cabinetTab.dataset.cabinetTab);
            return;
        }

        const adminTab = event.target.closest('[data-admin-tab]');
        if (adminTab) {
            switchAdminTab(adminTab.dataset.adminTab);
            return;
        }
    });

    // Обработчик изменений (select)
    document.addEventListener('change', function(event) {
        const filter = event.target.closest('[data-filter]');
        if (filter) {
            const category = filter.dataset.filter;
            const value = filter.value;
            if (category === 'custom') {
                filterCustomRequests();
            } else {
                filterProducts(category);
            }
            return;
        }

        // Обработчик изменения фильтра по университету
        const universityFilter = event.target.closest('[data-filter-university]');
        if (universityFilter) {
            const category = universityFilter.dataset.filterUniversity;
            filterProducts(category);
            return;
        }

        // Обработчик изменения фильтра по преподавателю
        const teacherFilter = event.target.closest('[data-filter-teacher]');
        if (teacherFilter) {
            const category = teacherFilter.dataset.filterTeacher;
            filterProducts(category);
            return;
        }

        const toggleType = event.target.closest('[data-toggle-product-type]');
        if (toggleType) {
            toggleProductType();
        }

        const chatFileInput = event.target.closest('#chat-file-input');
        if (chatFileInput) {
            handleChatFileSelect(event);
        }
    });

    // Обработчик ввода в поиск
    document.addEventListener('input', function(event) {
        const searchInput = event.target.closest('[data-filter-search]');
        if (searchInput) {
            const category = searchInput.dataset.filterSearch;
            filterProducts(category);
            return;
        }
    });

    // Обработчик клавиш (Enter в поле чата)
    document.addEventListener('keypress', function(event) {
        if (event.target.id === 'chat-message-input' && event.key === 'Enter') {
            event.preventDefault();
            handleChatKeyPress(event);
        }
    });

    // Обработчик фокуса на поле ввода (для мобильных)
    document.addEventListener('focus', function(event) {
        if (event.target.id === 'chat-message-input') {
            // Прокрутка к полю ввода при фокусе на мобильных
            setTimeout(() => {
                event.target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 300);
        }
    }, true);

    const authModalEl = document.getElementById('auth-modal');
    if (authModalEl) {
        authModalEl.addEventListener(
            'pointerdown',
            (event) => {
                if (!authModalEl.classList.contains('active')) return;
                authModalCloseFromBackdrop = event.target === authModalEl;
            },
            true
        );
    }

    // Закрытие модалки только при полноценном клике по фону (не при отпускании кнопки после выделения из формы)
    document.addEventListener('click', function(event) {
        const authModal = document.getElementById('auth-modal');
        if (authModal && authModal.classList.contains('active')) {
            if (event.target === authModal && authModalCloseFromBackdrop) {
                closeModal();
            }
        }
        authModalCloseFromBackdrop = false;
    });

    // Закрытие уведомлений при клике вне
    document.addEventListener('click', function(event) {
        const dropdown = document.getElementById('notifications-dropdown');
        const button = document.getElementById('btn-notifications');

        if (dropdown && !dropdown.contains(event.target) && !button.contains(event.target)) {
            dropdown.style.display = 'none';
        }
    });

    // Форма добавления товара удалена — дублирует обработчик на строке 800
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('StudentMarket загружен');

    document.getElementById('wallet-topup-net')?.addEventListener('input', updateWalletTopupPreview);

    document.getElementById('support-ticket-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) {
            showToast('Ошибка', 'Войдите в аккаунт', 'error');
            return;
        }
        const subject = document.getElementById('support-subject')?.value.trim() || '';
        const category = document.getElementById('support-category')?.value || 'other';
        const message = document.getElementById('support-message')?.value.trim() || '';
        if (!subject || !message) {
            showToast('Ошибка', 'Заполните тему и текст обращения', 'error');
            return;
        }
        try {
            const r = await fetch(`${API_URL}/support/tickets`, {
                method: 'POST',
                headers: authJsonHeaders(),
                body: JSON.stringify({ subject, category, message })
            });
            const data = await r.json();
            if (!r.ok) {
                showToast('Ошибка', data.error || 'Не удалось отправить', 'error');
                return;
            }
            showToast('Успешно', 'Обращение отправлено', 'success');
            document.getElementById('support-subject').value = '';
            document.getElementById('support-message').value = '';
            loadMySupportTicketsIntoModal();
        } catch {
            showToast('Ошибка', 'Сеть', 'error');
        }
    });

    // Проверяем VK OAuth callback
    if (window.location.pathname === '/auth/vk/callback') {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        if (code) {
            window.opener.postMessage({ type: 'vk_auth_code', code }, window.location.origin);
            window.close();
            return;
        }
    }

    // Восстанавливаем сессию
    const savedUser = sessionStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
    }

    await syncCurrentUserFromServer();
    checkAuth();
    initAllPageCustomSelects();
    initAllFilterComboboxes();

    renderProducts('practices', 'all', 'all', 'all', '');
    renderProducts('labs', 'all', 'all', 'all', '');
    renderProducts('courses', 'all', 'all', 'all', '');
    renderCustomRequests('all');

    // Настраиваем event listeners (CSP-safe)
    setupEventListeners();

    // ==================== АВТОРИЗАЦИЯ: ПЕРЕКЛЮЧЕНИЕ ВХОД/РЕГИСТРАЦИЯ ====================

    // Переключение вход/регистрация
    const loginBtn = document.getElementById('login-btn');
    const registerBtn = document.getElementById('register-btn');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            loginBtn.classList.add('active');
            loginBtn.style.background = 'var(--primary-blue)';
            loginBtn.style.color = 'white';
            registerBtn.classList.remove('active');
            registerBtn.style.background = 'var(--border-color)';
            registerBtn.style.color = 'var(--text-main)';
            loginForm.style.display = 'block';
            registerForm.style.display = 'none';
        });
    }

    if (registerBtn) {
        registerBtn.addEventListener('click', () => {
            registerBtn.classList.add('active');
            registerBtn.style.background = 'var(--primary-blue)';
            registerBtn.style.color = 'white';
            loginBtn.classList.remove('active');
            loginBtn.style.background = 'var(--border-color)';
            loginBtn.style.color = 'var(--text-main)';
            loginForm.style.display = 'none';
            registerForm.style.display = 'block';
        });
    }

    // Обработка формы входа
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const login = document.getElementById('login-login').value;
            const password = document.getElementById('login-password').value;
            const errorEl = document.getElementById('login-error-message');

            // Скрыть предыдущую ошибку
            errorEl.style.display = 'none';
            errorEl.textContent = '';

            if (!login || !password) {
                errorEl.textContent = 'Заполните все поля!';
                errorEl.style.display = 'block';
                return;
            }

            try {
                const response = await fetch(`${API_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ login, password })
                });

                const data = await response.json();

                if (!response.ok) {
                    errorEl.textContent = data.error || 'Неверный логин/email или пароль';
                    errorEl.style.display = 'block';
                    return;
                }

                // Сохраняем сессию
                clearChatStateForSessionChange();
                currentUser = data;
                sessionStorage.setItem('currentUser', JSON.stringify(data));

                // Очистка формы
                loginForm.reset();
                errorEl.style.display = 'none';

                closeModal();
                checkAuth();
                showToast('Успешно', `Добро пожаловать, ${data.name}!`, 'success');
            } catch (error) {
                errorEl.textContent = 'Ошибка подключения к серверу. Проверьте соединение.';
                errorEl.style.display = 'block';
                console.error('[LOGIN] Ошибка:', error);
            }
        });
    }

    // Обработка формы регистрации
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('register-name').value;
            const login = document.getElementById('register-login').value;
            const password = document.getElementById('register-password').value;
            const consents = getRegistrationConsents();

            if (!name || !login || !password) {
                showToast('Ошибка', 'Заполните все поля!', 'error');
                return;
            }

            // Проверка логина (только латиница, цифры, _)
            const loginRegex = /^[a-zA-Z0-9_]+$/;
            if (!loginRegex.test(login)) {
                showToast('Ошибка', 'Логин: только латинские буквы, цифры и _', 'error');
                return;
            }

            // Проверка длины логина
            if (login.length < 3 || login.length > 20) {
                showToast('Ошибка', 'Логин: от 3 до 20 символов', 'error');
                return;
            }

            // Проверка длины пароля
            if (password.length < 6) {
                showToast('Ошибка', 'Пароль должен быть не менее 6 символов', 'error');
                return;
            }

            if (!hasAllRegistrationConsents(consents)) {
                showToast('Ошибка', 'Для регистрации необходимо принять оферту, соглашение и дать согласие на обработку ПДн', 'error');
                return;
            }

            try {
                const response = await fetch(`${API_URL}/auth/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, login, password, consents })
                });

                const data = await response.json();

                if (!response.ok) {
                    showToast('Ошибка', data.error || 'Ошибка регистрации', 'error');
                    return;
                }

                // Сохраняем сессию
                clearChatStateForSessionChange();
                currentUser = data;
                sessionStorage.setItem('currentUser', JSON.stringify(data));

                // Очистка формы
                registerForm.reset();

                closeModal();
                checkAuth();
                showToast('Успешно', `Регистрация успешна! Добро пожаловать, ${data.name}!`, 'success');
            } catch (error) {
                showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
                console.error('[REGISTER] Ошибка:', error);
            }
        });
    }

    // ==================== COOKIES ДЛЯ ФОРМ ====================

    // Функция установки cookie
    function setCookie(name, value, days) {
        const expires = new Date(Date.now() + days * 864e5).toUTCString();
        document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/; SameSite=Lax';
    }

    // Функция получения cookie
    function getCookie(name) {
        return document.cookie.split('; ').reduce((r, v) => {
            const parts = v.split('=');
            return parts[0] === name ? decodeURIComponent(parts[1]) : r;
        }, '');
    }

    // Сохранение данных формы индивидуального запроса
    const customFields = ['custom-title', 'custom-university', 'custom-teacher', 'custom-description', 'custom-budget', 'custom-deadline'];
    customFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (!field) return;

        // Восстановление данных из cookie при загрузке
        const savedValue = getCookie(fieldId);
        if (savedValue) {
            field.value = savedValue;
        }

        // Сохранение данных в cookie при изменении
        field.addEventListener('input', () => {
            setCookie(fieldId, field.value, 30); // 30 дней
        });
        field.addEventListener('change', () => {
            setCookie(fieldId, field.value, 30);
        });
    });

    // Сохранение данных формы готового товара
    const productFields = ['product-title', 'product-university', 'product-teacher', 'product-price'];
    productFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (!field) return;

        // Восстановление данных из cookie при загрузке
        const savedValue = getCookie(fieldId);
        if (savedValue) {
            field.value = savedValue;
        }

        // Сохранение данных в cookie при изменении
        field.addEventListener('input', () => {
            setCookie(fieldId, field.value, 30);
        });
        field.addEventListener('change', () => {
            setCookie(fieldId, field.value, 30);
        });
    });

    // ==================== ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ ====================

    // Открытие модального окна политики конфиденциальности
    function openPrivacyPolicy() {
        const modal = document.getElementById('privacy-policy-modal');
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    }

    // Закрытие модального окна политики конфиденциальности
    function closePrivacyPolicy() {
        const modal = document.getElementById('privacy-policy-modal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = '';
        }
    }

    // Глобальные функции для обработки событий
    window.openPrivacyPolicy = openPrivacyPolicy;
    window.closePrivacyPolicy = closePrivacyPolicy;

    // Обработчик клика на кнопку политики конфиденциальности в футере
    document.addEventListener('click', function(event) {
        const privacyBtn = event.target.closest('[data-action="open-privacy-policy"]');
        if (privacyBtn) {
            event.preventDefault();
            openPrivacyPolicy();
            return;
        }

        const closePrivacyBtn = event.target.closest('[data-action="close-privacy-policy"]');
        if (closePrivacyBtn) {
            event.preventDefault();
            closePrivacyPolicy();
            return;
        }

        // Открытие политики конфиденциальности из формы регистрации
        const privacyFromRegister = event.target.closest('[data-action="open-privacy-policy-from-register"]');
        if (privacyFromRegister) {
            event.preventDefault();
            openPrivacyPolicy();
            return;
        }
    });

    // Закрытие модального окна при клике на фон
    document.addEventListener('click', function(event) {
        const privacyModal = document.getElementById('privacy-policy-modal');
        if (event.target === privacyModal) {
            closePrivacyPolicy();
        }
    });

    // Закрытие по Escape
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            const privacyModal = document.getElementById('privacy-policy-modal');
            if (privacyModal && privacyModal.style.display === 'flex') {
                closePrivacyPolicy();
            }
        }
    });
});
