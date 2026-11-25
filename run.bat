@echo off
rem Push-latch: local server + browser
cd /d "%~dp0dist"
set "PY=python"
where py >nul 2>nul && set "PY=py"
echo Push-to-open generator: http://127.0.0.1:8765/
echo Close this window to stop the server.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8765/"
%PY% -m http.server 8765 --bind 127.0.0.1
if errorlevel 1 (
  echo.
  echo Python not found or port 8765 is busy. Install Python 3 from https://www.python.org/
  pause
)
