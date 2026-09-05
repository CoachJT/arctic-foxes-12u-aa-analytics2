@echo off
title Arctic Foxes Analytics 3.0 - Publish Update
echo ===================================================
echo Arctic Foxes Hockey Analytics 3.0 - Publish Update
echo ===================================================
echo.
echo Make sure package.json has your real GitHub owner/repo first.
echo You also need a GitHub token available as GH_TOKEN.
echo.
call npm install
if errorlevel 1 pause & exit /b 1
call npm run publish
pause
