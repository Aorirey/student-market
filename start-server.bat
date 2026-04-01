@echo off
chcp 65001 >nul
echo ====================================
echo   StudentMarket Server
echo ====================================
echo.

cd /d "%~dp0"

echo Проверка Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ОШИБКА: Node.js не найден!
    echo Установите Node.js с https://nodejs.org/
    pause
    exit /b 1
)

echo Запуск сервера...
echo.
echo Сервер доступен: http://localhost:3000
echo API: http://localhost:3000/api
echo.
echo Для остановки нажмите Ctrl+C
echo ====================================
echo.

"C:\Program Files\nodejs\node.exe" server.js

pause
