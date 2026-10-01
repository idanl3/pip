# Loads .env into the current PowerShell session, puts the installed tools on
# PATH, and assembles the database connection string.
#
# Dot-source it, don't run it, or the variables vanish with the child process:
#
#     . .\scripts\load-env.ps1
#
# Two things make this necessary on Windows. An agent's shell captures PATH
# when it starts, so tools installed mid-session are invisible to it. And the
# Supabase CLI reads its credentials from the environment, which keeps them out
# of command lines and shell history.

$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path', 'User')

$envFile = Join-Path $PSScriptRoot '..\.env'

if (-not (Test-Path $envFile)) {
    Write-Warning "No .env found at $envFile. Copy .env.example to .env and fill it in."
    return
}

$loaded = @()
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
        $name  = $Matches[1]
        $value = $Matches[2].Trim()
        # Blank entries are placeholders waiting to be filled; skip them so a
        # half-finished .env cannot shadow a real value already in the session.
        if ($value -ne '') {
            Set-Item -Path "env:$name" -Value $value
            $loaded += $name
        }
    }
}

# Assemble the connection string for migrations.
#
# This goes through the connection pooler rather than the direct database host,
# and that is not optional: db.<ref>.supabase.co resolves to IPv6 only, and this
# machine has no routable IPv6 address. The pooler is the only route that works.
#
# Session mode (5432), not transaction mode (6543) — migrations need a session.
#
# The pooler's regional hostname is not published through any endpoint this
# token can read, so it was found by trying the candidates for eu-central-1 and
# keeping the one that authenticated. If it ever stops working, the host has
# moved: try aws-0 / aws-2 and so on in the same region.
if ($env:SUPABASE_DB_PASSWORD -and $env:SUPABASE_DB_HOST -and $env:SUPABASE_DB_USER) {
    $pw = [System.Uri]::EscapeDataString($env:SUPABASE_DB_PASSWORD)
    $env:PIP_DB_URL = "postgresql://$($env:SUPABASE_DB_USER):$pw@$($env:SUPABASE_DB_HOST):5432/postgres"
    $dbState = "PIP_DB_URL built for $($env:SUPABASE_DB_HOST)"
} else {
    $env:PIP_DB_URL = $null
    $dbState = 'PIP_DB_URL not built - needs SUPABASE_DB_PASSWORD, SUPABASE_DB_HOST and SUPABASE_DB_USER'
}

"loaded from .env: $($loaded -join ', ')"
$dbState
