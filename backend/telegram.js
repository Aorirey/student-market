/**
 * Telegram Bot для отправки уведомлений пользователям маркетплейса
 * 
 * Настройка:
 * 1. Создать бота через @BotFather в Telegram
 * 2. Получить BOT_TOKEN
 * 3. Пользователи должны написать /start боту и отправить свой userId
 * 4. Сервер сохранит chatId и будет отправлять уведомления
 * 
 * Работает через HTTPS к api.telegram.org — не блокируется в РФ для ботов
 */

const https = require('https');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = 'api.telegram.org';

// Хранилище соответствия userId <-> chatId (в продакшене использовать БД)
// Таблица: telegram_subscriptions (userId TEXT, chatId TEXT, createdAt TEXT)
let chatIdCache = new Map();

/**
 * Загрузить все chatId из БД в кэш при старте
 */
function loadChatIdCache(db) {
    try {
        if (!db) return;
        const result = db.exec("SELECT userId, chatId FROM telegram_subscriptions");
        if (result.length > 0) {
            result[0].values.forEach(row => {
                chatIdCache.set(row[0], row[1]);
            });
        }
        console.log(`[TELEGRAM] Загружено ${chatIdCache.size} подписок`);
    } catch (error) {
        // Таблица может не существовать — это нормально
        console.log('[TELEGRAM] Таблица telegram_subscriptions ещё не создана');
    }
}

/**
 * Создать таблицу telegram_subscriptions
 */
function initTelegramTable(db) {
    try {
        db.run(`CREATE TABLE IF NOT EXISTS telegram_subscriptions (
            userId TEXT NOT NULL,
            chatId TEXT NOT NULL UNIQUE,
            createdAt TEXT DEFAULT CURRENT_TIMESTAMP
        )`);
    } catch (error) {
        console.error('[TELEGRAM] Ошибка создания таблицы:', error.message);
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
            const result = db.exec("SELECT chatId FROM telegram_subscriptions WHERE userId = ?", [userId]);
            if (result.length > 0 && result[0].values.length > 0) {
                chatId = result[0].values[0][0];
                chatIdCache.set(userId, chatId);
            }
        }

        if (!chatId) {
            console.log(`[TELEGRAM] Пользователь ${userId} не подписан на уведомления`);
            return false;
        }

        const text = `📌 <b>${title}</b>\n\n${message}`;
        return await sendTelegramMessage(chatId, text);
    } catch (error) {
        console.error('[TELEGRAM] Ошибка уведомления:', error.message);
        return false;
    }
}

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
