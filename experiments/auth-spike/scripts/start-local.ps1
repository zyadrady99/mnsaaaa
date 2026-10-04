param([switch]$WithDataApi, [switch]$ServerOnlyAuth, [switch]$ProductMode)
$ErrorActionPreference = 'Stop'
$experimentRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$priorProcessPath = $env:PATH
$priorAdapterPath = $env:DOROSNA_DOCKER_ADAPTER
$priorDataProbe = $env:DOROSNA_DATA_API_PROBE
$didRequestStart = $false
try {
    New-Item -ItemType Directory -Path (Join-Path $experimentRoot '.local') -Force | Out-Null
    $shimDirectory = Join-Path $experimentRoot '.local\docker-shim'
    New-Item -ItemType Directory -Path $shimDirectory -Force | Out-Null
    $compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    & $compilerPath /nologo /target:exe ("/out:" + (Join-Path $shimDirectory 'docker.exe')) (Join-Path $PSScriptRoot 'DockerShim.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Local Docker launcher compilation failed.' }
    $env:PATH = $shimDirectory + ';C:\Program Files\nodejs;' + (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin') + ';' + $priorProcessPath
    $env:DOROSNA_DOCKER_ADAPTER = Join-Path $PSScriptRoot 'docker-local.mjs'
    $excludedServices = 'realtime,storage-api,imgproxy,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'
    if ($WithDataApi) {
        $excludedServices = 'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'
        if ($ProductMode) { $env:DOROSNA_DATA_API_PROBE = $null }
        else { $env:DOROSNA_DATA_API_PROBE = '1' }
    }
    $didRequestStart = $true
    # Windows PowerShell treats redirected native stderr warnings as errors.
    # Let the CLI finish, then check its exit code before verifying the services.
    $priorStartErrorPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & (Join-Path $experimentRoot 'node_modules\.bin\supabase.cmd') start --workdir $experimentRoot --network-id dorosna-auth-spike-local --exclude $excludedServices --agent no 1> (Join-Path $experimentRoot '.local\start.stdout.log') 2> (Join-Path $experimentRoot '.local\start.stderr.log')
        $startExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $priorStartErrorPreference
    }
    if ($startExitCode -ne 0) { throw 'Local start failed; inspect ignored .local logs without printing credentials.' }
    $dockerPath = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'
    $containerNames = @('supabase_db_dorosna-auth-spike', 'supabase_auth_dorosna-auth-spike', 'supabase_kong_dorosna-auth-spike')
    if ($WithDataApi) { $containerNames += 'supabase_rest_dorosna-auth-spike' }
    $inspectionRaw = & $dockerPath inspect @containerNames
    if ($LASTEXITCODE -ne 0) { throw 'Container verification failed.' }
    $inspection = $inspectionRaw | ConvertFrom-Json -ErrorAction Stop
    foreach ($container in $inspection) {
        if ($container.Name -eq '/supabase_rest_dorosna-auth-spike' -and $null -eq $container.State.Health) {
            if (-not $container.State.Running) { throw 'Data API is not running.' }
        } elseif ($container.State.Health.Status -ne 'healthy') { throw 'An experiment container is unhealthy.' }
        foreach ($port in $container.NetworkSettings.Ports.PSObject.Properties) {
            foreach ($binding in @($port.Value)) {
                if ($binding -and $binding.HostIp -ne '127.0.0.1') { throw 'An experiment port is not restricted to localhost.' }
            }
        }
    }
    $authContainer = $inspection | Where-Object { $_.Name -eq '/supabase_auth_dorosna-auth-spike' }
    if ($authContainer.Config.Env -notcontains 'GOTRUE_EXTERNAL_PHONE_ENABLED=true') { throw 'Phone provider verification failed.' }
    if (@($authContainer.Config.Env | Where-Object { $_ -match '^GOTRUE_SMS_PROVIDER=.+' }).Count -ne 0) { throw 'An SMS provider was configured unexpectedly.' }
    if ($WithDataApi) {
        $priorStatusErrorPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $probeStatusRaw = & (Join-Path $experimentRoot 'node_modules\@supabase\cli-windows-x64\bin\supabase.exe') status --workdir $experimentRoot --output json --agent no 2> (Join-Path $experimentRoot '.local\probe-status.stderr.log')
            $probeStatusExitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $priorStatusErrorPreference
        }
        if ($probeStatusExitCode -ne 0) { throw 'Local status failed; inspect the ignored probe-status log without printing credentials.' }
        $probeSettings = ($probeStatusRaw -join "`n") | ConvertFrom-Json -ErrorAction Stop
        $probeResponse = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:54321/rest/v1/' -Headers @{ apikey = $probeSettings.ANON_KEY } -TimeoutSec 15
        if ($probeResponse.StatusCode -ne 200) { throw 'Data API HTTP check failed.' }
        Write-Output 'Local Data API responds over the same loopback gateway; private-schema grants remain restricted.'
    }
    if ($ServerOnlyAuth) {
        & 'C:\Program Files\nodejs\node.exe' (Join-Path $PSScriptRoot 'harden-auth-local.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'Server-only Auth boundary verification failed.' }
    }
    Write-Output 'Local Auth/Postgres/gateway healthy; published ports use 127.0.0.1; phone provider enabled without SMS provider.'
} catch {
    $originalStartError = $_
    if ($didRequestStart) {
        # A rejected verification must not leave this experiment's ports running.
        # Native stderr warnings must not interrupt cleanup or replace its cause.
        $priorStopErrorPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & (Join-Path $experimentRoot 'node_modules\.bin\supabase.cmd') stop --workdir $experimentRoot --project-id dorosna-auth-spike --agent no 1> (Join-Path $experimentRoot '.local\failed-start-stop.stdout.log') 2> (Join-Path $experimentRoot '.local\failed-start-stop.stderr.log')
            if ($LASTEXITCODE -ne 0) {
                Write-Warning 'Cleanup failed; inspect the ignored failed-start-stop logs without printing credentials.' -WarningAction Continue
            }
        } catch {
            Write-Warning 'Cleanup could not finish; inspect the ignored failed-start-stop logs without printing credentials.' -WarningAction Continue
        } finally {
            $ErrorActionPreference = $priorStopErrorPreference
        }
    }
    throw $originalStartError
} finally {
    $env:PATH = $priorProcessPath
    $env:DOROSNA_DOCKER_ADAPTER = $priorAdapterPath
    $env:DOROSNA_DATA_API_PROBE = $priorDataProbe
}
