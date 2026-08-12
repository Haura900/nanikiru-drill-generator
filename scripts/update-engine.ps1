param(
    [string]$SourceZip = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$lock = Get-Content (Join-Path $repoRoot "engine-lock.json") -Raw | ConvertFrom-Json
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("nanikiru-drill-engine-" + [guid]::NewGuid())
$zipPath = if ($SourceZip) { (Resolve-Path $SourceZip).Path } else { Join-Path $temporary $lock.asset }
$extractPath = Join-Path $temporary "extracted"

New-Item -ItemType Directory -Force -Path $temporary, $extractPath | Out-Null
try {
    if (-not $SourceZip) {
        gh release download $lock.tag --repo $lock.repository --pattern $lock.asset --dir $temporary
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
    if ($lock.sha256 -and $actualHash -ne $lock.sha256.ToLowerInvariant()) {
        throw "Engine checksum mismatch. Expected $($lock.sha256), got $actualHash."
    }
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force
    $manifest = Get-Content (Join-Path $extractPath "engine-manifest.json") -Raw | ConvertFrom-Json
    if ($manifest.version -ne $lock.version -or [int]$manifest.apiVersion -ne [int]$lock.apiVersion -or
        $manifest.commit -ne $lock.commit) {
        throw "Engine manifest does not match engine-lock.json."
    }
    Copy-Item -Path (Join-Path $extractPath "*") `
        -Destination (Join-Path $repoRoot "docs\wasm") -Force
    Write-Host "Installed engine $($lock.version) ($($lock.commit.Substring(0, 7))) / SHA256 $actualHash"
}
finally {
    if (Test-Path $temporary) {
        Remove-Item -LiteralPath $temporary -Recurse -Force
    }
}
