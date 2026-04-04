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

// ==================== ТЕМНАЯ ТЕМА ====================

// Инициализация темы
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

// Переключение темы
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
}

// Обновление иконки темы
function updateThemeIcon(theme) {
    const icon = document.querySelector('.theme-icon');
    if (icon) {
        icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
}

// ==================== TELEGRAM AUTH ====================

// Виджет уже внедрён сервером в HTML, ничего грузить не нужно
function loadTelegramWidget() {
    // Виджет уже на странице
}

// Callback при успешной авторизации через Telegram
window.onTelegramAuth = async function(user) {
    console.log('[TELEGRAM] Данные от виджета:', user);

    try {
        const response = await fetch(`${API_URL}/auth/telegram`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user)
        });

        const data = await response.json();
        console.log('[TELEGRAM] Ответ сервера:', response.status, data);

        if (!response.ok) {
            showToast('Ошибка', data.error || 'Ошибка входа через Telegram', 'error');
            return;
        }

        // Сохраняем сессию
        currentUser = data;
        sessionStorage.setItem('currentUser', JSON.stringify(data));

        closeModal();
        checkAuth();
        showToast('Успешно', `Добро пожаловать, ${data.name}!`, 'success');
    } catch (error) {
        showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
        console.error('[TELEGRAM] Ошибка:', error);
    }
};

