// Конфигурация JWT
const crypto = require('crypto');

// Секретный ключ для JWT (генерируется один раз при первом запуске)
let JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    // Если нет в переменных окружения, генерируем и сохраняем в файл
    const fs = require('fs');
    const path = require('path');
    const secretPath = path.join(__dirname, '.jwt_secret');
    
    if (fs.existsSync(secretPath)) {
        JWT_SECRET = fs.readFileSync(secretPath, 'utf8').trim();
    } else {
        JWT_SECRET = crypto.randomBytes(64).toString('hex');
        fs.writeFileSync(secretPath, JWT_SECRET);
        console.log('[JWT] Сгенерирован новый секретный ключ');
    }
}

// Время жизни токена
const JWT_EXPIRES_IN = '24h';
const JWT_REFRESH_EXPIRES_IN = '7d';

module.exports = {
    JWT_SECRET,
    JWT_EXPIRES_IN,
    JWT_REFRESH_EXPIRES_IN
};
