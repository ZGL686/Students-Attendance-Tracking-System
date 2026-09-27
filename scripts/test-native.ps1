$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot '.local') | Out-Null
# The launch harness isolates WebView2 with WEBVIEW2_USER_DATA_FOLDER.
$config=@{app=@{windows=@(@{label='main';title='Ludian · 独立验收';width=1440;height=940;minWidth=1050;minHeight=700;center=$true;additionalBrowserArgs='--remote-debugging-port=9333'})}}
$configPath=Join-Path $repoRoot '.local\tauri.qa.json'
[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding $false))
& npm.cmd run tauri -- build --debug --no-bundle --config $configPath
if($LASTEXITCODE -ne 0){throw '桌面验收构建失败'}
$taskTargetRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $repoRoot 'src-tauri\target' }
& node.exe scripts/native-smoke.mjs (Join-Path $taskTargetRoot 'debug\guilu.exe')
if($LASTEXITCODE -ne 0){throw '桌面验收未通过'}
