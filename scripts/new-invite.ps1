# Creates an invitation and prints the link to send.
#
#     .\scripts\new-invite.ps1 -Label "Idan (owner)"
#     .\scripts\new-invite.ps1 -Label "the Cohens" -Days 7
#
# Normally invitations are made from the admin screen. This exists for the
# bootstrap case: on a fresh project nobody is an admin yet, so there is no way
# to reach that screen, and the first invitation has to come from here.
#
# Keep children's names out of the label. It is only there so the owner can
# tell codes apart, and an adult's name does that.

param(
  [string]$Label = $null,
  [int]$Days = 30
)

Set-Location (Join-Path $PSScriptRoot '..')
. .\scripts\load-env.ps1 | Out-Null

$ref = ([uri]$env:VITE_SUPABASE_URL).Host.Split('.')[0]
$api = "https://api.supabase.com/v1/projects/$ref/database/query"
$mg  = @{ Authorization = "Bearer $env:SUPABASE_ACCESS_TOKEN"; 'Content-Type' = 'application/json' }

function Sql($q) {
  Invoke-RestMethod -Uri $api -Method Post -Headers $mg -Body (@{ query = $q } | ConvertTo-Json -Compress) -TimeoutSec 60
}

$labelSql = if ([string]::IsNullOrWhiteSpace($Label)) { 'null' } else { "'" + $Label.Replace("'", "''") + "'" }

$row = Sql @"
insert into public.invites (code, label, expires_at)
values (public.generate_invite_code(), $labelSql, now() + interval '$Days days')
returning code, expires_at
"@

$code = $row[0].code
""
"Invitation created$(if ($Label) { " for $Label" })."
"Expires $([datetime]$row[0].expires_at)."
""
"Send this link:"
"  https://pip.linnewiel.com/join.html?code=$code"
""
"For local testing:"
"  http://localhost:5173/join.html?code=$code"
