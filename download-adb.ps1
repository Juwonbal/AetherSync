$ErrorActionPreference = "Stop"
$destDir = Join-Path $PSScriptRoot "bin"
$zipPath = Join-Path $PSScriptRoot "platform-tools.zip"
$adbPath = Join-Path $destDir "platform-tools\adb.exe"

if (!(Test-Path $destDir)) {
    New-Item -ItemType Directory -Path $destDir | Out-Null
}

if (!(Test-Path $adbPath)) {
    Write-Host "Downloading Google Android platform-tools..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "https://dl.google.com/android/repository/platform-tools-latest-windows.zip" -OutFile $zipPath
    Write-Host "Extracting archive..."
    Expand-Archive -Path $zipPath -DestinationPath $destDir -Force
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Write-Host "Platform tools downloaded and extracted successfully!"
} else {
    Write-Host "Platform tools already exists at $adbPath"
}

& $adbPath version
