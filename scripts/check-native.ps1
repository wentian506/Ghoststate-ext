# Read-only setup diagnostics. Displays local paths and public extension IDs, never passwords.
param(
  [Parameter(Mandatory=$true)][ValidateSet('chrome','edge','brave','firefox')][string]$Browser,
  [Parameter(Mandatory=$true)][string]$ExtensionId
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($Browser -eq 'firefox') {
  if ($ExtensionId -cne 'ghoststate@local.invalid') { throw 'Unexpected Firefox development ID.' }
  $caller=$ExtensionId; $registry='HKCU:\Software\Mozilla\NativeMessagingHosts\com.ghoststate.bridge'; $list='allowed_extensions'
} else {
  if ($ExtensionId -cnotmatch '^[a-p]{32}$') { throw 'Expected a 32-letter lowercase Chromium extension ID (a-p).' }
  $caller="chrome-extension://$ExtensionId/"
  $vendor=@{chrome='Google\Chrome';edge='Microsoft\Edge';brave='BraveSoftware\Brave-Browser'}[$Browser]
  $registry="HKCU:\Software\$vendor\NativeMessagingHosts\com.ghoststate.bridge"; $list='allowed_origins'
}
try {
  $key=Get-Item -Path $registry
  $manifestPath=$key.GetValue('')
  if ([string]::IsNullOrWhiteSpace($manifestPath) -or !(Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Registry default value does not point to an existing host manifest.' }
  $manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.name -cne 'com.ghoststate.bridge' -or $manifest.type -cne 'stdio') { throw 'Unexpected host manifest name or type.' }
  if ($null -eq $manifest.PSObject.Properties[$list] -or @($manifest.$list) -cnotcontains $caller) { throw 'This extension ID is not in the browser host manifest.' }
  if (!(Test-Path -LiteralPath $manifest.path -PathType Leaf)) { throw 'The registered companion executable is missing.' }
  $config=Join-Path $env:USERPROFILE '.config\ghoststate\allowed-callers.json'
  $allowed=Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
  if (@($allowed.allowed) -cnotcontains $caller) { throw 'This extension ID is not in the executable allowlist.' }
  Write-Host 'PASS: registry in this PowerShell view, manifest, executable path and exact caller entries exist.'
  Write-Host "Host manifest: $manifestPath"
  Write-Host "Executable: $($manifest.path)"
} catch {
  Write-Error "Registration check failed: $($_.Exception.Message) Run install-native.ps1 for this browser and exact extension ID."
  exit 1
}
Write-Host 'Bluetooth devices visible to Windows (this does not prove BLE peripheral support):'
if (Get-Command Get-PnpDevice -ErrorAction SilentlyContinue) {
  try { Get-PnpDevice -Class Bluetooth -ErrorAction Stop | Select-Object Status, FriendlyName | Format-Table -AutoSize }
  catch { Write-Host 'Windows could not enumerate Bluetooth devices in this session.' }
} else { Write-Host 'Bluetooth device enumeration is not available in this PowerShell session.' }
Write-Host 'Restart Chrome and use Connect companion. Check Bluetooth power and permissions on both devices.'
Write-Host 'A conflicting registration in the other registry view can still take precedence; see README-WINDOWS.md.'
Write-Host 'PASS above checks registration only; Windows Bluetooth, security, and real-device transfer still require testing.'
