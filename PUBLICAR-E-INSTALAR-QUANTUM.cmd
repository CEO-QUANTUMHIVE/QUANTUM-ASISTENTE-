@echo off
setlocal
title Publicar e instalar Quantum Assistant

set "GH_DIR=C:\Users\sergio\Documents\Codex\.github-cli"
set "REPO=C:\Users\sergio\Documents\Codex\2026-08-03\invitaci-n-plan-plus-chatgpt-conversation\quantum-assistant"
set "INSTALADOR=%REPO%\apps\desktop\release\Quantum-Assistant-Setup-0.1.0.exe"

echo [1/4] Guardando la conexion permanente de GitHub...
if not exist "%GH_DIR%" mkdir "%GH_DIR%"
setx GH_CONFIG_DIR "%GH_DIR%" >nul
if errorlevel 1 goto error
set "GH_CONFIG_DIR=%GH_DIR%"

gh auth status >nul 2>&1
if errorlevel 1 (
  echo Se abrira GitHub para autorizar esta computadora.
  gh auth login --hostname github.com --git-protocol https --web
  if errorlevel 1 goto error
)
gh auth setup-git
if errorlevel 1 goto error

echo [2/4] Verificando el codigo...
cd /d "%REPO%"
for /f "delims=" %%A in ('git status --porcelain') do (
  echo El repositorio tiene cambios sin guardar: %%A
  goto error
)

echo [3/4] Publicando la version estable y la rama del navegador...
git push -u origin agent/preparar-quantum-assistant
if errorlevel 1 goto error
git push -u origin agent/navegador-integrado
if errorlevel 1 goto error

echo [4/4] Abriendo el instalador nuevo...
if not exist "%INSTALADOR%" (
  echo No se encontro el instalador: %INSTALADOR%
  goto error
)
start "" "%INSTALADOR%"

echo.
echo ========================================================
echo GitHub publicado y navegador integrado listo para instalar.
echo Completa el instalador y luego volve a Codex.
echo ========================================================
pause
exit /b 0

:error
echo.
echo No se pudo completar la publicacion o instalacion.
echo Deja esta ventana abierta y avisa a Codex.
pause
exit /b 1
