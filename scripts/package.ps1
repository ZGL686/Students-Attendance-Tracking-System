$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'dist'))
$appDir = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot 'Ludian-latest'))
$zipPath = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot 'Ludian-latest.zip'))
if (-not $appDir.StartsWith($releaseRoot + [System.IO.Path]::DirectorySeparatorChar) -or -not $zipPath.StartsWith($releaseRoot + [System.IO.Path]::DirectorySeparatorChar)) { throw '发布路径越界' }
$taskTargetRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $repoRoot 'src-tauri\target' }
$exePath = Join-Path $taskTargetRoot 'release\guilu.exe'
if (-not (Test-Path -LiteralPath $exePath)) { throw '请先执行 npm run desktop:build' }
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
# Copy only release-owned files; preserve any extra user files in the extracted directory.
Copy-Item -LiteralPath $exePath -Destination (Join-Path $appDir 'Ludian.exe') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'docs\使用说明.md') -Destination (Join-Path $appDir '使用说明.md') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'public\offline\THIRD-PARTY-NOTICES.txt') -Destination (Join-Path $appDir 'THIRD-PARTY-NOTICES.txt') -Force
$fontLicense = @('Noto Sans SC', (Get-Content -LiteralPath (Join-Path $repoRoot 'public\fonts\OFL.txt') -Raw), 'Ludian Rounded - derived from 975 Yuan', (Get-Content -LiteralPath (Join-Path $repoRoot 'public\fonts\rounded-OFL.txt') -Raw), 'Ludian Hand - derived from LXGW WenKai GB Screen', (Get-Content -LiteralPath (Join-Path $repoRoot 'public\fonts\handwritten-OFL.txt') -Raw)) -join "`r`n`r`n"
[System.IO.File]::WriteAllText((Join-Path $appDir 'FONT-LICENSE.txt'), $fontLicense, (New-Object System.Text.UTF8Encoding $false))
$version = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $hash = [System.BitConverter]::ToString($sha.ComputeHash([System.IO.File]::ReadAllBytes((Join-Path $appDir 'Ludian.exe')))).Replace('-','') } finally { $sha.Dispose() }
@{version=$version;builtAt=(Get-Date).ToString('o');sha256=$hash;executable='Ludian.exe'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $appDir 'version.json') -Encoding UTF8
# Recreate the archive from release-owned files only; never package user databases or backups.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipTemp = $zipPath + '.tmp'
$zipStream = [System.IO.File]::Open($zipTemp, [System.IO.FileMode]::Create)
$archive = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
try {
  foreach($file in @((Join-Path $appDir 'Ludian.exe'),(Join-Path $appDir '使用说明.md'),(Join-Path $appDir 'version.json'),(Join-Path $appDir 'FONT-LICENSE.txt'),(Join-Path $appDir 'THIRD-PARTY-NOTICES.txt'))){
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file, [System.IO.Path]::GetFileName($file), [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $archive.Dispose(); $zipStream.Dispose() }
Move-Item -LiteralPath $zipTemp -Destination $zipPath -Force
Write-Output "解压版：$appDir"
Write-Output "压缩包：$zipPath"
Write-Output "SHA256：$hash"
