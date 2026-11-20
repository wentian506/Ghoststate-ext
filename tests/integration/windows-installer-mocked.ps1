# Cross-platform PowerShell test with a mocked HKCU registry; this is not a Windows OS test.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).ProviderPath
$temp=Join-Path ([IO.Path]::GetTempPath()) ('gs-win-installer-'+[guid]::NewGuid().ToString())
Microsoft.PowerShell.Management\New-Item -ItemType Directory -Path $temp | Out-Null
$previousProfile=$env:USERPROFILE
$env:USERPROFILE=$temp
$global:GhostStateFakeRegistry=@{}
function global:New-Item {
  param([string]$ItemType,[string]$Path,[switch]$Force)
  if ($Path -like 'HKCU:*') { return }
  Microsoft.PowerShell.Management\New-Item -ItemType $ItemType -Path $Path -Force:$Force
}
function global:Set-Item {
  param([string]$Path,$Value)
  if ($Path -like 'HKCU:*') { $global:GhostStateFakeRegistry[$Path]=$Value; return }
  Microsoft.PowerShell.Management\Set-Item -Path $Path -Value $Value
}
function global:Get-Item {
  param([string]$Path)
  if ($Path -like 'HKCU:*') {
    if (!$global:GhostStateFakeRegistry.ContainsKey($Path)) { throw 'Fake key not found' }
    $o=[pscustomobject]@{ SavedValue=$global:GhostStateFakeRegistry[$Path] }
    $o | Add-Member -MemberType ScriptMethod -Name GetValue -Value { param($n) return $this.SavedValue }
    return $o
  }
  Microsoft.PowerShell.Management\Get-Item -Path $Path
}
function Require($condition,$message) { if (!$condition) { throw $message } }
try {
  $binary=Join-Path $temp 'test-companion.exe'
  [IO.File]::WriteAllText($binary,'test fixture, not an executable')
  $installer=Join-Path $root 'scripts/install-native.ps1'
  $check=Join-Path $root 'scripts/check-native.ps1'
  $a='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; $b='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  & $installer -Browser chrome -ExtensionId $a -Binary $binary
  & $installer -Browser chrome -ExtensionId $b -Binary $binary
  & $installer -Browser edge -ExtensionId $a -Binary $binary
  & $installer -Browser firefox -ExtensionId 'ghoststate@local.invalid' -Binary $binary
  $base=Join-Path $temp '.config/ghoststate'
  $config=Get-Content -Raw (Join-Path $base 'allowed-callers.json') | ConvertFrom-Json
  $chrome=Get-Content -Raw (Join-Path $base 'com.ghoststate.bridge.chrome.json') | ConvertFrom-Json
  $edge=Get-Content -Raw (Join-Path $base 'com.ghoststate.bridge.edge.json') | ConvertFrom-Json
  $firefox=Get-Content -Raw (Join-Path $base 'com.ghoststate.bridge.firefox.json') | ConvertFrom-Json
  Require (@($config.allowed).Count -eq 3) 'Caller list must retain two Chrome IDs and one Firefox ID.'
  Require (@($chrome.allowed_origins).Count -eq 2) 'Chrome manifest must retain both IDs.'
  Require (@($edge.allowed_origins).Count -eq 1) 'Browser manifests must be isolated.'
  Require ($firefox.allowed_extensions[0] -ceq 'ghoststate@local.invalid') 'Firefox uses allowed_extensions.'
  $key='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.ghoststate.bridge'
  Require ($global:GhostStateFakeRegistry[$key] -ceq (Join-Path $base 'com.ghoststate.bridge.chrome.json')) 'Registry default must point to the browser manifest.'
  & $check -Browser chrome -ExtensionId $b
  # Installing the already-copied binary should not copy a file onto itself.
  & $installer -Browser chrome -ExtensionId $b -Binary (Join-Path $base 'ghoststate-companion.exe')
  $rejected=$false
  try { & $installer -Browser chrome -ExtensionId 'not-an-id' -Binary $binary } catch { $rejected=$true }
  Require $rejected 'Invalid Chromium IDs must be rejected.'
  $rejected=$false
  [IO.File]::WriteAllText((Join-Path $base 'allowed-callers.json'),'{"allowed":"not-an-array"}')
  try { & $installer -Browser chrome -ExtensionId $a -Binary $binary } catch { $rejected=$true }
  Require $rejected 'Malformed allowlists must be rejected.'
  Write-Host 'PASS mocked PowerShell registry: exact IDs, repeated install, browser isolation, self-copy, diagnostics and malformed input.'
} finally {
  $env:USERPROFILE=$previousProfile
  Remove-Item function:\New-Item, function:\Set-Item, function:\Get-Item -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
