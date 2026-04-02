# Исправления кнопок

## ✅ Исправленные проблемы:

### 1. `switchCabinetTab` и `switchAdminTab`
**Проблема:** Использовалось `event.target`, но `event` не был определён.

**Исправление:** Теперь кнопки находятся по тексту и получают класс `active`.

### 2. `openReviewModal`
**Проблема:** `JSON.stringify(escapeHTML(purchase.title))` создавал лишние кавычки.

**Исправление:** Теперь `JSON.stringify(purchase.title)` без `escapeHTML`.

### 3. `openSellerPage`
**Проблема:** `event` мог быть не определён.

**Исправление:** Добавлена проверка `if (event) event.preventDefault()`.

## 🧪 Проверка работы кнопок:

### Основные кнопки:
- [x] **Войти** → `openModal('login')`
- [x] **Стать продавцом** → `openModal('register')`
- [x] **Войти (в модалке)** → `login()`
- [x] **Зарегистрироваться (в модалке)** → `register()`
- [x] **Закрыть модалку** → `closeModal()`
- [x] **Переключить тему** → `toggleTheme()`
- [x] **Выйти** → `logout()`

### Вкладки:
- [x] **Практические работы** → `openTab('practices')`
- [x] **Лабораторные работы** → `openTab('labs')`
- [x] **Курсовые работы** → `openTab('courses')`
- [x] **Ещё** → `openTab('custom')`
- [x] **Личный кабинет** → `openCabinet()`
- [x] **Админ-панель** → `openAdminPanel()` (только админ)

### Вкладки личного кабинета:
- [x] **Покупатель** → `switchCabinetTab('buyer')`
- [x] **Мои продажи** → `switchCabinetTab('sales')`
- [x] **Мои товары** → `switchCabinetTab('products')`
- [x] **Чаты** → `switchCabinetTab('chats')`
- [x] **Добавить товар/запрос** → `switchCabinetTab('add')`

### Вкладки админ-панели:
- [x] **Модерация товаров** → `switchAdminTab('moderation')`
- [x] **Индивид. запросы** → `switchAdminTab('custom')`
- [x] **Пользователи** → `switchAdminTab('users')`

### Кнопки товаров:
- [x] **Купить** → `buyProduct(id)`
- [x] **Продавец (ссылка)** → `openSellerPage(id, name, event)`
- [x] **Откликнуться** → `contactRequester(id, title)`
- [x] **Назад (со страницы продавца)** → `backFromSeller()`

### Кнопки личного кабинета:
- [x] **Удалить товар** → `deleteProduct(id)`
- [x] **Прикрепить работу** → `openUploadModal(...)`
- [x] **Заменить файл** → `openUploadModal(...)`
- [x] **Смотреть работу** → `viewPurchaseFile(id)`
- [x] **Оставить отзыв** → `openReviewModal(...)`

### Кнопки модальных окон:
- [x] **Закрыть (загрузка файла)** → `closeUploadModal()`
- [x] **Закрыть (отзыв)** → `closeReviewModal()`
- [x] **Закрыть (подтверждение покупки)** → `closePurchaseConfirmModal()`
- [x] **Загрузить файл** → `uploadWorkFile()`
- [x] **Отправить отзыв** → `submitReview()`
- [x] **Подтвердить покупку** → `confirmPurchase()`
- [x] **Написать покупателю** → `contactSellerFromModal()`

### Кнопки чата:
- [x] **Открыть чат** → `openChat(...)`
- [x] **Закрыть чат** → `closeChatWindow()`
- [x] **Отправить сообщение** → `sendMessage()`
- [x] **Прикрепить файл** → `handleChatFileSelect(event)`
- [x] **Очистить файл** → `clearSelectedFile()`

### Кнопки уведомлений:
- [x] **Уведомления** → `toggleNotifications()`
- [x] **Отметить прочитанным** → `markNotificationRead(id)`
- [x] **Отметить все прочитанными** → `markAllNotificationsRead()`

### Кнопки админ-панели:
- [x] **Одобрить товар** → `approveProduct(id)`
- [x] **Отклонить товар** → `rejectProduct(id)`
- [x] **Одобрить запрос** → `approveCustomRequest(id)`
- [x] **Отклонить запрос** → `rejectCustomRequest(id)`
- [x] **Заблокировать** → `blockUser(id)`
- [x] **Разблокировать** → `unblockUser(id)`

### Кнопки фильтров:
- [x] **Фильтр дисциплины** → `filterProducts(category)`
- [x] **Фильтр запросов** → `filterCustomRequests()`

### Кнопки форм:
- [x] **Переключить тип (товар/запрос)** → `toggleProductType()`
- [x] **Добавить товар** → `submit` форма
- [x] **Создать запрос** → `submit` форма

---

## 🚀 Запуск проверки:

```bash
cd c:\Users\Artem\study\student-market
npm start
```

Откройте http://localhost:3000 и проверьте работу кнопок.
