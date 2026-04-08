@echo off
REM Dùng khi lệnh "node" trong CMD trỏ nhầm (ví dụ Firebase) — gọi Node.js cài chuẩn.
set "TSC=%~dp0node_modules\typescript\bin\tsc"
if exist "%ProgramFiles%\nodejs\node.exe" (
  "%ProgramFiles%\nodejs\node.exe" "%TSC%" %*
  exit /b %ERRORLEVEL%
)
if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
  "%ProgramFiles(x86)%\nodejs\node.exe" "%TSC%" %*
  exit /b %ERRORLEVEL%
)
where node.exe >nul 2>&1 && node "%TSC%" %* && exit /b %ERRORLEVEL%
echo Khong tim thay node.exe. Cai Node.js hoac chay: "%%ProgramFiles%%\nodejs\node.exe" "%TSC%"
exit /b 1
