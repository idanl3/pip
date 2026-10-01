# Grants or revokes admin rights.
#
#     .\scripts\make-admin.ps1 -Email you@example.com
#     .\scripts\make-admin.ps1 -Email you@example.com -Remove
#
# Admin rights are membership of public.admins, and that table is unreachable
# through the API by design — no grants, no policies. So the only way in is
# from here, with the database credentials. That is deliberate: an admin roster
# that the application could edit would not be worth much.
#
# There is a bootstrap problem on a fresh project: creating an invitation needs
# admin rights, and the admin screen needs an account. The way through is to
# create the first invitation with SQL (see scripts/new-invite.ps1), join with
# it like any other family, then run this.

param(
  [Parameter(Mandatory = $true)][string]$Email,
  [switch]$Remove
)

Set-Location (Join-Path $PSScriptRoot '..')
. .\scripts\load-env.ps1 | Out-Null

$ref = ([uri]$env:VITE_SUPABASE_URL).Host.Split('.')[0]
$api = "https://api.supabase.com/v1/projects/$ref/database/query"
$mg  = @{ Authorization = "Bearer $env:SUPABASE_ACCESS_TOKEN"; 'Content-Type' = 'application/json' }

function Sql($q) {
  Invoke-RestMethod -Uri $api -Method Post -Headers $mg -Body (@{ query = $q } | ConvertTo-Json -Compress) -TimeoutSec 60
}

$safe = $Email.Replace("'", "''")
$found = Sql "select id from auth.users where lower(email) = lower('$safe')"

if (-not $found -or -not $found[0].id) {
  Write-Warning "No account with the address $Email. They need to sign up first."
  exit 1
}

$id = $found[0].id

if ($Remove) {
  Sql "delete from public.admins where user_id = '$id'" | Out-Null
  "$Email is no longer an admin."
} else {
  Sql "insert into public.admins (user_id) values ('$id') on conflict (user_id) do nothing" | Out-Null
  "$Email is now an admin."
}

$roster = Sql 'select count(*)::int as n from public.admins'
"admins on the roster: $($roster[0].n)"
