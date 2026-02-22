@echo off
echo Building Poly Convergence...
echo.
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo BUILD FAILED
    pause
    exit /b 1
)
echo.
echo Build successful! Output is in the build\ folder.
echo.
call npm run serve
pause
