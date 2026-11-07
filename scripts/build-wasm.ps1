# Builds the browser prover and copies it, with the keys, into the web app.
# Needs wasm-bindgen-cli 0.2.130 on PATH (or in $env:WASM_BINDGEN).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'web\public\zk'
New-Item -ItemType Directory -Force $out | Out-Null

# RUSTFLAGS replaces .cargo/config.toml here: wasm-bindgen needs the sections that `-s` strips.
$env:RUSTFLAGS = '--cfg getrandom_backend="wasm_js"'
$env:CARGO_TARGET_DIR = if ($env:TIDEOVER_WASM_TARGET) { $env:TIDEOVER_WASM_TARGET } else { Join-Path $root 'target\browser' }
Push-Location $root
cargo build -q -p tideover-wasm --target wasm32-unknown-unknown --release
Pop-Location
$bindgen = if ($env:WASM_BINDGEN) { $env:WASM_BINDGEN } else { 'wasm-bindgen' }
& $bindgen --target web --no-typescript --out-dir $out "$env:CARGO_TARGET_DIR\wasm32-unknown-unknown\release\tideover_wasm.wasm"

Copy-Item (Join-Path $root 'keys\membership.pk') $out -Force
Copy-Item (Join-Path $root 'keys\membership.vk.ark') $out -Force
Get-ChildItem $out | Select-Object Name, Length | Format-Table -AutoSize
