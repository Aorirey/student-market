const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Проверяем режим работы с БД
const dbMode = process.env.DB_MODE || 'sqlite';

if (dbMode === 'postgres') {
    console.log('🚀 Запуск в режиме PostgreSQL...');
    require('./server-pg');
} else {
    console.log('🚀 Запуск в режиме SQLite...');
    const initSqlJs = require('sql.js');
    const fs = require('fs');
    const { v4: uuidv4 } = require('uuid');

    app.use(cors());
    app.use(express.json({ limit: '50mb' }));
    app.use(express.static(path.join(__dirname)));

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

        db.run(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, balance INTEGER DEFAULT 10000, isAdmin INTEGER DEFAULT 0, isBlocked INTEGER DEFAULT 0, rating REAL DEFAULT 0, reviewCount INTEGER DEFAULT 0, createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL, discipline TEXT NOT NULL, price INTEGER NOT NULL, sellerId TEXT NOT NULL, sellerName TEXT NOT NULL, status TEXT DEFAULT 'pending', createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, productId INTEGER NOT NULL, title TEXT NOT NULL, price INTEGER NOT NULL, buyerId TEXT NOT NULL, sellerId TEXT NOT NULL, date TEXT DEFAULT CURRENT_TIMESTAMP, fileAttached INTEGER DEFAULT 0)`);
        db.run(`CREATE TABLE IF NOT EXISTS work_files (id INTEGER PRIMARY KEY AUTOINCREMENT, purchaseId INTEGER NOT NULL, fileName TEXT NOT NULL, fileData TEXT NOT NULL, uploadedAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, purchaseId INTEGER NOT NULL, buyerId TEXT NOT NULL, sellerId TEXT NOT NULL, rating INTEGER NOT NULL, comment TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS custom_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, budget INTEGER NOT NULL, requesterId TEXT NOT NULL, requesterName TEXT NOT NULL, fileName TEXT, fileData TEXT, status TEXT DEFAULT 'pending', createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);

        const adminExists = db.exec("SELECT * FROM users WHERE email = 'admin@studentmarket.ru'");
        if (adminExists.length === 0 || adminExists[0].values.length === 0) {
            db.run(`INSERT INTO users (id, name, email, password, balance, isAdmin, isBlocked) VALUES ('admin', 'Администратор', 'admin@studentmarket.ru', 'admin123', 10000, 1, 0)`);
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

    // API пользователи
    app.get('/api/users', (req, res) => {
        try {
            const result = db.exec("SELECT id, name, email, balance, isAdmin, isBlocked, createdAt FROM users");
            if (result.length === 0) return res.json([]);
            res.json(result[0].values.map(row => ({ id: row[0], name: row[1], email: row[2], balance: row[3], isAdmin: Boolean(row[4]), isBlocked: Boolean(row[5]), createdAt: row[6] })));
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.get('/api/users/:id', (req, res) => {
        try {
            const result = db.exec(`SELECT id, name, email, balance, isAdmin, isBlocked, createdAt FROM users WHERE id = '${req.params.id}'`);
            if (result.length === 0 || result[0].values.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
            const row = result[0].values[0];
            res.json({ id: row[0], name: row[1], email: row[2], balance: row[3], isAdmin: Boolean(row[4]), isBlocked: Boolean(row[5]), createdAt: row[6] });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.post('/api/users/register', (req, res) => {
        try {
            const { name, email, password } = req.body;
            if (!name || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
            const existing = db.exec(`SELECT * FROM users WHERE email = '${email}'`);
            if (existing.length > 0 && existing[0].values.length > 0) return res.status(409).json({ error: 'Пользователь уже существует' });
            const id = uuidv4();
            db.run(`INSERT INTO users (id, name, email, password, balance, isAdmin, isBlocked) VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, name, email, password, 10000, 0, 0]);
            saveDatabase();
            res.status(201).json({ id, name, email, balance: 10000, isAdmin: false, isBlocked: false });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.post('/api/users/login', (req, res) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) return res.status(400).json({ error: 'Заполните все поля' });
            const result = db.exec(`SELECT id, name, email, balance, isAdmin, isBlocked FROM users WHERE email = '${email}' AND password = '${password}'`);
            if (result.length === 0 || result[0].values.length === 0) return res.status(401).json({ error: 'Неверный email или пароль' });
            const row = result[0].values[0];
            const user = { id: row[0], name: row[1], email: row[2], balance: row[3], isAdmin: Boolean(row[4]), isBlocked: Boolean(row[5]) };
            if (user.isBlocked) return res.status(403).json({ error: 'Аккаунт заблокирован' });
            res.json(user);
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.patch('/api/users/:id/balance', (req, res) => {
        try {
            db.run(`UPDATE users SET balance = ? WHERE id = ?`, [req.body.balance, req.params.id]);
            saveDatabase();
            const result = db.exec(`SELECT id, name, email, balance, isAdmin, isBlocked FROM users WHERE id = '${req.params.id}'`);
            const row = result[0].values[0];
            res.json({ id: row[0], name: row[1], email: row[2], balance: row[3], isAdmin: Boolean(row[4]), isBlocked: Boolean(row[5]) });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.patch('/api/users/:id/block', (req, res) => {
        try {
            db.run(`UPDATE users SET isBlocked = ? WHERE id = ?`, [req.body.isBlocked ? 1 : 0, req.params.id]);
            saveDatabase();
            const result = db.exec(`SELECT id, name, email, balance, isAdmin, isBlocked FROM users WHERE id = '${req.params.id}'`);
            const row = result[0].values[0];
            res.json({ id: row[0], name: row[1], email: row[2], balance: row[3], isAdmin: Boolean(row[4]), isBlocked: Boolean(row[5]) });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.delete('/api/users/:id', (req, res) => {
        try {
            const userResult = db.exec(`SELECT isAdmin FROM users WHERE id = '${req.params.id}'`);
            if (userResult.length > 0 && userResult[0].values.length > 0 && userResult[0].values[0][0] === 1) return res.status(403).json({ error: 'Нельзя удалить админа' });
            db.run(`DELETE FROM users WHERE id = ?`, [req.params.id]);
            saveDatabase();
            res.json({ message: 'Пользователь удалён' });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    // API товары
    app.get('/api/products', (req, res) => {
        try {
            const result = db.exec("SELECT * FROM products WHERE status = 'approved'");
            res.json(result.length > 0 ? result[0].values.map(row => ({ id: row[0], title: row[1], category: row[2], discipline: row[3], price: row[4], sellerId: row[5], sellerName: row[6], status: row[7], createdAt: row[8] })) : []);
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.get('/api/products/all', (req, res) => {
        try {
            const result = db.exec("SELECT * FROM products");
            res.json(result.length > 0 ? result[0].values.map(row => ({ id: row[0], title: row[1], category: row[2], discipline: row[3], price: row[4], sellerId: row[5], sellerName: row[6], status: row[7], createdAt: row[8] })) : []);
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.get('/api/users/:id/products', (req, res) => {
        try {
            const result = db.exec(`SELECT * FROM products WHERE sellerId = '${req.params.id}'`);
            res.json(result.length > 0 ? result[0].values.map(row => ({ id: row[0], title: row[1], category: row[2], discipline: row[3], price: row[4], sellerId: row[5], sellerName: row[6], status: row[7], createdAt: row[8] })) : []);
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.post('/api/products', (req, res) => {
        try {
            const { title, category, discipline, price, sellerId, sellerName } = req.body;
            db.run(`INSERT INTO products (title, category, discipline, price, sellerId, sellerName, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`, [title, category, discipline, price, sellerId, sellerName]);
            saveDatabase();
            const result = db.exec("SELECT last_insert_rowid()");
            res.status(201).json({ id: result[0].values[0][0], title, category, discipline, price, sellerId, sellerName, status: 'pending' });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.patch('/api/products/:id/approve', (req, res) => {
        try { db.run(`UPDATE products SET status = 'approved' WHERE id = ?`, [req.params.id]); saveDatabase(); res.json({ message: 'Товар одобрен' }); }
        catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.patch('/api/products/:id/reject', (req, res) => {
        try { db.run(`UPDATE products SET status = 'rejected' WHERE id = ?`, [req.params.id]); saveDatabase(); res.json({ message: 'Товар отклонён' }); }
        catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.delete('/api/products/:id', (req, res) => {
        try { db.run(`DELETE FROM products WHERE id = ?`, [req.params.id]); saveDatabase(); res.json({ message: 'Товар удалён' }); }
        catch (error) { res.status(500).json({ error: error.message }); }
    });

    // API покупки
    app.get('/api/users/:id/purchases', (req, res) => {
        try {
            const result = db.exec(`SELECT * FROM purchases WHERE buyerId = '${req.params.id}'`);
            res.json(result.length > 0 ? result[0].values.map(row => ({ id: row[0], productId: row[1], title: row[2], price: row[3], buyerId: row[4], sellerId: row[5], date: row[6], fileAttached: Boolean(row[7]) })) : []);
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.get('/api/users/:id/sales', (req, res) => {
        try {
            const result = db.exec(`SELECT * FROM purchases WHERE sellerId = '${req.params.id}'`);
            res.json(result.length > 0 ? result[0].values.map(row => ({ id: row[0], productId: row[1], title: row[2], price: row[3], buyerId: row[4], sellerId: row[5], date: row[6], fileAttached: Boolean(row[7]) })) : []);
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.post('/api/purchases', (req, res) => {
        try {
            const { productId, title, price, buyerId, sellerId } = req.body;
            db.run(`INSERT INTO purchases (productId, title, price, buyerId, sellerId) VALUES (?, ?, ?, ?, ?)`, [productId, title, price, buyerId, sellerId]);
            saveDatabase();
            const result = db.exec("SELECT last_insert_rowid()");
            res.status(201).json({ id: result[0].values[0][0], productId, title, price, buyerId, sellerId });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    // API файлы
    app.post('/api/purchases/:purchaseId/file', (req, res) => {
        try {
            const { purchaseId } = req.params;
            const { fileName, fileData } = req.body;
            if (!fileName || !fileData) return res.status(400).json({ error: 'Файл не загружен' });
            const purchaseCheck = db.exec(`SELECT * FROM purchases WHERE id = ${purchaseId}`);
            if (purchaseCheck.length === 0 || purchaseCheck[0].values.length === 0) return res.status(404).json({ error: 'Покупка не найдена' });
            db.run(`DELETE FROM work_files WHERE purchaseId = ?`, [purchaseId]);
            db.run(`INSERT INTO work_files (purchaseId, fileName, fileData) VALUES (?, ?, ?)`, [purchaseId, fileName, fileData]);
            db.run(`UPDATE purchases SET fileAttached = 1 WHERE id = ?`, [purchaseId]);
            saveDatabase();
            res.json({ message: 'Файл загружен' });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.get('/api/purchases/:purchaseId/file', (req, res) => {
        try {
            const result = db.exec(`SELECT * FROM work_files WHERE purchaseId = ${req.params.purchaseId}`);
            if (result.length === 0 || result[0].values.length === 0) return res.status(404).json({ error: 'Файл не найден' });
            const row = result[0].values[0];
            res.json({ fileName: row[2], fileData: row[3], uploadedAt: row[4] });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    // API отзывы
    app.get('/api/users/:sellerId/reviews', (req, res) => {
        try {
            const result = db.exec(`SELECT R.*, b.name as buyerName FROM reviews R JOIN users b ON R.buyerId = b.id WHERE R.sellerId = '${req.params.sellerId}' ORDER BY R.createdAt DESC`);
            res.json(result.length > 0 ? result[0].values.map(row => ({ id: row[0], purchaseId: row[1], buyerId: row[2], sellerId: row[3], rating: row[4], comment: row[5], createdAt: row[6], buyerName: row[7] })) : []);
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.post('/api/reviews', (req, res) => {
        try {
            const { purchaseId, buyerId, sellerId, rating, comment } = req.body;
            if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Рейтинг от 1 до 5' });
            const existing = db.exec(`SELECT * FROM reviews WHERE purchaseId = ${purchaseId}`);
            if (existing.length > 0 && existing[0].values.length > 0) return res.status(409).json({ error: 'Отзыв уже есть' });
            db.run(`INSERT INTO reviews (purchaseId, buyerId, sellerId, rating, comment) VALUES (?, ?, ?, ?, ?)`, [purchaseId, buyerId, sellerId, rating, comment || '']);
            const stats = db.exec(`SELECT AVG(rating) as avgRating, COUNT(*) as count FROM reviews WHERE sellerId = '${sellerId}'`);
            const avgRating = stats[0].values[0][0];
            const count = stats[0].values[0][1];
            db.run(`UPDATE users SET rating = ?, reviewCount = ? WHERE id = ?`, [avgRating, count, sellerId]);
            saveDatabase();
            res.status(201).json({ message: 'Отзыв добавлен' });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    // API индивидуальные запросы
    app.get('/api/custom-requests', (req, res) => {
        try {
            const result = db.exec("SELECT * FROM custom_requests WHERE status = 'approved'");
            res.json(result.length > 0 ? result[0].values.map(row => ({ id: row[0], title: row[1], description: row[2], budget: row[3], requesterId: row[4], requesterName: row[5], fileName: row[6], fileData: row[7], status: row[8], createdAt: row[9] })) : []);
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.get('/api/custom-requests/all', (req, res) => {
        try {
            const result = db.exec("SELECT * FROM custom_requests");
            res.json(result.length > 0 ? result[0].values.map(row => ({ id: row[0], title: row[1], description: row[2], budget: row[3], requesterId: row[4], requesterName: row[5], fileName: row[6], fileData: row[7], status: row[8], createdAt: row[9] })) : []);
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.post('/api/custom-requests', (req, res) => {
        try {
            const { title, description, budget, requesterId, requesterName, fileName, fileData } = req.body;
            db.run(`INSERT INTO custom_requests (title, description, budget, requesterId, requesterName, fileName, fileData, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`, [title, description || '', budget, requesterId, requesterName, fileName || null, fileData || null]);
            saveDatabase();
            const result = db.exec("SELECT last_insert_rowid()");
            res.status(201).json({ id: result[0].values[0][0], title, description, budget, requesterId, requesterName, fileName, status: 'pending' });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.patch('/api/custom-requests/:id/approve', (req, res) => {
        try { db.run(`UPDATE custom_requests SET status = 'approved' WHERE id = ?`, [req.params.id]); saveDatabase(); res.json({ message: 'Запрос одобрен' }); }
        catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.patch('/api/custom-requests/:id/reject', (req, res) => {
        try { db.run(`UPDATE custom_requests SET status = 'rejected' WHERE id = ?`, [req.params.id]); saveDatabase(); res.json({ message: 'Запрос отклонён' }); }
        catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.delete('/api/custom-requests/:id', (req, res) => {
        try { db.run(`DELETE FROM custom_requests WHERE id = ?`, [req.params.id]); saveDatabase(); res.json({ message: 'Запрос удалён' }); }
        catch (error) { res.status(500).json({ error: error.message }); }
    });

    initDatabase().then(() => {
        app.listen(PORT, () => {
            console.log(`Сервер запущен: http://localhost:${PORT}`);
            console.log(`API доступно: http://localhost:${PORT}/api`);
        });
    });
}
