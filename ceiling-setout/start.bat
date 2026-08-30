@echo off
setlocal enabledelayedexpansion
title Ceiling setout

rem Double-click launcher. Checks what it needs, installs once, then starts the app
rem and opens it. Everything it does is the same as the README's commands - this just
rem saves typing them and says something useful when a prerequisite is missing.

cd /d "%~dp0"
echo.
echo   Ceiling setout
echo   ==============
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed, and it is the only thing this needs.
  echo.
  echo   Get the LTS installer from https://nodejs.org, accept the defaults,
  echo   then close this window and double-click start.bat again.
  echo.
  start "" "https://nodejs.org"
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set MAJOR=%%v
if !MAJOR! LSS 20 (
  echo   Node.js 20 or newer is needed. This machine has:
  node -v
  echo.
  echo   Install the current LTS from https://nodejs.org and run this again.
  echo.
  start "" "https://nodejs.org"
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo   Setting up pnpm...
  call corepack enable >nul 2>nul
  where pnpm >nul 2>nul
  if errorlevel 1 (
    call npm install -g pnpm
    if errorlevel 1 (
      echo.
      echo   Could not install pnpm. Try running this once from a terminal
      echo   opened as Administrator, or run: npm install -g pnpm
      echo.
      pause
      exit /b 1
    )
  )
)

if not exist "node_modules" (
  echo   Installing ^(first run only, about a minute^)...
  call pnpm install
  if errorlevel 1 (
    echo.
    echo   Install failed. The message above says why.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo   Starting. The app will open at http://localhost:5173
echo   Leave this window open while you use it; close it to stop.
echo.
start "" "http://localhost:5173"
call pnpm dev
pause
