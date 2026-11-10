@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
set "GENESIS_NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%GENESIS_NODE_EXE%" goto runtime_ready
set "GENESIS_NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if exist "%GENESIS_NODE_EXE%" goto runtime_ready
set "GENESIS_NODE_EXE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined GENESIS_NODE_EXE set "GENESIS_NODE_EXE=%%N"
if defined GENESIS_NODE_EXE goto runtime_ready
echo No se encontro Node.js. Instala Node.js 22 o superior y vuelve a ejecutar este archivo.
exit /b 1
:runtime_ready
for %%N in ("%GENESIS_NODE_EXE%") do set "PATH=%%~dpN;%PATH%"
if /i "%~1"=="build" goto build
if /i "%~1"=="login" goto login
if /i "%~1"=="account" goto account
if /i "%~1"=="status" goto status
if /i "%~1"=="push" goto push
if /i "%~1"=="check" goto check
if /i "%~1"=="version" goto version
if /i "%~1"=="prepare-data" goto prepare_data
if /i "%~1"=="test" goto test
if not "%~1"=="" echo Comando no reconocido.
echo Uso: genesis.cmd build ^| login ^| account ^| status ^| push ^| check ^| version ^| prepare-data ^| test
exit /b 2
:build
"%GENESIS_NODE_EXE%" tools/build.mjs
exit /b %errorlevel%
:login
"%GENESIS_NODE_EXE%" tools/clasp.mjs login
exit /b %errorlevel%
:account
"%GENESIS_NODE_EXE%" tools/clasp.mjs show-authorized-user
exit /b %errorlevel%
:status
"%GENESIS_NODE_EXE%" tools/clasp.mjs show-file-status
exit /b %errorlevel%
:push
"%GENESIS_NODE_EXE%" tools/build.mjs
if errorlevel 1 exit /b 1
set "GENESIS_GOOGLE_AUTHORIZED=YES"
"%GENESIS_NODE_EXE%" tools/clasp.mjs push
exit /b %errorlevel%
:check
"%GENESIS_NODE_EXE%" tools/release-preflight.mjs
exit /b %errorlevel%
:version
"%GENESIS_NODE_EXE%" --version
exit /b %errorlevel%
:prepare_data
"%GENESIS_NODE_EXE%" tools/prepare-google-data.mjs
exit /b %errorlevel%
:test
"%GENESIS_NODE_EXE%" --test tests/*.test.mjs
exit /b %errorlevel%
