$ErrorActionPreference = "Stop"

$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path -LiteralPath $chromePath)) {
  throw "Chrome was not found at $chromePath"
}

$chromeVersion = [version](Get-Item -LiteralPath $chromePath).VersionInfo.ProductVersion
if ($chromeVersion.Major -lt 150) {
  throw "Chrome 150 or newer is required; found $chromeVersion"
}

$profilePath = Join-Path $env:LOCALAPPDATA "SchematicWebMCPChrome"
New-Item -ItemType Directory -Path $profilePath -Force | Out-Null

$arguments = @(
  "--enable-features=WebMCP",
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=9222",
  "--user-data-dir=$profilePath",
  "--no-first-run",
  "http://localhost:3000/studio/project/webmcp-proof"
)

Start-Process -FilePath $chromePath -ArgumentList $arguments
Write-Host "Opened Chrome $chromeVersion with native WebMCP and CDP on http://127.0.0.1:9222"
