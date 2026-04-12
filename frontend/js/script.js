// --- JAVASCRIPT ЛОГИКА ---

// Автоматическое определение API_URL
const API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000/api'
    : '/api';

// Текущий пользователь (хранится в sessionStorage)
let currentUser = null;

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
        if (balanceEl) balanceEl.textContent = currentUser.balance || 10000;

        if (currentUser.isAdmin) {
            btnAdmin.style.display = 'block';
        } else {
            btnAdmin.style.display = 'none';
        }

        // Показываем аватар если есть
        if (currentUser.photoUrl) {
            if (userName) {
                userName.innerHTML = `<img src="${currentUser.photoUrl}" style="width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-right:8px;">${currentUser.name}`;
            }
        }

        // Загружаем уведомления
        loadNotifications();

        // Автообновление уведомлений каждые 5 секунд
        if (notificationInterval) clearInterval(notificationInterval);
        notificationInterval = setInterval(loadNotifications, 5000);
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

    try {
        const response = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, login: loginValue, password })
        });

        const data = await response.json();

        if (!response.ok) {
            showAuthError(errorEl, data.error || 'Ошибка регистрации');
            return;
        }

        // Сохраняем сессию
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
    const modal = document.getElementById('auth-modal');
    modal.classList.remove('active');
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
        customFields.style.display = 'block';
        btnSubmit.textContent = 'Создать запрос';
    } else {
        productFields.style.display = 'block';
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
        renderProducts(tabName, 'all');
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

    document.getElementById('admin-panel').classList.add('active');
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
    
    // Находим кнопку и добавляем active
    const buttons = document.querySelectorAll('.admin-tab');
    buttons.forEach(btn => {
        if ((type === 'moderation' && btn.textContent.includes('Модерация')) ||
            (type === 'custom' && btn.textContent.includes('Индивид')) ||
            (type === 'users' && btn.textContent.includes('Пользователи'))) {
            btn.classList.add('active');
        }
    });
    
    loadAdminData();
}

// ==================== ТОВАРЫ ====================

// Отрисовка товаров
async function renderProducts(category, filterDiscipline) {
    const grid = document.getElementById(`grid-${category}`);
    if (!grid) return;

    grid.innerHTML = '';

    try {
        const response = await fetch(`${API_URL}/products`);
        const products = await response.json();

        const items = products.filter(p => p.category === category);

        if (items.length === 0) {
            grid.innerHTML = '<p style="color: var(--text-secondary);">Нет товаров в этой категории</p>';
            return;
        }

        items.forEach(item => {
            if (filterDiscipline !== 'all' && item.discipline !== filterDiscipline) {
                return;
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
            
            card.appendChild(contentDiv);
            card.appendChild(footer);
            grid.appendChild(card);
        });
    } catch (error) {
        console.error('Ошибка загрузки товаров:', error);
        grid.innerHTML = '<p style="color: var(--text-secondary);">Ошибка загрузки товаров</p>';
    }
}

// Фильтрация
function filterProducts(category) {
    const select = document.getElementById(`select-${category}`);
    const value = select.value;
    renderProducts(category, value);
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

    // Загружаем товары продавца
    try {
        const productsResponse = await fetch(`${API_URL}/products`);
        const products = await productsResponse.json();
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

        // Загружаем данные продавца (рейтинг)
        const userResponse = await fetch(`${API_URL}/users/${sellerId}`);
        const user = await userResponse.json();

        // Загружаем количество продаж
        const salesResponse = await fetch(`${API_URL}/users/${sellerId}/sales`);
        const sales = await salesResponse.json();

        // Вычисляем рейтинг из отзывов
        const avgRating = reviews.length > 0
            ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
            : '--';

        const ratingEl = document.getElementById('seller-page-rating');
        ratingEl.innerHTML = `Рейтинг: <strong>${escapeHTML(avgRating)} ⭐</strong> | Продано работ: <strong>${sales.length}</strong> | Товаров на сайте: <strong>${sellerProducts.length}</strong>`;

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
        const description = document.getElementById('custom-description').value;
        const budget = parseInt(document.getElementById('custom-budget').value);
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

                await submitCustomRequest(title, description, budget, fileName, fileData);
            };

            reader.readAsDataURL(file);
        } else {
            await submitCustomRequest(title, description, budget, null, null);
        }
    } else {
        // Создание готового товара
        const title = document.getElementById('product-title').value;
        const category = document.getElementById('product-category').value;
        const discipline = document.getElementById('product-discipline').value;
        const price = parseInt(document.getElementById('product-price').value);
        const deadlineDays = parseInt(document.getElementById('product-deadline').value);

        if (!title || !category || !discipline || !price) {
            showToast('Ошибка', 'Заполните все поля!', 'error');
            return;
        }

        // Вычисляем дату дедлайна
        const deadlineDate = new Date();
        deadlineDate.setDate(deadlineDate.getDate() + deadlineDays);
        const deadline = deadlineDate.toISOString();

        try {
            const response = await fetch(`${API_URL}/products`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title,
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

            showToast('Информация', 'Товар отправлен на модерацию! Администратор проверит его в ближайшее время.', 'info');
            loadProductsData();
        } catch (error) {
            showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
            console.error(error);
        }
    }
});

