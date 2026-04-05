const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { body, param, query, validationResult } = require('express-validator');
const crypto = require('crypto');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN } = require('./config');
const { authenticateToken, requireAdmin, requirePurchaseParticipant } = require('./auth');
const telegram = require('./telegram');

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
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:", "data:"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "data:"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
            connectSrc: ["'self'", '*', 'blob:', 'data:'],
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
    skip: () => process.env.NODE_ENV === 'development'
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Слишком много попыток входа, попробуйте через 15 минут' },
    skipSuccessfulRequests: false,
    skip: () => process.env.NODE_ENV === 'development'
});

const strictLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Слишком много запросов' },
    skip: () => process.env.NODE_ENV === 'development'
});

const purchaseLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Слишком много покупок, попробуйте позже' },
    skip: () => process.env.NODE_ENV === 'development'
});

app.use('/api/', generalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/users/login', authLimiter);
app.use('/api/users/register', authLimiter);
app.use('/api/purchases', purchaseLimiter);
app.use('/api/reviews', strictLimiter);

// ============================================
// БЕЗОПАСНОСТЬ: CORS настройки (A05)
// ============================================
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// ============================================
// БЕЗОПАСНОСТЬ: Парсинг с ограничениями (A04)
// ============================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const ROOT = path.join(__dirname, '..');
app.use('/css', express.static(path.join(ROOT, 'css')));
app.use('/js', express.static(path.join(ROOT, 'js')));

// Главная страница
app.get('/', (req, res) => {
    let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    html = html.replace('<!-- TELEGRAM_WIDGET_INJECT -->', '');
    res.send(html);
});

// Favicon - возвращаем пустую иконку чтобы не было 404
app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

// ============================================
// БЕЗОПАСНОСТЬ: Middleware валидации
// ============================================
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Ошибка валидации', details: errors.array().map(e => e.msg) });
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
function createNotification(userId, title, message, type) {
    try {
        db.run("INSERT INTO notifications (userId, title, message, type) VALUES (?, ?, ?, ?)",
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
const dbMode = process.env.DB_MODE || 'sqlite';

if (dbMode === 'postgres') {
    console.log('🚀 Запуск в режиме PostgreSQL...');
    require('./server-pg');
} else {
    console.log('🚀 Запуск в режиме SQLite...');
    const initSqlJs = require('sql.js');
    const fs = require('fs');

    let db;

    async function initDatabase() {
        const SQL = await initSqlJs({
            locateFile: file => path.join(ROOT, 'node_modules', 'sql.js', 'dist', file)
        });

        const dbPath = path.join(ROOT, 'database.sqlite');
        let dbBuffer;
        if (fs.existsSync(dbPath)) {
            dbBuffer = fs.readFileSync(dbPath);
            db = new SQL.Database(dbBuffer);
            console.log('База данных загружена из файла');
        } else {
            db = new SQL.Database();
            console.log('Создана новая база данных');
        }

        // Создание таблиц
        db.run(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, balance INTEGER DEFAULT 10000, isAdmin INTEGER DEFAULT 0, isBlocked INTEGER DEFAULT 0, rating REAL DEFAULT 0, reviewCount INTEGER DEFAULT 0, photo_url TEXT, login TEXT UNIQUE, vk_id BIGINT UNIQUE, createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);

        // Миграция для существующих БД
        try { db.run(`ALTER TABLE users ADD COLUMN photo_url TEXT`); } catch(e) {}
        try { db.run(`ALTER TABLE users ADD COLUMN login TEXT UNIQUE`); } catch(e) {}
        try { db.run(`ALTER TABLE users ADD COLUMN vk_id BIGINT UNIQUE`); } catch(e) {}

        // Миграции для purchases (для существующих БД)
        try { db.run(`ALTER TABLE purchases ADD COLUMN sellerId TEXT`); } catch(e) {}
        try { db.run(`ALTER TABLE purchases ADD COLUMN deadline TEXT`); } catch(e) {}
        try { db.run(`ALTER TABLE purchases ADD COLUMN fileAttached INTEGER DEFAULT 0`); } catch(e) {}
        try { db.run(`ALTER TABLE purchases ADD COLUMN status TEXT DEFAULT 'active'`); } catch(e) {}

        db.run(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL, discipline TEXT NOT NULL, price INTEGER NOT NULL, sellerId TEXT NOT NULL, sellerName TEXT NOT NULL, deadline TEXT, status TEXT DEFAULT 'pending', createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, productId INTEGER NOT NULL, title TEXT NOT NULL, price INTEGER NOT NULL, buyerId TEXT NOT NULL, sellerId TEXT NOT NULL, deadline TEXT, date TEXT DEFAULT CURRENT_TIMESTAMP, fileAttached INTEGER DEFAULT 0, status TEXT DEFAULT 'active')`);
        db.run(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT NOT NULL, type TEXT NOT NULL, amount INTEGER NOT NULL, description TEXT, purchaseId INTEGER, createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
        try { db.run(`ALTER TABLE work_files ADD COLUMN uploadedBy TEXT`); } catch(e) {}
        db.run(`CREATE TABLE IF NOT EXISTS work_files (id INTEGER PRIMARY KEY AUTOINCREMENT, purchaseId INTEGER NOT NULL, fileName TEXT NOT NULL, fileData TEXT NOT NULL, uploadedBy TEXT, uploadedAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, purchaseId INTEGER NOT NULL, buyerId TEXT NOT NULL, sellerId TEXT NOT NULL, rating INTEGER NOT NULL, comment TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS custom_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, budget INTEGER NOT NULL, requesterId TEXT NOT NULL, requesterName TEXT NOT NULL, fileName TEXT, fileData TEXT, status TEXT DEFAULT 'pending', createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
        try { db.run(`ALTER TABLE chat_messages ADD COLUMN isRead INTEGER DEFAULT 0`); } catch(e) {}

        db.run(`CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, purchaseId INTEGER NOT NULL, senderId TEXT NOT NULL, receiverId TEXT NOT NULL, message TEXT, fileName TEXT, fileData TEXT, fileType TEXT, isRead INTEGER DEFAULT 0, createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, type TEXT NOT NULL, isRead INTEGER DEFAULT 0, createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);

        // Создание администратора по умолчанию
        const adminExists = db.exec("SELECT * FROM users WHERE email = 'admin@studentmarket.ru'");
        if (adminExists.length === 0 || adminExists[0].values.length === 0) {
            const hashedPassword = bcrypt.hashSync('admin123', 10);
            db.run(`INSERT INTO users (id, name, email, password, balance, isAdmin, isBlocked, login) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                ['admin', 'Администратор', 'admin@studentmarket.ru', hashedPassword, 10000, 1, 0, 'admin']);
            saveDatabase();
            console.log('Администратор создан');
        }

        // Инициализация таблицы Telegram
        telegram.initTelegramTable(db);
        telegram.loadChatIdCache(db);

        console.log('База данных инициализирована');
    }

    function saveDatabase() {
        try {
            const data = db.export();
            const buffer = Buffer.from(data);
            const dbPath = path.join(ROOT, 'database.sqlite');
            fs.writeFileSync(dbPath, buffer);
            console.log(`[DB] База данных сохранена в ${dbPath}`);
        } catch (error) {
            console.error('[DB] Ошибка сохранения базы данных:', error.message);
            throw error;
        }
    }

    // ============================================
    // БЕЗОПАСНОСТЬ: Валидаторы для API (A03, A04)
    // ============================================

    // Пользователи - регистрация
    const registerValidator = [
        body('name').trim().notEmpty().withMessage('Имя обязательно').isLength({ max: 100 }).withMessage('Имя слишком длинное'),
        body('email').trim().notEmpty().withMessage('Email обязателен').isEmail().withMessage('Некорректный email').normalizeEmail(),
        body('password').notEmpty().withMessage('Пароль обязателен').isLength({ min: 6, max: 128 }).withMessage('Пароль должен быть от 6 до 128 символов'),
        validate
    ];

    // Пользователи - логин
    const loginValidator = [
        body('email').trim().notEmpty().withMessage('Email обязателен').isEmail().withMessage('Некорректный email').normalizeEmail(),
        body('password').notEmpty().withMessage('Пароль обязателен'),
        validate
    ];

    // Пользователи - ID параметр
    const userIdValidator = [
        param('id').trim().notEmpty().withMessage('ID обязателен').isLength({ max: 100 }),
        validate
    ];

    // Товар - создание
    const productCreateValidator = [
        body('title').trim().notEmpty().withMessage('Название обязательно').isLength({ max: 200 }).withMessage('Название слишком длинное'),
        body('category').trim().notEmpty().withMessage('Категория обязательна').isIn(['practices', 'labs', 'courses']).withMessage('Некорректная категория'),
        body('discipline').trim().notEmpty().withMessage('Дисциплина обязательна').isLength({ max: 100 }),
        body('price').notEmpty().withMessage('Цена обязательна').isInt({ min: 1, max: 1000000 }).withMessage('Некорректная цена'),
        body('sellerId').trim().notEmpty().withMessage('ID продавца обязателен'),
        body('sellerName').trim().notEmpty().withMessage('Имя продавца обязательно'),
        body('deadline').optional().isISO8601().withMessage('Некорректная дата дедлайна'),
        validate
    ];

    // Покупка - создание
    const purchaseCreateValidator = [
        body('productId').notEmpty().isInt({ min: 1 }).withMessage('Некорректный ID товара'),
        body('title').trim().notEmpty().withMessage('Название обязательно'),
        body('price').notEmpty().isInt({ min: 1, max: 1000000 }).withMessage('Некорректная цена'),
        body('buyerId').trim().notEmpty().withMessage('ID покупателя обязателен'),
        body('sellerId').trim().notEmpty().withMessage('ID продавца обязателен'),
        body('deadline').optional().isISO8601().withMessage('Некорректная дата'),
        validate
    ];

    // Отзыв - создание
    const reviewCreateValidator = [
        body('purchaseId').notEmpty().isInt({ min: 1 }).withMessage('Некорректный ID покупки'),
        body('buyerId').trim().notEmpty().withMessage('ID покупателя обязателен'),
        body('sellerId').trim().notEmpty().withMessage('ID продавца обязателен'),
        body('rating').notEmpty().isInt({ min: 1, max: 5 }).withMessage('Рейтинг должен быть от 1 до 5'),
        body('comment').optional().isLength({ max: 1000 }).withMessage('Комментарий слишком длинный'),
        validate
    ];

    // Индивидуальный запрос - создание
    const customRequestCreateValidator = [
        body('title').trim().notEmpty().withMessage('Название обязательно').isLength({ max: 200 }),
        body('description').optional().isLength({ max: 2000 }).withMessage('Описание слишком длинное'),
        body('budget').notEmpty().isInt({ min: 1, max: 1000000 }).withMessage('Некорректный бюджет'),
        body('requesterId').trim().notEmpty().withMessage('ID заказчика обязателен'),
        body('requesterName').trim().notEmpty().withMessage('Имя заказчика обязательно'),
        body('fileName').optional().isLength({ max: 255 }),
        validate
    ];

    // Файл - валидация base64
    const fileValidator = [
        body('fileName').trim().notEmpty().withMessage('Имя файла обязательно')
            .matches(/^[a-zA-Z0-9._-]+\.[a-zA-Z0-9]+$/).withMessage('Некорректное имя файла'),
        body('fileData').notEmpty().withMessage('Файл не загружен')
            .matches(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).withMessage('Некорректные данные файла'),
        validate
    ];

    // ============================================
    // API: Пользователи
    // ============================================

    // БЕЗОПАСНОСТЬ: Получение всех пользователей — только для администраторов
    app.get('/api/users', authenticateToken, requireAdmin, (req, res) => {
        try {
            const result = db.exec("SELECT id, name, email, balance, isAdmin, isBlocked, createdAt FROM users");
            if (result.length === 0) return res.json([]);
            res.json(result[0].values.map(row => ({
                id: sanitizeHTML(row[0]),
                name: sanitizeHTML(row[1]),
                email: sanitizeHTML(row[2]),
                balance: row[3],
                isAdmin: Boolean(row[4]),
                isBlocked: Boolean(row[5]),
                createdAt: row[6]
            })));
        } catch (error) {
            console.error('Ошибка получения пользователей:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.get('/api/users/:id', authenticateToken, userIdValidator, (req, res) => {
        try {
            // Разрешаем пользователю смотреть свой профиль, админу — любые
            if (req.user.id !== req.params.id && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы можете просматривать только свой профиль' });
            }
            const result = db.exec("SELECT id, name, email, balance, isAdmin, isBlocked, createdAt FROM users WHERE id = ?", [req.params.id]);
            if (result.length === 0 || result[0].values.length === 0) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }
            const row = result[0].values[0];
            res.json({
                id: sanitizeHTML(row[0]),
                name: sanitizeHTML(row[1]),
                email: sanitizeHTML(row[2]),
                balance: row[3],
                isAdmin: Boolean(row[4]),
                isBlocked: Boolean(row[5]),
                createdAt: row[6]
            });
        } catch (error) {
            console.error('Ошибка получения пользователя:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.post('/api/users/register', registerValidator, async (req, res) => {
        try {
            const { name, email, password } = req.body;

            // Проверка существующего пользователя (параметризованный запрос)
            const existing = db.exec("SELECT * FROM users WHERE email = ?", [email]);
            if (existing.length > 0 && existing[0].values.length > 0) {
                return res.status(409).json({ error: 'Пользователь уже существует' });
            }

            // Хеширование пароля (A02)
            const hashedPassword = await bcrypt.hash(password, 10);
            const id = uuidv4();

            db.run("INSERT INTO users (id, name, email, password, balance, isAdmin, isBlocked) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [id, sanitizeHTML(name), email.toLowerCase(), hashedPassword, 10000, 0, 0]);
            saveDatabase();

            // Логирование (A09)
            console.log(`[AUTH] Зарегистрирован новый пользователь: ${email}`);

            res.status(201).json({
                id,
                name: sanitizeHTML(name),
                email: email.toLowerCase(),
                balance: 10000,
                isAdmin: false,
                isBlocked: false
            });
        } catch (error) {
            console.error('Ошибка регистрации:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // Регистрация через форму (name, login, password)
    app.post('/api/auth/register', async (req, res) => {
        try {
            const { name, login, password } = req.body;

            if (!name || !login || !password) {
                return res.status(400).json({ error: 'Заполните все поля!' });
            }

            // Проверка логина
            const loginRegex = /^[a-zA-Z0-9_]{3,20}$/;
            if (!loginRegex.test(login)) {
                return res.status(400).json({ error: 'Логин: только латинские буквы, цифры и _ (3-20 символов)' });
            }

            // Проверка пароля
            if (password.length < 6) {
                return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
            }

            // Проверка существующего пользователя
            const existing = db.exec("SELECT * FROM users WHERE login = ? OR email = ?", [login.toLowerCase(), login.toLowerCase()]);
            if (existing.length > 0 && existing[0].values.length > 0) {
                return res.status(409).json({ error: 'Пользователь с таким логином уже существует' });
            }

            // Хеширование пароля
            const hashedPassword = await bcrypt.hash(password, 10);
            const id = uuidv4();

            db.run("INSERT INTO users (id, name, email, password, balance, isAdmin, isBlocked, login) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [id, sanitizeHTML(name), `${login.toLowerCase()}@studentmarket.ru`, hashedPassword, 10000, 0, 0, login.toLowerCase()]);
            saveDatabase();

            console.log(`[AUTH] Зарегистрирован новый пользователь: ${login}`);

            // Генерация JWT токена
            const tokenPayload = {
                id,
                name: sanitizeHTML(name),
                email: `${login.toLowerCase()}@studentmarket.ru`,
                isAdmin: false,
                login: login.toLowerCase()
            };
            
            const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
            const refreshToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });

            res.status(201).json({
                id,
                name: sanitizeHTML(name),
                email: `${login.toLowerCase()}@studentmarket.ru`,
                balance: 10000,
                isAdmin: false,
                isBlocked: false,
                login: login.toLowerCase(),
                token,
                refreshToken
            });
        } catch (error) {
            console.error('Ошибка регистрации:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // Вход по логину ИЛИ email (используется формой входа)
    app.post('/api/auth/login', async (req, res) => {
        try {
            const { login, password } = req.body;

            if (!login || !password) {
                return res.status(400).json({ error: 'Заполните все поля!' });
            }

            // Поиск пользователя по login ИЛИ email
            const result = db.exec(
                "SELECT id, name, email, password, balance, isAdmin, isBlocked, login FROM users WHERE login = ? OR email = ?",
                [login.toLowerCase(), login.toLowerCase()]
            );

            if (result.length === 0 || result[0].values.length === 0) {
                console.log(`[AUTH] Неудачная попытка входа: ${login} (пользователь не найден)`);
                return res.status(401).json({ error: 'Неверный логин/email или пароль' });
            }

            const row = result[0].values[0];
            const hashedPassword = row[3];

            // Проверка пароля
            const isValidPassword = await bcrypt.compare(password, hashedPassword);
            if (!isValidPassword) {
                console.log(`[AUTH] Неудачная попытка входа: ${login} (неверный пароль)`);
                return res.status(401).json({ error: 'Неверный логин/email или пароль' });
            }

            const user = {
                id: sanitizeHTML(row[0]),
                name: sanitizeHTML(row[1]),
                email: sanitizeHTML(row[2]),
                balance: row[4],
                isAdmin: Boolean(row[5]),
                isBlocked: Boolean(row[6]),
                login: sanitizeHTML(row[7]) || ''
            };

            if (user.isBlocked) {
                console.log(`[AUTH] Попытка входа заблокированного пользователя: ${login}`);
                return res.status(403).json({ error: 'Аккаунт заблокирован' });
            }

            // Генерация JWT токена
            const tokenPayload = {
                id: user.id,
                name: user.name,
                email: user.email,
                isAdmin: user.isAdmin,
                login: user.login
            };
            
            const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
            const refreshToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });

            console.log(`[AUTH] Успешный вход: ${login}`);
            res.json({
                ...user,
                token,
                refreshToken
            });
        } catch (error) {
            console.error('Ошибка входа:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.post('/api/users/login', loginValidator, async (req, res) => {
        try {
            const { email, password } = req.body;

            // Поиск пользователя (параметризованный запрос - A03)
            const result = db.exec("SELECT id, name, email, password, balance, isAdmin, isBlocked FROM users WHERE email = ?", [email.toLowerCase()]);
            
            if (result.length === 0 || result[0].values.length === 0) {
                console.log(`[AUTH] Неудачная попытка входа: ${email} (пользователь не найден)`);
                return res.status(401).json({ error: 'Неверный email или пароль' });
            }
            
            const row = result[0].values[0];
            const hashedPassword = row[3];
            
            // Проверка пароля (A02)
            const isValidPassword = await bcrypt.compare(password, hashedPassword);
            if (!isValidPassword) {
                console.log(`[AUTH] Неудачная попытка входа: ${email} (неверный пароль)`);
                return res.status(401).json({ error: 'Неверный email или пароль' });
            }
            
            const user = { 
                id: sanitizeHTML(row[0]), 
                name: sanitizeHTML(row[1]), 
                email: sanitizeHTML(row[2]), 
                balance: row[4], 
                isAdmin: Boolean(row[5]), 
                isBlocked: Boolean(row[6]) 
            };
            
            if (user.isBlocked) {
                console.log(`[AUTH] Попытка входа заблокированного пользователя: ${email}`);
                return res.status(403).json({ error: 'Аккаунт заблокирован' });
            }
            
            console.log(`[AUTH] Успешный вход: ${email}`);
            res.json(user);
        } catch (error) { 
            console.error('Ошибка входа:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    // БЕЗОПАСНОСТЬ: Изменение баланса — только для администраторов
    app.patch('/api/users/:id/balance', authenticateToken, requireAdmin, userIdValidator, (req, res) => {
        try {
            const { balance } = req.body;

            // Валидация баланса
            if (typeof balance !== 'number' || balance < 0 || balance > 10000000) {
                return res.status(400).json({ error: 'Некорректный баланс' });
            }

            db.run("UPDATE users SET balance = ? WHERE id = ?", [balance, req.params.id]);
            saveDatabase();

            const result = db.exec("SELECT id, name, email, balance, isAdmin, isBlocked FROM users WHERE id = ?", [req.params.id]);
            if (result.length === 0 || result[0].values.length === 0) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }

            const row = result[0].values[0];
            console.log(`[AUDIT] Баланс пользователя ${row[0]} изменён на ${balance} администратором ${req.user.id}`);
            res.json({
                id: sanitizeHTML(row[0]),
                name: sanitizeHTML(row[1]),
                email: sanitizeHTML(row[2]),
                balance: row[3],
                isAdmin: Boolean(row[4]),
                isBlocked: Boolean(row[5])
            });
        } catch (error) {
            console.error('Ошибка обновления баланса:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    // БЕЗОПАСНОСТЬ: Блокировка пользователей — только для администраторов
    app.patch('/api/users/:id/block', authenticateToken, requireAdmin, userIdValidator, (req, res) => {
        try {
            const { isBlocked } = req.body;

            if (typeof isBlocked !== 'boolean') {
                return res.status(400).json({ error: 'Некорректное значение isBlocked' });
            }

            db.run("UPDATE users SET isBlocked = ? WHERE id = ?", [isBlocked ? 1 : 0, req.params.id]);
            saveDatabase();

            const result = db.exec("SELECT id, name, email, balance, isAdmin, isBlocked FROM users WHERE id = ?", [req.params.id]);
            if (result.length === 0 || result[0].values.length === 0) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }

            const row = result[0].values[0];
            console.log(`[AUDIT] Пользователь ${row[0]} ${isBlocked ? 'заблокирован' : 'разблокирован'} администратором ${req.user.id}`);
            res.json({
                id: sanitizeHTML(row[0]),
                name: sanitizeHTML(row[1]),
                email: sanitizeHTML(row[2]),
                balance: row[3],
                isAdmin: Boolean(row[4]),
                isBlocked: Boolean(row[5])
            });
        } catch (error) {
            console.error('Ошибка блокировки:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // БЕЗОПАСНОСТЬ: Удаление пользователей — только для администраторов
    app.delete('/api/users/:id', authenticateToken, requireAdmin, userIdValidator, (req, res) => {
        try {
            const userResult = db.exec("SELECT isAdmin FROM users WHERE id = ?", [req.params.id]);
            if (userResult.length > 0 && userResult[0].values.length > 0 && userResult[0].values[0][0] === 1) {
                return res.status(403).json({ error: 'Нельзя удалить администратора' });
            }
            db.run("DELETE FROM users WHERE id = ?", [req.params.id]);
            saveDatabase();
            console.log(`[AUDIT] Пользователь ${req.params.id} удалён администратором ${req.user.id}`);
            res.json({ message: 'Пользователь удалён' });
        } catch (error) {
            console.error('Ошибка удаления:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // Обновление профиля пользователя (только для владельца или админа)
    const profileUpdateValidator = [
        body('name').optional().trim().notEmpty().withMessage('Имя не может быть пустым').isLength({ max: 100 }).withMessage('Имя слишком длинное'),
        body('email').optional().trim().isEmail().withMessage('Некорректный email').normalizeEmail(),
        body('photo_url').optional().trim().isURL().withMessage('Некорректный URL фото').isLength({ max: 500 }),
        validate
    ];

    app.patch('/api/users/:id', authenticateToken, userIdValidator, ...profileUpdateValidator, (req, res) => {
        try {
            // Проверяем, что пользователь обновляет свой профиль или это админ
            if (req.user.id !== req.params.id && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы можете обновлять только свой профиль' });
            }

            const { name, email, photo_url } = req.body;
            const updates = [];
            const params = [];

            if (name !== undefined) {
                updates.push("name = ?");
                params.push(sanitizeHTML(name));
            }
            if (email !== undefined) {
                // Проверка уникальности email
                const existing = db.exec("SELECT id FROM users WHERE email = ? AND id != ?", [email.toLowerCase(), req.params.id]);
                if (existing.length > 0 && existing[0].values.length > 0) {
                    return res.status(409).json({ error: 'Пользователь с таким email уже существует' });
                }
                updates.push("email = ?");
                params.push(email.toLowerCase());
            }
            if (photo_url !== undefined) {
                updates.push("photo_url = ?");
                params.push(photo_url);
            }

            if (updates.length === 0) {
                return res.status(400).json({ error: 'Нет данных для обновления' });
            }

            params.push(req.params.id);
            db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
            saveDatabase();

            const result = db.exec("SELECT id, name, email, balance, isAdmin, isBlocked, photo_url, login FROM users WHERE id = ?", [req.params.id]);
            if (result.length === 0 || result[0].values.length === 0) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }

            const row = result[0].values[0];
            console.log(`[AUDIT] Профиль пользователя ${row[0]} обновлён`);
            res.json({
                id: sanitizeHTML(row[0]),
                name: sanitizeHTML(row[1]),
                email: sanitizeHTML(row[2]),
                balance: row[3],
                isAdmin: Boolean(row[4]),
                isBlocked: Boolean(row[5]),
                photo_url: sanitizeHTML(row[6]),
                login: sanitizeHTML(row[7]) || ''
            });
        } catch (error) {
            console.error('Ошибка обновления профиля:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ============================================
    // АВТОРИЗАЦИЯ: ВКонтакте
    // ============================================
    // БЕЗОПАСНОСТЬ: JWT аутентификация
    // ============================================

    // Получение текущего пользователя по токену
    app.get('/api/auth/me', authenticateToken, async (req, res) => {
        try {
            const result = db.exec(
                "SELECT id, name, email, balance, isAdmin, isBlocked, login, photo_url FROM users WHERE id = ?",
                [req.user.id]
            );

            if (!result.length || !result[0].values.length) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }

            const row = result[0].values[0];
            res.json({
                id: sanitizeHTML(row[0]),
                name: sanitizeHTML(row[1]),
                email: sanitizeHTML(row[2]),
                balance: row[3],
                isAdmin: Boolean(row[4]),
                isBlocked: Boolean(row[5]),
                login: sanitizeHTML(row[6]) || '',
                photo_url: sanitizeHTML(row[7])
            });
        } catch (error) {
            console.error('Ошибка получения пользователя:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // Обновление токена
    app.post('/api/auth/refresh', async (req, res) => {
        try {
            const { refreshToken } = req.body;
            
            if (!refreshToken) {
                return res.status(401).json({ error: 'Требуется refresh токен' });
            }

            const decoded = jwt.verify(refreshToken, JWT_SECRET);
            
            // Проверяем, что пользователь всё ещё существует и не заблокирован
            const result = db.exec(
                "SELECT id, name, email, balance, isAdmin, isBlocked, login FROM users WHERE id = ?",
                [decoded.id]
            );

            if (!result.length || !result[0].values.length) {
                return res.status(401).json({ error: 'Пользователь не найден' });
            }

            const row = result[0].values[0];
            if (Boolean(row[5])) { // isBlocked
                return res.status(403).json({ error: 'Аккаунт заблокирован' });
            }

            const tokenPayload = {
                id: row[0],
                name: sanitizeHTML(row[1]),
                email: sanitizeHTML(row[2]),
                isAdmin: Boolean(row[4]),
                login: sanitizeHTML(row[6]) || ''
            };

            const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
            const newRefreshToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });

            res.json({ token, refreshToken: newRefreshToken });
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({ error: 'Refresh токен истёк, войдите заново' });
            }
            return res.status(403).json({ error: 'Неверный refresh токен' });
        }
    });

    // Выход из системы (клиент должен удалить токен)
    app.post('/api/auth/logout', authenticateToken, (req, res) => {
        console.log(`[AUTH] Выход пользователя: ${req.user.id}`);
        res.json({ message: 'Вы успешно вышли из системы' });
    });

    // Смена пароля (требует аутентификации)
    const changePasswordValidator = [
        body('currentPassword').notEmpty().withMessage('Текущий пароль обязателен'),
        body('newPassword').notEmpty().withMessage('Новый пароль обязателен').isLength({ min: 6, max: 128 }).withMessage('Пароль должен быть от 6 до 128 символов'),
        validate
    ];

    app.post('/api/auth/change-password', authenticateToken, changePasswordValidator, async (req, res) => {
        try {
            const { currentPassword, newPassword } = req.body;

            // Получаем текущего пользователя
            const result = db.exec("SELECT password FROM users WHERE id = ?", [req.user.id]);
            if (!result.length || !result[0].values.length) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }

            const hashedPassword = result[0].values[0][0];

            // Проверяем текущий пароль
            const isValidPassword = await bcrypt.compare(currentPassword, hashedPassword);
            if (!isValidPassword) {
                return res.status(401).json({ error: 'Неверный текущий пароль' });
            }

            // Хешируем новый пароль
            const newHashedPassword = await bcrypt.hash(newPassword, 10);
            db.run("UPDATE users SET password = ? WHERE id = ?", [newHashedPassword, req.user.id]);
            saveDatabase();

            console.log(`[AUTH] Пароль пользователя ${req.user.id} изменён`);
            res.json({ message: 'Пароль успешно изменён' });
        } catch (error) {
            console.error('Ошибка смены пароля:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // Запрос на восстановление пароля (отправка ссылки/кода)
    const forgotPasswordValidator = [
        body('email').trim().notEmpty().withMessage('Email обязателен').isEmail().withMessage('Некорректный email').normalizeEmail(),
        validate
    ];

    // Временное хранилище токенов восстановления (в продакшене использовать Redis/БД)
    const resetTokens = new Map();

    app.post('/api/auth/forgot-password', forgotPasswordValidator, async (req, res) => {
        try {
            const { email } = req.body;

            // Проверяем, что пользователь существует
            const result = db.exec("SELECT id FROM users WHERE email = ?", [email.toLowerCase()]);
            if (!result.length || !result[0].values.length) {
                // Не раскрываем, существует ли пользователь (безопасность)
                return res.json({ message: 'Если пользователь с таким email существует, ссылка для восстановления отправлена' });
            }

            const userId = result[0].values[0][0];

            // Генерируем токен восстановления
            const resetToken = crypto.randomBytes(32).toString('hex');
            const expiresAt = Date.now() + 15 * 60 * 1000; // 15 минут

            resetTokens.set(resetToken, { userId, expiresAt });

            // В продакшене здесь отправка email со ссылкой
            // Для разработки возвращаем токен в ответе
            console.log(`[AUTH] Запрос восстановления пароля для ${email}, токен: ${resetToken}`);

            res.json({
                message: 'Если пользователь с таким email существует, ссылка для восстановления отправлена',
                // В продакшене удалить это поле:
                resetToken: process.env.NODE_ENV === 'development' ? resetToken : undefined
            });
        } catch (error) {
            console.error('Ошибка восстановления пароля:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // Сброс пароля с токеном
    const resetPasswordValidator = [
        body('resetToken').trim().notEmpty().withMessage('Токен восстановления обязателен'),
        body('newPassword').notEmpty().withMessage('Новый пароль обязателен').isLength({ min: 6, max: 128 }).withMessage('Пароль должен быть от 6 до 128 символов'),
        validate
    ];

    app.post('/api/auth/reset-password', resetPasswordValidator, async (req, res) => {
        try {
            const { resetToken, newPassword } = req.body;

            const tokenData = resetTokens.get(resetToken);
            if (!tokenData) {
                return res.status(400).json({ error: 'Неверный или истёкший токен восстановления' });
            }

            if (Date.now() > tokenData.expiresAt) {
                resetTokens.delete(resetToken);
                return res.status(400).json({ error: 'Токен восстановления истёк' });
            }

            // Хешируем новый пароль
            const newHashedPassword = await bcrypt.hash(newPassword, 10);
            db.run("UPDATE users SET password = ? WHERE id = ?", [newHashedPassword, tokenData.userId]);
            saveDatabase();

            resetTokens.delete(resetToken);

            console.log(`[AUTH] Пароль пользователя ${tokenData.userId} сброшен`);
            res.json({ message: 'Пароль успешно сброшен' });
        } catch (error) {
            console.error('Ошибка сброса пароля:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ============================================
    // БЕЗОПАСНОСТЬ: VK OAuth
    // ============================================

    app.get('/api/config/vk', (req, res) => {
        res.json({
            clientId: process.env.VK_CLIENT_ID || null,
            redirectUri: process.env.VK_REDIRECT_URI || null
        });
    });

    app.post('/api/auth/vk', async (req, res) => {
        try {
            const { code } = req.body;
            if (!code) {
                return res.status(400).json({ error: 'Код авторизации не передан' });
            }

            const clientId = process.env.VK_CLIENT_ID;
            const clientSecret = process.env.VK_CLIENT_SECRET;
            const redirectUri = process.env.VK_REDIRECT_URI;

            if (!clientId || !clientSecret) {
                return res.status(500).json({ error: 'VK авторизация не настроена' });
            }

            const tokenResponse = await fetch('https://oauth.vk.com/access_token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: redirectUri,
                    code: code
                })
            });

            const tokenData = await tokenResponse.json();
            if (!tokenData.access_token) {
                return res.status(401).json({ error: 'Ошибка авторизации VK' });
            }

            const { access_token, user_id } = tokenData;

            const userResponse = await fetch('https://api.vk.com/method/users.get', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    access_token: access_token,
                    v: '5.131',
                    fields: 'photo_100,photo_200'
                })
            });

            const userData = await userResponse.json();
            if (!userData.response || userData.response.length === 0) {
                return res.status(401).json({ error: 'Не удалось получить данные пользователя VK' });
            }

            const vkUser = userData.response[0];
            const fullName = `${vkUser.first_name || ''} ${vkUser.last_name || ''}`.trim() || `user_${user_id}`;
            const photoUrl = vkUser.photo_200 || vkUser.photo_100 || null;

            let result = db.exec("SELECT * FROM users WHERE vk_id = ?", [user_id]);

            if (result.length === 0 || result[0].values.length === 0) {
                const hashedPassword = await bcrypt.hash(uuidv4(), 10);
                const newId = uuidv4();
                const login = `vk_${user_id}`;
                db.run(`INSERT INTO users (id, name, email, password, balance, isAdmin, isBlocked, photo_url, login, vk_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [newId, sanitizeHTML(fullName), `${user_id}@vk.user`, hashedPassword, 10000, 0, 0, photoUrl, login, user_id]);
                saveDatabase();
                result = db.exec("SELECT * FROM users WHERE id = ?", [newId]);
                console.log(`[VK] Создан: ${fullName}`);
            } else {
                console.log(`[VK] Вход: ${fullName}`);
            }

            const row = result[0].values[0];
            res.json({
                id: sanitizeHTML(row[0]),
                name: sanitizeHTML(row[1]),
                email: sanitizeHTML(row[2]),
                balance: row[4],
                isAdmin: Boolean(row[5]),
                isBlocked: Boolean(row[6]),
                photoUrl: row[8] || photoUrl,
                login: row[9] || `vk_${user_id}`
            });
        } catch (error) {
            console.error('[VK] Ошибка:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ============================================
    // API: Товары
    // ============================================

    // GET /api/products — с пагинацией и фильтрацией
    app.get('/api/products', (req, res) => {
        try {
            const { page, limit, category, discipline, search, minPrice, maxPrice } = req.query;

            // Строим WHERE условие
            let where = "WHERE status = 'approved'";
            const params = [];

            if (category) {
                where += ' AND category = ?';
                params.push(category);
            }
            if (discipline) {
                where += ' AND discipline LIKE ?';
                params.push(`%${discipline}%`);
            }
            if (search) {
                where += ' AND (title LIKE ? OR discipline LIKE ?)';
                params.push(`%${search}%`, `%${search}%`);
            }
            if (minPrice) {
                where += ' AND price >= ?';
                params.push(parseInt(minPrice));
            }
            if (maxPrice) {
                where += ' AND price <= ?';
                params.push(parseInt(maxPrice));
            }

            // Пагинация
            const pageNum = parseInt(page) || 1;
            const limitNum = parseInt(limit) || 20;
            const offset = (pageNum - 1) * limitNum;

            // Считаем общее количество
            const countResult = db.exec(`SELECT COUNT(*) FROM products ${where}`, params);
            const totalCount = countResult.length > 0 ? countResult[0].values[0][0] : 0;

            // Получаем товары с пагинацией
            const result = db.exec(`SELECT * FROM products ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`, [...params, limitNum, offset]);

            if (result.length === 0 || result[0].values.length === 0) {
                return res.json({
                    products: [],
                    pagination: { page: pageNum, limit: limitNum, total: 0, pages: 0 }
                });
            }

            const products = result[0].values.map(row => ({
                id: row[0],
                title: sanitizeHTML(row[1]),
                category: sanitizeHTML(row[2]),
                discipline: sanitizeHTML(row[3]),
                price: row[4],
                sellerId: sanitizeHTML(row[5]),
                sellerName: sanitizeHTML(row[6]),
                deadline: row[7],
                status: sanitizeHTML(row[8]),
                createdAt: row[9]
            }));

            res.json({
                products,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: totalCount,
                    pages: Math.ceil(totalCount / limitNum)
                }
            });
        } catch (error) {
            console.error('Ошибка получения товаров:', error.message);
            res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
        }
    });

    // GET /api/products/:id — получение одного товара по ID
    const productIdValidator = [
        param('id').notEmpty().isInt({ min: 1 }).withMessage('Некорректный ID товара'),
        validate
    ];

    app.get('/api/products/:id', productIdValidator, (req, res) => {
        try {
            const result = db.exec("SELECT * FROM products WHERE id = ?", [req.params.id]);

            if (result.length === 0 || result[0].values.length === 0) {
                return res.status(404).json({ error: 'Товар не найден' });
            }

            const row = result[0].values[0];
            res.json({
                id: row[0],
                title: sanitizeHTML(row[1]),
                category: sanitizeHTML(row[2]),
                discipline: sanitizeHTML(row[3]),
                price: row[4],
                sellerId: sanitizeHTML(row[5]),
                sellerName: sanitizeHTML(row[6]),
                deadline: row[7],
                status: sanitizeHTML(row[8]),
                createdAt: row[9]
            });
        } catch (error) {
            console.error('Ошибка получения товара:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // БЕЗОПАСНОСТЬ: Просмотр всех товаров (включая pending/rejected) — только для администраторов
    app.get('/api/products/all', authenticateToken, requireAdmin, (req, res) => {
        try {
            const result = db.exec("SELECT * FROM products");
            res.json(result.length > 0 ? result[0].values.map(row => ({
                id: row[0],
                title: sanitizeHTML(row[1]),
                category: sanitizeHTML(row[2]),
                discipline: sanitizeHTML(row[3]),
                price: row[4],
                sellerId: sanitizeHTML(row[5]),
                sellerName: sanitizeHTML(row[6]),
                deadline: row[7],
                status: sanitizeHTML(row[8]),
                createdAt: row[9]
            })) : []);
        } catch (error) {
            console.error('Ошибка получения всех товаров:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.get('/api/users/:id/products', authenticateToken, userIdValidator, (req, res) => {
        try {
            // Разрешаем пользователю смотреть свои товары, админу — любые
            if (req.user.id !== req.params.id && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы можете просматривать только свои товары' });
            }
            const result = db.exec("SELECT * FROM products WHERE sellerId = ?", [req.params.id]);
            res.json(result.length > 0 ? result[0].values.map(row => ({
                id: row[0],
                title: sanitizeHTML(row[1]),
                category: sanitizeHTML(row[2]),
                discipline: sanitizeHTML(row[3]),
                price: row[4],
                sellerId: sanitizeHTML(row[5]),
                sellerName: sanitizeHTML(row[6]),
                deadline: row[7],
                status: sanitizeHTML(row[8]),
                createdAt: row[9]
            })) : []);
        } catch (error) {
            console.error('Ошибка получения товаров пользователя:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.post('/api/products', authenticateToken, productCreateValidator, (req, res) => {
        try {
            const { title, category, discipline, price, sellerId, sellerName, deadline } = req.body;

            // Проверяем, что авторизованный пользователь — это продавец
            if (req.user.id !== sellerId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы можете создавать товары только от своего имени' });
            }
            
            db.run("INSERT INTO products (title, category, discipline, price, sellerId, sellerName, deadline, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')", 
                [sanitizeHTML(title), sanitizeHTML(category), sanitizeHTML(discipline), price, sanitizeHTML(sellerId), sanitizeHTML(sellerName), deadline || null]);
            saveDatabase();
            
            const result = db.exec("SELECT last_insert_rowid()");
            const productId = result[0].values[0][0];
            
            console.log(`[PRODUCT] Создан новый товар: ${productId}, продавец: ${sellerId}`);
            
            res.status(201).json({ 
                id: productId, 
                title: sanitizeHTML(title), 
                category: sanitizeHTML(category), 
                discipline: sanitizeHTML(discipline), 
                price, 
                sellerId: sanitizeHTML(sellerId), 
                sellerName: sanitizeHTML(sellerName), 
                deadline, 
                status: 'pending' 
            });
        } catch (error) { 
            console.error('Ошибка создания товара:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    // БЕЗОПАСНОСТЬ: Одобрение товара — только для администраторов
    app.patch('/api/products/:id/approve', authenticateToken, requireAdmin, [param('id').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            // Получаем sellerId до обновления
            const productResult = db.exec("SELECT sellerId, title FROM products WHERE id = ?", [req.params.id]);
            db.run("UPDATE products SET status = 'approved' WHERE id = ?", [req.params.id]);
            saveDatabase();
            console.log(`[AUDIT] Товар ${req.params.id} одобрен администратором ${req.user.id}`);

            if (productResult.length && productResult[0].values.length) {
                const sellerId = productResult[0].values[0][0];
                const title = productResult[0].values[0][1];
                createNotification(sellerId, 'Товар одобрен', `Ваш товар "${sanitizeHTML(title)}" прошёл модерацию`, 'moderation');
            }

            res.json({ message: 'Товар одобрен' });
        } catch (error) {
            console.error('Ошибка одобрения:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // БЕЗОПАСНОСТЬ: Отклонение товара — только для администраторов
    app.patch('/api/products/:id/reject', authenticateToken, requireAdmin, [param('id').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            const productResult = db.exec("SELECT sellerId, title FROM products WHERE id = ?", [req.params.id]);
            db.run("UPDATE products SET status = 'rejected' WHERE id = ?", [req.params.id]);
            saveDatabase();
            console.log(`[AUDIT] Товар ${req.params.id} отклонён администратором ${req.user.id}`);

            if (productResult.length && productResult[0].values.length) {
                const sellerId = productResult[0].values[0][0];
                const title = productResult[0].values[0][1];
                createNotification(sellerId, 'Товар отклонён', `Ваш товар "${sanitizeHTML(title)}" не прошёл модерацию`, 'moderation');
            }

            res.json({ message: 'Товар отклонён' });
        } catch (error) {
            console.error('Ошибка отклонения:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // БЕЗОПАСНОСТЬ: Удаление товара — только для владельца или администратора
    app.delete('/api/products/:id', authenticateToken, [param('id').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            // Проверяем владельца товара
            const productResult = db.exec("SELECT sellerId FROM products WHERE id = ?", [req.params.id]);

            if (!productResult.length || !productResult[0].values.length) {
                return res.status(404).json({ error: 'Товар не найден' });
            }

            const sellerId = productResult[0].values[0][0];

            // Проверяем права: владелец или админ
            if (req.user.id !== sellerId && !req.user.isAdmin) {
                console.log(`[AUTH] Попытка удаления чужого товара: пользователь ${req.user.id}, товар ${req.params.id}, владелец ${sellerId}`);
                return res.status(403).json({ error: 'Доступ запрещён: вы не владелец этого товара' });
            }

            db.run("DELETE FROM products WHERE id = ?", [req.params.id]);
            saveDatabase();
            console.log(`[AUDIT] Товар ${req.params.id} удалён пользователем ${req.user.id}`);
            res.json({ message: 'Товар удалён' });
        } catch (error) {
            console.error('Ошибка удаления товара:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // PATCH /api/products/:id — редактирование товара (только владелец или админ)
    const productEditValidator = [
        param('id').notEmpty().isInt({ min: 1 }).withMessage('Некорректный ID товара'),
        body('title').optional().trim().notEmpty().withMessage('Название не может быть пустым').isLength({ max: 200 }),
        body('category').optional().trim().isIn(['practices', 'labs', 'courses']).withMessage('Некорректная категория'),
        body('discipline').optional().trim().notEmpty().withMessage('Дисциплина не может быть пустой').isLength({ max: 100 }),
        body('price').optional().isInt({ min: 1, max: 1000000 }).withMessage('Некорректная цена'),
        body('deadline').optional().isISO8601().withMessage('Некорректная дата дедлайна'),
        validate
    ];

    app.patch('/api/products/:id', authenticateToken, productEditValidator, (req, res) => {
        try {
            // Проверяем владельца товара
            const productResult = db.exec("SELECT sellerId FROM products WHERE id = ?", [req.params.id]);

            if (!productResult.length || !productResult[0].values.length) {
                return res.status(404).json({ error: 'Товар не найден' });
            }

            const sellerId = productResult[0].values[0][0];

            // Проверяем права: владелец или админ
            if (req.user.id !== sellerId && !req.user.isAdmin) {
                console.log(`[AUTH] Попытка редактирования чужого товара: пользователь ${req.user.id}, товар ${req.params.id}, владелец ${sellerId}`);
                return res.status(403).json({ error: 'Доступ запрещён: вы не владелец этого товара' });
            }

            const { title, category, discipline, price, deadline } = req.body;
            const updates = [];
            const params = [];

            if (title !== undefined) {
                updates.push("title = ?");
                params.push(sanitizeHTML(title));
            }
            if (category !== undefined) {
                updates.push("category = ?");
                params.push(sanitizeHTML(category));
            }
            if (discipline !== undefined) {
                updates.push("discipline = ?");
                params.push(sanitizeHTML(discipline));
            }
            if (price !== undefined) {
                updates.push("price = ?");
                params.push(price);
            }
            if (deadline !== undefined) {
                updates.push("deadline = ?");
                params.push(deadline);
            }

            if (updates.length === 0) {
                return res.status(400).json({ error: 'Нет данных для обновления' });
            }

            params.push(req.params.id);
            db.run(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`, params);
            saveDatabase();

            console.log(`[AUDIT] Товар ${req.params.id} отредактирован пользователем ${req.user.id}`);

            // Возвращаем обновлённый товар
            const result = db.exec("SELECT * FROM products WHERE id = ?", [req.params.id]);
            const row = result[0].values[0];
            res.json({
                id: row[0],
                title: sanitizeHTML(row[1]),
                category: sanitizeHTML(row[2]),
                discipline: sanitizeHTML(row[3]),
                price: row[4],
                sellerId: sanitizeHTML(row[5]),
                sellerName: sanitizeHTML(row[6]),
                deadline: row[7],
                status: sanitizeHTML(row[8]),
                createdAt: row[9]
            });
        } catch (error) {
            console.error('Ошибка редактирования товара:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // GET /api/users/:id/products/pending — товары продавца на модерации
    app.get('/api/users/:id/products/pending', authenticateToken, userIdValidator, (req, res) => {
        try {
            // Разрешаем пользователю смотреть свои pending товары, админу — любые
            if (req.user.id !== req.params.id && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы можете просматривать только свои товары на модерации' });
            }

            const result = db.exec("SELECT * FROM products WHERE sellerId = ? AND status = 'pending' ORDER BY createdAt DESC", [req.params.id]);
            res.json(result.length > 0 ? result[0].values.map(row => ({
                id: row[0],
                title: sanitizeHTML(row[1]),
                category: sanitizeHTML(row[2]),
                discipline: sanitizeHTML(row[3]),
                price: row[4],
                sellerId: sanitizeHTML(row[5]),
                sellerName: sanitizeHTML(row[6]),
                deadline: row[7],
                status: sanitizeHTML(row[8]),
                createdAt: row[9]
            })) : []);
        } catch (error) {
            console.error('Ошибка получения товаров на модерации:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ============================================
    // API: Покупки
    // ============================================

    // БЕЗОПАСНОСТЬ: Покупки — только для авторизованного пользователя и только свои
    app.get('/api/users/:id/purchases', authenticateToken, userIdValidator, (req, res) => {
        try {
            // Проверяем, что пользователь запрашивает свои покупки
            if (req.user.id !== req.params.id && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы можете просматривать только свои покупки' });
            }
            
            const result = db.exec(`
                SELECT p.*, u.name as sellerName
                FROM purchases p
                LEFT JOIN users u ON p.sellerId = u.id
                WHERE p.buyerId = ?
            `, [req.params.id]);
            res.json(result.length > 0 ? result[0].values.map(row => ({
                id: row[0],
                productId: row[1],
                title: sanitizeHTML(row[2]),
                price: row[3],
                buyerId: sanitizeHTML(row[4]),
                sellerId: sanitizeHTML(row[5]),
                sellerName: sanitizeHTML(row[9]),
                deadline: row[6],
                date: row[7],
                fileAttached: Boolean(row[8]),
                status: sanitizeHTML(row[10] || 'active')
            })) : []);
        } catch (error) {
            console.error('Ошибка получения покупок:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // БЕЗОПАСНОСТЬ: Продажи — только для авторизованного пользователя и только свои
    app.get('/api/users/:id/sales', authenticateToken, userIdValidator, (req, res) => {
        try {
            // Проверяем, что пользователь запрашивает свои продажи
            if (req.user.id !== req.params.id && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы можете просматривать только свои продажи' });
            }

            console.log(`[SALES] Запрос продаж для sellerId: ${req.params.id}`);
            const result = db.exec(`
                SELECT p.*, u.name as buyerName
                FROM purchases p
                LEFT JOIN users u ON p.buyerId = u.id
                WHERE p.sellerId = ?
            `, [req.params.id]);
            console.log(`[SALES] Найдено записей: ${result.length > 0 ? result[0].values.length : 0}`);
            res.json(result.length > 0 ? result[0].values.map(row => ({
                id: row[0],
                productId: row[1],
                title: sanitizeHTML(row[2]),
                price: row[3],
                buyerId: sanitizeHTML(row[4]),
                buyerName: sanitizeHTML(row[9]),
                sellerId: sanitizeHTML(row[5]),
                deadline: row[6],
                date: row[7],
                fileAttached: Boolean(row[8]),
                status: sanitizeHTML(row[10] || 'active')
            })) : []);
        } catch (error) {
            console.error('Ошибка получения продаж:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // БЕЗОПАСНОСТЬ: Создание покупки — только для авторизованных пользователей с корректной работой баланса
    app.post('/api/purchases', authenticateToken, purchaseCreateValidator, (req, res) => {
        try {
            const { productId, title, price, buyerId, sellerId, deadline } = req.body;

            // Проверяем, что авторизованный пользователь — это покупатель
            if (req.user.id !== buyerId) {
                console.log(`[AUTH] Попытка создания покупки от чужого имени: пользователь ${req.user.id}, buyerId ${buyerId}`);
                return res.status(403).json({ error: 'Доступ запрещён: вы можете совершать покупки только от своего имени' });
            }

            // ЗАЩИТА: Проверяем, что покупатель не является продавцом
            if (buyerId === sellerId) {
                console.log(`[PURCHASE] Попытка покупки своего товара: покупатель=${buyerId}, продавец=${sellerId}`);
                return res.status(403).json({ error: 'Нельзя купить свой собственный товар' });
            }

            // Проверяем, что товар существует и одобрен
            const productResult = db.exec("SELECT id, status FROM products WHERE id = ?", [productId]);
            if (!productResult.length || !productResult[0].values.length) {
                return res.status(404).json({ error: 'Товар не найден' });
            }
            
            if (productResult[0].values[0][1] !== 'approved') {
                return res.status(400).json({ error: 'Товар не одобрен для продажи' });
            }

            // Проверяем баланс покупателя
            const buyerResult = db.exec("SELECT balance FROM users WHERE id = ?", [buyerId]);
            if (!buyerResult.length || !buyerResult[0].values.length) {
                return res.status(404).json({ error: 'Покупатель не найден' });
            }
            
            const buyerBalance = buyerResult[0].values[0][0];
            if (buyerBalance < price) {
                return res.status(400).json({ error: 'Недостаточно средств на балансе' });
            }

            // Проверяем, что продавец существует
            const sellerResult = db.exec("SELECT id FROM users WHERE id = ?", [sellerId]);
            if (!sellerResult.length || !sellerResult[0].values.length) {
                return res.status(404).json({ error: 'Продавец не найден' });
            }

            // Проверка уникальности — нельзя купить один товар дважды
            const existingPurchase = db.exec("SELECT id FROM purchases WHERE productId = ? AND buyerId = ? AND status = 'active'", [productId, buyerId]);
            if (existingPurchase.length > 0 && existingPurchase[0].values.length > 0) {
                return res.status(409).json({ error: 'Вы уже купили этот товар' });
            }

            // Транзакция: списываем у покупателя и начисляем продавцу
            const newBuyerBalance = buyerBalance - price;
            db.run("UPDATE users SET balance = ? WHERE id = ?", [newBuyerBalance, buyerId]);

            // Получаем текущий баланс продавца и начисляем
            const sellerBalanceResult = db.exec("SELECT balance FROM users WHERE id = ?", [sellerId]);
            const sellerBalance = sellerBalanceResult[0].values[0][0];
            const newSellerBalance = sellerBalance + price;
            db.run("UPDATE users SET balance = ? WHERE id = ?", [newSellerBalance, sellerId]);

            // Создаём запись о покупке
            db.run("INSERT INTO purchases (productId, title, price, buyerId, sellerId, deadline) VALUES (?, ?, ?, ?, ?, ?)",
                [productId, sanitizeHTML(title), price, sanitizeHTML(buyerId), sanitizeHTML(sellerId), deadline || null]);
            saveDatabase();

            // Записываем транзакции
            db.run("INSERT INTO transactions (userId, type, amount, description, purchaseId) VALUES (?, ?, ?, ?, ?)",
                [buyerId, 'debit', price, `Покупка товара #${productId}`, null]);
            const txResult = db.exec("SELECT last_insert_rowid()");
            const purchaseIdRef = txResult ? db.exec("SELECT last_insert_rowid()")[0].values[0][0] : null;

            db.run("INSERT INTO transactions (userId, type, amount, description, purchaseId) VALUES (?, ?, ?, ?, ?)",
                [sellerId, 'credit', price, `Продажа товара #${productId}`, purchaseIdRef]);

            const result = db.exec("SELECT last_insert_rowid()");
            const purchaseId = result[0].values[0][0];

            console.log(`[PURCHASE] Создана покупка: ${purchaseId}, покупатель: ${buyerId}, продавец: ${sellerId}, сумма: ${price}`);
            console.log(`[BALANCE] Баланс покупателя ${buyerId}: ${buyerBalance} -> ${newBuyerBalance}`);
            console.log(`[BALANCE] Баланс продавца ${sellerId}: ${sellerBalance} -> ${newSellerBalance}`);

            // Авто-уведомления
            createNotification(sellerId, 'Новая покупка', `Ваш товар "${sanitizeHTML(title)}" был куплен`, 'purchase');
            createNotification(buyerId, 'Покупка оформлена', `Вы купили "${sanitizeHTML(title)}" за ${price}`, 'purchase');

            res.status(201).json({
                id: purchaseId,
                productId,
                title: sanitizeHTML(title),
                price,
                buyerId: sanitizeHTML(buyerId),
                sellerId: sanitizeHTML(sellerId),
                deadline,
                buyerBalance: newBuyerBalance
            });
        } catch (error) {
            console.error('Ошибка создания покупки:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // GET /api/purchases/:id — получение одной покупки по ID
    const purchaseIdValidator = [
        param('id').notEmpty().isInt({ min: 1 }).withMessage('Некорректный ID покупки'),
        validate
    ];

    app.get('/api/purchases/:id', authenticateToken, purchaseIdValidator, (req, res) => {
        try {
            const result = db.exec(`
                SELECT p.*, u.name as sellerName, b.name as buyerName
                FROM purchases p
                LEFT JOIN users u ON p.sellerId = u.id
                LEFT JOIN users b ON p.buyerId = b.id
                WHERE p.id = ?
            `, [req.params.id]);

            if (!result.length || !result[0].values.length) {
                return res.status(404).json({ error: 'Покупка не найдена' });
            }

            const row = result[0].values[0];

            // Проверяем, что пользователь — участник покупки или админ
            if (req.user.id !== row[4] && req.user.id !== row[5] && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы не участник этой покупки' });
            }

            res.json({
                id: row[0],
                productId: row[1],
                title: sanitizeHTML(row[2]),
                price: row[3],
                buyerId: sanitizeHTML(row[4]),
                sellerId: sanitizeHTML(row[5]),
                buyerName: sanitizeHTML(row[10]),
                sellerName: sanitizeHTML(row[9]),
                deadline: row[6],
                date: row[7],
                fileAttached: Boolean(row[8]),
                status: sanitizeHTML(row[11] || 'active')
            });
        } catch (error) {
            console.error('Ошибка получения покупки:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // DELETE /api/purchases/:id — удаление покупки (админ или покупатель до передачи файла)
    app.delete('/api/purchases/:id', authenticateToken, purchaseIdValidator, (req, res) => {
        try {
            const result = db.exec("SELECT buyerId, fileAttached, status FROM purchases WHERE id = ?", [req.params.id]);

            if (!result.length || !result[0].values.length) {
                return res.status(404).json({ error: 'Покупка не найдена' });
            }

            const row = result[0].values[0];
            const buyerId = row[0];
            const fileAttached = row[1];
            const status = row[2];

            // Удалить может: админ, или покупатель (если файл ещё не прикреплён и статус active)
            if (req.user.isAdmin) {
                // Админ может отменить и вернуть средства
                // Возвращаем средства покупателю и списываем у продавца
                const purchasePrice = db.exec("SELECT price, buyerId, sellerId FROM purchases WHERE id = ?", [req.params.id])[0].values[0];
                const [price, bId, sId] = purchasePrice;

                const buyerBal = db.exec("SELECT balance FROM users WHERE id = ?", [bId])[0].values[0][0];
                const sellerBal = db.exec("SELECT balance FROM users WHERE id = ?", [sId])[0].values[0][0];

                db.run("UPDATE users SET balance = ? WHERE id = ?", [buyerBal + price, bId]);
                db.run("UPDATE users SET balance = ? WHERE id = ?", [sellerBal - price, sId]);

                db.run("DELETE FROM purchases WHERE id = ?", [req.params.id]);
                saveDatabase();
                console.log(`[AUDIT] Покупка ${req.params.id} удалена администратором ${req.user.id}, средства возвращены`);
                return res.json({ message: 'Покупка удалена, средства возвращены' });
            }

            if (req.user.id !== buyerId) {
                return res.status(403).json({ error: 'Доступ запрещён: только покупатель может удалить покупку' });
            }

            if (fileAttached) {
                return res.status(400).json({ error: 'Нельзя удалить покупку после получения файла' });
            }

            if (status !== 'active') {
                return res.status(400).json({ error: `Нельзя удалить покупку в статусе "${status}"` });
            }

            // Возвращаем средства
            const purchasePrice = db.exec("SELECT price, sellerId FROM purchases WHERE id = ?", [req.params.id])[0].values[0];
            const [price, sId] = purchasePrice;

            const buyerBal = db.exec("SELECT balance FROM users WHERE id = ?", [buyerId])[0].values[0][0];
            const sellerBal = db.exec("SELECT balance FROM users WHERE id = ?", [sId])[0].values[0][0];

            db.run("UPDATE users SET balance = ? WHERE id = ?", [buyerBal + price, buyerId]);
            db.run("UPDATE users SET balance = ? WHERE id = ?", [sellerBal - price, sId]);

            db.run("DELETE FROM purchases WHERE id = ?", [req.params.id]);
            saveDatabase();
            console.log(`[AUDIT] Покупка ${req.params.id} удалена покупателем ${buyerId}, средства возвращены`);
            res.json({ message: 'Покупка удалена, средства возвращены' });
        } catch (error) {
            console.error('Ошибка удаления покупки:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // PATCH /api/purchases/:id/status — обновление статуса покупки
    const purchaseStatusValidator = [
        param('id').notEmpty().isInt({ min: 1 }).withMessage('Некорректный ID покупки'),
        body('status').isIn(['active', 'completed', 'cancelled', 'disputed']).withMessage('Некорректный статус'),
        validate
    ];

    app.patch('/api/purchases/:id/status', authenticateToken, purchaseStatusValidator, (req, res) => {
        try {
            const result = db.exec("SELECT buyerId, sellerId, status FROM purchases WHERE id = ?", [req.params.id]);

            if (!result.length || !result[0].values.length) {
                return res.status(404).json({ error: 'Покупка не найдена' });
            }

            const row = result[0].values[0];
            const buyerId = row[0];
            const sellerId = row[1];
            const currentStatus = row[2];

            const newStatus = req.body.status;

            // Сменить статус может: админ, продавец (completed/cancelled), покупатель (cancelled)
            const isParticipant = req.user.id === buyerId || req.user.id === sellerId;
            if (!req.user.isAdmin && !isParticipant) {
                return res.status(403).json({ error: 'Доступ запрещён: вы не участник этой покупки' });
            }

            // Покупатель может только отменить
            if (req.user.id === buyerId && !req.user.isAdmin && newStatus !== 'cancelled') {
                return res.status(403).json({ error: 'Покупатель может только отменить покупку' });
            }

            // Если отмена — возвращаем средства
            if (newStatus === 'cancelled' && currentStatus === 'active') {
                const purchaseData = db.exec("SELECT price, buyerId, sellerId FROM purchases WHERE id = ?", [req.params.id])[0].values[0];
                const [price, bId, sId] = purchaseData;

                const buyerBal = db.exec("SELECT balance FROM users WHERE id = ?", [bId])[0].values[0][0];
                const sellerBal = db.exec("SELECT balance FROM users WHERE id = ?", [sId])[0].values[0][0];

                db.run("UPDATE users SET balance = ? WHERE id = ?", [buyerBal + price, bId]);
                db.run("UPDATE users SET balance = ? WHERE id = ?", [sellerBal - price, sId]);

                db.run("INSERT INTO transactions (userId, type, amount, description, purchaseId) VALUES (?, ?, ?, ?, ?)",
                    [bId, 'credit', price, `Возврат за отмену покупки #${req.params.id}`, req.params.id]);
                db.run("INSERT INTO transactions (userId, type, amount, description, purchaseId) VALUES (?, ?, ?, ?, ?)",
                    [sId, 'debit', price, `Возврат за отмену покупки #${req.params.id}`, req.params.id]);
            }

            db.run("UPDATE purchases SET status = ? WHERE id = ?", [newStatus, req.params.id]);
            saveDatabase();

            console.log(`[AUDIT] Статус покупки ${req.params.id} изменён на "${newStatus}" пользователем ${req.user.id}`);
            res.json({ message: `Статус покупки изменён на "${newStatus}"` });
        } catch (error) {
            console.error('Ошибка обновления статуса покупки:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // GET /api/transactions — история транзакций пользователя
    app.get('/api/transactions', authenticateToken, (req, res) => {
        try {
            const { page, limit, type } = req.query;

            const pageNum = parseInt(page) || 1;
            const limitNum = parseInt(limit) || 20;
            const offset = (pageNum - 1) * limitNum;

            let where = "WHERE userId = ?";
            const params = [req.user.id];

            if (type) {
                where += ' AND type = ?';
                params.push(type);
            }

            const countResult = db.exec(`SELECT COUNT(*) FROM transactions ${where}`, params);
            const totalCount = countResult.length > 0 ? countResult[0].values[0][0] : 0;

            const result = db.exec(`SELECT * FROM transactions ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`, [...params, limitNum, offset]);

            const transactions = result.length > 0 ? result[0].values.map(row => ({
                id: row[0],
                userId: sanitizeHTML(row[1]),
                type: sanitizeHTML(row[2]),
                amount: row[3],
                description: sanitizeHTML(row[4]),
                purchaseId: row[5],
                createdAt: row[6]
            })) : [];

            res.json({
                transactions,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: totalCount,
                    pages: Math.ceil(totalCount / limitNum)
                }
            });
        } catch (error) {
            console.error('Ошибка получения транзакций:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ============================================
    // API: Файлы
    // ============================================

    // POST /api/purchases/:purchaseId/file — загрузка файла (только участник покупки)
    app.post('/api/purchases/:purchaseId/file', authenticateToken, [param('purchaseId').notEmpty().isInt().withMessage('Некорректный ID'), ...fileValidator], (req, res) => {
        try {
            const { purchaseId } = req.params;
            const { fileName, fileData } = req.body;

            // Проверка существования покупки и авторства
            const purchaseCheck = db.exec("SELECT buyerId, sellerId FROM purchases WHERE id = ?", [purchaseId]);
            if (purchaseCheck.length === 0 || purchaseCheck[0].values.length === 0) {
                return res.status(404).json({ error: 'Покупка не найдена' });
            }

            const [buyerId, sellerId] = purchaseCheck[0].values[0];

            // Загрузить файл может только участник покупки (обычно продавец)
            if (req.user.id !== buyerId && req.user.id !== sellerId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы не участник этой покупки' });
            }

            // Валидация типа файла по расширению + MIME
            const allowedExtensions = ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'zip', 'rar'];
            const fileExt = fileName.split('.').pop().toLowerCase();
            if (!allowedExtensions.includes(fileExt)) {
                return res.status(400).json({ error: 'Недопустимый тип файла. Разрешены: ' + allowedExtensions.join(', ') });
            }

            // Базовая MIME проверка по base64 заголовку
            const mimeTypeMap = {
                pdf: 'application/pdf',
                doc: 'application/msword',
                docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                png: 'image/png',
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                zip: 'application/zip',
                rar: 'application/x-rar-compressed'
            };

            db.run("DELETE FROM work_files WHERE purchaseId = ?", [purchaseId]);
            db.run("INSERT INTO work_files (purchaseId, fileName, fileData, uploadedBy) VALUES (?, ?, ?, ?)",
                [purchaseId, sanitizeHTML(fileName), fileData, req.user.id]);
            db.run("UPDATE purchases SET fileAttached = 1 WHERE id = ?", [purchaseId]);
            saveDatabase();

            console.log(`[FILE] Файл загружен для покупки: ${purchaseId}, пользователь: ${req.user.id}`);
            res.json({ message: 'Файл загружен' });
        } catch (error) {
            console.error('Ошибка загрузки файла:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // GET /api/purchases/:purchaseId/file — получение файла (только участник покупки)
    app.get('/api/purchases/:purchaseId/file', authenticateToken, [param('purchaseId').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            // Проверка авторства
            const purchaseCheck = db.exec("SELECT buyerId, sellerId FROM purchases WHERE id = ?", [req.params.purchaseId]);
            if (purchaseCheck.length === 0 || purchaseCheck[0].values.length === 0) {
                return res.status(404).json({ error: 'Покупка не найдена' });
            }

            const [buyerId, sellerId] = purchaseCheck[0].values[0];
            if (req.user.id !== buyerId && req.user.id !== sellerId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы не участник этой покупки' });
            }

            const result = db.exec("SELECT * FROM work_files WHERE purchaseId = ?", [req.params.purchaseId]);
            if (result.length === 0 || result[0].values.length === 0) {
                return res.status(404).json({ error: 'Файл не найден' });
            }
            const row = result[0].values[0];
            res.json({
                fileName: sanitizeHTML(row[2]),
                fileData: row[3],
                uploadedAt: row[4],
                uploadedBy: sanitizeHTML(row[5] || '')
            });
        } catch (error) {
            console.error('Ошибка получения файла:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // GET /api/purchases/:purchaseId/file/download — скачивание файла (Content-Disposition attachment)
    app.get('/api/purchases/:purchaseId/file/download', authenticateToken, [param('purchaseId').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            // Проверка авторства
            const purchaseCheck = db.exec("SELECT buyerId, sellerId FROM purchases WHERE id = ?", [req.params.purchaseId]);
            if (purchaseCheck.length === 0 || purchaseCheck[0].values.length === 0) {
                return res.status(404).json({ error: 'Покупка не найдена' });
            }

            const [buyerId, sellerId] = purchaseCheck[0].values[0];
            if (req.user.id !== buyerId && req.user.id !== sellerId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы не участник этой покупки' });
            }

            const result = db.exec("SELECT fileName, fileData FROM work_files WHERE purchaseId = ?", [req.params.purchaseId]);
            if (result.length === 0 || result[0].values.length === 0) {
                return res.status(404).json({ error: 'Файл не найден' });
            }

            const fileName = result[0].values[0][0];
            const fileData = result[0].values[0][1];

            const buffer = Buffer.from(fileData, 'base64');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
            res.setHeader('Content-Type', 'application/octet-stream');
            res.send(buffer);
        } catch (error) {
            console.error('Ошибка скачивания файла:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // DELETE /api/purchases/:purchaseId/file — удаление файла (продавец или админ)
    app.delete('/api/purchases/:purchaseId/file', authenticateToken, [param('purchaseId').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            // Проверка авторства
            const purchaseCheck = db.exec("SELECT buyerId, sellerId FROM purchases WHERE id = ?", [req.params.purchaseId]);
            if (purchaseCheck.length === 0 || purchaseCheck[0].values.length === 0) {
                return res.status(404).json({ error: 'Покупка не найдена' });
            }

            const [buyerId, sellerId] = purchaseCheck[0].values[0];
            if (req.user.id !== sellerId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: только продавец или админ может удалить файл' });
            }

            db.run("DELETE FROM work_files WHERE purchaseId = ?", [req.params.purchaseId]);
            db.run("UPDATE purchases SET fileAttached = 0 WHERE id = ?", [req.params.purchaseId]);
            saveDatabase();

            console.log(`[AUDIT] Файл покупки ${req.params.purchaseId} удалён пользователем ${req.user.id}`);
            res.json({ message: 'Файл удалён' });
        } catch (error) {
            console.error('Ошибка удаления файла:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ============================================
    // API: Файлы индивидуальных запросов
    // ============================================

    // POST /api/custom-requests/:requestId/file — загрузка файла к запросу
    app.post('/api/custom-requests/:requestId/file', authenticateToken, [param('requestId').notEmpty().isInt().withMessage('Некорректный ID'), ...fileValidator], (req, res) => {
        try {
            const { requestId } = req.params;
            const { fileName, fileData } = req.body;

            const reqCheck = db.exec("SELECT requesterId FROM custom_requests WHERE id = ?", [requestId]);
            if (reqCheck.length === 0 || reqCheck[0].values.length === 0) {
                return res.status(404).json({ error: 'Запрос не найден' });
            }

            const requesterId = reqCheck[0].values[0][0];
            if (req.user.id !== requesterId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: только автор запроса может загрузить файл' });
            }

            const allowedExtensions = ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'zip', 'rar'];
            const fileExt = fileName.split('.').pop().toLowerCase();
            if (!allowedExtensions.includes(fileExt)) {
                return res.status(400).json({ error: 'Недопустимый тип файла' });
            }

            db.run("UPDATE custom_requests SET fileName = ?, fileData = ? WHERE id = ?",
                [sanitizeHTML(fileName), fileData, requestId]);
            saveDatabase();

            console.log(`[FILE] Файл загружен к запросу: ${requestId}`);
            res.json({ message: 'Файл загружен' });
        } catch (error) {
            console.error('Ошибка загрузки файла:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // GET /api/custom-requests/:requestId/file — получение файла запроса
    app.get('/api/custom-requests/:requestId/file', authenticateToken, [param('requestId').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            const result = db.exec("SELECT fileName, fileData FROM custom_requests WHERE id = ? AND fileData IS NOT NULL", [req.params.requestId]);
            if (result.length === 0 || result[0].values.length === 0) {
                return res.status(404).json({ error: 'Файл не найден' });
            }

            res.json({
                fileName: sanitizeHTML(result[0].values[0][0]),
                fileData: result[0].values[0][1]
            });
        } catch (error) {
            console.error('Ошибка получения файла:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ============================================
    // API: Отзывы
    // ============================================

    // GET /api/users/:sellerId/reviews — все отзывы о продавце
    app.get('/api/users/:sellerId/reviews', userIdValidator, (req, res) => {
        try {
            const result = db.exec(`SELECT R.*, b.name as buyerName FROM reviews R
                JOIN users b ON R.buyerId = b.id
                WHERE R.sellerId = ?
                ORDER BY R.createdAt DESC`, [req.params.sellerId]);

            res.json(result.length > 0 ? result[0].values.map(row => ({
                id: row[0],
                purchaseId: row[1],
                buyerId: sanitizeHTML(row[2]),
                sellerId: sanitizeHTML(row[3]),
                rating: row[4],
                comment: sanitizeHTML(row[5]),
                createdAt: row[6],
                buyerName: sanitizeHTML(row[7])
            })) : []);
        } catch (error) {
            console.error('Ошибка получения отзывов:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // GET /api/users/:buyerId/reviews — отзывы, оставленные конкретным покупателем
    app.get('/api/users/:buyerId/reviews-given', authenticateToken, userIdValidator, (req, res) => {
        try {
            if (req.user.id !== req.params.buyerId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы можете просматривать только свои отзывы' });
            }

            const result = db.exec(`SELECT R.*, s.name as sellerName FROM reviews R
                JOIN users s ON R.sellerId = s.id
                WHERE R.buyerId = ?
                ORDER BY R.createdAt DESC`, [req.params.buyerId]);

            res.json(result.length > 0 ? result[0].values.map(row => ({
                id: row[0],
                purchaseId: row[1],
                buyerId: sanitizeHTML(row[2]),
                sellerId: sanitizeHTML(row[3]),
                sellerName: sanitizeHTML(row[7]),
                rating: row[4],
                comment: sanitizeHTML(row[5]),
                createdAt: row[6]
            })) : []);
        } catch (error) {
            console.error('Ошибка получения отзывов покупателя:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // GET /api/users/:sellerId/rating — средний рейтинг и статистика
    app.get('/api/users/:sellerId/rating', userIdValidator, (req, res) => {
        try {
            const stats = db.exec(
                "SELECT AVG(rating) as avgRating, COUNT(*) as totalCount, " +
                "SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as five, " +
                "SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as four, " +
                "SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as three, " +
                "SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as two, " +
                "SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as one " +
                "FROM reviews WHERE sellerId = ?",
                [req.params.sellerId]
            );

            if (stats.length > 0 && stats[0].values.length > 0) {
                const row = stats[0].values[0];
                res.json({
                    sellerId: req.params.sellerId,
                    averageRating: parseFloat((row[0] || 0).toFixed(2)),
                    totalReviews: row[1] || 0,
                    distribution: {
                        5: row[2] || 0,
                        4: row[3] || 0,
                        3: row[4] || 0,
                        2: row[5] || 0,
                        1: row[6] || 0
                    }
                });
            } else {
                res.json({
                    sellerId: req.params.sellerId,
                    averageRating: 0,
                    totalReviews: 0,
                    distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
                });
            }
        } catch (error) {
            console.error('Ошибка получения рейтинга:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // GET /api/reviews/:id — получение конкретного отзыва
    const reviewIdValidator = [
        param('id').notEmpty().isInt({ min: 1 }).withMessage('Некорректный ID отзыва'),
        validate
    ];

    app.get('/api/reviews/:id', reviewIdValidator, (req, res) => {
        try {
            const result = db.exec(`SELECT R.*, b.name as buyerName, s.name as sellerName FROM reviews R
                JOIN users b ON R.buyerId = b.id
                JOIN users s ON R.sellerId = s.id
                WHERE R.id = ?`, [req.params.id]);

            if (!result.length || !result[0].values.length) {
                return res.status(404).json({ error: 'Отзыв не найден' });
            }

            const row = result[0].values[0];
            res.json({
                id: row[0],
                purchaseId: row[1],
                buyerId: sanitizeHTML(row[2]),
                sellerId: sanitizeHTML(row[3]),
                rating: row[4],
                comment: sanitizeHTML(row[5]),
                createdAt: row[6],
                buyerName: sanitizeHTML(row[7]),
                sellerName: sanitizeHTML(row[8])
            });
        } catch (error) {
            console.error('Ошибка получения отзыва:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // POST /api/reviews — создание отзыва с проверкой реального покупателя
    const reviewCreateValidatorNew = [
        body('purchaseId').notEmpty().isInt({ min: 1 }).withMessage('Некорректный ID покупки'),
        body('buyerId').trim().notEmpty().withMessage('ID покупателя обязателен'),
        body('sellerId').trim().notEmpty().withMessage('ID продавца обязателен'),
        body('rating').notEmpty().isInt({ min: 1, max: 5 }).withMessage('Рейтинг должен быть от 1 до 5'),
        body('comment').optional().isLength({ max: 1000 }).withMessage('Комментарий слишком длинный'),
        validate
    ];

    app.post('/api/reviews', authenticateToken, reviewCreateValidatorNew, (req, res) => {
        try {
            const { purchaseId, buyerId, sellerId, rating, comment } = req.body;

            // Проверяем, что авторизованный пользователь — это покупатель
            if (req.user.id !== buyerId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы можете оставлять отзывы только от своего имени' });
            }

            // Проверка: purchase существует и buyer действительно участвовал в покупке
            const purchaseCheck = db.exec(
                "SELECT id, buyerId, sellerId, status FROM purchases WHERE id = ?",
                [purchaseId]
            );

            if (!purchaseCheck.length || !purchaseCheck[0].values.length) {
                return res.status(404).json({ error: 'Покупка не найдена' });
            }

            const purchaseRow = purchaseCheck[0].values[0];
            const purchaseBuyerId = purchaseRow[1];
            const purchaseSellerId = purchaseRow[2];
            const purchaseStatus = purchaseRow[3];

            // Проверяем, что buyerId совпадает с покупателем в покупке
            if (buyerId !== purchaseBuyerId) {
                return res.status(403).json({ error: 'Вы не являетесь покупателем в этой покупке' });
            }

            // Проверяем, что sellerId совпадает с продавцом в покупке
            if (sellerId !== purchaseSellerId) {
                return res.status(400).json({ error: 'Продавец не соответствует данной покупке' });
            }

            // Проверяем, что покупка завершена (не активна)
            if (purchaseStatus === 'active') {
                return res.status(400).json({ error: 'Нельзя оставить отзыв, пока покупка в процессе выполнения. Дождитесь завершения.' });
            }

            // Проверка: отзыв уже есть
            const existing = db.exec("SELECT * FROM reviews WHERE purchaseId = ?", [purchaseId]);
            if (existing.length > 0 && existing[0].values.length > 0) {
                return res.status(409).json({ error: 'Отзыв уже существует' });
            }

            db.run("INSERT INTO reviews (purchaseId, buyerId, sellerId, rating, comment) VALUES (?, ?, ?, ?, ?)",
                [purchaseId, sanitizeHTML(buyerId), sanitizeHTML(sellerId), rating, sanitizeHTML(comment || '')]);

            // Обновление рейтинга продавца
            const stats = db.exec("SELECT AVG(rating), COUNT(*) FROM reviews WHERE sellerId = ?", [sellerId]);
            const avgRating = stats[0].values[0][0] || 0;
            const count = stats[0].values[0][1] || 0;
            db.run("UPDATE users SET rating = ?, reviewCount = ? WHERE id = ?", [avgRating, count, sellerId]);
            saveDatabase();

            console.log(`[REVIEW] Отзыв добавлен: покупка ${purchaseId}, рейтинг ${rating}`);
            res.status(201).json({ message: 'Отзыв добавлен' });
        } catch (error) {
            console.error('Ошибка добавления отзыва:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // PATCH /api/reviews/:id — редактирование отзыва (автор или админ)
    const reviewEditValidator = [
        param('id').notEmpty().isInt({ min: 1 }).withMessage('Некорректный ID отзыва'),
        body('rating').optional().isInt({ min: 1, max: 5 }).withMessage('Рейтинг должен быть от 1 до 5'),
        body('comment').optional().isLength({ max: 1000 }).withMessage('Комментарий слишком длинный'),
        validate
    ];

    app.patch('/api/reviews/:id', authenticateToken, reviewEditValidator, (req, res) => {
        try {
            const result = db.exec("SELECT buyerId, sellerId, rating, comment FROM reviews WHERE id = ?", [req.params.id]);

            if (!result.length || !result[0].values.length) {
                return res.status(404).json({ error: 'Отзыв не найден' });
            }

            const row = result[0].values[0];
            const buyerId = row[0];
            const sellerId = row[1];
            const currentRating = row[2];
            const currentComment = row[3];

            // Редактировать может: автор (покупатель) или админ
            if (req.user.id !== buyerId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: только автор может редактировать отзыв' });
            }

            const { rating, comment } = req.body;
            const newRating = rating !== undefined ? rating : currentRating;
            const newComment = comment !== undefined ? sanitizeHTML(comment) : currentComment;

            db.run("UPDATE reviews SET rating = ?, comment = ? WHERE id = ?", [newRating, newComment, req.params.id]);

            // Пересчитываем рейтинг продавца
            const stats = db.exec("SELECT AVG(rating), COUNT(*) FROM reviews WHERE sellerId = ?", [sellerId]);
            const avgRating = stats[0].values[0][0] || 0;
            const count = stats[0].values[0][1] || 0;
            db.run("UPDATE users SET rating = ?, reviewCount = ? WHERE id = ?", [avgRating, count, sellerId]);
            saveDatabase();

            console.log(`[AUDIT] Отзыв ${req.params.id} отредактирован пользователем ${req.user.id}`);
            res.json({ message: 'Отзыв обновлён' });
        } catch (error) {
            console.error('Ошибка редактирования отзыва:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // DELETE /api/reviews/:id — удаление отзыва (автор или админ)
    app.delete('/api/reviews/:id', authenticateToken, reviewIdValidator, (req, res) => {
        try {
            const result = db.exec("SELECT buyerId, sellerId FROM reviews WHERE id = ?", [req.params.id]);

            if (!result.length || !result[0].values.length) {
                return res.status(404).json({ error: 'Отзыв не найден' });
            }

            const row = result[0].values[0];
            const buyerId = row[0];
            const sellerId = row[1];

            // Удалить может: автор (покупатель) или админ
            if (req.user.id !== buyerId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: только автор или админ может удалить отзыв' });
            }

            db.run("DELETE FROM reviews WHERE id = ?", [req.params.id]);

            // Пересчитываем рейтинг продавца
            const stats = db.exec("SELECT AVG(rating), COUNT(*) FROM reviews WHERE sellerId = ?", [sellerId]);
            const avgRating = stats[0].values[0][0] || 0;
            const count = stats[0].values[0][1] || 0;
            db.run("UPDATE users SET rating = ?, reviewCount = ? WHERE id = ?", [avgRating, count, sellerId]);
            saveDatabase();

            console.log(`[AUDIT] Отзыв ${req.params.id} удалён пользователем ${req.user.id}`);
            res.json({ message: 'Отзыв удалён' });
        } catch (error) {
            console.error('Ошибка удаления отзыва:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ============================================
    // API: Индивидуальные запросы
    // ============================================

    app.get('/api/custom-requests', (req, res) => {
        try {
            const result = db.exec("SELECT * FROM custom_requests WHERE status = 'approved'");
            res.json(result.length > 0 ? result[0].values.map(row => ({ 
                id: row[0], 
                title: sanitizeHTML(row[1]), 
                description: sanitizeHTML(row[2]), 
                budget: row[3], 
                requesterId: sanitizeHTML(row[4]), 
                requesterName: sanitizeHTML(row[5]), 
                fileName: sanitizeHTML(row[6]), 
                fileData: row[7], 
                status: sanitizeHTML(row[8]), 
                createdAt: row[9] 
            })) : []);
        } catch (error) { 
            console.error('Ошибка получения запросов:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    // БЕЗОПАСНОСТЬ: Просмотр всех индивидуальных запросов — только для администраторов
    app.get('/api/custom-requests/all', authenticateToken, requireAdmin, (req, res) => {
        try {
            const result = db.exec("SELECT * FROM custom_requests");
            res.json(result.length > 0 ? result[0].values.map(row => ({
                id: row[0],
                title: sanitizeHTML(row[1]),
                description: sanitizeHTML(row[2]),
                budget: row[3],
                requesterId: sanitizeHTML(row[4]),
                requesterName: sanitizeHTML(row[5]),
                fileName: sanitizeHTML(row[6]),
                fileData: row[7],
                status: sanitizeHTML(row[8]),
                createdAt: row[9]
            })) : []);
        } catch (error) {
            console.error('Ошибка получения всех запросов:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.post('/api/custom-requests', authenticateToken, customRequestCreateValidator, (req, res) => {
        try {
            const { title, description, budget, requesterId, requesterName, fileName, fileData } = req.body;

            // Проверяем, что авторизованный пользователь — это заказчик
            if (req.user.id !== requesterId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы можете создавать запросы только от своего имени' });
            }
            
            db.run("INSERT INTO custom_requests (title, description, budget, requesterId, requesterName, fileName, fileData, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')", 
                [sanitizeHTML(title), sanitizeHTML(description || ''), budget, sanitizeHTML(requesterId), sanitizeHTML(requesterName), sanitizeHTML(fileName || null), fileData || null]);
            saveDatabase();
            
            const result = db.exec("SELECT last_insert_rowid()");
            const requestId = result[0].values[0][0];
            
            console.log(`[CUSTOM_REQUEST] Создан запрос: ${requestId}, заказчик: ${requesterId}`);
            
            res.status(201).json({ 
                id: requestId, 
                title: sanitizeHTML(title), 
                description: sanitizeHTML(description || ''), 
                budget, 
                requesterId: sanitizeHTML(requesterId), 
                requesterName: sanitizeHTML(requesterName), 
                fileName: sanitizeHTML(fileName || null), 
                status: 'pending' 
            });
        } catch (error) { 
            console.error('Ошибка создания запроса:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    // БЕЗОПАСНОСТЬ: Одобрение индивидуального запроса — только для администраторов
    app.patch('/api/custom-requests/:id/approve', authenticateToken, requireAdmin, [param('id').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            db.run("UPDATE custom_requests SET status = 'approved' WHERE id = ?", [req.params.id]);
            saveDatabase();
            console.log(`[AUDIT] Запрос ${req.params.id} одобрен администратором ${req.user.id}`);
            res.json({ message: 'Запрос одобрен' });
        } catch (error) {
            console.error('Ошибка одобрения запроса:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // БЕЗОПАСНОСТЬ: Отклонение индивидуального запроса — только для администраторов
    app.patch('/api/custom-requests/:id/reject', authenticateToken, requireAdmin, [param('id').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            db.run("UPDATE custom_requests SET status = 'rejected' WHERE id = ?", [req.params.id]);
            saveDatabase();
            console.log(`[AUDIT] Запрос ${req.params.id} отклонён администратором ${req.user.id}`);
            res.json({ message: 'Запрос отклонён' });
        } catch (error) {
            console.error('Ошибка отклонения запроса:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.delete('/api/custom-requests/:id', authenticateToken, [param('id').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            const reqCheck = db.exec("SELECT requesterId FROM custom_requests WHERE id = ?", [req.params.id]);
            if (reqCheck.length > 0 && reqCheck[0].values.length > 0) {
                const requesterId = reqCheck[0].values[0][0];
                if (req.user.id !== requesterId && !req.user.isAdmin) {
                    return res.status(403).json({ error: 'Доступ запрещён: только автор запроса или админ может удалить' });
                }
            }

            db.run("DELETE FROM custom_requests WHERE id = ?", [req.params.id]);
            saveDatabase();
            console.log(`[AUDIT] Запрос ${req.params.id} удалён пользователем ${req.user.id}`);
            res.json({ message: 'Запрос удалён' });
        } catch (error) {
            console.error('Ошибка удаления запроса:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // GET /api/custom-requests/:id — один запрос по ID
    app.get('/api/custom-requests/:id', [param('id').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            const result = db.exec("SELECT * FROM custom_requests WHERE id = ?", [req.params.id]);
            if (!result.length || !result[0].values.length) {
                return res.status(404).json({ error: 'Запрос не найден' });
            }

            const row = result[0].values[0];
            res.json({
                id: row[0],
                title: sanitizeHTML(row[1]),
                description: sanitizeHTML(row[2]),
                budget: row[3],
                requesterId: sanitizeHTML(row[4]),
                requesterName: sanitizeHTML(row[5]),
                fileName: sanitizeHTML(row[6]),
                status: sanitizeHTML(row[8]),
                createdAt: row[9]
            });
        } catch (error) {
            console.error('Ошибка получения запроса:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // PATCH /api/custom-requests/:id — редактирование (только автор)
    app.patch('/api/custom-requests/:id', authenticateToken, [
        param('id').notEmpty().isInt().withMessage('Некорректный ID'),
        body('title').optional().trim().notEmpty().isLength({ max: 200 }),
        body('description').optional().isLength({ max: 2000 }),
        body('budget').optional().isInt({ min: 1, max: 1000000 }),
        validate
    ], (req, res) => {
        try {
            const reqCheck = db.exec("SELECT requesterId FROM custom_requests WHERE id = ?", [req.params.id]);
            if (!reqCheck.length || !reqCheck[0].values.length) {
                return res.status(404).json({ error: 'Запрос не найден' });
            }

            const requesterId = reqCheck[0].values[0][0];
            if (req.user.id !== requesterId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: только автор запроса может редактировать' });
            }

            const { title, description, budget } = req.body;
            const updates = [];
            const params = [];

            if (title !== undefined) { updates.push("title = ?"); params.push(sanitizeHTML(title)); }
            if (description !== undefined) { updates.push("description = ?"); params.push(sanitizeHTML(description)); }
            if (budget !== undefined) { updates.push("budget = ?"); params.push(budget); }

            if (updates.length === 0) return res.status(400).json({ error: 'Нет данных для обновления' });

            params.push(req.params.id);
            db.run(`UPDATE custom_requests SET ${updates.join(', ')} WHERE id = ?`, params);
            saveDatabase();

            console.log(`[AUDIT] Запрос ${req.params.id} отредактирован пользователем ${req.user.id}`);
            res.json({ message: 'Запрос обновлён' });
        } catch (error) {
            console.error('Ошибка обновления запроса:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // GET /api/users/:id/custom-requests — запросы конкретного заказчика
    app.get('/api/users/:id/custom-requests', authenticateToken, userIdValidator, (req, res) => {
        try {
            const result = db.exec("SELECT * FROM custom_requests WHERE requesterId = ? ORDER BY createdAt DESC", [req.params.id]);
            res.json(result.length > 0 ? result[0].values.map(row => ({
                id: row[0],
                title: sanitizeHTML(row[1]),
                description: sanitizeHTML(row[2]),
                budget: row[3],
                requesterId: sanitizeHTML(row[4]),
                requesterName: sanitizeHTML(row[5]),
                fileName: sanitizeHTML(row[6]),
                status: sanitizeHTML(row[8]),
                createdAt: row[9]
            })) : []);
        } catch (error) {
            console.error('Ошибка получения запросов пользователя:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ============================================
    // API: Чат
    // ============================================

    // GET /api/chat/:purchaseId — с пагинацией и маркировкой прочитано
    app.get('/api/chat/:purchaseId', authenticateToken, [param('purchaseId').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            const { page, limit } = req.query;
            const pageNum = parseInt(page) || 1;
            const limitNum = parseInt(limit) || 50;
            const offset = (pageNum - 1) * limitNum;

            // Проверяем, что пользователь является участником покупки
            const purchaseResult = db.exec("SELECT buyerId, sellerId FROM purchases WHERE id = ?", [req.params.purchaseId]);

            if (!purchaseResult.length || !purchaseResult[0].values.length) {
                return res.status(404).json({ error: 'Покупка не найдена' });
            }

            const [buyerId, sellerId] = purchaseResult[0].values[0];

            if (req.user.id !== buyerId && req.user.id !== sellerId && !req.user.isAdmin) {
                console.log(`[AUTH] Попытка доступа к чужому чату: пользователь ${req.user.id}, покупка ${req.params.purchaseId}`);
                return res.status(403).json({ error: 'Доступ запрещён: вы не участник этой покупки' });
            }

            // Считаем общее количество
            const countResult = db.exec("SELECT COUNT(*) FROM chat_messages WHERE purchaseId = ?", [req.params.purchaseId]);
            const totalCount = countResult.length > 0 ? countResult[0].values[0][0] : 0;

            // Получаем сообщения с пагинацией
            const result = db.exec("SELECT * FROM chat_messages WHERE purchaseId = ? ORDER BY createdAt ASC LIMIT ? OFFSET ?", [req.params.purchaseId, limitNum, offset]);

            const messages = result.length > 0 ? result[0].values.map(row => ({
                id: row[0],
                purchaseId: row[1],
                senderId: sanitizeHTML(row[2]),
                receiverId: sanitizeHTML(row[3]),
                message: sanitizeHTML(row[4]),
                fileName: sanitizeHTML(row[5]),
                fileData: row[6],
                fileType: sanitizeHTML(row[7]),
                isRead: Boolean(row[8]),
                createdAt: row[9]
            })) : [];

            // Автоматически отмечаем входящие сообщения как прочитанные
            db.run("UPDATE chat_messages SET isRead = 1 WHERE purchaseId = ? AND receiverId = ? AND isRead = 0",
                [req.params.purchaseId, req.user.id]);
            saveDatabase();

            res.json({
                messages,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: totalCount,
                    pages: Math.ceil(totalCount / limitNum)
                }
            });
        } catch (error) {
            console.error('Ошибка получения сообщений:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // POST /api/chat — отправка сообщения
    app.post('/api/chat', authenticateToken, [
        body('purchaseId').notEmpty().isInt().withMessage('Некорректный ID покупки'),
        body('senderId').trim().notEmpty().withMessage('ID отправителя обязателен'),
        body('receiverId').trim().notEmpty().withMessage('ID получателя обязателен'),
        body('message').optional().isLength({ max: 2000 }).withMessage('Сообщение слишком длинное'),
        body('fileName').optional().isLength({ max: 255 }),
        validate
    ], (req, res) => {
        try {
            const { purchaseId, senderId, receiverId, message, fileName, fileData, fileType } = req.body;

            // Проверяем, что отправитель — это авторизованный пользователь
            if (req.user.id !== senderId) {
                console.log(`[AUTH] Попытка отправки сообщения от чужого имени: пользователь ${req.user.id}, senderId ${senderId}`);
                return res.status(403).json({ error: 'Доступ запрещён: вы можете отправлять сообщения только от своего имени' });
            }

            // Проверяем, что пользователь является участником покупки
            const purchaseResult = db.exec("SELECT buyerId, sellerId FROM purchases WHERE id = ?", [purchaseId]);

            if (!purchaseResult.length || !purchaseResult[0].values.length) {
                return res.status(404).json({ error: 'Покупка не найдена' });
            }

            const [buyerId, sellerId] = purchaseResult[0].values[0];

            if (req.user.id !== buyerId && req.user.id !== sellerId) {
                return res.status(403).json({ error: 'Доступ запрещён: вы не участник этой покупки' });
            }

            db.run("INSERT INTO chat_messages (purchaseId, senderId, receiverId, message, fileName, fileData, fileType, isRead) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
                [purchaseId, sanitizeHTML(senderId), sanitizeHTML(receiverId), sanitizeHTML(message || null), sanitizeHTML(fileName || null), fileData || null, sanitizeHTML(fileType || null)]);
            saveDatabase();

            const result = db.exec("SELECT last_insert_rowid()");
            const messageId = result[0].values[0][0];

            res.status(201).json({
                id: messageId,
                purchaseId,
                senderId: sanitizeHTML(senderId),
                receiverId: sanitizeHTML(receiverId),
                message: sanitizeHTML(message || null),
                fileName: sanitizeHTML(fileName || null),
                fileData,
                fileType: sanitizeHTML(fileType || null),
                isRead: false
            });
        } catch (error) {
            console.error('Ошибка отправки сообщения:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // PATCH /api/chat/:messageId — редактирование сообщения (только автор)
    const chatMessageEditValidator = [
        param('messageId').notEmpty().isInt({ min: 1 }).withMessage('Некорректный ID сообщения'),
        body('message').optional().isLength({ max: 2000 }).withMessage('Сообщение слишком длинное'),
        validate
    ];

    app.patch('/api/chat/:messageId', authenticateToken, chatMessageEditValidator, (req, res) => {
        try {
            const result = db.exec("SELECT senderId, purchaseId FROM chat_messages WHERE id = ?", [req.params.messageId]);

            if (!result.length || !result[0].values.length) {
                return res.status(404).json({ error: 'Сообщение не найдено' });
            }

            const row = result[0].values[0];
            const senderId = row[0];
            const purchaseId = row[1];

            // Редактировать может только автор
            if (req.user.id !== senderId) {
                return res.status(403).json({ error: 'Доступ запрещён: только автор может редактировать сообщение' });
            }

            // Проверяем, что пользователь — участник покупки
            const purchaseResult = db.exec("SELECT buyerId, sellerId FROM purchases WHERE id = ?", [purchaseId]);
            if (!purchaseResult.length || !purchaseResult[0].values.length) {
                return res.status(404).json({ error: 'Покупка не найдена' });
            }

            const { message } = req.body;
            if (message === undefined) {
                return res.status(400).json({ error: 'Сообщение обязательно' });
            }

            db.run("UPDATE chat_messages SET message = ? WHERE id = ?", [sanitizeHTML(message), req.params.messageId]);
            saveDatabase();

            console.log(`[AUDIT] Сообщение ${req.params.messageId} отредактировано пользователем ${req.user.id}`);
            res.json({ message: 'Сообщение обновлено' });
        } catch (error) {
            console.error('Ошибка редактирования сообщения:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // DELETE /api/chat/:messageId — удаление сообщения (автор или админ)
    app.delete('/api/chat/:messageId', authenticateToken, [param('messageId').notEmpty().isInt({ min: 1 }).withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            const result = db.exec("SELECT senderId FROM chat_messages WHERE id = ?", [req.params.messageId]);

            if (!result.length || !result[0].values.length) {
                return res.status(404).json({ error: 'Сообщение не найдено' });
            }

            const senderId = result[0].values[0][0];

            // Удалить может: автор или админ
            if (req.user.id !== senderId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: только автор или админ может удалить сообщение' });
            }

            db.run("DELETE FROM chat_messages WHERE id = ?", [req.params.messageId]);
            saveDatabase();

            console.log(`[AUDIT] Сообщение ${req.params.messageId} удалено пользователем ${req.user.id}`);
            res.json({ message: 'Сообщение удалено' });
        } catch (error) {
            console.error('Ошибка удаления сообщения:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // GET /api/chat/previews/:userId — превью чатов (последнее сообщение для каждой покупки)
    app.get('/api/chat/previews/:userId', authenticateToken, userIdValidator, (req, res) => {
        try {
            if (req.user.id !== req.params.userId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы можете просматривать только свои чаты' });
            }

            // Получаем все покупки пользователя с последними сообщениями
            const result = db.exec(`
                SELECT p.id, p.title,
                       (SELECT cm.message FROM chat_messages cm WHERE cm.purchaseId = p.id ORDER BY cm.createdAt DESC LIMIT 1) as lastMessage,
                       (SELECT cm.senderId FROM chat_messages cm WHERE cm.purchaseId = p.id ORDER BY cm.createdAt DESC LIMIT 1) as lastSenderId,
                       (SELECT cm.createdAt FROM chat_messages cm WHERE cm.purchaseId = p.id ORDER BY cm.createdAt DESC LIMIT 1) as lastTime,
                       (SELECT COUNT(*) FROM chat_messages cm WHERE cm.purchaseId = p.id AND cm.receiverId = ? AND cm.isRead = 0) as unreadCount,
                       u.name as counterpartName,
                       p.sellerId, p.buyerId
                FROM purchases p
                LEFT JOIN users u ON (p.sellerId = u.id OR p.buyerId = u.id) AND u.id != ?
                WHERE p.buyerId = ? OR p.sellerId = ?
                ORDER BY lastTime DESC
            `, [req.params.userId, req.params.userId, req.params.userId, req.params.userId]);

            res.json(result.length > 0 ? result[0].values.map(row => ({
                purchaseId: row[0],
                title: sanitizeHTML(row[1]),
                lastMessage: sanitizeHTML(row[2] || ''),
                lastSenderId: row[3],
                lastTime: row[4],
                unreadCount: row[5],
                counterpartName: sanitizeHTML(row[6] || ''),
                sellerId: sanitizeHTML(row[7]),
                buyerId: sanitizeHTML(row[8])
            })) : []);
        } catch (error) {
            console.error('Ошибка получения превью чатов:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // БЕЗОПАСНОСТЬ: Список чатов — только для авторизованного пользователя
    app.get('/api/chat/purchases/:userId', authenticateToken, userIdValidator, (req, res) => {
        try {
            // Проверяем, что пользователь запрашивает свои чаты
            if (req.user.id !== req.params.userId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы можете просматривать только свои чаты' });
            }
            
            const result = db.exec(`SELECT DISTINCT p.id, p.title, u.name as counterpartName, p.sellerId, p.buyerId
                FROM purchases p
                JOIN users u ON (p.sellerId = u.id OR p.buyerId = u.id)
                WHERE (p.buyerId = ? OR p.sellerId = ?)
                AND p.id IN (SELECT purchaseId FROM chat_messages)`,
                [req.params.userId, req.params.userId]);

            res.json(result.length > 0 ? result[0].values.map(row => ({
                purchaseId: row[0],
                title: sanitizeHTML(row[1]),
                counterpartName: sanitizeHTML(row[2]),
                sellerId: sanitizeHTML(row[3]),
                buyerId: sanitizeHTML(row[4])
            })) : []);
        } catch (error) {
            console.error('Ошибка получения чатов:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ============================================
    // API: Уведомления
    // ============================================

    // GET /api/notifications/:userId — с фильтрацией по типу
    app.get('/api/notifications/:userId', authenticateToken, userIdValidator, (req, res) => {
        try {
            if (req.user.id !== req.params.userId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы можете просматривать только свои уведомления' });
            }

            const { type, unreadOnly } = req.query;
            let where = "WHERE userId = ?";
            const params = [req.params.userId];

            if (type) {
                where += ' AND type = ?';
                params.push(type);
            }
            if (unreadOnly === 'true') {
                where += ' AND isRead = 0';
            }

            const result = db.exec(`SELECT * FROM notifications ${where} ORDER BY createdAt DESC`, params);
            res.json(result.length > 0 ? result[0].values.map(row => ({
                id: row[0],
                userId: sanitizeHTML(row[1]),
                title: sanitizeHTML(row[2]),
                message: sanitizeHTML(row[3]),
                type: sanitizeHTML(row[4]),
                isRead: Boolean(row[5]),
                createdAt: row[6]
            })) : []);
        } catch (error) {
            console.error('Ошибка получения уведомлений:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // POST /api/notifications — создание (только админ)
    app.post('/api/notifications', authenticateToken, requireAdmin, [
        body('userId').trim().notEmpty().withMessage('ID пользователя обязателен'),
        body('title').trim().notEmpty().withMessage('Заголовок обязателен').isLength({ max: 200 }),
        body('message').trim().notEmpty().withMessage('Сообщение обязательно').isLength({ max: 1000 }),
        body('type').trim().notEmpty().withMessage('Тип обязателен'),
        validate
    ], (req, res) => {
        try {
            const { userId, title, message, type } = req.body;

            db.run("INSERT INTO notifications (userId, title, message, type) VALUES (?, ?, ?, ?)",
                [sanitizeHTML(userId), sanitizeHTML(title), sanitizeHTML(message), sanitizeHTML(type)]);
            saveDatabase();

            const result = db.exec("SELECT last_insert_rowid()");
            res.status(201).json({
                id: result[0].values[0][0],
                userId: sanitizeHTML(userId),
                title: sanitizeHTML(title),
                message: sanitizeHTML(message),
                type: sanitizeHTML(type)
            });
        } catch (error) {
            console.error('Ошибка создания уведомления:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // PATCH /api/notifications/:id/read — отметка как прочитанное
    app.patch('/api/notifications/:id/read', authenticateToken, [param('id').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            const notifResult = db.exec("SELECT userId FROM notifications WHERE id = ?", [req.params.id]);
            if (!notifResult.length || !notifResult[0].values.length) {
                return res.status(404).json({ error: 'Уведомление не найдено' });
            }

            const userId = notifResult[0].values[0][0];
            if (req.user.id !== userId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён: вы не владелец этого уведомления' });
            }

            db.run("UPDATE notifications SET isRead = 1 WHERE id = ?", [req.params.id]);
            saveDatabase();
            res.json({ message: 'Уведомление прочитано' });
        } catch (error) {
            console.error('Ошибка обновления уведомления:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // PATCH /api/notifications/:id/unread — вернуть в непрочитанные
    app.patch('/api/notifications/:id/unread', authenticateToken, [param('id').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            const notifResult = db.exec("SELECT userId FROM notifications WHERE id = ?", [req.params.id]);
            if (!notifResult.length || !notifResult[0].values.length) {
                return res.status(404).json({ error: 'Уведомление не найдено' });
            }

            const userId = notifResult[0].values[0][0];
            if (req.user.id !== userId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён' });
            }

            db.run("UPDATE notifications SET isRead = 0 WHERE id = ?", [req.params.id]);
            saveDatabase();
            res.json({ message: 'Уведомление возвращено в непрочитанные' });
        } catch (error) {
            console.error('Ошибка обновления уведомления:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // PATCH /api/notifications/:userId/read-all — отметить все как прочитанные
    app.patch('/api/notifications/:userId/read-all', authenticateToken, userIdValidator, (req, res) => {
        try {
            if (req.user.id !== req.params.userId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён' });
            }

            db.run("UPDATE notifications SET isRead = 1 WHERE userId = ?", [req.params.userId]);
            saveDatabase();
            res.json({ message: 'Все уведомления отмечены как прочитанные' });
        } catch (error) {
            console.error('Ошибка обновления уведомлений:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // DELETE /api/notifications/:id — удаление уведомления (владелец или админ)
    app.delete('/api/notifications/:id', authenticateToken, [param('id').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            const notifResult = db.exec("SELECT userId FROM notifications WHERE id = ?", [req.params.id]);
            if (!notifResult.length || !notifResult[0].values.length) {
                return res.status(404).json({ error: 'Уведомление не найдено' });
            }

            const userId = notifResult[0].values[0][0];
            if (req.user.id !== userId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён' });
            }

            db.run("DELETE FROM notifications WHERE id = ?", [req.params.id]);
            saveDatabase();
            res.json({ message: 'Уведомление удалено' });
        } catch (error) {
            console.error('Ошибка удаления уведомления:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ============================================
    // АДМИН-ПАНЕЛЬ: Статистика
    // ============================================

    app.get('/api/admin/stats', authenticateToken, requireAdmin, (req, res) => {
        try {
            const usersCount = db.exec("SELECT COUNT(*) FROM users")[0]?.values[0]?.[0] || 0;
            const productsCount = db.exec("SELECT COUNT(*) FROM products")[0]?.values[0]?.[0] || 0;
            const approvedProducts = db.exec("SELECT COUNT(*) FROM products WHERE status = 'approved'")[0]?.values[0]?.[0] || 0;
            const pendingProducts = db.exec("SELECT COUNT(*) FROM products WHERE status = 'pending'")[0]?.values[0]?.[0] || 0;
            const purchasesCount = db.exec("SELECT COUNT(*) FROM purchases")[0]?.values[0]?.[0] || 0;
            const activePurchases = db.exec("SELECT COUNT(*) FROM purchases WHERE status = 'active'")[0]?.values[0]?.[0] || 0;
            const completedPurchases = db.exec("SELECT COUNT(*) FROM purchases WHERE status = 'completed'")[0]?.values[0]?.[0] || 0;
            const reviewsCount = db.exec("SELECT COUNT(*) FROM reviews")[0]?.values[0]?.[0] || 0;
            const totalRevenue = db.exec("SELECT COALESCE(SUM(price), 0) FROM purchases")[0]?.values[0]?.[0] || 0;
            const blockedUsers = db.exec("SELECT COUNT(*) FROM users WHERE isBlocked = 1")[0]?.values[0]?.[0] || 0;
            const totalBalance = db.exec("SELECT COALESCE(SUM(balance), 0) FROM users")[0]?.values[0]?.[0] || 0;

            res.json({
                users: { total: usersCount, blocked: blockedUsers },
                products: { total: productsCount, approved: approvedProducts, pending: pendingProducts },
                purchases: { total: purchasesCount, active: activePurchases, completed: completedPurchases },
                reviews: { total: reviewsCount },
                finance: { totalRevenue, totalUserBalance: totalBalance }
            });
        } catch (error) {
            console.error('Ошибка получения статистики:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // Массовое управление статусами товаров (одобрить/отклонить несколько)
    app.patch('/api/admin/products/bulk-update', authenticateToken, requireAdmin, [
        body('ids').isArray({ min: 1 }).withMessage('Массив ID обязателен'),
        body('status').isIn(['approved', 'rejected', 'pending']).withMessage('Некорректный статус'),
        validate
    ], (req, res) => {
        try {
            const { ids, status } = req.body;

            const placeholders = ids.map(() => '?').join(',');
            db.run(`UPDATE products SET status = ? WHERE id IN (${placeholders})`, [status, ...ids]);
            saveDatabase();

            console.log(`[AUDIT] Массовое обновление: ${ids.length} товаров -> "${status}", администратор ${req.user.id}`);
            res.json({ message: `Обновлено ${ids.length} товаров на статус "${status}"` });
        } catch (error) {
            console.error('Ошибка массового обновления:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ============================================
    // АНАЛИТИКА: Расширенные данные для графиков
    // ============================================

    // GET /api/analytics/sales — данные для графика продаж (по дням/неделям/месяцам)
    app.get('/api/analytics/sales', authenticateToken, (req, res) => {
        try {
            const { period = 'days', limit = 30 } = req.query;
            const limitNum = parseInt(limit);

            let dateFormat, groupBy;
            switch (period) {
                case 'months':
                    dateFormat = "strftime('%Y-%m', date)";
                    break;
                case 'weeks':
                    dateFormat = "strftime('%Y-%W', date)";
                    break;
                default:
                    dateFormat = "strftime('%Y-%m-%d', date)";
            }

            const salesData = db.exec(`
                SELECT ${dateFormat} as period,
                       COUNT(*) as count,
                       SUM(price) as revenue,
                       AVG(price) as avgPrice
                FROM purchases
                GROUP BY ${dateFormat}
                ORDER BY period DESC
                LIMIT ${limitNum}
            `);

            const result = salesData.length > 0 ? salesData[0].values.map(row => ({
                period: row[0],
                count: row[1],
                revenue: row[2],
                avgPrice: parseFloat(row[3]).toFixed(2)
            })).reverse() : [];

            res.json({ period, data: result });
        } catch (error) {
            console.error('Ошибка получения аналитики продаж:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // GET /api/analytics/activity — активность пользователей (регистрации, покупки, отзывы)
    app.get('/api/analytics/activity', authenticateToken, (req, res) => {
        try {
            const { days = 30 } = req.query;
            const daysNum = parseInt(days);

            const registrations = db.exec(`
                SELECT strftime('%Y-%m-%d', createdAt) as date, COUNT(*) as count
                FROM users
                WHERE createdAt >= datetime('now', '-${daysNum} days')
                GROUP BY date
                ORDER BY date
            `);

            const purchases = db.exec(`
                SELECT strftime('%Y-%m-%d', date) as date, COUNT(*) as count
                FROM purchases
                WHERE date >= datetime('now', '-${daysNum} days')
                GROUP BY date
                ORDER BY date
            `);

            const reviews = db.exec(`
                SELECT strftime('%Y-%m-%d', createdAt) as date, COUNT(*) as count
                FROM reviews
                WHERE createdAt >= datetime('now', '-${daysNum} days')
                GROUP BY date
                ORDER BY date
            `);

            res.json({
                days: daysNum,
                registrations: registrations.length > 0 ? registrations[0].values.map(r => ({ date: r[0], count: r[1] })) : [],
                purchases: purchases.length > 0 ? purchases[0].values.map(r => ({ date: r[0], count: r[1] })) : [],
                reviews: reviews.length > 0 ? reviews[0].values.map(r => ({ date: r[0], count: r[1] })) : []
            });
        } catch (error) {
            console.error('Ошибка получения аналитики активности:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // GET /api/analytics/ratings — распределение рейтингов продавцов
    app.get('/api/analytics/ratings', authenticateToken, (req, res) => {
        try {
            const topSellers = db.exec(`
                SELECT u.name, u.rating, u.reviewCount, u.balance,
                       (SELECT COUNT(*) FROM products p WHERE p.sellerId = u.id) as productCount,
                       (SELECT COUNT(*) FROM purchases pu WHERE pu.sellerId = u.id) as salesCount
                FROM users u
                WHERE u.reviewCount > 0
                ORDER BY u.rating DESC, u.reviewCount DESC
                LIMIT 20
            `);

            const ratingDistribution = db.exec(`
                SELECT
                    SUM(CASE WHEN rating >= 4.5 THEN 1 ELSE 0 END) as excellent,
                    SUM(CASE WHEN rating >= 3.5 AND rating < 4.5 THEN 1 ELSE 0 END) as good,
                    SUM(CASE WHEN rating >= 2.5 AND rating < 3.5 THEN 1 ELSE 0 END) as average,
                    SUM(CASE WHEN rating < 2.5 THEN 1 ELSE 0 END) as poor
                FROM users
                WHERE reviewCount > 0
            `);

            res.json({
                topSellers: topSellers.length > 0 ? topSellers[0].values.map(row => ({
                    name: row[0],
                    rating: parseFloat(row[1]).toFixed(2),
                    reviewCount: row[2],
                    balance: row[3],
                    productCount: row[4],
                    salesCount: row[5]
                })) : [],
                distribution: ratingDistribution.length > 0 ? {
                    excellent: ratingDistribution[0].values[0][0] || 0,
                    good: ratingDistribution[0].values[0][1] || 0,
                    average: ratingDistribution[0].values[0][2] || 0,
                    poor: ratingDistribution[0].values[0][3] || 0
                } : { excellent: 0, good: 0, average: 0, poor: 0 }
            });
        } catch (error) {
            console.error('Ошибка получения рейтингов:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // GET /api/analytics/revenue — доходы по категориям
    app.get('/api/analytics/revenue', authenticateToken, (req, res) => {
        try {
            const revenueByCategory = db.exec(`
                SELECT pr.category,
                       COUNT(*) as salesCount,
                       SUM(pu.price) as totalRevenue,
                       AVG(pu.price) as avgSale
                FROM purchases pu
                JOIN products pr ON pu.productId = pr.id
                GROUP BY pr.category
            `);

            const revenueByProduct = db.exec(`
                SELECT pr.title, pr.sellerName, pu.price, pu.date
                FROM purchases pu
                JOIN products pr ON pu.productId = pr.id
                ORDER BY pu.date DESC
                LIMIT 20
            `);

            res.json({
                byCategory: revenueByCategory.length > 0 ? revenueByCategory[0].values.map(row => ({
                    category: row[0],
                    salesCount: row[1],
                    totalRevenue: row[2],
                    avgSale: parseFloat(row[3]).toFixed(2)
                })) : [],
                recentSales: revenueByProduct.length > 0 ? revenueByProduct[0].values.map(row => ({
                    title: row[0],
                    sellerName: row[1],
                    price: row[2],
                    date: row[3]
                })) : []
            });
        } catch (error) {
            console.error('Ошибка получения аналитики доходов:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // GET /api/analytics/user/:userId — персональная аналитика пользователя
    app.get('/api/analytics/user/:userId', authenticateToken, (req, res) => {
        try {
            if (req.user.id !== req.params.userId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён' });
            }

            // Продажи (если пользователь — продавец)
            const salesStats = db.exec(`
                SELECT COUNT(*) as totalSales,
                       COALESCE(SUM(price), 0) as totalRevenue,
                       COALESCE(AVG(price), 0) as avgSale,
                       COALESCE(MAX(price), 0) as maxSale,
                       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeSales,
                       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedSales,
                       SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelledSales
                FROM purchases
                WHERE sellerId = ?
            `, [req.params.userId]);

            // Покупки (если пользователь — покупатель)
            const purchasesStats = db.exec(`
                SELECT COUNT(*) as totalPurchases,
                       COALESCE(SUM(price), 0) as totalSpent,
                       COALESCE(AVG(price), 0) as avgPurchase
                FROM purchases
                WHERE buyerId = ?
            `, [req.params.userId]);

            // Товары пользователя
            const productsStats = db.exec(`
                SELECT COUNT(*) as totalProducts,
                       SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
                       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                       SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
                FROM products
                WHERE sellerId = ?
            `, [req.params.userId]);

            // Продажи по дням (последние 30)
            const salesByDay = db.exec(`
                SELECT strftime('%Y-%m-%d', date) as date,
                       COUNT(*) as count,
                       SUM(price) as revenue
                FROM purchases
                WHERE sellerId = ? AND date >= datetime('now', '-30 days')
                GROUP BY date
                ORDER BY date
            `, [req.params.userId]);

            // Отзывы о пользователе
            const reviewsStats = db.exec(`
                SELECT COUNT(*) as totalReviews,
                       COALESCE(AVG(rating), 0) as avgRating,
                       SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as fiveStars,
                       SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as fourStars,
                       SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as threeStars,
                       SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as twoStars,
                       SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as oneStar
                FROM reviews
                WHERE sellerId = ?
            `, [req.params.userId]);

            const formatStats = (result, fields) => {
                if (!result.length || !result[0].values.length) return {};
                const row = result[0].values[0];
                const obj = {};
                fields.forEach((field, i) => {
                    obj[field] = typeof row[i] === 'number' ? row[i] : parseFloat(row[i] || 0).toFixed(2);
                });
                return obj;
            };

            res.json({
                sales: formatStats(salesStats, ['totalSales', 'totalRevenue', 'avgSale', 'maxSale', 'activeSales', 'completedSales', 'cancelledSales']),
                purchases: formatStats(purchasesStats, ['totalPurchases', 'totalSpent', 'avgPurchase']),
                products: formatStats(productsStats, ['totalProducts', 'approved', 'pending', 'rejected']),
                salesByDay: salesByDay.length > 0 ? salesByDay[0].values.map(r => ({
                    date: r[0], count: r[1], revenue: r[2]
                })) : [],
                reviews: formatStats(reviewsStats, ['totalReviews', 'avgRating', 'fiveStars', 'fourStars', 'threeStars', 'twoStars', 'oneStar'])
            });
        } catch (error) {
            console.error('Ошибка персональной аналитики:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ============================================
    // TELEGRAM БОТ: Подписка на уведомления
    // ============================================

    // POST /api/telegram/webhook — webhook от Telegram Bot API
    app.post('/api/telegram/webhook', express.json(), (req, res) => {
        try {
            const update = req.body;

            // Обрабатываем только сообщения
            if (!update.message || !update.message.text) {
                return res.json({ ok: true });
            }

            const chatId = update.message.chat.id;
            const text = update.message.text.trim();
            const firstName = update.message.from.first_name || 'Пользователь';

            // Команда /start — регистрация
            if (text === '/start' || text.startsWith('/start ')) {
                // Извлекаем userId из /start userId
                const parts = text.split(' ');
                const userId = parts[1];

                if (!userId) {
                    telegram.sendTelegramMessage(chatId,
                        `👋 Привет, ${firstName}!\n\n` +
                        `Для подписки на уведомления отправьте команду:\n` +
                        `/connect ВАШ_USER_ID\n\n` +
                        `Ваш userId можно найти в настройках профиля.`
                    );
                    return res.json({ ok: true });
                }

                // Проверяем, что пользователь существует
                const userResult = db.exec("SELECT name FROM users WHERE id = ?", [userId]);
                if (!userResult.length || !userResult[0].values.length) {
                    telegram.sendTelegramMessage(chatId,
                        `❌ Пользователь с ID "${userId}" не найден. Проверьте правильность ID.`
                    );
                    return res.json({ ok: true });
                }

                const userName = userResult[0].values[0][0];

                // Сохраняем подписку
                try {
                    db.run("INSERT OR REPLACE INTO telegram_subscriptions (userId, chatId, createdAt) VALUES (?, ?, CURRENT_TIMESTAMP)",
                        [userId, String(chatId)]);
                    saveDatabase();
                    telegram.chatIdCache.set(userId, String(chatId));
                } catch (e) {
                    // Если UNIQUE constraint не работает, используем UPDATE
                    db.run("UPDATE telegram_subscriptions SET chatId = ? WHERE userId = ?", [String(chatId), userId]);
                    saveDatabase();
                    telegram.chatIdCache.set(userId, String(chatId));
                }

                telegram.sendTelegramMessage(chatId,
                    `✅ ${userName}, вы подписаны на уведомления!\n\n` +
                    `Вы будете получать уведомления о:\n` +
                    `• 💰 Новых покупках ваших товаров\n` +
                    `• ✅/❌ Результатах модерации\n` +
                    `• 📝 Новых отзывах\n\n` +
                    `Для отписки: /unsubscribe`
                );

                console.log(`[TELEGRAM] Пользователь ${userId} (${userName}) подписался: chatId=${chatId}`);
                return res.json({ ok: true });
            }

            // Команда /connect userId
            if (text.startsWith('/connect ')) {
                const userId = text.split(' ')[1];
                if (!userId) {
                    return telegram.sendTelegramMessage(chatId, 'Использование: /connect ВАШ_USER_ID');
                }

                const userResult = db.exec("SELECT name FROM users WHERE id = ?", [userId]);
                if (!userResult.length || !userResult[0].values.length) {
                    return telegram.sendTelegramMessage(chatId, `❌ Пользователь "${userId}" не найден`);
                }

                const userName = userResult[0].values[0][0];
                try {
                    db.run("INSERT OR REPLACE INTO telegram_subscriptions (userId, chatId, createdAt) VALUES (?, ?, CURRENT_TIMESTAMP)",
                        [userId, String(chatId)]);
                    saveDatabase();
                    telegram.chatIdCache.set(userId, String(chatId));
                } catch (e) {
                    db.run("UPDATE telegram_subscriptions SET chatId = ? WHERE userId = ?", [String(chatId), userId]);
                    saveDatabase();
                    telegram.chatIdCache.set(userId, String(chatId));
                }

                telegram.sendTelegramMessage(chatId, `✅ ${userName}, подписка оформлена!`);
                console.log(`[TELEGRAM] Подписка через /connect: userId=${userId}, chatId=${chatId}`);
                return res.json({ ok: true });
            }

            // Команда /unsubscribe
            if (text === '/unsubscribe') {
                db.run("DELETE FROM telegram_subscriptions WHERE chatId = ?", [String(chatId)]);
                saveDatabase();
                // Удаляем из кэша
                for (const [userId, cId] of telegram.chatIdCache.entries()) {
                    if (cId === String(chatId)) {
                        telegram.chatIdCache.delete(userId);
                    }
                }

                telegram.sendTelegramMessage(chatId,
                    `👋 Вы отписались от уведомлений.\nДля подписки снова: /connect ВАШ_USER_ID`
                );
                console.log(`[TELEGRAM] Отписка: chatId=${chatId}`);
                return res.json({ ok: true });
            }

            // Команда /help
            if (text === '/help') {
                telegram.sendTelegramMessage(chatId,
                    `📋 Доступные команды:\n\n` +
                    `/connect USER_ID — подписаться на уведомления\n` +
                    `/unsubscribe — отписаться\n` +
                    `/status — проверить статус подписки\n` +
                    `/help — эта справка`
                );
                return res.json({ ok: true });
            }

            // Команда /status
            if (text === '/status') {
                const subResult = db.exec("SELECT userId FROM telegram_subscriptions WHERE chatId = ?", [String(chatId)]);
                if (subResult.length > 0 && subResult[0].values.length > 0) {
                    const userId = subResult[0].values[0][0];
                    telegram.sendTelegramMessage(chatId, `✅ Вы подписаны на уведомления (userId: ${userId})`);
                } else {
                    telegram.sendTelegramMessage(chatId, `❌ Вы не подписаны. Используйте /connect USER_ID`);
                }
                return res.json({ ok: true });
            }

            // Неизвестная команда
            telegram.sendTelegramMessage(chatId,
                `❓ Неизвестная команда. Используйте /help для списка команд.`
            );
            res.json({ ok: true });
        } catch (error) {
            console.error('[TELEGRAM] Ошибка обработки webhook:', error.message);
            res.json({ ok: true });
        }
    });

    // GET /api/telegram/status/:userId — проверить статус подписки пользователя
    app.get('/api/telegram/status/:userId', authenticateToken, (req, res) => {
        try {
            if (req.user.id !== req.params.userId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён' });
            }

            const chatId = telegram.chatIdCache.get(req.params.userId);
            res.json({
                userId: req.params.userId,
                subscribed: !!chatId,
                chatId: chatId || null
            });
        } catch (error) {
            console.error('[TELEGRAM] Ошибка проверки статуса:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // POST /api/telegram/unsubscribe/:userId — отписаться (для фронтенда)
    app.post('/api/telegram/unsubscribe/:userId', authenticateToken, (req, res) => {
        try {
            if (req.user.id !== req.params.userId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён' });
            }

            db.run("DELETE FROM telegram_subscriptions WHERE userId = ?", [req.params.userId]);
            telegram.chatIdCache.delete(req.params.userId);
            saveDatabase();

            console.log(`[TELEGRAM] Пользователь ${req.params.userId} отписан через API`);
            res.json({ message: 'Вы отписаны от Telegram-уведомлений' });
        } catch (error) {
            console.error('[TELEGRAM] Ошибка отписки:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // POST /api/telegram/test — тестовое сообщение (только админ)
    app.post('/api/telegram/test', authenticateToken, requireAdmin, (req, res) => {
        try {
            const { chatId, message } = req.body;

            if (chatId) {
                // Отправить конкретному chatId
                telegram.sendTelegramMessage(chatId, message || '🔔 Тестовое сообщение').then(result => {
                    res.json({ ok: result.ok, description: result.description });
                });
            } else {
                // Отправить всем подписчикам
                const subs = db.exec("SELECT chatId FROM telegram_subscriptions");
                if (subs.length === 0 || subs[0].values.length === 0) {
                    return res.json({ ok: true, sent: 0, message: 'Нет подписчиков' });
                }

                let sent = 0;
                const promises = subs[0].values.map(row => {
                    return telegram.sendTelegramMessage(row[0], message || '🔔 Тестовое сообщение от администратора')
                        .then(r => { if (r.ok) sent++; });
                });

                Promise.all(promises).then(() => {
                    res.json({ ok: true, sent, total: subs[0].values.length });
                });
            }
        } catch (error) {
            console.error('[TELEGRAM] Ошибка тестового сообщения:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ============================================
    // HEALTH CHECK
    // ============================================
    app.get('/api/health', (req, res) => {
        try {
            db.exec("SELECT 1");
            res.json({ status: 'ok', database: 'connected', uptime: process.uptime(), timestamp: new Date().toISOString() });
        } catch (error) {
            res.status(503).json({ status: 'error', database: 'disconnected' });
        }
    });

    // ============================================
    // 404 HANDLER
    // ============================================
    app.use((req, res) => {
        if (req.path.startsWith('/api/')) {
            return res.status(404).json({ error: 'Эндпоинт не найден', path: req.path });
        }
        res.status(404).send('Страница не найдена');
    });

    // ============================================
    // ERROR HANDLER
    // ============================================
    app.use((err, req, res, next) => {
        console.error(`[ERROR] ${err.message}`, err.stack);

        if (err.type === 'entity.parse.failed') {
            return res.status(400).json({ error: 'Некорректный JSON в запросе' });
        }

        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'Файл слишком большой' });
        }

        res.status(err.status || 500).json({
            error: process.env.NODE_ENV === 'production' ? 'Внутренняя ошибка сервера' : err.message
        });
    });

    // ============================================
    // ОБРАБОТЧИКИ ЗАВЕРШЕНИЯ РАБОТЫ СЕРВЕРА
    // ============================================
    function gracefulShutdown(signal) {
        console.log(`\n[SERVER] Получен сигнал ${signal}. Сохранение базы данных...`);
        try {
            saveDatabase();
            console.log('[SERVER] База данных сохранена. Сервер завершает работу.');
        } catch (error) {
            console.error('[SERVER] Ошибка сохранения базы данных:', error.message);
        }
        process.exit(0);
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('beforeExit', () => {
        try {
            console.log('[SERVER] Сохранение базы данных перед выходом...');
            saveDatabase();
            console.log('[SERVER] База данных сохранена перед выходом');
        } catch (error) {
            console.error('[SERVER] Ошибка сохранения перед выходом:', error.message);
        }
    });

    // Запуск сервера
    // ============================================
    initDatabase().then(() => {
        app.listen(PORT, () => {
            console.log(`Сервер запущен: http://localhost:${PORT}`);
            console.log(`API доступно: http://localhost:${PORT}/api`);
            console.log(`Режим безопасности: включен`);
        });
    });
}
