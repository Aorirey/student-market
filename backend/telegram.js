/**
 * Telegram Bot для отправки уведомлений пользователям маркетплейса
 * Поддерживает SQLite (db.exec) и PostgreSQL (pool.query)
 */

const https = require('https');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = 'api.telegram.org';

let chatIdCache = new Map();

/**
 * Универсальный исполнитель SQL запросов
 * @param {object} db - объект БД (SQLite Database или PG Pool)
 * @param {string} sql - SQL запрос
 * @param {array} params - параметры
 * @returns {Promise<{values: array}>} - результат в формате { values: [[row1], [row2]] }
 */
async function execDb(db, sql, params = []) {
    try {
        if (db.query) {
            // PostgreSQL
            const res = await db.query(sql, params);
            // Преобразуем { rows: [{col: val}] } в { values: [[val]] }
            const values = res.rows.map(row => Object.values(row));
            return { values };
        } else {
            // SQLite
            const result = db.exec(sql, params);
            return result.length > 0 ? result[0] : { values: [] };
        }
    } catch (error) {
        console.error('[TELEGRAM] DB Error:', error.message);
        return { values: [] };
    }
}

/**
 * Создать таблицу telegram_subscriptions
 */
async function initTelegramTable(db) {
    try {
        const sql = `CREATE TABLE IF NOT EXISTS telegram_subscriptions (
            userId TEXT NOT NULL,
            chatId TEXT NOT NULL UNIQUE,
            createdAt TEXT DEFAULT CURRENT_TIMESTAMP
        )`;
        if (db.query) {
            await db.query(sql);
        } else {
            db.run(sql);
        }
    } catch (error) {
        console.error('[TELEGRAM] Ошибка создания таблицы:', error.message);
    }
}

/**
 * Загрузить все chatId из БД в кэш при старте
 */
async function loadChatIdCache(db) {
    try {
        const result = await execDb(db, "SELECT userId, chatId FROM telegram_subscriptions");
        result.values.forEach(row => {
            chatIdCache.set(row[0], row[1]);
        });
        console.log(`[TELEGRAM] Загружено ${chatIdCache.size} подписок`);
    } catch (error) {
        console.log('[TELEGRAM] Таблица telegram_subscriptions ещё пуста или не создана');
    }
}

/**
 * Отправить HTTP-запрос к Telegram Bot API
 */
function telegramRequest(method, body) {
    return new Promise((resolve, reject) => {
        if (!TELEGRAM_BOT_TOKEN) {
            return resolve({ ok: false, description: 'Telegram bot token not configured' });
        }

        const postData = JSON.stringify(body);
        const options = {
            hostname: TELEGRAM_API,
            path: `/bot${TELEGRAM_BOT_TOKEN}/${method}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    reject(new Error(`Invalid JSON response: ${data}`));
                }
            });
        });

        req.on('error', (error) => {
            console.error('[TELEGRAM] Network error:', error.message);
            resolve({ ok: false, description: error.message });
        });

        req.setTimeout(10000, () => {
            req.destroy();
            resolve({ ok: false, description: 'Request timeout' });
        });

        req.write(postData);
        req.end();
    });
}

/**
 * Отправить сообщение конкретному пользователю по chatId
 */
async function sendTelegramMessage(chatId, text, parseMode = 'HTML') {
    const result = await telegramRequest('sendMessage', {
        chat_id: chatId,
        text: text,
        parse_mode: parseMode,
        disable_web_page_preview: true
    });

    if (!result.ok) {
        console.error(`[TELEGRAM] Ошибка отправки сообщения в ${chatId}:`, result.description);
    }

    return result;
}

/**
 * Отправить уведомление пользователю по userId (находит chatId автоматически)
 */
async function notifyUser(userId, title, message, db) {
    try {
        // Находим chatId пользователя
        let chatId = chatIdCache.get(userId);

        if (!chatId && db) {
            const result = await execDb(db, "SELECT chatId FROM telegram_subscriptions WHERE userId = $1", [userId]);
            // Для SQLite параметры не используются в exec, но execDb обрабатывает это
            // Если это SQLite, запрос выше может не сработать с $1, нужно ?
            // execDb не меняет SQL. Нужно исправить вызов.
        }
        
        // Повторная попытка с правильным синтаксисом
        if (!chatId && db) {
            const sql = db.query ? "SELECT chatId FROM telegram_subscriptions WHERE userId = $1" : "SELECT chatId FROM telegram_subscriptions WHERE userId = ?";
            const result = await execDb(db, sql, [userId]);
            
            if (result.values.length > 0 && result.values[0].length > 0) {
                chatId = result.values[0][0];
                chatIdCache.set(userId, chatId);
            }
        }

        if (!chatId) {
            // console.log(`[TELEGRAM] Пользователь ${userId} не подписан на уведомления`);
            return false;
        }

        const text = `📌 <b>${title}</b>\n\n${message}`;
        return await sendTelegramMessage(chatId, text);
    } catch (error) {
        console.error('[TELEGRAM] Ошибка уведомления:', error.message);
        return false;
    }
}

// ... (остальной код без изменений)

/**
 * Форматировать уведомление о покупке для продавца
 */
function formatPurchaseNotification(productTitle, buyerName, price) {
    return {
        title: '💰 Новая покупка',
        message: `Товар "${productTitle}" куплен пользователем ${buyerName}\nСумма: ${price} баллов`
    };
}

/**
 * Форматировать уведомление о модерации
 */
function formatModerationNotification(productTitle, approved) {
    return {
        title: approved ? '✅ Товар одобрен' : '❌ Товар отклонён',
        message: `Ваш товар "${productTitle}" ${approved ? 'прошёл модерацию и доступен для покупки' : 'не прошёл модерацию. Отредактируйте и отправьте повторно'}`
    };
}

/**
 * Форматировать уведомление об отзыве
 */
function formatReviewNotification(sellerName, rating, comment) {
    const stars = '⭐'.repeat(rating);
    return {
        title: '📝 Новый отзыв',
        message: `Продавец ${sellerName} получил отзыв: ${stars}\n${comment || 'Без комментария'}`
    };
}

module.exports = {
    initTelegramTable,
    loadChatIdCache,
    sendTelegramMessage,
    notifyUser,
    formatPurchaseNotification,
    formatModerationNotification,
    formatReviewNotification
};
