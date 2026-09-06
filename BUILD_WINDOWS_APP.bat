@echo off
title Foxes Hockey Analytics Setup
cd /d "%~dp0"
echo.
echo ========================================
echo   Foxes Hockey Analytics Desktop Setup
echo ========================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed yet.
  echo.
  echo Install the LTS version of Node.js from:
  echo https://nodejs.org/
  echo.
  echo Then run this file again.
  pause
  exit /b 1
)
echo Installing desktop app components...
call npm ci
if errorlevel 1 (
  echo.
  echo Setup failed. Check your internet connection and try again.
  pause
  exit /b 1
)
echo.
echo Building the Windows desktop app...
call npm run dist
if errorlevel 1 (
  echo.
  echo Build failed.
  pause
  exit /b 1
)
echo.
echo DONE.
echo Open the "dist" folder and double-click the Foxes Hockey Analytics .exe file.
pause