// Старые функции (оставлены для совместимости, но не используются)

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

        // Показываем аватар Telegram если есть
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
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;

    console.log('[REGISTER] Попытка регистрации:', { name, email, passwordLen: password ? password.length : 0 });

    if (!name || !email || !password) {
        showToast('Ошибка', 'Заполните все поля!', 'error');
        return;
    }

    // Проверка email на валидность
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showToast('Ошибка', 'Введите корректный email адрес', 'error');
        return;
    }

    try {
        const body = JSON.stringify({ name, email, password });
        console.log('[REGISTER] Отправка тела:', body);

        const response = await fetch(`${API_URL}/users/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
        });

        console.log('[REGISTER] Ответ сервера:', response.status);

        const data = await response.json();
        console.log('[REGISTER] Данные ответа:', data);

        if (!response.ok) {
            showToast('Ошибка', data.error || 'Ошибка регистрации', 'error');
            return;
        }

        // Сохраняем сессию
        currentUser = data;
        sessionStorage.setItem('currentUser', JSON.stringify(data));

        // Очистка формы
        document.getElementById('register-name').value = '';
        document.getElementById('register-email').value = '';
        document.getElementById('register-password').value = '';

        closeModal();
        checkAuth();
        showToast('Успешно', 'Регистрация успешна!', 'success');
    } catch (error) {
        showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
        console.error('[REGISTER] Ошибка:', error);
    }
}

// Вход
async function login() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        showToast('Ошибка', 'Заполните все поля!', 'error');
        return;
    }

    console.log('[LOGIN] Попытка входа:', email, 'API_URL:', API_URL);

    try {
        const response = await fetch(`${API_URL}/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        console.log('[LOGIN] Ответ сервера:', response.status);

        const data = await response.json();
        console.log('[LOGIN] Данные ответа:', data);

        if (!response.ok) {
            showToast('Ошибка', data.error || 'Неверный email или пароль', 'error');
            return;
        }

        currentUser = data;
        sessionStorage.setItem('currentUser', JSON.stringify(data));

        closeModal();
        checkAuth();
        showToast('Успешно', 'Вход успешен!', 'success');
    } catch (error) {
        showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
        console.error('[LOGIN] Ошибка:', error);
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
    loadTelegramWidget();
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
            buyBtn.textContent = 'Купить';
            buyBtn.onclick = () => buyProduct(item.id);
            
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
                buyBtn.textContent = 'Купить';
                buyBtn.onclick = () => buyProduct(item.id);
                
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
                date.textContent = new Date(review.createdAt).toLocaleDateString();
                
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
                metaEl.textContent = `${purchase.price} ₽ • ${new Date(purchase.date).toLocaleDateString()}`;
                
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
        // Загружаем продажи (для продавца)
        const salesResponse = await fetch(`${API_URL}/users/${currentUser.id}/sales`);
        const sales = await salesResponse.json();

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
                    metaEl.textContent = `${sale.price} ₽ • ${new Date(sale.date).toLocaleDateString()} • Покупатель: ${sale.buyerId}`;
                    
                    infoDiv.appendChild(titleEl);
                    infoDiv.appendChild(metaEl);
                    if (deadlineInfo) {
                        const deadlineSpan = document.createElement('span');
                        deadlineSpan.innerHTML = deadlineInfo;
                        infoDiv.appendChild(deadlineSpan);
                    }
                    
                    const actionsDiv = document.createElement('div');
                    actionsDiv.className = 'sale-actions';
                    actionsDiv.innerHTML = fileAction;
                    
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
function contactSellerFromModal() {
    const purchaseId = document.getElementById('upload-purchase-id').value;
    const sellerId = document.getElementById('upload-seller-id').value;
    const buyerId = document.getElementById('upload-buyer-id').value;
    
    closeUploadModal();
    openChat(purchaseId, buyerId, 'Заказ');
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
            ...purchases.map(p => ({ ...p, type: 'buyer', counterpartName: 'Продавец' })),
            ...sales.map(s => ({ ...s, type: 'seller', counterpartName: 'Покупатель' }))
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
                metaDiv.textContent = new Date(msg.createdAt).toLocaleString();
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
            timeEl.textContent = new Date(notification.createdAt).toLocaleString();

            item.appendChild(titleEl);
            item.appendChild(messageEl);
            item.appendChild(timeEl);

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
            case 'toggle-theme':
                toggleTheme();
                break;
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
                // Не используется — авторизация через Telegram
                showToast('Информация', 'Используйте вход через Telegram', 'info');
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

    // Форма добавления товара
    const addProductForm = document.getElementById('add-product-form');
    if (addProductForm) {
        addProductForm.addEventListener('submit', async function(event) {
            event.preventDefault();
            if (!currentUser) {
                openModal('login');
                return;
            }

            const type = document.getElementById('product-type').value;

            if (type === 'product') {
                const title = document.getElementById('product-title').value;
                const category = document.getElementById('product-category').value;
                const discipline = document.getElementById('product-discipline').value;
                const price = parseInt(document.getElementById('product-price').value);
                const deadlineDays = parseInt(document.getElementById('product-deadline').value);

                if (!title || !category || !discipline || !price) {
                    showToast('Ошибка', 'Заполните все поля товара!', 'error');
                    return;
                }

                const deadlineDate = new Date();
                deadlineDate.setDate(deadlineDate.getDate() + deadlineDays);

                try {
                    const response = await fetch(`${API_URL}/products`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            title, category, discipline, price,
                            sellerId: currentUser.id,
                            sellerName: currentUser.name,
                            deadline: deadlineDate.toISOString()
                        })
                    });

                    if (!response.ok) {
                        const data = await response.json();
                        showToast('Ошибка', data.error || 'Ошибка создания товара', 'error');
                        return;
                    }

                    showToast('Успешно', 'Товар отправлен на модерацию', 'success');
                    addProductForm.reset();
                } catch (error) {
                    showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
                    console.error(error);
                }
            } else {
                const customTitle = document.getElementById('custom-title').value;
                const description = document.getElementById('custom-description').value;
                const budget = parseInt(document.getElementById('custom-budget').value);
                const fileInput = document.getElementById('custom-file');

                if (!customTitle || !budget) {
                    showToast('Ошибка', 'Заполните название и бюджет!', 'error');
                    return;
                }

                let fileName = null;
                let fileData = null;

                if (fileInput.files.length > 0) {
                    const file = fileInput.files[0];
                    fileName = file.name;

                    const reader = new FileReader();
                    reader.onload = async function(e) {
                        fileData = e.target.result.split(',')[1];

                        try {
                            const response = await fetch(`${API_URL}/custom-requests`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    title: customTitle,
                                    description,
                                    budget,
                                    requesterId: currentUser.id,
                                    requesterName: currentUser.name,
                                    fileName,
                                    fileData
                                })
                            });

                            if (!response.ok) {
                                const data = await response.json();
                                showToast('Ошибка', data.error || 'Ошибка создания запроса', 'error');
                                return;
                            }

                            showToast('Успешно', 'Запрос отправлен на модерацию', 'success');
                            addProductForm.reset();
                            toggleProductType();
                            renderCustomRequests('all');
                        } catch (error) {
                            showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
                            console.error(error);
                        }
                    };
                    reader.readAsDataURL(file);
                } else {
                    try {
                        const response = await fetch(`${API_URL}/custom-requests`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                title: customTitle,
                                description,
                                budget,
                                requesterId: currentUser.id,
                                requesterName: currentUser.name
                            })
                        });

                        if (!response.ok) {
                            const data = await response.json();
                            showToast('Ошибка', data.error || 'Ошибка создания запроса', 'error');
                            return;
                        }

                        showToast('Успешно', 'Запрос отправлен на модерацию', 'success');
                        addProductForm.reset();
                        toggleProductType();
                        renderCustomRequests('all');
                    } catch (error) {
                        showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
                        console.error(error);
                    }
                }
            }
        });
    }
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('StudentMarket загружен');

    // Инициализация темы
    initTheme();

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

    // ==================== АВТОРИЗАЦИЯ: ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК ====================
    
    // Переключение вкладок Логин/Telegram
    const authTabs = document.querySelectorAll('.auth-tab');
    const emailAuth = document.getElementById('email-auth');
    const telegramAuth = document.getElementById('telegram-auth');

    authTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.authTab;
            
            // Обновляем стили вкладок
            authTabs.forEach(t => {
                t.classList.remove('active');
                t.style.background = 'var(--border-color)';
                t.style.color = 'var(--text-main)';
            });
            tab.classList.add('active');
            tab.style.background = 'var(--primary-blue)';
            tab.style.color = 'white';

            // Показываем нужную форму
            if (tabName === 'login') {
                emailAuth.style.display = 'block';
                telegramAuth.style.display = 'none';
            } else {
                emailAuth.style.display = 'none';
                telegramAuth.style.display = 'block';
            }
        });
    });

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

            if (!login || !password) {
                showToast('Ошибка', 'Заполните все поля!', 'error');
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
                    showToast('Ошибка', data.error || 'Неверный логин или пароль', 'error');
                    return;
                }

                // Сохраняем сессию
                currentUser = data;
                sessionStorage.setItem('currentUser', JSON.stringify(data));

                // Очистка формы
                loginForm.reset();

                closeModal();
                checkAuth();
                showToast('Успешно', `Добро пожаловать, ${data.name}!`, 'success');
            } catch (error) {
                showToast('Ошибка', 'Ошибка подключения к серверу', 'error');
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
