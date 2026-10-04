param([switch]$WithDataApi, [switch]$ServerOnlyAuth, [switch]$ProductMode)

$ErrorActionPreference = 'Stop'
$taskStackLauncher = [System.IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\..\experiments\auth-spike\scripts\start-local.ps1')
)

# Keep the existing Supabase workdir and Docker volumes in their current place.
& $taskStackLauncher @PSBoundParameters
