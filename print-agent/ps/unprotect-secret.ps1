param([Parameter(Mandatory = $true)][string]$Blob)
# Decrypts the agent secret stored by setup.ps1 with Windows DPAPI (CurrentUser scope): only the
# same Windows user on the same PC can read it back.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String($Blob)
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plain))
