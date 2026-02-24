@echo off
echo Deploying Cloudflare Worker (api.polyconvergence.com)...
echo.
cd /d "%~dp0worker"
call npx wrangler deploy
if %errorlevel% neq 0 (
    echo.
    echo DEPLOY FAILED
    pause
    exit /b 1
)
echo.
echo Worker deployed successfully!
pause
