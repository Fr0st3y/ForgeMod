@echo off
cd /d "%~dp0"
where npm >nul 2>nul || (echo Node.js fehlt - bitte von https://nodejs.org installieren & pause & exit /b 1)
if not exist node_modules call npm install
call npm start
