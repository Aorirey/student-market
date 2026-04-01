const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

let pool;

// Инициализация базы данных PostgreSQL
async function initDatabase() {
    const databaseUrl = process.env.DATABASE_URL;
    
    if (!databaseUrl) {
        console.error('❌ DATABASE_URL не указан!');
        console.error('Создайте базу данных на https://supabase.com и добавьте DATABASE_URL в переменные окружения');
        process.exit(1);
    }

    pool = new Pool({
        connectionString: databaseUrl,
        ssl: {
            rejectUnauthorized: false
        },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000
    });

    try {
        // Создаём таблицу пользователей
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
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
            )
        `);
        console.log('✅ Таблица users создана');

        // Создаём таблицу товаров
        await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                category TEXT NOT NULL,
                discipline TEXT NOT NULL,
                price INTEGER NOT NULL,
                seller_id TEXT NOT NULL,
                seller_name TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (seller_id) REFERENCES users(id)
            )
        `);
        console.log('✅ Таблица products создана');

        // Создаём таблицу покупок
        await pool.query(`
            CREATE TABLE IF NOT EXISTS purchases (
                id SERIAL PRIMARY KEY,
                product_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                price INTEGER NOT NULL,
                buyer_id TEXT NOT NULL,
                seller_id TEXT NOT NULL,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                file_attached BOOLEAN DEFAULT false,
                FOREIGN KEY (product_id) REFERENCES products(id),
                FOREIGN KEY (buyer_id) REFERENCES users(id),
                FOREIGN KEY (seller_id) REFERENCES users(id)
            )
        `);
        console.log('✅ Таблица purchases создана');

        // Создаём таблицу файлов работ
        await pool.query(`
            CREATE TABLE IF NOT EXISTS work_files (
                id SERIAL PRIMARY KEY,
                purchase_id INTEGER NOT NULL,
                file_name TEXT NOT NULL,
                file_data TEXT NOT NULL,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (purchase_id) REFERENCES purchases(id)
            )
        `);
        console.log('✅ Таблица work_files создана');

        // Создаём таблицу отзывов
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reviews (
                id SERIAL PRIMARY KEY,
                purchase_id INTEGER NOT NULL,
                buyer_id TEXT NOT NULL,
                seller_id TEXT NOT NULL,
                rating INTEGER NOT NULL,
                comment TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (purchase_id) REFERENCES purchases(id),
                FOREIGN KEY (buyer_id) REFERENCES users(id),
                FOREIGN KEY (seller_id) REFERENCES users(id)
            )
        `);
        console.log('✅ Таблица reviews создана');

        // Создаём таблицу индивидуальных запросов
        await pool.query(`
            CREATE TABLE IF NOT EXISTS custom_requests (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                budget INTEGER NOT NULL,
                requester_id TEXT NOT NULL,
                requester_name TEXT NOT NULL,
                file_name TEXT,
                file_data TEXT,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (requester_id) REFERENCES users(id)
            )
        `);
        console.log('✅ Таблица custom_requests создана');

        // Создаём администратора по умолчанию
        const adminExists = await pool.query(
            "SELECT * FROM users WHERE email = 'admin@studentmarket.ru'"
        );
        if (adminExists.rows.length === 0) {
            await pool.query(`
                INSERT INTO users (id, name, email, password, balance, is_admin, is_blocked)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, ['admin', 'Администратор', 'admin@studentmarket.ru', 'admin123', 10000, true, false]);
            console.log('✅ Администратор создан');
        }

        console.log('\n🎉 База данных инициализирована!\n');
    } catch (error) {
        console.error('❌ Ошибка инициализации БД:', error.message);
        process.exit(1);
    }
}

// ==================== API ДЛЯ ПОЛЬЗОВАТЕЛЕЙ ====================

