-- Добавление полей university и teacher в таблицу products
ALTER TABLE products ADD COLUMN IF NOT EXISTS university TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS teacher TEXT DEFAULT '';
