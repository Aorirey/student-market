const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const { body, param, query, validationResult } = require('express-validator');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// НАСТРОЙКА PROXY (для Render/Heroku и др.)
// ============================================
app.set('trust proxy', 1);

// Логирование запросов (Московское время)
function getMoscowTime() {
    return new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour12: false });
}
app.use((req, res, next) => {
    console.log(`[${getMoscowTime()}] ${req.method} ${req.path}`);
    next();
});

// ============================================
// БЕЗОПАСНОСТЬ: Заголовки безопасности (A05)
// ============================================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:", "data:", "https://unpkg.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "data:"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
            connectSrc: ["'self'", '*', 'blob:', 'data:', 'https://oauth.vk.com', 'https://api.vk.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'", 'blob:', 'data:'],
            frameSrc: ["'none'"],
            workerSrc: ["'self'", 'blob:']
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// ============================================
// БЕЗОПАСНОСТЬ: Rate limiting (A04, A07)
// ============================================
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Слишком много запросов, попробуйте позже' },
    skip: (req) => process.env.NODE_ENV !== 'production'
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Слишком много попыток входа, попробуйте через 15 минут' },
    skipSuccessfulRequests: false,
    skip: (req) => process.env.NODE_ENV !== 'production'
});

const strictLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Слишком много запросов' },
    skip: (req) => process.env.NODE_ENV !== 'production'
});

app.use('/api/', generalLimiter);
app.use('/api/users/login', authLimiter);
app.use('/api/users/register', authLimiter);
app.use('/api/purchases', strictLimiter);
app.use('/api/reviews', strictLimiter);

// ============================================
// БЕЗОПАСНОСТЬ: CORS настройки (A05)
// ============================================
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// ============================================
// БЕЗОПАСНОСТЬ: Парсинг с ограничениями (A04)
// ============================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================
// СТАТИКА: Раздача CSS, JS, изображений
// ============================================
const ROOT = path.join(__dirname, '..');
app.use('/css', express.static(path.join(ROOT, 'css')));
app.use('/js', express.static(path.join(ROOT, 'js')));

// Главная страница
app.get('/', (req, res) => {
    let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    html = html.replace('<!-- TELEGRAM_WIDGET_INJECT -->', '');
    res.send(html);
});

// ============================================
// БЕЗОПАСНОСТЬ: Middleware валидации
// ============================================
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const errorArr = errors.array();
        console.log(`[VALIDATE] Ошибка! Полей: ${errorArr.length}`);
        console.log(`[VALIDATE] Body: ${JSON.stringify(req.body)}`);
        errorArr.forEach(e => console.log(`  - ${e.path}: ${e.msg}`));
        return res.status(400).json({ error: 'Ошибка валидации', details: errorArr.map(e => e.msg) });
    }
    next();
};