app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, name, email, balance, is_admin, is_blocked, created_at FROM users"
        );
        res.json(result.rows.map(row => ({
            id: row.id,
            name: row.name,
            email: row.email,
            balance: row.balance,
            isAdmin: row.is_admin,
            isBlocked: row.is_blocked,
            createdAt: row.created_at
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/users/:id', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, name, email, balance, is_admin, is_blocked, created_at FROM users WHERE id = $1",
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        const row = result.rows[0];
        res.json({
            id: row.id,
            name: row.name,
            email: row.email,
            balance: row.balance,
            isAdmin: row.is_admin,
            isBlocked: row.is_blocked,
            createdAt: row.created_at
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/users/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Заполните все поля' });
        }

        const existing = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Пользователь с таким email уже существует' });
        }

        const id = uuidv4();
        const result = await pool.query(`
            INSERT INTO users (id, name, email, password, balance, is_admin, is_blocked)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, name, email, balance, is_admin, is_blocked
        `, [id, name, email, password, 10000, false, false]);

        const row = result.rows[0];
        res.status(201).json({
            id: row.id,
            name: row.name,
            email: row.email,
            balance: row.balance,
            isAdmin: row.is_admin,
            isBlocked: row.is_blocked
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/users/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Заполните все поля' });
        }

        const result = await pool.query(
            "SELECT id, name, email, balance, is_admin, is_blocked FROM users WHERE email = $1 AND password = $2",
            [email, password]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }

        const row = result.rows[0];
        if (row.is_blocked) {
            return res.status(403).json({ error: 'Ваш аккаунт заблокирован' });
        }

        res.json({
            id: row.id,
            name: row.name,
            email: row.email,
            balance: row.balance,
            isAdmin: row.is_admin,
            isBlocked: row.is_blocked
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/users/:id/balance', async (req, res) => {
    try {
        const { balance } = req.body;
        const { id } = req.params;
        await pool.query("UPDATE users SET balance = $1 WHERE id = $2", [balance, id]);
        const result = await pool.query(
            "SELECT id, name, email, balance, is_admin, is_blocked FROM users WHERE id = $1",
            [id]
        );
        const row = result.rows[0];
        res.json({
            id: row.id,
            name: row.name,
            email: row.email,
            balance: row.balance,
            isAdmin: row.is_admin,
            isBlocked: row.is_blocked
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/users/:id/block', async (req, res) => {
    try {
        const { isBlocked } = req.body;
        const { id } = req.params;
        await pool.query("UPDATE users SET is_blocked = $1 WHERE id = $2", [isBlocked, id]);
        const result = await pool.query(
            "SELECT id, name, email, balance, is_admin, is_blocked FROM users WHERE id = $1",
            [id]
        );
        const row = result.rows[0];
        res.json({
            id: row.id,
            name: row.name,
            email: row.email,
            balance: row.balance,
            isAdmin: row.is_admin,
            isBlocked: row.is_blocked
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userResult = await pool.query("SELECT is_admin FROM users WHERE id = $1", [id]);
        if (userResult.rows.length > 0 && userResult.rows[0].is_admin) {
            return res.status(403).json({ error: 'Нельзя удалить администратора' });
        }
        await pool.query("DELETE FROM users WHERE id = $1", [id]);
        res.json({ message: 'Пользователь удалён' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== API ДЛЯ ТОВАРОВ ====================

app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM products WHERE status = 'approved'");
        res.json(result.rows.map(row => ({
            id: row.id,
            title: row.title,
            category: row.category,
            discipline: row.discipline,
            price: row.price,
            sellerId: row.seller_id,
            sellerName: row.seller_name,
            status: row.status,
            createdAt: row.created_at
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/products/all', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM products");
        res.json(result.rows.map(row => ({
            id: row.id,
            title: row.title,
            category: row.category,
            discipline: row.discipline,
            price: row.price,
            sellerId: row.seller_id,
            sellerName: row.seller_name,
            status: row.status,
            createdAt: row.created_at
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/users/:id/products', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM products WHERE seller_id = $1", [req.params.id]);
        res.json(result.rows.map(row => ({
            id: row.id,
            title: row.title,
            category: row.category,
            discipline: row.discipline,
            price: row.price,
            sellerId: row.seller_id,
            sellerName: row.seller_name,
            status: row.status,
            createdAt: row.created_at
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/products', async (req, res) => {
    try {
        const { title, category, discipline, price, sellerId, sellerName } = req.body;
        const result = await pool.query(`
            INSERT INTO products (title, category, discipline, price, seller_id, seller_name, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'pending')
            RETURNING id
        `, [title, category, discipline, price, sellerId, sellerName]);
        res.status(201).json({
            id: result.rows[0].id,
            title,
            category,
            discipline,
            price,
            sellerId,
            sellerName,
            status: 'pending'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/products/:id/approve', async (req, res) => {
    try {
        await pool.query("UPDATE products SET status = 'approved' WHERE id = $1", [req.params.id]);
        res.json({ message: 'Товар одобрен' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/products/:id/reject', async (req, res) => {
    try {
        await pool.query("UPDATE products SET status = 'rejected' WHERE id = $1", [req.params.id]);
        res.json({ message: 'Товар отклонён' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/products/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);
        res.json({ message: 'Товар удалён' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== API ДЛЯ ПОКУПОК ====================

app.get('/api/users/:id/purchases', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM purchases WHERE buyer_id = $1", [req.params.id]);
        res.json(result.rows.map(row => ({
            id: row.id,
            productId: row.product_id,
            title: row.title,
            price: row.price,
            buyerId: row.buyer_id,
            sellerId: row.seller_id,
            date: row.date,
            fileAttached: row.file_attached
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/users/:id/sales', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM purchases WHERE seller_id = $1", [req.params.id]);
        res.json(result.rows.map(row => ({
            id: row.id,
            productId: row.product_id,
            title: row.title,
            price: row.price,
            buyerId: row.buyer_id,
            sellerId: row.seller_id,
            date: row.date,
            fileAttached: row.file_attached
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/purchases', async (req, res) => {
    try {
        const { productId, title, price, buyerId, sellerId } = req.body;
        const result = await pool.query(`
            INSERT INTO purchases (product_id, title, price, buyer_id, seller_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        `, [productId, title, price, buyerId, sellerId]);
        res.status(201).json({
            id: result.rows[0].id,
            productId,
            title,
            price,
            buyerId,
            sellerId
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== API ДЛЯ ФАЙЛОВ ====================

app.post('/api/purchases/:purchaseId/file', async (req, res) => {
    try {
        const { purchaseId } = req.params;
        const { fileName, fileData } = req.body;

        if (!fileName || !fileData) {
            return res.status(400).json({ error: 'Файл не загружен' });
        }

        const purchaseCheck = await pool.query("SELECT * FROM purchases WHERE id = $1", [purchaseId]);
        if (purchaseCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Покупка не найдена' });
        }

        await pool.query("DELETE FROM work_files WHERE purchase_id = $1", [purchaseId]);
        await pool.query(`
            INSERT INTO work_files (purchase_id, file_name, file_data)
            VALUES ($1, $2, $3)
        `, [purchaseId, fileName, fileData]);
        await pool.query("UPDATE purchases SET file_attached = true WHERE id = $1", [purchaseId]);

        res.json({ message: 'Файл загружен' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/purchases/:purchaseId/file', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM work_files WHERE purchase_id = $1", [req.params.purchaseId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Файл не найден' });
        }
        const row = result.rows[0];
        res.json({
            fileName: row.file_name,
            fileData: row.file_data,
            uploadedAt: row.uploaded_at
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== API ДЛЯ ОТЗЫВОВ ====================

app.get('/api/users/:sellerId/reviews', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT r.*, b.name as buyer_name
            FROM reviews r
            JOIN users b ON r.buyer_id = b.id
            WHERE r.seller_id = $1
            ORDER BY r.created_at DESC
        `, [req.params.sellerId]);
        res.json(result.rows.map(row => ({
            id: row.id,
            purchaseId: row.purchase_id,
            buyerId: row.buyer_id,
            sellerId: row.seller_id,
            rating: row.rating,
            comment: row.comment,
            createdAt: row.created_at,
            buyerName: row.buyer_name
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/reviews', async (req, res) => {
    try {
        const { purchaseId, buyerId, sellerId, rating, comment } = req.body;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Рейтинг должен быть от 1 до 5' });
        }

        const existing = await pool.query("SELECT * FROM reviews WHERE purchase_id = $1", [purchaseId]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Отзыв уже оставлен' });
        }

        await pool.query(`
            INSERT INTO reviews (purchase_id, buyer_id, seller_id, rating, comment)
            VALUES ($1, $2, $3, $4, $5)
        `, [purchaseId, buyerId, sellerId, rating, comment || '']);

        const stats = await pool.query(
            "SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM reviews WHERE seller_id = $1",
            [sellerId]
        );
        const avgRating = stats.rows[0].avg_rating || 0;
        const count = stats.rows[0].count || 0;

        await pool.query("UPDATE users SET rating = $1, review_count = $2 WHERE id = $3", [avgRating, count, sellerId]);

        res.status(201).json({ message: 'Отзыв добавлен' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== API ДЛЯ ИНДИВИДУАЛЬНЫХ ЗАПРОСОВ ====================

app.get('/api/custom-requests', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM custom_requests WHERE status = 'approved'");
        res.json(result.rows.map(row => ({
            id: row.id,
            title: row.title,
            description: row.description,
            budget: row.budget,
            requesterId: row.requester_id,
            requesterName: row.requester_name,
            fileName: row.file_name,
            fileData: row.file_data,
            status: row.status,
            createdAt: row.created_at
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/custom-requests/all', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM custom_requests");
        res.json(result.rows.map(row => ({
            id: row.id,
            title: row.title,
            description: row.description,
            budget: row.budget,
            requesterId: row.requester_id,
            requesterName: row.requester_name,
            fileName: row.file_name,
            fileData: row.file_data,
            status: row.status,
            createdAt: row.created_at
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/custom-requests', async (req, res) => {
    try {
        const { title, description, budget, requesterId, requesterName, fileName, fileData } = req.body;
        const result = await pool.query(`
            INSERT INTO custom_requests (title, description, budget, requester_id, requester_name, file_name, file_data, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
            RETURNING id
        `, [title, description || '', budget, requesterId, requesterName, fileName || null, fileData || null]);
        res.status(201).json({
            id: result.rows[0].id,
            title,
            description,
            budget,
            requesterId,
            requesterName,
            fileName,
            status: 'pending'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/custom-requests/:id/approve', async (req, res) => {
    try {
        await pool.query("UPDATE custom_requests SET status = 'approved' WHERE id = $1", [req.params.id]);
        res.json({ message: 'Запрос одобрен' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/custom-requests/:id/reject', async (req, res) => {
    try {
        await pool.query("UPDATE custom_requests SET status = 'rejected' WHERE id = $1", [req.params.id]);
        res.json({ message: 'Запрос отклонён' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/custom-requests/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM custom_requests WHERE id = $1", [req.params.id]);
        res.json({ message: 'Запрос удалён' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Запуск сервера
initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
        console.log(`📡 API доступно: http://localhost:${PORT}/api`);
    });
});
