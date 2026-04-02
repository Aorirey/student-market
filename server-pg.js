const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const { body, param, query, validationResult } = require('express-validator');

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
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
            connectSrc: ["'self'", '*'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'", 'blob:'],
            frameSrc: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
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
        if (adminExists.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await pool.query(
                `INSERT INTO users (id, name, email, password, balance, is_admin, is_blocked) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`, 
                ['admin', 'Администратор', 'admin@studentmarket.ru', hashedPassword, 10000, true, false]
            );
            console.log('✅ Администратор создан');
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
    body('name').trim().notEmpty().withMessage('Имя обязательно').isLength({ max: 100 }),
    body('email').trim().notEmpty().withMessage('Email обязателен').isEmail().normalizeEmail(),
    body('password').notEmpty().withMessage('Пароль обязателен').isLength({ min: 6, max: 128 }),
    validate
];

const loginValidator = [
    body('email').trim().notEmpty().withMessage('Email обязателен').isEmail().normalizeEmail(),
    body('password').notEmpty().withMessage('Пароль обязателен'),
    validate
];

const userIdValidator = [
    param('id').trim().notEmpty().isLength({ max: 100 }),
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
        const existing = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
        if (existing.rows.length > 0) return res.status(409).json({ error: 'Пользователь уже существует' });
        const hashedPassword = await bcrypt.hash(password, 10);
        const id = uuidv4();
        const result = await pool.query(
            `INSERT INTO users (id, name, email, password, balance, is_admin, is_blocked) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING id, name, email, balance, is_admin, is_blocked`, 
            [id, sanitizeHTML(name), email.toLowerCase(), hashedPassword, 10000, false, false]
        );
        console.log(`[AUTH] Зарегистрирован: ${email}`);
        res.status(201).json({ 
            id: result.rows[0].id, 
            name: sanitizeHTML(result.rows[0].name), 
            email: result.rows[0].email, 
            balance: result.rows[0].balance, 
            isAdmin: result.rows[0].is_admin, 
            isBlocked: result.rows[0].is_blocked 
        });
    } catch (error) { 
        console.error('Ошибка регистрации:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

app.post('/api/users/login', loginValidator, async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await pool.query("SELECT id, name, email, password, balance, is_admin, is_blocked FROM users WHERE email = $1", [email.toLowerCase()]);
        if (result.rows.length === 0) {
            console.log(`[AUTH] Неудачный вход: ${email}`);
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }
        const row = result.rows[0];
        const isValidPassword = await bcrypt.compare(password, row.password);
        if (!isValidPassword) {
            console.log(`[AUTH] Неудачный вход: ${email}`);
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }
        if (row.is_blocked) {
            console.log(`[AUTH] Заблокирован: ${email}`);
            return res.status(403).json({ error: 'Аккаунт заблокирован' });
        }
        console.log(`[AUTH] Успешный вход: ${email}`);
        res.json({ 
            id: sanitizeHTML(row.id), 
            name: sanitizeHTML(row.name), 
            email: sanitizeHTML(row.email), 
            balance: row.balance, 
            isAdmin: row.is_admin, 
            isBlocked: row.is_blocked 
        });
    } catch (error) { 
        console.error('Ошибка входа:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' }); 
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
        const result = await pool.query("SELECT * FROM purchases WHERE seller_id = $1", [req.params.id]);
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

app.get('/api/chat/:purchaseId', [param('purchaseId').notEmpty().isInt(), validate], async (req, res) => {
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
    body('purchaseId').notEmpty().isInt(),
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
// Главная страница
// ============================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// Запуск сервера
// ============================================

initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
        console.log(`📡 API: http://localhost:${PORT}/api`);
        console.log(`🔒 Trust proxy: включён`);
        console.log(`🌍 ENV: ${process.env.NODE_ENV || 'development'}`);
    });
});
