# Builds Zoom Timer Bridge for Windows and zips it to dist\ZoomTimerBridge-Windows-<arch>-<version>.zip.
# Usage (PowerShell, .NET 8 SDK installed):  windows\build.ps1 [-Version 1.0.0] [-Arch x64|arm64|all] [-SkipTests]
param(
    [string]$Version = "1.0.0",
    [ValidateSet("x64", "arm64", "all")][string]$Arch = "all",
    [switch]$SkipTests
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null

if (-not $SkipTests) {
    Write-Host "==> Running tests"
    dotnet run --project (Join-Path $PSScriptRoot "Tests") -c Release
    if ($LASTEXITCODE -ne 0) { throw "Tests failed" }
}

$archs = if ($Arch -eq "all") { @("x64", "arm64") } else { @($Arch) }
foreach ($a in $archs) {
    Write-Host "==> Publishing win-$a"
    $out = Join-Path $dist "windows-$a\Zoom Timer Bridge"
    if (Test-Path $out) { Remove-Item -Recurse -Force $out }
    dotnet publish (Join-Path $PSScriptRoot "App\ZoomTimerBridge.Windows.csproj") -c Release -r "win-$a" `
        --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
        -p:DebugType=None -p:Version=$Version -o $out
    if ($LASTEXITCODE -ne 0) { throw "Publish failed for win-$a" }
    Copy-Item (Join-Path $root "SETUP.md") $out

    $zip = Join-Path $dist "ZoomTimerBridge-Windows-$a-$Version.zip"
    if (Test-Path $zip) { Remove-Item -Force $zip }
    Compress-Archive -Path $out -DestinationPath $zip
    Write-Host "    $zip"
}
