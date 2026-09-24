$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Build MDX Windows packages on Windows.' }

$keyDirectory = Join-Path $env:USERPROFILE '.tauri'
$keyPath = Join-Path $keyDirectory 'mdx.key'
$publicKeyPath = Join-Path $keyDirectory 'mdx.key.pub'
$passwordPath = Join-Path $keyDirectory 'mdx-password.dpapi'
foreach ($path in @($keyPath, $publicKeyPath, $passwordPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing local signing material: $path" }
}

$repositoryPublicKey = (Get-Content -LiteralPath 'app/flowix-desktop/tauri.conf.json' -Raw | ConvertFrom-Json).plugins.updater.pubkey
$localPublicKey = (Get-Content -LiteralPath $publicKeyPath -Raw).Trim()
if ($repositoryPublicKey -ne $localPublicKey) { throw 'The local signing key does not match the desktop updater public key.' }

$securePassword = ConvertTo-SecureString (Get-Content -LiteralPath $passwordPath -Raw)
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$previousKeyPath = $env:TAURI_SIGNING_PRIVATE_KEY_PATH
$previousPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
try {
  $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $keyPath
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  npm run tauri:build:prod
  if ($LASTEXITCODE -ne 0) { throw "MDX desktop build failed with exit code $LASTEXITCODE." }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  [Environment]::SetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY_PATH', $previousKeyPath, 'Process')
  [Environment]::SetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY_PASSWORD', $previousPassword, 'Process')
}
