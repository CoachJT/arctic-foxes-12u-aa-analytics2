@echo off
title Arctic Foxes 12U AA - Publish Update
echo.
echo ================================================
echo  Arctic Foxes Analytics - Publish Windows Update
echo ================================================
echo.
findstr /C:"REPLACE_WITH_GITHUB_USERNAME" package.json >nul
if not errorlevel 1 (
  echo STOP: Configure your GitHub username in package.json first.
  echo See SETUP_AUTO_UPDATES.txt.
  pause
  exit /b 1
)
if "%GH_TOKEN%"=="" (
  echo STOP: GH_TOKEN is not set in this Command Prompt session.
  echo See SETUP_AUTO_UPDATES.txt.
  pause
  exit /b 1
)
call npm ci
if errorlevel 1 goto :fail
call npm run release
if errorlevel 1 goto :fail
echo.
echo Update published. Installed apps can now detect this release.
pause
exit /b 0
:fail
echo.
echo Publish failed. Review the error above.
pause
exit /b 1
