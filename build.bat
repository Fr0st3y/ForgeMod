@echo off
cd /d "%~dp0"
where npm >nul 2>nul || (echo Node.js fehlt - bitte von https://nodejs.org installieren & pause & exit /b 1)
if not exist node_modules call npm install
call npm run dist
echo.
echo Fertig: Programmordner dist\ForgeMod, Update-Datei ForgeMod-x.y.z.update und ZIP liegen im Ordner dist.
explorer dist
pause
