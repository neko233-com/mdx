param(
  [ValidateSet('auto', 'github', 'mirror')]
  [string]$Source = 'auto',
  [string]$MirrorBase = 'https://ghproxy.net'
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) {
  throw 'Use install.sh on macOS.'
}

$release = 'https://github.com/neko233-com/mdx/releases/latest/download/'
$mirror = $MirrorBase.TrimEnd('/')
if (-not $mirror.StartsWith('https://')) { throw 'MirrorBase must use HTTPS.' }
$sources = if ($Source -eq 'github') { @('github') } elseif ($Source -eq 'mirror') { @('mirror') } else { @('github', 'mirror') }
$work = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
$work = [IO.Path]::GetFullPath($work)
if (-not $work.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid temporary directory.' }
New-Item -ItemType Directory -Path $work | Out-Null
try {
  $manifest = $null
  foreach ($candidate in $sources) {
    $url = if ($candidate -eq 'mirror') { "$mirror/${release}latest-mirror.json" } else { "${release}latest.json" }
    try {
      $manifest = Invoke-RestMethod -Uri $url -TimeoutSec 20
      break
    } catch {
      Write-Warning "Cannot fetch update manifest from ${candidate}: $($_.Exception.Message)"
    }
  }
  if (-not $manifest) { throw 'No MDX release manifest is reachable.' }
  $asset = $manifest.platforms.'windows-x86_64-nsis'
  if (-not $asset) { $asset = $manifest.platforms.'windows-x86_64' }
  if (-not $asset -or -not $asset.url) { throw 'The release does not include a Windows NSIS installer.' }
  $assetUrl = [string]$asset.url
  $originUrl = $assetUrl -replace '^https://ghproxy\.net/', ''
  if (-not $originUrl.StartsWith($release.Replace('/latest/download/', '/download/'))) {
    throw "Unexpected installer URL: $assetUrl"
  }
  $installer = Join-Path $work 'MDX-setup.exe'
  $downloaded = $false
  foreach ($candidate in $sources) {
    $url = if ($candidate -eq 'mirror') { "$mirror/$originUrl" } else { $originUrl }
    try {
      Invoke-WebRequest -Uri $url -OutFile $installer -TimeoutSec 120 -UseBasicParsing
      $downloaded = $true
      break
    } catch {
      Write-Warning "Cannot download MDX from ${candidate}: $($_.Exception.Message)"
    }
  }
  if (-not $downloaded) { throw 'The MDX installer could not be downloaded.' }
  $process = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "MDX installer exited with code $($process.ExitCode)." }
  Write-Output 'MDX installed. You can select it as the default Markdown app in Windows Settings > Apps > Default apps.'
} finally {
  if ($work.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}
