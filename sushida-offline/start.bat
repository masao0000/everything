@echo off
rem Double-click to download (first time only), start the local server and open the browser.
cd /d "%~dp0"
title Sushida Offline

set "NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" (
    set "NODE=%ProgramFiles%\nodejs\node.exe"
  ) else (
    echo Node.js not found. Installing Node.js LTS with winget...
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    if exist "%ProgramFiles%\nodejs\node.exe" (
      set "NODE=%ProgramFiles%\nodejs\node.exe"
    ) else (
      echo.
      echo Could not install Node.js automatically.
      echo Please install the LTS version from https://nodejs.org/ and double-click start.bat again.
      pause
      exit /b 1
    )
  )
)

"%NODE%" download.mjs
if errorlevel 1 (
  echo.
  echo Download failed. Check your internet connection and double-click start.bat again.
  pause
  exit /b 1
)

"%NODE%" serve.mjs --open
if errorlevel 1 pause
