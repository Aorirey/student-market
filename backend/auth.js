const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./config');

/** (userId) => Promise|sync { isAdmin, isModerator } | null — подставляет актуальные роли из БД поверх JWT */
let loadUserStaffFlags = null;

function setUserStaffFlagsLoader(fn) {
    loadUserStaffFlags = typeof fn === 'function' ? fn : null;
}

function applyJwtRoleBooleans(user) {
    user.isAdmin = Boolean(user.isAdmin);
    user.isModerator = Boolean(user.isModerator);
    return user;
}

/** Администратор или модератор (обход проверок владельца в API панели) */
function isStaffUser(req) {
    return !!(req.user && (req.user.isAdmin || req.user.isModerator));
}

/**
 * Middleware для проверки JWT токена
 * Извлекает токен из заголовка Authorization: Bearer <token>
 * Добавляет req.user с данными пользователя
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Требуется аутентификация' });
    }

    try {
        const user = applyJwtRoleBooleans(jwt.verify(token, JWT_SECRET));

        if (!loadUserStaffFlags || !user.id) {
            req.user = user;
            return next();
        }

        Promise.resolve(loadUserStaffFlags(user.id))
            .then((flags) => {
                if (flags && typeof flags === 'object') {
                    if ('isAdmin' in flags) user.isAdmin = Boolean(flags.isAdmin);
                    if ('isModerator' in flags) user.isModerator = Boolean(flags.isModerator);
                }
                req.user = user;
                next();
            })
            .catch((err) => {
                console.error('[AUTH] Ошибка загрузки ролей:', err.message);
                req.user = user;
                next();
            });
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Токен истёк' });
        }
        return res.status(403).json({ error: 'Неверный токен' });
    }
}

/** Токен не обязателен: при отсутствии или невалидном токене req.user = null */
function optionalAuthenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    req.user = null;
    if (!token) {
        return next();
    }
    try {
        const user = applyJwtRoleBooleans(jwt.verify(token, JWT_SECRET));

        if (!loadUserStaffFlags || !user.id) {
            req.user = user;
            return next();
        }

        Promise.resolve(loadUserStaffFlags(user.id))
            .then((flags) => {
                if (flags && typeof flags === 'object') {
                    if ('isAdmin' in flags) user.isAdmin = Boolean(flags.isAdmin);
                    if ('isModerator' in flags) user.isModerator = Boolean(flags.isModerator);
                }
                req.user = user;
                next();
            })
            .catch(() => {
                req.user = user;
                next();
            });
    } catch {
        req.user = null;
        next();
    }
}

/**
 * Middleware для проверки прав администратора
 * Должен использоваться ПОСЛЕ authenticateToken
 */
function requireAdmin(req, res, next) {
    if (!req.user || !req.user.isAdmin) {
        console.log(`[AUTH] Попытка доступа к админ-функции: ${req.user?.id || 'unknown'}`);
        return res.status(403).json({ error: 'Доступ запрещён: требуются права администратора' });
    }
    next();
}

/** Администратор или модератор (переписки, техподдержка, блокировка обычных пользователей) */
function requireStaff(req, res, next) {
    if (!req.user || (!req.user.isAdmin && !req.user.isModerator)) {
        return res.status(403).json({ error: 'Доступ запрещён: требуются права модератора или администратора' });
    }
    next();
}

/**
 * Middleware для проверки авторства ресурса
 * Проверяет, что пользователь является владельцем ресурса
 * @param {string} idField - имя поля в req.params с ID ресурса
 * @param {function} getResourceOwner - функция, возвращающая ID владельца ресурса
 */
function requireOwnership(idField, getResourceOwner) {
    return (req, res, next) => {
        const resourceId = req.params[idField];
        const ownerId = getResourceOwner(resourceId);
        
        if (!ownerId) {
            return res.status(404).json({ error: 'Ресурс не найден' });
        }
        
        if (req.user.id !== ownerId && !isStaffUser(req)) {
            console.log(`[AUTH] Попытка доступа к чужому ресурсу: пользователь ${req.user.id}, ресурс ${resourceId}, владелец ${ownerId}`);
            return res.status(403).json({ error: 'Доступ запрещён: вы не владелец этого ресурса' });
        }
        
        next();
    };
}

/**
 * Middleware для проверки участия в покупке (buyer или seller)
 * @param {object} db - объект базы данных
 */
function requirePurchaseParticipant(db) {
    return (req, res, next) => {
        const purchaseId = req.params.purchaseId || req.body.purchaseId;
        
        if (!purchaseId) {
            return res.status(400).json({ error: 'Требуется ID покупки' });
        }
        
        try {
            const result = db.exec("SELECT buyerId, sellerId FROM purchases WHERE id = ?", [purchaseId]);
            
            if (!result.length || !result[0].values.length) {
                return res.status(404).json({ error: 'Покупка не найдена' });
            }
            
            const [buyerId, sellerId] = result[0].values[0];
            
            if (req.user.id !== buyerId && req.user.id !== sellerId && !isStaffUser(req)) {
                console.log(`[AUTH] Попытка доступа к чужой покупке: пользователь ${req.user.id}, покупка ${purchaseId}`);
                return res.status(403).json({ error: 'Доступ запрещён: вы не участник этой покупки' });
            }
            
            next();
        } catch (error) {
            console.error('[AUTH] Ошибка проверки участия в покупке:', error.message);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
    };
}

module.exports = {
    authenticateToken,
    optionalAuthenticateToken,
    requireAdmin,
    requireStaff,
    requireOwnership,
    requirePurchaseParticipant,
    setUserStaffFlagsLoader,
    isStaffUser
};
