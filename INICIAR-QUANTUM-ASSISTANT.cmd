@echo off
setlocal
cd /d "%~dp0"
where corepack.cmd >nul 2>&1
if errorlevel 1 (
  echo No encontre Corepack. Reinstala Node.js con Corepack incluido.
  pause
  exit /b 1
)
call corepack.cmd pnpm --filter @quantumhive/assistant-desktop dev > "%~dp0iniciar-quantum.log" 2>&1
