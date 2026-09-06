@echo off
title Arctic Foxes 12U AA Hockey Analytics 3.0 Builder
echo.
echo ================================================
echo  Arctic Foxes 12U AA Hockey Analytics 3.0
echo  Windows Portable + Installer Builder
echo ================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js LTS first.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found.
  pause
  exit /b 1
)
echo Installing build dependencies...
call npm ci
if errorlevel 1 goto :fail
echo.
echo Building Windows app...
call npm run dist
if errorlevel 1 goto :fail
echo.
echo DONE.
echo Look in the dist folder for:
echo   - Portable EXE
echo   - Windows Setup EXE
echo.
pause
exit /b 0
:fail
echo.
echo BUILD FAILED. Review the message above.
pause
exit /b 1
