$ErrorActionPreference = "Stop"

$realRoot = Split-Path -Parent $PSScriptRoot
$root = "C:\nanikiru-wasm-workspace"
if (-not (Test-Path $root)) {
    New-Item -ItemType Junction -Path $root -Target $realRoot | Out-Null
}
$emsdk = Join-Path $root "tools\emsdk"
$emcmd = Join-Path $emsdk "emsdk_env.bat"
$empp = Join-Path $emsdk "upstream\emscripten\em++.exe"
$vendor = Join-Path $root "vendor\mahjong-cpp"
$stage = Join-Path $root "wasm\build\mahjong-src"
$output = Join-Path $root "docs\wasm"
$boost = "C:\vcpkg\installed\x64-windows\include"
$deps = Join-Path $root "tools\wasm-deps"
$rapidjsonRoot = Join-Path $deps "rapidjson"
$spdlogRoot = Join-Path $deps "spdlog"
$rapidjson = Join-Path $rapidjsonRoot "include"
$spdlog = Join-Path $spdlogRoot "include"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $vendor)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $vendor) | Out-Null
    git clone https://github.com/nekobean/mahjong-cpp.git $vendor
}
New-Item -ItemType Directory -Force -Path $deps | Out-Null
if (-not (Test-Path $rapidjson)) {
    git clone --depth 1 https://github.com/Tencent/rapidjson.git $rapidjsonRoot
}
if (-not (Test-Path $spdlog)) {
    git clone --depth 1 https://github.com/gabime/spdlog.git $spdlogRoot
}
if (-not (Test-Path $emsdk)) {
    git clone https://github.com/emscripten-core/emsdk.git $emsdk
}
Push-Location $emsdk
try {
    & .\emsdk.bat install latest
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & .\emsdk.bat activate latest
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Pop-Location
}

if (Test-Path $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item -LiteralPath (Join-Path $vendor "src\mahjong") -Destination (Join-Path $stage "mahjong") -Recurse

$tableCpp = Join-Path $stage "mahjong\core\table.cpp"
$separatorCpp = Join-Path $stage "mahjong\core\hand_separator.cpp"
$tableText = Get-Content -LiteralPath $tableCpp -Raw
if ($tableText -notmatch "__EMSCRIPTEN__") {
    $tableText = $tableText.Replace(
        "#include <boost/dll.hpp>",
        "#ifdef __EMSCRIPTEN__`n#include <filesystem>`n#else`n#include <boost/dll.hpp>`n#endif"
    ).Replace(
        "boost::filesystem::path exe_path = boost::dll::program_location().parent_path();",
        "#ifdef __EMSCRIPTEN__`n    std::filesystem::path exe_path = `"/mahjong-data`";`n#else`n    boost::filesystem::path exe_path = boost::dll::program_location().parent_path();`n#endif"
    ).Replace(
        "boost::filesystem::path suits_table_path",
        "auto suits_table_path"
    ).Replace(
        "boost::filesystem::path honors_table_path",
        "auto honors_table_path"
    )
    [System.IO.File]::WriteAllText($tableCpp, $tableText, $utf8NoBom)
}
$separatorText = Get-Content -LiteralPath $separatorCpp -Raw
if ($separatorText -notmatch "__EMSCRIPTEN__") {
    $separatorText = $separatorText.Replace(
        "#include <boost/dll.hpp>",
        "#ifdef __EMSCRIPTEN__`n#include <filesystem>`n#else`n#include <boost/dll.hpp>`n#endif"
    )
    $pathPattern = '(?s)    boost::filesystem::path s_tbl_path =\s*boost::dll::program_location\(\)\.parent_path\(\) / "suits_patterns\.json";\s*boost::filesystem::path z_tbl_path =\s*boost::dll::program_location\(\)\.parent_path\(\) / "honors_patterns\.json";'
    $pathReplacement = @'
#ifdef __EMSCRIPTEN__
    std::filesystem::path s_tbl_path = "/mahjong-data/suits_patterns.json";
    std::filesystem::path z_tbl_path = "/mahjong-data/honors_patterns.json";
#else
    boost::filesystem::path s_tbl_path =
        boost::dll::program_location().parent_path() / "suits_patterns.json";
    boost::filesystem::path z_tbl_path =
        boost::dll::program_location().parent_path() / "honors_patterns.json";
#endif
'@
    $separatorText = [regex]::Replace($separatorText, $pathPattern, $pathReplacement)
    $separatorText = $separatorText.Replace("    delete buffer;", "    delete[] buffer;")
    if ($separatorText -notmatch 'mahjong-data/suits_patterns\.json') {
        throw "Failed to patch hand_separator.cpp for Emscripten."
    }
    [System.IO.File]::WriteAllText($separatorCpp, $separatorText, $utf8NoBom)
}

New-Item -ItemType Directory -Force -Path $output | Out-Null
$sources = Get-ChildItem -LiteralPath (Join-Path $stage "mahjong") -Recurse -Filter *.cpp |
    ForEach-Object { $_.FullName }
$config = Join-Path $vendor "data\config"

& $empp @sources (Join-Path $root "wasm\mahjong_wasm.cpp") `
    "-I$stage" "-I$boost" "-I$rapidjson" "-I$spdlog" `
    -std=c++17 -O3 -fexceptions --bind `
    -sDISABLE_EXCEPTION_CATCHING=0 `
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createMahjongModule `
    -sALLOW_MEMORY_GROWTH=1 "-sENVIRONMENT=web,worker,node" -sFILESYSTEM=1 `
    "--preload-file" "$config\suits_patterns.json@/mahjong-data/suits_patterns.json" `
    "--preload-file" "$config\honors_patterns.json@/mahjong-data/honors_patterns.json" `
    "--preload-file" "$config\suits_table.bin@/mahjong-data/suits_table.bin" `
    "--preload-file" "$config\honors_table.bin@/mahjong-data/honors_table.bin" `
    -o (Join-Path $output "mahjong.js")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Get-ChildItem $output | Select-Object Name,Length
