@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -Command "try { $page = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:15473/phone-simulator.html'; if ($page.StatusCode -eq 200 -and $page.Content.Contains('/src/simulator/main.tsx')) { exit 0 } } catch {}; exit 1" >nul 2>&1
if not errorlevel 1 (
  echo 手机模拟器服务已运行，无需重复启动。
  echo 请打开或刷新：http://127.0.0.1:15473/phone-simulator.html
  pause
  exit /b 0
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo 未找到 Node.js / npm。请先安装 Node.js 后重新运行。
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  echo 尚未安装项目依赖。请先在本文件所在目录运行 npm ci。
  pause
  exit /b 1
)

echo 正在启动手机模拟器，出现 VITE ready 后打开或刷新：
echo http://127.0.0.1:15473/phone-simulator.html
echo 使用模拟器时请保留此窗口；关闭窗口或重启电脑后服务会停止。
echo 若 15473 端口被其他程序占用，启动会报错，请保留错误提示。
echo.
call npm.cmd run dev
set "simulatorExitCode=%errorlevel%"
echo.
echo 手机模拟器服务已停止。
pause
exit /b %simulatorExitCode%
