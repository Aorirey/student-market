#!/usr/bin/env node
/**
 * Генерация безопасных ключей для .env файла
 * Запуск: node scripts/generate-keys.js
 */
const crypto = require('crypto');

const jwtSecret = crypto.randomBytes(64).toString('hex');
const sessionSecret = crypto.randomBytes(32).toString('hex');

console.log('Скопируйте эти значения в ваш .env файл:\n');
console.log(`JWT_SECRET=${jwtSecret}`);
console.log(`SESSION_SECRET=${sessionSecret}`);
console.log('\n⚠️  Никогда не коммитьте .env файл в репозиторий!');
