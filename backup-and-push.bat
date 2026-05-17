@echo off
chcp 65001 >nul
echo ==========================================
echo 开始备份数据库...
echo ==========================================

cd /d "%~dp0backupAndRestore"

rem 运行备份脚本
echo 正在运行备份脚本...
node backup.js

if %errorlevel% neq 0 (
    echo 备份失败！
    pause
    exit /b 1
)

echo.
echo ==========================================
echo 备份完成，正在复制到 DbBak 并提交...
echo ==========================================

rem 获取最新备份文件夹名称
for /f "delims=" %%i in ('dir /b /ad /o-d backup_*') do (
    set LATEST_BACKUP=%%i
    goto :found
)
:found

echo 最新备份: %LATEST_BACKUP%

rem 复制备份到 DbBak 目录
xcopy /E /I /Y "backup\%LATEST_BACKUP%" "..\DbBak\%LATEST_BACKUP%"

cd /d "%~dp0DbBak"

git add .
git commit -m "backup: %LATEST_BACKUP%"
git push -u origin main

if %errorlevel% neq 0 (
    echo Git 推送失败，请手动重试
    pause
    exit /b 1
)

echo.
echo ==========================================
echo 备份并提交完成！
echo ==========================================
pause
