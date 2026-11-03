@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js before running the application.
  exit /b 1
)
node desktop\launcher.mjs
endlocal
