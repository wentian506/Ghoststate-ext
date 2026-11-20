# Register the separately installed GhostState native host for exactly the selected extension IDs.
# Run as the signed-in user, not as Administrator. No keys or passwords are requested.
param(
  [Parameter(Mandatory=$true)][ValidateSet('chrome','edge','brave','firefox')][string]$Browser,
  [Parameter(Mandatory=$true)][string]$ExtensionId,
  [Parameter(Mandatory=$true)][string]$Binary
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) { throw 'USERPROFILE is missing; sign in to a Windows user profile first.' }
if (!(Test-Path -LiteralPath $Binary -PathType Leaf)) { throw 'Companion executable does not exist.' }
$source = (Resolve-Path -LiteralPath $Binary).ProviderPath
if ([IO.Path]::GetExtension($source) -ine '.exe') { throw 'Select the GhostState Windows .exe, not the extension ZIP or Linux binary.' }
if ($Browser -eq 'firefox') {
  if ($ExtensionId -cne 'ghoststate@local.invalid') { throw 'Firefox development ID must match the built manifest.' }
  $caller = $ExtensionId; $registry = 'HKCU:\Software\Mozilla\NativeMessagingHosts\com.ghoststate.bridge'
  $listName = 'allowed_extensions'
} else {
  if ($ExtensionId -cnotmatch '^[a-p]{32}$') { throw 'Chromium extension ID must be 32 lowercase letters from a to p.' }
  $caller = "chrome-extension://$ExtensionId/"
  $vendor = @{chrome='Google\Chrome';edge='Microsoft\Edge';brave='BraveSoftware\Brave-Browser'}[$Browser]
  $registry = "HKCU:\Software\$vendor\NativeMessagingHosts\com.ghoststate.bridge"
  $listName = 'allowed_origins'
}
$base = Join-Path $env:USERPROFILE '.config\ghoststate'
New-Item -ItemType Directory -Force -Path $base | Out-Null
$dest = Join-Path $base 'ghoststate-companion.exe'
$config = Join-Path $base 'allowed-callers.json'
$manifestPath = Join-Path $base ("com.ghoststate.bridge.$Browser.json")
$allowed = @()
if (Test-Path -LiteralPath $config -PathType Leaf) {
  $existing = Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
  if ($null -eq $existing -or $null -eq $existing.PSObject.Properties['allowed'] -or $existing.allowed -isnot [array]) { throw 'Existing companion allowlist is invalid; inspect it before retrying.' }
  foreach ($entry in $existing.allowed) {
    if ($entry -isnot [string] -or ($entry -cnotmatch '^chrome-extension://[a-p]{32}/$' -and $entry -cne 'ghoststate@local.invalid')) { throw 'Existing companion allowlist contains an invalid caller; inspect it before retrying.' }
    if ($allowed -cnotcontains $entry) { $allowed += $entry }
  }
}
if ($allowed -cnotcontains $caller) { $allowed += $caller }
if ($allowed.Count -gt 20) { throw 'Caller allowlist limit reached; remove unused registrations first.' }
# The registry has only one manifest per browser. Keep existing exact IDs for
# this browser rather than breaking a prior unpacked/store installation.
$browserAllowed = @()
if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
  $previous = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($null -eq $previous -or $null -eq $previous.PSObject.Properties[$listName] -or $previous.$listName -isnot [array]) { throw 'Existing browser manifest is invalid; inspect it before retrying.' }
  foreach ($entry in $previous.$listName) {
    if ($entry -isnot [string]) { throw 'Existing browser manifest contains an invalid caller.' }
    if ($Browser -eq 'firefox') {
      if ($entry -cne 'ghoststate@local.invalid') { throw 'Existing Firefox manifest contains an unexpected ID.' }
    } elseif ($entry -cnotmatch '^chrome-extension://[a-p]{32}/$') { throw 'Existing browser manifest contains an invalid origin.' }
    if ($browserAllowed -cnotcontains $entry) { $browserAllowed += $entry }
    if ($allowed -cnotcontains $entry) { throw 'Existing manifest and executable allowlist disagree; inspect both before retrying.' }
  }
}
if ($browserAllowed -cnotcontains $caller) { $browserAllowed += $caller }
if ($browserAllowed.Count -gt 20) { throw 'Browser manifest allowlist limit reached.' }
if (![string]::Equals([IO.Path]::GetFullPath($source), [IO.Path]::GetFullPath($dest), [StringComparison]::OrdinalIgnoreCase)) {
  Copy-Item -LiteralPath $source -Destination $dest -Force
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($config, (@{allowed=$allowed} | ConvertTo-Json -Depth 5), $utf8NoBom)
$manifest = @{name='com.ghoststate.bridge';description='GhostState experimental local Bluetooth companion';path=$dest;type='stdio'}
$manifest[$listName] = @($browserAllowed)
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5), $utf8NoBom)
New-Item -Path $registry -Force | Out-Null
Set-Item -Path $registry -Value $manifestPath
Write-Host "Registered native host for $caller"
Write-Host "Manifest: $manifestPath"
Write-Host "Registry: $registry"
Write-Host 'Restart the browser, then open GhostState > Devices & transfer > Connect companion.'
Write-Host 'Experimental only: Windows Bluetooth and physical transfers have not been verified. Use synthetic credentials.'
