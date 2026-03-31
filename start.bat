@echo off
:: Ensure we are in the correct directory
cd /d "%~dp0"
:: Use UTF-8 for messages
chcp 65001 > nul

SETLOCAL EnableDelayedExpansion

echo ==========================================
echo   Qwen3 语音合成工作室 - 本地运行环境
echo ==========================================

:: 1. 检查 Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js (https://nodejs.org/)
    pause
    exit /b 1
)

:: 2. 初始化环境文件
if not exist .env.local (
    echo [状态] 正在创建 .env.local 文件...
    copy .env.example .env.local
    echo [提示] 请在 .env.local 中填入你的 GEMINI_API_KEY
)

:: 3. 安装依赖
if not exist node_modules (
    echo [状态] 正在安装项目依赖，请稍候...
    call npm install
)

:: 4. 启动项目
echo [状态] 正在启动开发服务器...
call npm run dev

pause
