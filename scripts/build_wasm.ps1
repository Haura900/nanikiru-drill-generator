$ErrorActionPreference = "Stop"
Write-Warning "WASM is built and released by Haura900/mahjong-cpp. Installing the pinned release instead."
& (Join-Path $PSScriptRoot "update-engine.ps1") @args