// Функция отправки индивидуального запроса
async function submitCustomRequest(title, description, budget, fileName, fileData) {
    try {
        const response = await fetch(`${API_URL}/custom-requests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                description,
                budget,
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
        document.getElementById('custom-description').value = '';
        document.getElementById('custom-budget').value = '';
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
            method: 'DELETE'
        });

        if (!response.ok) {
            showToast('Ошибка', 'Ошибка удаления товара', 'error');
            return;
        }

        showToast('Успешно', 'Товар удалён', 'success');
        loadCabinetData();
        renderProducts('practices', 'all');
        renderProducts('labs', 'all');
        renderProducts('courses', 'all');
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
        const userResponse = await fetch(`${API_URL}/users/${currentUser.id}`);
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
        // Обновляем баланс
        const newBalance = userBalance - productPrice;
        const updateBalanceResponse = await fetch(`${API_URL}/users/${currentUser.id}/balance`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ balance: newBalance })
        });

        const updatedUser = await updateBalanceResponse.json();
        currentUser = updatedUser;
        sessionStorage.setItem('currentUser', JSON.stringify(updatedUser));

        // Создаём покупку
        const purchaseResponse = await fetch(`${API_URL}/purchases`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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

        // Создаём чат для покупки
        await fetch(`${API_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
            headers: { 'Content-Type': 'application/json' },
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

async function loadCabinetData() {
    if (!currentUser) return;

    try {
        // Получаем актуальные данные пользователя
        const userResponse = await fetch(`${API_URL}/users/${currentUser.id}`);
        const user = await userResponse.json();
        document.getElementById('user-balance').textContent = user.balance || 10000;

        // Загружаем покупки (для заказчика)
        const purchasesResponse = await fetch(`${API_URL}/users/${currentUser.id}/purchases`);
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
                actionsDiv.innerHTML = fileAction + reviewBtn;
                
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
    } catch (error) {
        console.error('Ошибка загрузки данных кабинета:', error);
    }
}

// Загрузка данных о продажах
async function loadSalesData() {
    if (!currentUser) return;

    try {
        console.log('[SALES] Загрузка продаж для пользователя:', currentUser.id);
        // Загружаем продажи (для продавца)
        const salesResponse = await fetch(`${API_URL}/users/${currentUser.id}/sales`);
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
        const productsResponse = await fetch(`${API_URL}/users/${currentUser.id}/products`);
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

async function loadAdminData() {
    if (!currentUser || !currentUser.isAdmin) return;

    try {
        // Загружаем ВСЕ товары (включая pending)
        const productsResponse = await fetch(`${API_URL}/products/all`);
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
                
                const metaEl = document.createElement('span');
                metaEl.className = 'meta';
                metaEl.textContent = `${product.discipline} • ${product.price} ₽ • Продавец: ${product.sellerName}`;
                
                infoDiv.appendChild(titleEl);
                infoDiv.appendChild(metaEl);
                
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
                
                const metaEl = document.createElement('span');
                metaEl.className = 'meta';
                metaEl.textContent = `${product.discipline} • ${product.price} ₽ • Продавец: ${product.sellerName}`;
                
                infoDiv.appendChild(titleEl);
                infoDiv.appendChild(metaEl);
                
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
        const requestsResponse = await fetch(`${API_URL}/custom-requests/all`);
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
        const usersResponse = await fetch(`${API_URL}/users`);
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
            method: 'PATCH'
        });

        if (!response.ok) {
            showToast('Ошибка', 'Ошибка одобрения товара', 'error');
            return;
        }

        showToast('Успешно', 'Товар одобрен', 'success');
        loadAdminData();
        renderProducts('practices', 'all');
        renderProducts('labs', 'all');
        renderProducts('courses', 'all');
    } catch (error) {
        showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
        console.error(error);
    }
}

// Отклонение товара
async function rejectProduct(productId) {
    try {
        const response = await fetch(`${API_URL}/products/${productId}/reject`, {
            method: 'PATCH'
        });

        if (!response.ok) {
            showToast('Ошибка', 'Ошибка отклонения товара', 'error');
            return;
        }

        showToast('Информация', 'Товар отклонён', 'info');
        loadAdminData();
        renderProducts('practices', 'all');
        renderProducts('labs', 'all');
        renderProducts('courses', 'all');
    } catch (error) {
        showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
        console.error(error);
    }
}

// Одобрение индивидуального запроса
async function approveCustomRequest(requestId) {
    try {
        const response = await fetch(`${API_URL}/custom-requests/${requestId}/approve`, {
            method: 'PATCH'
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
            method: 'PATCH'
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

// Блокировка пользователя
async function blockUser(userId) {
    try {
        const response = await fetch(`${API_URL}/users/${userId}/block`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
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

// Разблокировка пользователя
async function unblockUser(userId) {
    try {
        const response = await fetch(`${API_URL}/users/${userId}/block`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
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
        const buyerResponse = await fetch(`${API_URL}/users/${buyerId}`);
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
                headers: { 'Content-Type': 'application/json' },
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
        const response = await fetch(`${API_URL}/purchases/${purchaseId}/file`);

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
            headers: { 'Content-Type': 'application/json' },
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

// Загрузка списка чатов
async function loadChatsList() {
    if (!currentUser) return;

    try {
        // Загружаем все покупки и продажи пользователя
        const purchasesResponse = await fetch(`${API_URL}/users/${currentUser.id}/purchases`);
        const purchases = await purchasesResponse.json();
        
        const salesResponse = await fetch(`${API_URL}/users/${currentUser.id}/sales`);
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
    
    // Автообновление каждые 3 секунды
    if (currentChatInterval) clearInterval(currentChatInterval);
    currentChatInterval = setInterval(loadChatMessages, 3000);
}

// Загрузка сообщений чата
async function loadChatMessages() {
    if (!currentChatPurchaseId) return;

    try {
        const response = await fetch(`${API_URL}/chat/${currentChatPurchaseId}`);
        const messages = await response.json();

        const messagesContainer = document.getElementById('chat-messages');
        messagesContainer.innerHTML = '';

        messages.forEach(msg => {
            const messageDiv = document.createElement('div');
            const isSent = msg.senderId === currentUser.id;
            messageDiv.className = `chat-message ${isSent ? 'sent' : 'received'}`;

            // БЕЗОПАСНОСТЬ: Используем textContent вместо innerHTML
            if (msg.message) {
                const msgEl = document.createElement('div');
                msgEl.textContent = msg.message;
                messageDiv.appendChild(msgEl);
            }
            if (msg.fileName) {
                const fileDiv = document.createElement('div');
                fileDiv.className = 'chat-message-file';
                
                const iconSpan = document.createElement('span');
                iconSpan.textContent = getFileIcon(msg.fileType) + ' ';
                
                const link = document.createElement('a');
                link.href = `data:${msg.fileType || 'application/octet-stream'};base64,${msg.fileData}`;
                link.download = msg.fileName;
                link.textContent = msg.fileName;
                
                fileDiv.appendChild(iconSpan);
                fileDiv.appendChild(link);
                messageDiv.appendChild(fileDiv);
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
    currentChatPurchaseId = null;
    document.getElementById('chat-window').style.display = 'none';
    document.getElementById('chat-list').style.display = 'block';
    selectedFileForChat = null;
    updateFilePreview();
}

// Открыть чат из уведомления
async function openChatFromNotification(notificationId) {
    try {
        console.log('[CHAT-NOTIFICATION] Открываем чат из уведомления:', notificationId);
        
        // Получаем покупки как покупатель
        const purchasesResponse = await fetch(`${API_URL}/users/${currentUser.id}/purchases`);
        const purchases = await purchasesResponse.json();
        console.log('[CHAT-NOTIFICATION] Покупки:', purchases);
        
        // Получаем продажи как продавец
        const salesResponse = await fetch(`${API_URL}/users/${currentUser.id}/sales`);
        const sales = await salesResponse.json();
        console.log('[CHAT-NOTIFICATION] Продажи:', sales);
        
        // Ищем последнюю активную покупку или продажу
        const purchase = purchases.find(p => p.status === 'active');
        const sale = sales.find(s => s.status === 'active');
        
        let purchaseId, counterpartName, title;
        
        if (purchase) {
            // Мы покупатель - открываем чат с продавцом
            purchaseId = purchase.id;
            title = purchase.title;
            const sellerResponse = await fetch(`${API_URL}/users/${purchase.sellerId}`);
            const seller = await sellerResponse.json();
            counterpartName = seller.name || 'Продавец';
        } else if (sale) {
            // Мы продавец - открываем чат с покупателем
            purchaseId = sale.id;
            title = sale.title;
            const buyerResponse = await fetch(`${API_URL}/users/${sale.buyerId}`);
            const buyer = await buyerResponse.json();
            counterpartName = buyer.name || 'Покупатель';
        } else {
            // Если не нашли активных покупок/продаж
            console.log('[CHAT-NOTIFICATION] Нет активных покупок/продаж');
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
        const buyerResponse = await fetch(`${API_URL}/users/${buyerId}`);
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
        const purchasesResponse = await fetch(`${API_URL}/users/${currentUser.id}/purchases`);
        const purchases = await purchasesResponse.json();
        const purchase = purchases.find(p => p.id === currentChatPurchaseId);
        
        let receiverId;
        if (purchase) {
            receiverId = purchase.sellerId;
        } else {
            const salesResponse = await fetch(`${API_URL}/users/${currentUser.id}/sales`);
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
            headers: { 'Content-Type': 'application/json' },
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
        sendMessage();
    }
}

// Выбор файла для чата
function handleChatFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Проверка типа файла
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
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
            type: file.type
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
        const response = await fetch(`${API_URL}/notifications/${currentUser.id}`);
        
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

        notificationsList.innerHTML = '';
        notifications.slice(0, 10).forEach(notification => {
            const item = document.createElement('div');
            item.className = `notification-item ${notification.isRead ? 'read' : 'unread'}`;

            // БЕЗОПАСНОСТЬ: Используем textContent
            const titleEl = document.createElement('div');
            titleEl.className = 'notification-title';
            titleEl.textContent = notification.title;

            const messageEl = document.createElement('div');
            messageEl.className = 'notification-message';
            messageEl.textContent = notification.message;

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
            method: 'PATCH'
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
        const response = await fetch(`${API_URL}/notifications/${currentUser.id}`);
        const notifications = await response.json();

        for (const notification of notifications) {
            if (!notification.isRead) {
                await fetch(`${API_URL}/notifications/${notification.id}/read`, {
                    method: 'PATCH'
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

        const toggleType = event.target.closest('[data-toggle-product-type]');
        if (toggleType) {
            toggleProductType();
        }

        const chatFileInput = event.target.closest('#chat-file-input');
        if (chatFileInput) {
            handleChatFileSelect(event);
        }
    });

    // Обработчик клавиш (Enter в поле чата)
    document.addEventListener('keypress', function(event) {
        if (event.target.id === 'chat-message-input' && event.key === 'Enter') {
            sendMessage();
        }
    });

    // Закрытие модалки при клике на фон
    document.addEventListener('click', function(event) {
        const authModal = document.getElementById('auth-modal');
        if (event.target === authModal) {
            closeModal();
        }
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

    checkAuth();
    renderProducts('practices', 'all');
    renderProducts('labs', 'all');
    renderProducts('courses', 'all');
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

            try {
                const response = await fetch(`${API_URL}/auth/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, login, password })
                });

                const data = await response.json();

                if (!response.ok) {
                    showToast('Ошибка', data.error || 'Ошибка регистрации', 'error');
                    return;
                }

                // Сохраняем сессию
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
});
