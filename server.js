const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { body, param, query, validationResult } = require('express-validator');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// НАСТРОЙКА PROXY (для Render/Heroku и др.)
// ============================================
app.set('trust proxy', 1);

// ============================================
// ЛОГИРОВАНИЕ запросов (для отладки)
// ============================================
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// ============================================
// БЕЗОПАСНОСТЬ: Заголовки безопасности (A05)
// ============================================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://telegram.org"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
            connectSrc: ["'self'", '*'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:', 'https://telegram.org'],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'", 'blob:'],
            frameSrc: ["'none'", "https://oauth.telegram.org"]
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false
}));

// ============================================
// БЕЗОПАСНОСТЬ: Rate limiting (A04, A07)
// ============================================
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100, // 100 запросов
    message: { error: 'Слишком много запросов, попробуйте позже' }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 5, // 5 попыток входа
    message: { error: 'Слишком много попыток входа, попробуйте через 15 минут' },
    skipSuccessfulRequests: false
});

const strictLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 час
    max: 10, // 10 запросов
    message: { error: 'Слишком много запросов' }
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
app.use(express.static(path.join(__dirname)));

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
            locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
        });

        const dbPath = path.join(__dirname, 'database.sqlite');
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
        db.run(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, balance INTEGER DEFAULT 10000, isAdmin INTEGER DEFAULT 0, isBlocked INTEGER DEFAULT 0, rating REAL DEFAULT 0, reviewCount INTEGER DEFAULT 0, telegram_id BIGINT UNIQUE, photo_url TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);

        // Миграция для существующих БД
        try { db.run(`ALTER TABLE users ADD COLUMN telegram_id BIGINT UNIQUE`); } catch(e) {}
        try { db.run(`ALTER TABLE users ADD COLUMN photo_url TEXT`); } catch(e) {}
        db.run(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL, discipline TEXT NOT NULL, price INTEGER NOT NULL, sellerId TEXT NOT NULL, sellerName TEXT NOT NULL, deadline TEXT, status TEXT DEFAULT 'pending', createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, productId INTEGER NOT NULL, title TEXT NOT NULL, price INTEGER NOT NULL, buyerId TEXT NOT NULL, sellerId TEXT NOT NULL, deadline TEXT, date TEXT DEFAULT CURRENT_TIMESTAMP, fileAttached INTEGER DEFAULT 0)`);
        db.run(`CREATE TABLE IF NOT EXISTS work_files (id INTEGER PRIMARY KEY AUTOINCREMENT, purchaseId INTEGER NOT NULL, fileName TEXT NOT NULL, fileData TEXT NOT NULL, uploadedAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, purchaseId INTEGER NOT NULL, buyerId TEXT NOT NULL, sellerId TEXT NOT NULL, rating INTEGER NOT NULL, comment TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS custom_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, budget INTEGER NOT NULL, requesterId TEXT NOT NULL, requesterName TEXT NOT NULL, fileName TEXT, fileData TEXT, status TEXT DEFAULT 'pending', createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, purchaseId INTEGER NOT NULL, senderId TEXT NOT NULL, receiverId TEXT NOT NULL, message TEXT, fileName TEXT, fileData TEXT, fileType TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, type TEXT NOT NULL, isRead INTEGER DEFAULT 0, createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);

        // Создание администратора по умолчанию
        const adminExists = db.exec("SELECT * FROM users WHERE email = 'admin@studentmarket.ru'");
        if (adminExists.length === 0 || adminExists[0].values.length === 0) {
            const hashedPassword = bcrypt.hashSync('admin123', 10);
            db.run(`INSERT INTO users (id, name, email, password, balance, isAdmin, isBlocked) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
                ['admin', 'Администратор', 'admin@studentmarket.ru', hashedPassword, 10000, 1, 0]);
            saveDatabase();
            console.log('Администратор создан');
        }
        console.log('База данных инициализирована');
    }

    function saveDatabase() {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(path.join(__dirname, 'database.sqlite'), buffer);
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

    app.get('/api/users', (req, res) => {
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

    app.get('/api/users/:id', userIdValidator, (req, res) => {
        try {
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

    app.patch('/api/users/:id/balance', userIdValidator, (req, res) => {
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

    app.patch('/api/users/:id/block', userIdValidator, (req, res) => {
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

    app.delete('/api/users/:id', userIdValidator, (req, res) => {
        try {
            const userResult = db.exec("SELECT isAdmin FROM users WHERE id = ?", [req.params.id]);
            if (userResult.length > 0 && userResult[0].values.length > 0 && userResult[0].values[0][0] === 1) {
                return res.status(403).json({ error: 'Нельзя удалить администратора' });
            }
            db.run("DELETE FROM users WHERE id = ?", [req.params.id]);
            saveDatabase();
            console.log(`[AUDIT] Пользователь удален: ${req.params.id}`);
            res.json({ message: 'Пользователь удалён' });
        } catch (error) {
            console.error('Ошибка удаления:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ============================================
    // TELEGRAM AUTH (для локальной разработки)
    // ============================================

    app.get('/api/config/telegram', (req, res) => {
        const botUsername = process.env.TELEGRAM_BOT_USERNAME || null;
        console.log(`[TELEGRAM] Запрос конфига. TELEGRAM_BOT_USERNAME=${botUsername}`);
        res.json({
            botUsername: botUsername
        });
    });

    function verifyTelegramAuth(data, botToken) {
        const { hash, ...checkData } = data;
        const dataCheckString = Object.keys(checkData)
            .sort()
            .map(key => `${key}=${checkData[key]}`)
            .join('\n');
        const secretKey = crypto.createHash('sha256').update(botToken).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        return calculatedHash === hash;
    }

    app.post('/api/auth/telegram', async (req, res) => {
        try {
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            if (!botToken) {
                return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN не установлен' });
            }
            const telegramData = req.body;
            if (!verifyTelegramAuth(telegramData, botToken)) {
                return res.status(401).json({ error: 'Неверная подпись' });
            }
            const authDate = parseInt(telegramData.auth_date);
            const now = Math.floor(Date.now() / 1000);
            if (now - authDate > 86400) {
                return res.status(401).json({ error: 'Данные устарели' });
            }
            const telegramId = telegramData.id;
            const firstName = telegramData.first_name || '';
            const lastName = telegramData.last_name || '';
            const username = telegramData.username || `user_${telegramId}`;
            const photoUrl = telegramData.photo_url || null;
            const fullName = `${firstName} ${lastName}`.trim() || username;

            let result = db.exec("SELECT * FROM users WHERE telegram_id = ?", [telegramId]);

            if (result.length === 0 || result[0].values.length === 0) {
                const hashedPassword = await bcrypt.hash(uuidv4(), 10);
                const newId = uuidv4();
                db.run(`INSERT INTO users (id, name, email, password, balance, isAdmin, isBlocked, telegram_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [newId, sanitizeHTML(fullName), `${telegramId}@telegram.user`, hashedPassword, 10000, 0, 0, telegramId]);
                saveDatabase();
                result = db.exec("SELECT * FROM users WHERE id = ?", [newId]);
                console.log(`[TELEGRAM] Создан: ${fullName}`);
            } else {
                console.log(`[TELEGRAM] Вход: ${fullName}`);
            }

            const row = result[0].values[0];
            res.json({
                id: sanitizeHTML(row[0]),
                name: sanitizeHTML(row[1]),
                email: sanitizeHTML(row[2]),
                balance: row[4],
                isAdmin: Boolean(row[5]),
                isBlocked: Boolean(row[6]),
                telegramId: row[7] || telegramId,
                photoUrl: photoUrl
            });
        } catch (error) {
            console.error('[TELEGRAM] Ошибка:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ============================================
    // API: Товары
    // ============================================

    app.get('/api/products', (req, res) => {
        try {
            const result = db.exec("SELECT * FROM products WHERE status = 'approved'");
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
            console.error('Ошибка получения товаров:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    app.get('/api/products/all', (req, res) => {
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

    app.get('/api/users/:id/products', userIdValidator, (req, res) => {
        try {
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

    app.post('/api/products', productCreateValidator, (req, res) => {
        try {
            const { title, category, discipline, price, sellerId, sellerName, deadline } = req.body;
            
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

    app.patch('/api/products/:id/approve', [param('id').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            db.run("UPDATE products SET status = 'approved' WHERE id = ?", [req.params.id]);
            saveDatabase();
            console.log(`[MODERATION] Товар одобрен: ${req.params.id}`);
            res.json({ message: 'Товар одобрен' });
        } catch (error) { 
            console.error('Ошибка одобрения:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    app.patch('/api/products/:id/reject', [param('id').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            db.run("UPDATE products SET status = 'rejected' WHERE id = ?", [req.params.id]);
            saveDatabase();
            console.log(`[MODERATION] Товар отклонен: ${req.params.id}`);
            res.json({ message: 'Товар отклонён' });
        } catch (error) { 
            console.error('Ошибка отклонения:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    app.delete('/api/products/:id', [param('id').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            db.run("DELETE FROM products WHERE id = ?", [req.params.id]);
            saveDatabase();
            console.log(`[PRODUCT] Товар удален: ${req.params.id}`);
            res.json({ message: 'Товар удалён' });
        } catch (error) { 
            console.error('Ошибка удаления товара:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    // ============================================
    // API: Покупки
    // ============================================

    app.get('/api/users/:id/purchases', userIdValidator, (req, res) => {
        try {
            const result = db.exec("SELECT * FROM purchases WHERE buyerId = ?", [req.params.id]);
            res.json(result.length > 0 ? result[0].values.map(row => ({ 
                id: row[0], 
                productId: row[1], 
                title: sanitizeHTML(row[2]), 
                price: row[3], 
                buyerId: sanitizeHTML(row[4]), 
                sellerId: sanitizeHTML(row[5]), 
                deadline: row[6], 
                date: row[7], 
                fileAttached: Boolean(row[8]) 
            })) : []);
        } catch (error) { 
            console.error('Ошибка получения покупок:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    app.get('/api/users/:id/sales', userIdValidator, (req, res) => {
        try {
            const result = db.exec("SELECT * FROM purchases WHERE sellerId = ?", [req.params.id]);
            res.json(result.length > 0 ? result[0].values.map(row => ({ 
                id: row[0], 
                productId: row[1], 
                title: sanitizeHTML(row[2]), 
                price: row[3], 
                buyerId: sanitizeHTML(row[4]), 
                sellerId: sanitizeHTML(row[5]), 
                deadline: row[6], 
                date: row[7], 
                fileAttached: Boolean(row[8]) 
            })) : []);
        } catch (error) { 
            console.error('Ошибка получения продаж:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    app.post('/api/purchases', purchaseCreateValidator, (req, res) => {
        try {
            const { productId, title, price, buyerId, sellerId, deadline } = req.body;
            
            db.run("INSERT INTO purchases (productId, title, price, buyerId, sellerId, deadline) VALUES (?, ?, ?, ?, ?, ?)", 
                [productId, sanitizeHTML(title), price, sanitizeHTML(buyerId), sanitizeHTML(sellerId), deadline || null]);
            saveDatabase();
            
            const result = db.exec("SELECT last_insert_rowid()");
            const purchaseId = result[0].values[0][0];
            
            console.log(`[PURCHASE] Создана покупка: ${purchaseId}, покупатель: ${buyerId}`);
            
            res.status(201).json({ 
                id: purchaseId, 
                productId, 
                title: sanitizeHTML(title), 
                price, 
                buyerId: sanitizeHTML(buyerId), 
                sellerId: sanitizeHTML(sellerId), 
                deadline 
            });
        } catch (error) { 
            console.error('Ошибка создания покупки:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    // ============================================
    // API: Файлы
    // ============================================

    app.post('/api/purchases/:purchaseId/file', [param('purchaseId').notEmpty().isInt().withMessage('Некорректный ID'), ...fileValidator], (req, res) => {
        try {
            const { purchaseId } = req.params;
            const { fileName, fileData } = req.body;
            
            // Проверка существования покупки
            const purchaseCheck = db.exec("SELECT * FROM purchases WHERE id = ?", [purchaseId]);
            if (purchaseCheck.length === 0 || purchaseCheck[0].values.length === 0) {
                return res.status(404).json({ error: 'Покупка не найдена' });
            }
            
            // Валидация типа файла по расширению
            const allowedExtensions = ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'zip', 'rar'];
            const fileExt = fileName.split('.').pop().toLowerCase();
            if (!allowedExtensions.includes(fileExt)) {
                return res.status(400).json({ error: 'Недопустимый тип файла' });
            }
            
            db.run("DELETE FROM work_files WHERE purchaseId = ?", [purchaseId]);
            db.run("INSERT INTO work_files (purchaseId, fileName, fileData) VALUES (?, ?, ?)", 
                [purchaseId, sanitizeHTML(fileName), fileData]);
            db.run("UPDATE purchases SET fileAttached = 1 WHERE id = ?", [purchaseId]);
            saveDatabase();
            
            console.log(`[FILE] Файл загружен для покупки: ${purchaseId}`);
            res.json({ message: 'Файл загружен' });
        } catch (error) { 
            console.error('Ошибка загрузки файла:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    app.get('/api/purchases/:purchaseId/file', [param('purchaseId').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            const result = db.exec("SELECT * FROM work_files WHERE purchaseId = ?", [req.params.purchaseId]);
            if (result.length === 0 || result[0].values.length === 0) {
                return res.status(404).json({ error: 'Файл не найден' });
            }
            const row = result[0].values[0];
            res.json({ 
                fileName: sanitizeHTML(row[2]), 
                fileData: row[3], 
                uploadedAt: row[4] 
            });
        } catch (error) { 
            console.error('Ошибка получения файла:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    // ============================================
    // API: Отзывы
    // ============================================

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

    app.post('/api/reviews', reviewCreateValidator, (req, res) => {
        try {
            const { purchaseId, buyerId, sellerId, rating, comment } = req.body;
            
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

    app.get('/api/custom-requests/all', (req, res) => {
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

    app.post('/api/custom-requests', customRequestCreateValidator, (req, res) => {
        try {
            const { title, description, budget, requesterId, requesterName, fileName, fileData } = req.body;
            
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

    app.patch('/api/custom-requests/:id/approve', [param('id').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            db.run("UPDATE custom_requests SET status = 'approved' WHERE id = ?", [req.params.id]);
            saveDatabase();
            console.log(`[MODERATION] Запрос одобрен: ${req.params.id}`);
            res.json({ message: 'Запрос одобрен' });
        } catch (error) { 
            console.error('Ошибка одобрения запроса:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    app.patch('/api/custom-requests/:id/reject', [param('id').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            db.run("UPDATE custom_requests SET status = 'rejected' WHERE id = ?", [req.params.id]);
            saveDatabase();
            console.log(`[MODERATION] Запрос отклонен: ${req.params.id}`);
            res.json({ message: 'Запрос отклонён' });
        } catch (error) { 
            console.error('Ошибка отклонения запроса:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    app.delete('/api/custom-requests/:id', [param('id').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            db.run("DELETE FROM custom_requests WHERE id = ?", [req.params.id]);
            saveDatabase();
            console.log(`[CUSTOM_REQUEST] Запрос удален: ${req.params.id}`);
            res.json({ message: 'Запрос удалён' });
        } catch (error) { 
            console.error('Ошибка удаления запроса:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    // ============================================
    // API: Чат
    // ============================================

    app.get('/api/chat/:purchaseId', [param('purchaseId').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            const result = db.exec("SELECT * FROM chat_messages WHERE purchaseId = ? ORDER BY createdAt ASC", [req.params.purchaseId]);
            res.json(result.length > 0 ? result[0].values.map(row => ({ 
                id: row[0], 
                purchaseId: row[1], 
                senderId: sanitizeHTML(row[2]), 
                receiverId: sanitizeHTML(row[3]), 
                message: sanitizeHTML(row[4]), 
                fileName: sanitizeHTML(row[5]), 
                fileData: row[6], 
                fileType: sanitizeHTML(row[7]), 
                createdAt: row[8] 
            })) : []);
        } catch (error) { 
            console.error('Ошибка получения сообщений:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    app.post('/api/chat', [
        body('purchaseId').notEmpty().isInt().withMessage('Некорректный ID покупки'),
        body('senderId').trim().notEmpty().withMessage('ID отправителя обязателен'),
        body('receiverId').trim().notEmpty().withMessage('ID получателя обязателен'),
        body('message').optional().isLength({ max: 2000 }).withMessage('Сообщение слишком длинное'),
        body('fileName').optional().isLength({ max: 255 }),
        validate
    ], (req, res) => {
        try {
            const { purchaseId, senderId, receiverId, message, fileName, fileData, fileType } = req.body;
            
            db.run("INSERT INTO chat_messages (purchaseId, senderId, receiverId, message, fileName, fileData, fileType) VALUES (?, ?, ?, ?, ?, ?, ?)", 
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
                fileType: sanitizeHTML(fileType || null) 
            });
        } catch (error) { 
            console.error('Ошибка отправки сообщения:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    app.get('/api/chat/purchases/:userId', userIdValidator, (req, res) => {
        try {
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

    app.get('/api/notifications/:userId', userIdValidator, (req, res) => {
        try {
            const result = db.exec("SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC", [req.params.userId]);
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

    app.post('/api/notifications', [
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

    app.patch('/api/notifications/:id/read', [param('id').notEmpty().isInt().withMessage('Некорректный ID'), validate], (req, res) => {
        try {
            db.run("UPDATE notifications SET isRead = 1 WHERE id = ?", [req.params.id]);
            saveDatabase();
            res.json({ message: 'Уведомление прочитано' });
        } catch (error) { 
            console.error('Ошибка обновления уведомления:', error.message);
            res.status(500).json({ error: 'Ошибка сервера' }); 
        }
    });

    // ============================================
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
