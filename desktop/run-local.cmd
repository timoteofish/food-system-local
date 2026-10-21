@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao foi encontrado. Instale Node.js antes de executar a aplicacao.
  exit /b 1
)
node desktop\launcher.mjs
endlocal
