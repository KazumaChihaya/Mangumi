@echo off
setlocal
cd /d "%~dp0"
set "MANGUMI_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%MANGUMI_NODE%" set "MANGUMI_NODE=node"
echo Mangumi preview: http://localhost:4173/
echo All screens: http://localhost:4173/screens
echo Keep this window open while reviewing. Press Ctrl+C to stop.
"%MANGUMI_NODE%" "%~dp0scripts\serve.mjs"
echo Preview server stopped.
pause