// ============================================
// БЕЗОПАСНОСТЬ: Санитизация HTML (A08 - XSS)
// ============================================
function sanitizeHTML(str) {
    if (!str) return str;
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

// Helper: автоматическое создание уведомлений + Telegram
function createNotification(userId, title, message, type, db) {
    try {
        db.query("INSERT INTO notifications (userId, title, message, type) VALUES ($1, $2, $3, $4)",
            [userId, title, message, type]);

        // Отправляем Telegram-уведомление
        telegram.notifyUser(userId, title, message, db).catch(err => {
            console.error('[TELEGRAM] Ошибка отправки уведомления:', err.message);
        });
    } catch (error) {
        console.error('[NOTIFICATION] Ошибка создания уведомления:', error.message);
    }
}

// ============================================
// Инициализация БД
// ============================================
let pool;

async function initDatabase() {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
        console.error('❌ DATABASE_URL не указан!');
        process.exit(1);
    }

    pool = new Pool({
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000
    });

    pool.on('error', (err) => {
        console.error('Ошибка пула соединений:', err.message);
    });

    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            balance INTEGER DEFAULT 10000,
            is_admin BOOLEAN DEFAULT false,
            is_blocked BOOLEAN DEFAULT false,
            rating REAL DEFAULT 0,
            review_count INTEGER DEFAULT 0,
            photo_url TEXT,
            login TEXT UNIQUE,
            vk_id BIGINT UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        // Миграция: добавляем колонки если их нет (для существующих БД)
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS login TEXT UNIQUE`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS vk_id BIGINT UNIQUE`);

        // Миграции для products
        await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS deadline TIMESTAMP`);

        // Миграции для purchases (для существующих БД)
        await pool.query(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS seller_id TEXT`);
        await pool.query(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS deadline TIMESTAMP`);
        await pool.query(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS file_attached BOOLEAN DEFAULT false`);

        await pool.query(`CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY, 
            title TEXT NOT NULL, 
            category TEXT NOT NULL, 
            discipline TEXT NOT NULL, 
            price INTEGER NOT NULL, 
            seller_id TEXT NOT NULL, 
            seller_name TEXT NOT NULL, 
            deadline TIMESTAMP, 
            status TEXT DEFAULT 'pending', 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        await pool.query(`CREATE TABLE IF NOT EXISTS purchases (
            id SERIAL PRIMARY KEY, 
            product_id INTEGER NOT NULL, 
            title TEXT NOT NULL, 
            price INTEGER NOT NULL, 
            buyer_id TEXT NOT NULL, 
            seller_id TEXT NOT NULL, 
            deadline TIMESTAMP, 
            date TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
            file_attached BOOLEAN DEFAULT false
        )`);
        
        await pool.query(`CREATE TABLE IF NOT EXISTS work_files (
            id SERIAL PRIMARY KEY, 
            purchase_id INTEGER NOT NULL, 
            file_name TEXT NOT NULL, 
            file_data TEXT NOT NULL, 
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        await pool.query(`CREATE TABLE IF NOT EXISTS reviews (
            id SERIAL PRIMARY KEY, 
            purchase_id INTEGER NOT NULL, 
            buyer_id TEXT NOT NULL, 
            seller_id TEXT NOT NULL, 
            rating INTEGER NOT NULL, 
            comment TEXT, 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        await pool.query(`CREATE TABLE IF NOT EXISTS custom_requests (
            id SERIAL PRIMARY KEY, 
            title TEXT NOT NULL, 
            description TEXT, 
            budget INTEGER NOT NULL, 
            requester_id TEXT NOT NULL, 
            requester_name TEXT NOT NULL, 
            file_name TEXT, 
            file_data TEXT, 
            status TEXT DEFAULT 'pending', 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        await pool.query(`CREATE TABLE IF NOT EXISTS chat_messages (
            id SERIAL PRIMARY KEY, 
            purchase_id INTEGER NOT NULL, 
            sender_id TEXT NOT NULL, 
            receiver_id TEXT NOT NULL, 
            message TEXT, 
            file_name TEXT, 
            file_data TEXT, 
            file_type TEXT, 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY, 
            user_id TEXT NOT NULL, 
            title TEXT NOT NULL, 
            message TEXT NOT NULL, 
            type TEXT NOT NULL, 
            is_read BOOLEAN DEFAULT false, 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        const adminExists = await pool.query("SELECT * FROM users WHERE email = $1", ['admin@studentmarket.ru']);
        const hashedPassword = await bcrypt.hash('admin123', 10);
        if (adminExists.rows.length === 0) {
            await pool.query(
                `INSERT INTO users (id, name, email, password, balance, is_admin, is_blocked, login)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                ['admin', 'Администратор', 'admin@studentmarket.ru', hashedPassword, 10000, true, false, 'admin']
            );
            console.log('✅ Администратор создан');
        } else {
            // Обновляем пароль и login админа на случай если данные устарели
            await pool.query(
                "UPDATE users SET password = $1, login = COALESCE(login, $2) WHERE email = $3",
                [hashedPassword, 'admin', 'admin@studentmarket.ru']
            );
            console.log('✅ Пароль администратора обновлён');
        }
        console.log('🎉 База данных инициализирована!');
    } catch (error) {
        console.error('❌ Ошибка инициализации БД:', error.message);
        process.exit(1);
    }
}

// ============================================
// ВАЛИДАТОРЫ
// ============================================

const registerValidator = [
    body('name').trim().notEmpty().withMessage('Имя обязательно').isLength({ max: 100 }).withMessage('Имя слишком длинное'),
    body('email').trim().notEmpty().withMessage('Email обязателен').isEmail().withMessage('Некорректный email'),
    body('password').notEmpty().withMessage('Пароль обязателен').isLength({ min: 6, max: 128 }).withMessage('Пароль от 6 до 128 символов'),
    validate
];

const loginValidator = [
    body('email').trim().notEmpty().withMessage('Email обязателен').isEmail().withMessage('Некорректный email'),
    body('password').notEmpty().withMessage('Пароль обязателен'),
    validate
];

const userIdValidator = [
    param('id').trim().notEmpty().withMessage('ID обязателен'),
    validate
];

const productCreateValidator = [
    body('title').trim().notEmpty().isLength({ max: 200 }),
    body('category').trim().notEmpty().isIn(['practices', 'labs', 'courses']),
    body('discipline').trim().notEmpty().isLength({ max: 100 }),
    body('price').notEmpty().isInt({ min: 1, max: 1000000 }),
    body('sellerId').trim().notEmpty(),
    body('sellerName').trim().notEmpty(),
    body('deadline').optional().isISO8601(),
    validate
];

const purchaseCreateValidator = [
    body('productId').notEmpty().isInt({ min: 1 }),
    body('title').trim().notEmpty(),
    body('price').notEmpty().isInt({ min: 1, max: 1000000 }),
    body('buyerId').trim().notEmpty(),
    body('sellerId').trim().notEmpty(),
    body('deadline').optional().isISO8601(),
    validate
];

const reviewCreateValidator = [
    body('purchaseId').notEmpty().isInt({ min: 1 }),
    body('buyerId').trim().notEmpty(),
    body('sellerId').trim().notEmpty(),
    body('rating').notEmpty().isInt({ min: 1, max: 5 }),
    body('comment').optional().isLength({ max: 1000 }),
    validate
];

const customRequestCreateValidator = [
    body('title').trim().notEmpty().isLength({ max: 200 }),
    body('description').optional().isLength({ max: 2000 }),
    body('budget').notEmpty().isInt({ min: 1, max: 1000000 }),
    body('requesterId').trim().notEmpty(),
    body('requesterName').trim().notEmpty(),
    body('fileName').optional().isLength({ max: 255 }),
    validate
];

const fileValidator = [
    body('fileName').trim().notEmpty().matches(/^[a-zA-Z0-9._-]+\.[a-zA-Z0-9]+$/),
    body('fileData').notEmpty(),
    validate
];

// ============================================
// API: Пользователи
// ============================================

app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query("SELECT id, name, email, balance, is_admin, is_blocked, created_at FROM users");
        res.json(result.rows.map(row => ({ 
            id: sanitizeHTML(row.id), 
            name: sanitizeHTML(row.name), 
            email: sanitizeHTML(row.email), 
            balance: row.balance, 
            isAdmin: row.is_admin, 
            isBlocked: row.is_blocked, 
            createdAt: row.created_at 
        })));
    } catch (error) { 
        console.error('Ошибка получения пользователей:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.get('/api/users/:id', userIdValidator, async (req, res) => {
    try {
        const result = await pool.query("SELECT id, name, email, balance, is_admin, is_blocked, created_at FROM users WHERE id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
        const row = result.rows[0];
        res.json({ 
            id: sanitizeHTML(row.id), 
            name: sanitizeHTML(row.name), 
            email: sanitizeHTML(row.email), 
            balance: row.balance, 
            isAdmin: row.is_admin, 
            isBlocked: row.is_blocked, 
            createdAt: row.created_at 
        });
    } catch (error) { 
        console.error('Ошибка получения пользователя:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.post('/api/users/register', registerValidator, async (req, res) => {
    try {
        const { name, email, password } = req.body;
        console.log(`[REGISTER] Попытка: name=${name}, email=${email}, passwordLen=${password ? password.length : 0}`);
        
        const existing = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
        if (existing.rows.length > 0) {
            console.log(`[REGISTER] Пользователь уже существует: ${email}`);
            return res.status(409).json({ error: 'Пользователь уже существует' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const id = uuidv4();
        const result = await pool.query(
            `INSERT INTO users (id, name, email, password, balance, is_admin, is_blocked)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, name, email, balance, is_admin, is_blocked`,
            [id, sanitizeHTML(name), email.toLowerCase(), hashedPassword, 10000, false, false]
        );
        console.log(`[REGISTER] Успешно: ${email}`);
        res.status(201).json({
            id: result.rows[0].id,
            name: sanitizeHTML(result.rows[0].name),
            email: result.rows[0].email,
            balance: result.rows[0].balance,
            isAdmin: result.rows[0].is_admin,
            isBlocked: result.rows[0].is_blocked
        });
    } catch (error) {
        console.error('[REGISTER] Ошибка:', error.message);
        res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
    }
});

app.post('/api/users/login', loginValidator, async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log(`[LOGIN] Попытка входа: email=${email}, passwordLen=${password ? password.length : 0}`);
        
        const result = await pool.query("SELECT id, name, email, password, balance, is_admin, is_blocked FROM users WHERE email = $1", [email.toLowerCase()]);
        
        if (result.rows.length === 0) {
            console.log(`[LOGIN] Пользователь не найден: ${email}`);
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }
        
        const row = result.rows[0];
        console.log(`[LOGIN] Найден пользователь: ${row.email}, isAdmin=${row.is_admin}`);
        
        const isValidPassword = await bcrypt.compare(password, row.password);
        if (!isValidPassword) {
            console.log(`[LOGIN] Неверный пароль для: ${email}`);
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }
        
        if (row.is_blocked) {
            console.log(`[LOGIN] Заблокирован: ${email}`);
            return res.status(403).json({ error: 'Аккаунт заблокирован' });
        }
        
        console.log(`[LOGIN] Успешный вход: ${email}`);
        res.json({
            id: sanitizeHTML(row.id),
            name: sanitizeHTML(row.name),
            email: sanitizeHTML(row.email),
            balance: row.balance,
            isAdmin: row.is_admin,
            isBlocked: row.is_blocked
        });
    } catch (error) {
        console.error('[LOGIN] Ошибка:', error.message);
        res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
    }
});

app.patch('/api/users/:id/balance', userIdValidator, async (req, res) => {
    try {
        const { balance } = req.body;
        if (typeof balance !== 'number' || balance < 0 || balance > 10000000) {
            return res.status(400).json({ error: 'Некорректный баланс' });
        }
        await pool.query("UPDATE users SET balance = $1 WHERE id = $2", [balance, req.params.id]);
        const result = await pool.query("SELECT id, name, email, balance, is_admin, is_blocked FROM users WHERE id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
        const row = result.rows[0];
        res.json({ id: sanitizeHTML(row.id), name: sanitizeHTML(row.name), email: sanitizeHTML(row.email), balance: row.balance, isAdmin: row.is_admin, isBlocked: row.is_blocked });
    } catch (error) { 
        console.error('Ошибка баланса:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.patch('/api/users/:id/block', userIdValidator, async (req, res) => {
    try {
        const { isBlocked } = req.body;
        if (typeof isBlocked !== 'boolean') return res.status(400).json({ error: 'Некорректное значение' });
        await pool.query("UPDATE users SET is_blocked = $1 WHERE id = $2", [isBlocked, req.params.id]);
        const result = await pool.query("SELECT id, name, email, balance, is_admin, is_blocked FROM users WHERE id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
        const row = result.rows[0];
        res.json({ id: sanitizeHTML(row.id), name: sanitizeHTML(row.name), email: sanitizeHTML(row.email), balance: row.balance, isAdmin: row.is_admin, isBlocked: row.is_blocked });
    } catch (error) { 
        console.error('Ошибка блокировки:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.delete('/api/users/:id', userIdValidator, async (req, res) => {
    try {
        const userResult = await pool.query("SELECT is_admin FROM users WHERE id = $1", [req.params.id]);
        if (userResult.rows.length > 0 && userResult.rows[0].is_admin) return res.status(403).json({ error: 'Нельзя удалить админа' });
        await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
        console.log(`[AUDIT] Удалён пользователь: ${req.params.id}`);
        res.json({ message: 'Пользователь удалён' });
    } catch (error) {
        console.error('Ошибка удаления:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============================================
// АВТОРИЗАЦИЯ: ВКонтакте
// ============================================

// Конфиг VK для фронтенда
app.get('/api/config/vk', (req, res) => {
    res.json({
        clientId: process.env.VK_CLIENT_ID || null,
        redirectUri: process.env.VK_REDIRECT_URI || null
    });
});

// OAuth callback — обмен code на token (VK ID SDK)
app.post('/api/auth/vk', async (req, res) => {
    try {
        const { code, device_id } = req.body;
        if (!code) {
            return res.status(400).json({ error: 'Код авторизации не передан' });
        }

        const clientId = process.env.VK_CLIENT_ID;
        const clientSecret = process.env.VK_CLIENT_SECRET;
        const redirectUri = process.env.VK_REDIRECT_URI;

        if (!clientId || !clientSecret) {
            return res.status(500).json({ error: 'VK авторизация не настроена' });
        }

        // Обмениваем code на access_token через VK ID
        const tokenParams = {
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code: code
        };
        if (device_id) {
            tokenParams.device_id = device_id;
        }

        const tokenResponse = await fetch('https://id.vk.com/oauth2/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(tokenParams)
        });

        const tokenData = await tokenResponse.json();

        if (!tokenData.access_token && !tokenData.token) {
            console.error('[VK] Ошибка получения токена:', tokenData);
            return res.status(401).json({ error: tokenData.error || 'Ошибка авторизации VK' });
        }

        const accessToken = tokenData.access_token || tokenData.token;
        const userId = tokenData.user_id || tokenData.sub;

        // Получаем данные пользователя через VK API
        const userResponse = await fetch('https://api.vk.com/method/users.get', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                access_token: accessToken,
                v: '5.199',
                fields: 'photo_100,photo_200,city,country'
            })
        });

        const userData = await userResponse.json();

        if (!userData.response || userData.response.length === 0) {
            return res.status(401).json({ error: 'Не удалось получить данные пользователя VK' });
        }

        const vkUser = userData.response[0];
        const firstName = vkUser.first_name || '';
        const lastName = vkUser.last_name || '';
        const fullName = `${firstName} ${lastName}`.trim() || `user_${userId}`;
        const photoUrl = vkUser.photo_200 || vkUser.photo_100 || null;
        const vkId = userId;

        // Ищем или создаём пользователя
        let result = await pool.query("SELECT * FROM users WHERE vk_id = $1", [vkId]);

        if (result.rows.length === 0) {
            // Новый пользователь
            const hashedPassword = await bcrypt.hash(uuidv4(), 10);
            const newId = uuidv4();
            const login = `vk_${vkId}`;

            result = await pool.query(
                `INSERT INTO users (id, name, email, password, balance, is_admin, is_blocked, photo_url, login, vk_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 RETURNING id, name, email, balance, is_admin, is_blocked, photo_url, login`,
                [newId, sanitizeHTML(fullName), `${vkId}@vk.user`, hashedPassword, 10000, false, false, photoUrl, login, vkId]
            );
            console.log(`[VK] Создан новый пользователь: ${fullName}`);
        } else {
            // Обновляем имя и фото
            await pool.query(
                "UPDATE users SET name = $1, photo_url = $2 WHERE vk_id = $3",
                [sanitizeHTML(fullName), photoUrl, vkId]
            );
            console.log(`[VK] Вход существующего пользователя: ${fullName}`);
        }

        const user = result.rows[0];

        if (user.is_blocked) {
            return res.status(403).json({ error: 'Аккаунт заблокирован' });
        }

        console.log(`[VK] Успешный вход: ${fullName}`);
        res.json({
            id: user.id,
            name: sanitizeHTML(user.name),
            email: user.email,
            balance: user.balance,
            isAdmin: user.is_admin,
            isBlocked: user.is_blocked,
            photoUrl: user.photo_url,
            login: user.login
        });
    } catch (error) {
        console.error('[VK] Ошибка:', error.message);
        res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
    }
});

// ============================================
// АВТОРИЗАЦИЯ: Логин/пароль
// ============================================

// Регистрация нового пользователя
app.post('/api/auth/register', [
    body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Ник: 2-50 символов'),
    body('login').trim().isLength({ min: 3, max: 20 }).withMessage('Логин: 3-20 символов'),
    body('password').isLength({ min: 6 }).withMessage('Пароль: мин. 6 символов')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array()[0].msg });
        }

        const { name, login, password } = req.body;

        // Валидация логина (только латиница, цифры, _)
        const loginRegex = /^[a-zA-Z0-9_]+$/;
        if (!loginRegex.test(login)) {
            return res.status(400).json({ error: 'Логин: только латинские буквы, цифры и _' });
        }

        console.log(`[AUTH] Попытка регистрации: ${login}`);

        // Проверяем, существует ли пользователь
        const existing = await pool.query("SELECT id FROM users WHERE login = $1", [login.toLowerCase()]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Пользователь с таким логином уже существует' });
        }

        // Хешируем пароль
        const hashedPassword = await bcrypt.hash(password, 10);
        const newId = uuidv4();

        // Создаём пользователя
        await pool.query(
            `INSERT INTO users (id, name, email, password, balance, is_admin, is_blocked, photo_url, login)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [newId, sanitizeHTML(name), `${login}@studentmarket.local`, hashedPassword, 10000, false, false, null, login.toLowerCase()]
        );

        console.log(`[AUTH] Регистрация успешна: ${login}`);
        res.status(201).json({
            id: newId,
            name: sanitizeHTML(name),
            login: login.toLowerCase(),
            email: `${login}@studentmarket.local`,
            balance: 10000,
            isAdmin: false,
            isBlocked: false,
            photoUrl: null
        });
    } catch (error) {
        console.error('[AUTH] Ошибка регистрации:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Вход пользователя
app.post('/api/auth/login', [
    body('login').trim().notEmpty().withMessage('Введите логин'),
    body('password').notEmpty().withMessage('Введите пароль')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array()[0].msg });
        }

        const { login, password } = req.body;
        console.log(`[AUTH] Попытка входа: ${login}`);

        // Ищем пользователя по логину ИЛИ email
        const result = await pool.query(
            "SELECT * FROM users WHERE login = $1 OR email = $2",
            [login.toLowerCase(), login.toLowerCase()]
        );
        if (result.rows.length === 0) {
            console.log(`[AUTH] Пользователь не найден: ${login}`);
            return res.status(401).json({ error: 'Неверный логин/email или пароль' });
        }

        const user = result.rows[0];

        // Проверяем пароль
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            console.log(`[AUTH] Неверный пароль: ${login}`);
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }

        // Проверяем блокировку
        if (user.is_blocked) {
            console.log(`[AUTH] Заблокирован: ${login}`);
            return res.status(403).json({ error: 'Аккаунт заблокирован' });
        }

        console.log(`[AUTH] Вход успешен: ${login}`);
        res.json({
            id: user.id,
            name: sanitizeHTML(user.name),
            login: user.login,
            email: user.email,
            balance: user.balance,
            isAdmin: user.is_admin,
            isBlocked: user.is_blocked,
            telegramId: user.telegram_id,
            photoUrl: user.photo_url
        });
    } catch (error) {
        console.error('[AUTH] Ошибка входа:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============================================
// API: Товары
// ============================================

app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM products WHERE status = 'approved'");
        res.json(result.rows.map(row => ({ 
            id: row.id, title: sanitizeHTML(row.title), category: sanitizeHTML(row.category), 
            discipline: sanitizeHTML(row.discipline), price: row.price, 
            sellerId: sanitizeHTML(row.seller_id), sellerName: sanitizeHTML(row.seller_name), 
            deadline: row.deadline, status: sanitizeHTML(row.status), createdAt: row.created_at 
        })));
    } catch (error) { 
        console.error('Ошибка товаров:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.get('/api/products/all', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM products");
        res.json(result.rows.map(row => ({ 
            id: row.id, title: sanitizeHTML(row.title), category: sanitizeHTML(row.category), 
            discipline: sanitizeHTML(row.discipline), price: row.price, 
            sellerId: sanitizeHTML(row.seller_id), sellerName: sanitizeHTML(row.seller_name), 
            deadline: row.deadline, status: sanitizeHTML(row.status), createdAt: row.created_at 
        })));
    } catch (error) { 
        console.error('Ошибка всех товаров:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.get('/api/users/:id/products', userIdValidator, async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM products WHERE seller_id = $1", [req.params.id]);
        res.json(result.rows.map(row => ({ 
            id: row.id, title: sanitizeHTML(row.title), category: sanitizeHTML(row.category), 
            discipline: sanitizeHTML(row.discipline), price: row.price, 
            sellerId: sanitizeHTML(row.seller_id), sellerName: sanitizeHTML(row.seller_name), 
            deadline: row.deadline, status: sanitizeHTML(row.status), createdAt: row.created_at 
        })));
    } catch (error) { 
        console.error('Ошибка товаров пользователя:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.post('/api/products', productCreateValidator, async (req, res) => {
    try {
        const { title, category, discipline, price, sellerId, sellerName, deadline } = req.body;
        const result = await pool.query(
            `INSERT INTO products (title, category, discipline, price, seller_id, seller_name, deadline, status) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING id`, 
            [sanitizeHTML(title), sanitizeHTML(category), sanitizeHTML(discipline), price, sanitizeHTML(sellerId), sanitizeHTML(sellerName), deadline || null]
        );
        console.log(`[PRODUCT] Создан товар: ${result.rows[0].id}`);
        res.status(201).json({ id: result.rows[0].id, title: sanitizeHTML(title), category: sanitizeHTML(category), discipline: sanitizeHTML(discipline), price, sellerId: sanitizeHTML(sellerId), sellerName: sanitizeHTML(sellerName), deadline, status: 'pending' });
    } catch (error) { 
        console.error('Ошибка создания товара:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.patch('/api/products/:id/approve', [param('id').notEmpty().isInt(), validate], async (req, res) => {
    try { 
        await pool.query("UPDATE products SET status = 'approved' WHERE id = $1", [req.params.id]); 
        console.log(`[MODERATION] Одобрен товар: ${req.params.id}`);
        res.json({ message: 'Товар одобрен' }); 
    } catch (error) { 
        console.error('Ошибка одобрения:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.patch('/api/products/:id/reject', [param('id').notEmpty().isInt(), validate], async (req, res) => {
    try { 
        await pool.query("UPDATE products SET status = 'rejected' WHERE id = $1", [req.params.id]); 
        console.log(`[MODERATION] Отклонён товар: ${req.params.id}`);
        res.json({ message: 'Товар отклонён' }); 
    } catch (error) { 
        console.error('Ошибка отклонения:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.delete('/api/products/:id', [param('id').notEmpty().isInt(), validate], async (req, res) => {
    try { 
        await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]); 
        console.log(`[PRODUCT] Удалён товар: ${req.params.id}`);
        res.json({ message: 'Товар удалён' }); 
    } catch (error) { 
        console.error('Ошибка удаления товара:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

// ============================================
// API: Покупки
// ============================================

app.get('/api/users/:id/purchases', userIdValidator, async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM purchases WHERE buyer_id = $1", [req.params.id]);
        res.json(result.rows.map(row => ({ 
            id: row.id, productId: row.product_id, title: sanitizeHTML(row.title), price: row.price, 
            buyerId: sanitizeHTML(row.buyer_id), sellerId: sanitizeHTML(row.seller_id), 
            deadline: row.deadline, date: row.date, fileAttached: row.file_attached 
        })));
    } catch (error) { 
        console.error('Ошибка покупок:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.get('/api/users/:id/sales', userIdValidator, async (req, res) => {
    try {
        console.log(`[SALES] Запрос продаж для seller_id: ${req.params.id}`);
        const result = await pool.query("SELECT * FROM purchases WHERE seller_id = $1", [req.params.id]);
        console.log(`[SALES] Найдено записей: ${result.rows.length}`);
        res.json(result.rows.map(row => ({ 
            id: row.id, productId: row.product_id, title: sanitizeHTML(row.title), price: row.price, 
            buyerId: sanitizeHTML(row.buyer_id), sellerId: sanitizeHTML(row.seller_id), 
            deadline: row.deadline, date: row.date, fileAttached: row.file_attached 
        })));
    } catch (error) { 
        console.error('Ошибка продаж:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.post('/api/purchases', purchaseCreateValidator, async (req, res) => {
    try {
        const { productId, title, price, buyerId, sellerId, deadline } = req.body;
        const result = await pool.query(
            `INSERT INTO purchases (product_id, title, price, buyer_id, seller_id, deadline) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, 
            [productId, sanitizeHTML(title), price, sanitizeHTML(buyerId), sanitizeHTML(sellerId), deadline || null]
        );
        console.log(`[PURCHASE] Создана покупка: ${result.rows[0].id}`);
        res.status(201).json({ id: result.rows[0].id, productId, title: sanitizeHTML(title), price, buyerId: sanitizeHTML(buyerId), sellerId: sanitizeHTML(sellerId), deadline });
    } catch (error) { 
        console.error('Ошибка покупки:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

// ============================================
// API: Файлы
// ============================================

app.post('/api/purchases/:purchaseId/file', [param('purchaseId').notEmpty().isInt(), ...fileValidator], async (req, res) => {
    try {
        const { purchaseId } = req.params;
        const { fileName, fileData } = req.body;
        const purchaseCheck = await pool.query("SELECT * FROM purchases WHERE id = $1", [purchaseId]);
        if (purchaseCheck.rows.length === 0) return res.status(404).json({ error: 'Покупка не найдена' });
        const allowedExtensions = ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'zip', 'rar'];
        const fileExt = fileName.split('.').pop().toLowerCase();
        if (!allowedExtensions.includes(fileExt)) return res.status(400).json({ error: 'Недопустимый тип файла' });
        await pool.query("DELETE FROM work_files WHERE purchase_id = $1", [purchaseId]);
        await pool.query("INSERT INTO work_files (purchase_id, file_name, file_data) VALUES ($1, $2, $3)", [purchaseId, sanitizeHTML(fileName), fileData]);
        await pool.query("UPDATE purchases SET file_attached = true WHERE id = $1", [purchaseId]);
        console.log(`[FILE] Загружен файл для покупки: ${purchaseId}`);
        res.json({ message: 'Файл загружен' });
    } catch (error) { 
        console.error('Ошибка файла:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.get('/api/purchases/:purchaseId/file', [param('purchaseId').notEmpty().isInt(), validate], async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM work_files WHERE purchase_id = $1", [req.params.purchaseId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Файл не найден' });
        const row = result.rows[0];
        res.json({ fileName: sanitizeHTML(row.file_name), fileData: row.file_data, uploadedAt: row.uploaded_at });
    } catch (error) { 
        console.error('Ошибка получения файла:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

// ============================================
// API: Отзывы
// ============================================

app.get('/api/users/:sellerId/reviews', userIdValidator, async (req, res) => {
    try {
        const result = await pool.query(`SELECT r.*, b.name as buyer_name FROM reviews r JOIN users b ON r.buyer_id = b.id WHERE r.seller_id = $1 ORDER BY r.created_at DESC`, [req.params.sellerId]);
        res.json(result.rows.map(row => ({ 
            id: row.id, purchaseId: row.purchase_id, buyerId: sanitizeHTML(row.buyer_id), 
            sellerId: sanitizeHTML(row.seller_id), rating: row.rating, comment: sanitizeHTML(row.comment), 
            createdAt: row.created_at, buyerName: sanitizeHTML(row.buyer_name) 
        })));
    } catch (error) { 
        console.error('Ошибка отзывов:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.post('/api/reviews', reviewCreateValidator, async (req, res) => {
    try {
        const { purchaseId, buyerId, sellerId, rating, comment } = req.body;
        const existing = await pool.query("SELECT * FROM reviews WHERE purchase_id = $1", [purchaseId]);
        if (existing.rows.length > 0) return res.status(409).json({ error: 'Отзыв уже существует' });
        await pool.query(`INSERT INTO reviews (purchase_id, buyer_id, seller_id, rating, comment) VALUES ($1, $2, $3, $4, $5)`, [purchaseId, sanitizeHTML(buyerId), sanitizeHTML(sellerId), rating, sanitizeHTML(comment || '')]);
        const stats = await pool.query("SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM reviews WHERE seller_id = $1", [sellerId]);
        const avgRating = parseFloat(stats.rows[0].avg_rating) || 0;
        const count = parseInt(stats.rows[0].count) || 0;
        await pool.query("UPDATE users SET rating = $1, review_count = $2 WHERE id = $3", [avgRating, count, sellerId]);
        console.log(`[REVIEW] Добавлен отзыв: ${purchaseId}`);
        res.status(201).json({ message: 'Отзыв добавлен' });
    } catch (error) { 
        console.error('Ошибка отзыва:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

// ============================================
// API: Индивидуальные запросы
// ============================================

app.get('/api/custom-requests', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM custom_requests WHERE status = 'approved'");
        res.json(result.rows.map(row => ({ 
            id: row.id, title: sanitizeHTML(row.title), description: sanitizeHTML(row.description), 
            budget: row.budget, requesterId: sanitizeHTML(row.requester_id), 
            requesterName: sanitizeHTML(row.requester_name), fileName: sanitizeHTML(row.file_name), 
            fileData: row.file_data, status: sanitizeHTML(row.status), createdAt: row.created_at 
        })));
    } catch (error) { 
        console.error('Ошибка запросов:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.get('/api/custom-requests/all', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM custom_requests");
        res.json(result.rows.map(row => ({ 
            id: row.id, title: sanitizeHTML(row.title), description: sanitizeHTML(row.description), 
            budget: row.budget, requesterId: sanitizeHTML(row.requester_id), 
            requesterName: sanitizeHTML(row.requester_name), fileName: sanitizeHTML(row.file_name), 
            fileData: row.file_data, status: sanitizeHTML(row.status), createdAt: row.created_at 
        })));
    } catch (error) { 
        console.error('Ошибка всех запросов:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.post('/api/custom-requests', customRequestCreateValidator, async (req, res) => {
    try {
        const { title, description, budget, requesterId, requesterName, fileName, fileData } = req.body;
        const result = await pool.query(
            `INSERT INTO custom_requests (title, description, budget, requester_id, requester_name, file_name, file_data, status) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING id`, 
            [sanitizeHTML(title), sanitizeHTML(description || ''), budget, sanitizeHTML(requesterId), sanitizeHTML(requesterName), sanitizeHTML(fileName || null), fileData || null]
        );
        console.log(`[CUSTOM_REQUEST] Создан запрос: ${result.rows[0].id}`);
        res.status(201).json({ id: result.rows[0].id, title: sanitizeHTML(title), description: sanitizeHTML(description || ''), budget, requesterId: sanitizeHTML(requesterId), requesterName: sanitizeHTML(requesterName), fileName: sanitizeHTML(fileName || null), status: 'pending' });
    } catch (error) { 
        console.error('Ошибка запроса:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.patch('/api/custom-requests/:id/approve', [param('id').notEmpty().isInt(), validate], async (req, res) => {
    try { 
        await pool.query("UPDATE custom_requests SET status = 'approved' WHERE id = $1", [req.params.id]); 
        console.log(`[MODERATION] Одобрен запрос: ${req.params.id}`);
        res.json({ message: 'Запрос одобрен' }); 
    } catch (error) { 
        console.error('Ошибка одобрения запроса:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.patch('/api/custom-requests/:id/reject', [param('id').notEmpty().isInt(), validate], async (req, res) => {
    try { 
        await pool.query("UPDATE custom_requests SET status = 'rejected' WHERE id = $1", [req.params.id]); 
        console.log(`[MODERATION] Отклонён запрос: ${req.params.id}`);
        res.json({ message: 'Запрос отклонён' }); 
    } catch (error) { 
        console.error('Ошибка отклонения запроса:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.delete('/api/custom-requests/:id', [param('id').notEmpty().isInt(), validate], async (req, res) => {
    try { 
        await pool.query("DELETE FROM custom_requests WHERE id = $1", [req.params.id]); 
        console.log(`[CUSTOM_REQUEST] Удалён запрос: ${req.params.id}`);
        res.json({ message: 'Запрос удалён' }); 
    } catch (error) { 
        console.error('Ошибка удаления запроса:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

// ============================================
// API: Чат
// ============================================

app.get('/api/chat/:purchaseId', [param('purchaseId').notEmpty(), validate], async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM chat_messages WHERE purchase_id = $1 ORDER BY created_at ASC", [req.params.purchaseId]);
        res.json(result.rows.map(row => ({ 
            id: row.id, purchaseId: row.purchase_id, senderId: sanitizeHTML(row.sender_id), 
            receiverId: sanitizeHTML(row.receiver_id), message: sanitizeHTML(row.message), 
            fileName: sanitizeHTML(row.file_name), fileData: row.file_data, 
            fileType: sanitizeHTML(row.file_type), createdAt: row.created_at 
        })));
    } catch (error) { 
        console.error('Ошибка чата:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.post('/api/chat', [
    body('purchaseId').notEmpty(),
    body('senderId').trim().notEmpty(),
    body('receiverId').trim().notEmpty(),
    body('message').optional().isLength({ max: 2000 }),
    body('fileName').optional().isLength({ max: 255 }),
    validate
], async (req, res) => {
    try {
        const { purchaseId, senderId, receiverId, message, fileName, fileData, fileType } = req.body;
        const result = await pool.query(
            `INSERT INTO chat_messages (purchase_id, sender_id, receiver_id, message, file_name, file_data, file_type) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, 
            [purchaseId, sanitizeHTML(senderId), sanitizeHTML(receiverId), sanitizeHTML(message || null), sanitizeHTML(fileName || null), fileData || null, sanitizeHTML(fileType || null)]
        );
        res.status(201).json({ id: result.rows[0].id, purchaseId, senderId: sanitizeHTML(senderId), receiverId: sanitizeHTML(receiverId), message: sanitizeHTML(message || null), fileName: sanitizeHTML(fileName || null), fileData, fileType: sanitizeHTML(fileType || null) });
    } catch (error) { 
        console.error('Ошибка сообщения:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.get('/api/chat/purchases/:userId', userIdValidator, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT p.id, p.title, u.name as counterpartName, p.seller_id as sellerId, p.buyer_id as buyerId 
             FROM purchases p 
             JOIN users u ON (p.seller_id = u.id OR p.buyer_id = u.id) 
             WHERE (p.buyer_id = $1 OR p.seller_id = $1) 
             AND p.id IN (SELECT purchase_id FROM chat_messages)`, 
            [req.params.userId]
        );
        res.json(result.rows.map(row => ({ 
            purchaseId: row.id, title: sanitizeHTML(row.title), counterpartName: sanitizeHTML(row.counterpartName), 
            sellerId: sanitizeHTML(row.sellerId), buyerId: sanitizeHTML(row.buyerId) 
        })));
    } catch (error) { 
        console.error('Ошибка чатов:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

// ============================================
// API: Уведомления
// ============================================

app.get('/api/notifications/:userId', userIdValidator, async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC", [req.params.userId]);
        res.json(result.rows.map(row => ({ 
            id: row.id, userId: sanitizeHTML(row.user_id), title: sanitizeHTML(row.title), 
            message: sanitizeHTML(row.message), type: sanitizeHTML(row.type), 
            isRead: row.is_read, createdAt: row.created_at 
        })));
    } catch (error) { 
        console.error('Ошибка уведомлений:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.post('/api/notifications', [
    body('userId').trim().notEmpty(),
    body('title').trim().notEmpty().isLength({ max: 200 }),
    body('message').trim().notEmpty().isLength({ max: 1000 }),
    body('type').trim().notEmpty(),
    validate
], async (req, res) => {
    try {
        const { userId, title, message, type } = req.body;
        const result = await pool.query(
            `INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4) RETURNING id`, 
            [sanitizeHTML(userId), sanitizeHTML(title), sanitizeHTML(message), sanitizeHTML(type)]
        );
        res.status(201).json({ id: result.rows[0].id, userId: sanitizeHTML(userId), title: sanitizeHTML(title), message: sanitizeHTML(message), type: sanitizeHTML(type) });
    } catch (error) { 
        console.error('Ошибка уведомления:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.patch('/api/notifications/:id/read', [param('id').notEmpty().isInt(), validate], async (req, res) => {
    try {
        await pool.query("UPDATE notifications SET is_read = true WHERE id = $1", [req.params.id]);
        res.json({ message: 'Уведомление прочитано' });
    } catch (error) { 
        console.error('Ошибка уведомления:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

// ============================================
// TELEGRAM БОТ: Подписка на уведомления
// ============================================

// GET /api/telegram/setup — АВТО-НАСТРОЙКА WEBHOOK
app.get('/api/telegram/setup', async (req, res) => {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
        return res.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set in .env' });
    }
    const serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    const webhookUrl = `${serverUrl}/api/telegram/webhook`;
    const apiUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`;
    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: webhookUrl })
        });
        const data = await response.json();
        res.json({ message: 'Webhook setup attempted', webhookUrl, telegramResponse: data });
    } catch (err) {
        res.json({ ok: false, error: err.message });
    }
});

// GET /api/telegram/webhook — проверка (браузер)
app.get('/api/telegram/webhook', (req, res) => {
    res.json({ ok: true, message: 'Telegram webhook endpoint is active. This endpoint only accepts POST requests from Telegram.' });
});

// POST /api/telegram/webhook — webhook от Telegram Bot API
app.post('/api/telegram/webhook', express.json(), (req, res) => {
    try {
        const update = req.body;
        if (!update.message || !update.message.text) return res.json({ ok: true });

        const chatId = update.message.chat.id;
        const text = update.message.text.trim();
        const firstName = update.message.from.first_name || 'Пользователь';

        if (text === '/start' || text.startsWith('/start ')) {
            const parts = text.split(' ');
            const userId = parts[1];
            if (!userId) {
                return telegram.sendTelegramMessage(chatId,
                    `👋 Привет, ${firstName}!\n\nДля подписки: /connect ВАШ_USER_ID`);
            }
            pool.query("SELECT name FROM users WHERE id = $1", [userId]).then(result => {
                if (!result.rows.length) {
                    return telegram.sendTelegramMessage(chatId, `❌ Пользователь "${userId}" не найден`);
                }
                const userName = result.rows[0].name;
                pool.query("INSERT INTO telegram_subscriptions (userId, chatId) VALUES ($1, $2) ON CONFLICT (chatId) DO UPDATE SET userId = $1", [userId, String(chatId)])
                    .then(() => {
                        telegram.chatIdCache.set(userId, String(chatId));
                        telegram.sendTelegramMessage(chatId, `✅ ${userName}, вы подписаны на уведомления!\n\nДля отписки: /unsubscribe`);
                    });
            });
            return res.json({ ok: true });
        }

        if (text.startsWith('/connect ')) {
            const userId = text.split(' ')[1];
            if (!userId) return telegram.sendTelegramMessage(chatId, 'Использование: /connect USER_ID');
            pool.query("SELECT name FROM users WHERE id = $1", [userId]).then(result => {
                if (!result.rows.length) return telegram.sendTelegramMessage(chatId, `❌ Пользователь не найден`);
                const userName = result.rows[0].name;
                pool.query("INSERT INTO telegram_subscriptions (userId, chatId) VALUES ($1, $2) ON CONFLICT (chatId) DO UPDATE SET userId = $1", [userId, String(chatId)])
                    .then(() => {
                        telegram.chatIdCache.set(userId, String(chatId));
                        telegram.sendTelegramMessage(chatId, `✅ ${userName}, подписка оформлена!`);
                    });
            });
            return res.json({ ok: true });
        }

        if (text === '/unsubscribe') {
            pool.query("DELETE FROM telegram_subscriptions WHERE chatId = $1", [String(chatId)]).then(() => {
                for (const [uid, cid] of telegram.chatIdCache.entries()) {
                    if (cid === String(chatId)) telegram.chatIdCache.delete(uid);
                }
                telegram.sendTelegramMessage(chatId, `👋 Вы отписались. Для подписки: /connect USER_ID`);
            });
            return res.json({ ok: true });
        }

        if (text === '/help') {
            telegram.sendTelegramMessage(chatId, `📋 Команды:\n/connect USER_ID — подписка\n/unsubscribe — отписка\n/status — статус\n/help — справка`);
            return res.json({ ok: true });
        }

        if (text === '/status') {
            pool.query("SELECT userId FROM telegram_subscriptions WHERE chatId = $1", [String(chatId)]).then(result => {
                if (result.rows.length) telegram.sendTelegramMessage(chatId, `✅ Подписан (userId: ${result.rows[0].userId})`);
                else telegram.sendTelegramMessage(chatId, `❌ Не подписан. Используйте /connect USER_ID`);
            });
            return res.json({ ok: true });
        }

        telegram.sendTelegramMessage(chatId, `❓ Неизвестная команда. Используйте /help`);
        res.json({ ok: true });
    } catch (error) {
        console.error('[TELEGRAM] Ошибка webhook:', error.message);
        res.json({ ok: true });
    }
});

// GET /api/telegram/status/:userId
app.get('/api/telegram/status/:userId', (req, res) => {
    const chatId = telegram.chatIdCache.get(req.params.userId);
    res.json({ userId: req.params.userId, subscribed: !!chatId, chatId: chatId || null });
});

// POST /api/telegram/unsubscribe/:userId
app.post('/api/telegram/unsubscribe/:userId', (req, res) => {
    pool.query("DELETE FROM telegram_subscriptions WHERE userId = $1", [req.params.userId]).then(() => {
        telegram.chatIdCache.delete(req.params.userId);
        res.json({ message: 'Вы отписаны от Telegram-уведомлений' });
    });
});

// POST /api/telegram/test — тестовое сообщение (только админ)
app.post('/api/telegram/test', async (req, res) => {
    try {
        const { chatId, message } = req.body;
        if (chatId) {
            const result = await telegram.sendTelegramMessage(chatId, message || '🔔 Тест');
            res.json({ ok: result.ok, description: result.description });
        } else {
            const subs = await pool.query("SELECT chatId FROM telegram_subscriptions");
            if (!subs.rows.length) return res.json({ ok: true, sent: 0, message: 'Нет подписчиков' });
            let sent = 0;
            await Promise.all(subs.rows.map(row =>
                telegram.sendTelegramMessage(row.chatid, message || '🔔 Тест от админа').then(r => { if (r.ok) sent++; })
            ));
            res.json({ ok: true, sent, total: subs.rows.length });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// VK Callback страница
// ============================================

app.get('/auth/vk/callback', (req, res) => {
    // Эта страница получает code из URL и отправляет его в opener
    res.send(`<!DOCTYPE html><html><head><title>VK Auth</title></head><body>
<script>
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code && window.opener) {
        window.opener.postMessage({ type: 'vk_auth_code', code }, window.location.origin);
        window.close();
    } else {
        document.body.innerHTML = '<p>Авторизация завершена. Закройте это окно.</p>';
    }
</script></body></html>`);
});

// ============================================
// Главная страница
// ============================================

app.get('/', (req, res) => {
    res.sendFile(path.join(ROOT, 'index.html'));
});

// ============================================
// Запуск сервера
// ============================================

const telegram = require('./telegram');

initDatabase().then((db) => {
    // Инициализация Telegram
    telegram.initTelegramTable(db);
    telegram.loadChatIdCache(db);

    app.listen(PORT, () => {
        console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
        console.log(`📡 API: http://localhost:${PORT}/api`);
        console.log(`🔒 Trust proxy: включён`);
        console.log(`🌍 ENV: ${process.env.NODE_ENV || 'development'}`);
    });

    // АВТО-НАСТРОЙКА TELEGRAM WEBHOOK ПРИ ЗАПУСКЕ (на Render)
    if (process.env.RENDER_EXTERNAL_URL && process.env.TELEGRAM_BOT_TOKEN) {
        (async () => {
            const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/api/telegram/webhook`;
            const apiUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`;
            try {
                const res = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: webhookUrl })
                });
                const data = await res.json();
                if (data.ok) console.log(`[TELEGRAM] ✅ Webhook автоматически установлен: ${webhookUrl}`);
                else console.error(`[TELEGRAM] ❌ Ошибка установки webhook: ${data.description}`);
            } catch (e) {
                console.error('[TELEGRAM] Ошибка настройки webhook:', e.message);
            }
        })();
    }
});
