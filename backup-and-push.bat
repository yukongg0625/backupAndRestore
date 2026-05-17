@echo off
chcp 65001 >nul
echo ==========================================
echo Starting database backup...
echo ==========================================

cd /d "%~dp0backupAndRestore"

echo Running backup script...
node backup.js

if %errorlevel% neq 0 (
    echo Backup failed!
    pause
    exit /b 1
)

echo.
echo ==========================================
echo Backup done, copying to DbBak and committing...
echo ==========================================

for /f "delims=" %%i in ('dir /b /ad /o-d backup_*') do (
    set LATEST_BACKUP=%%i
    goto :found
)
:found

echo Latest backup: %LATEST_BACKUP%

xcopy /E /I /Y "backup\%LATEST_BACKUP%" "..\DbBak\%LATEST_BACKUP%"

cd /d "%~dp0DbBak"

git add .
git commit -m "backup: %LATEST_BACKUP%"
git push -u origin main

if %errorlevel% neq 0 (
    echo Git push failed, please retry manually
    pause
    exit /b 1
)

echo.
echo ==========================================
echo Backup and push completed!
echo ==========================================
pause
