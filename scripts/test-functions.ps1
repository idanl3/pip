# Tests the start-session and end-session edge functions against the live
# project.
#
#     .\scripts\test-functions.ps1
#
# Creates a disposable family, walks it through approval, starting, refusing
# and ending, then deletes it. Run after any change to either function.
#
# What it is really checking is that the refusals cannot be skipped. Everything
# here could be bypassed if the checks lived in the browser, which is why they
# do not.

Set-Location (Join-Path $PSScriptRoot '..')
. .\scripts\load-env.ps1 | Out-Null

$url  = $env:VITE_SUPABASE_URL
$key  = $env:VITE_SUPABASE_PUBLISHABLE_KEY
$ref  = ([uri]$url).Host.Split('.')[0]
$mg   = @{ Authorization = "Bearer $env:SUPABASE_ACCESS_TOKEN"; 'Content-Type' = 'application/json' }
$pass = 'Correct-Horse-Battery-7!x'
$email = 'pip-fn-a@pip.invalid'

function Sql($q) {
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" -Method Post `
    -Headers $mg -Body (@{ query = $q } | ConvertTo-Json -Compress) -TimeoutSec 60
}

function Call($fn, $jwt, $body) {
  $h = @{ apikey = $key; Authorization = "Bearer $jwt"; 'Content-Type' = 'application/json' }
  try {
    $r = Invoke-WebRequest -Uri "$url/functions/v1/$fn" -Method Post -Headers $h `
          -Body ($body | ConvertTo-Json -Compress) -UseBasicParsing -TimeoutSec 60
    return @{ status = [int]$r.StatusCode; body = ($r.Content | ConvertFrom-Json) }
  } catch {
    $resp = $_.Exception.Response
    $text = ''
    try { $sr = New-Object System.IO.StreamReader($resp.GetResponseStream()); $text = $sr.ReadToEnd() } catch {}
    $parsed = $null
    try { $parsed = $text | ConvertFrom-Json } catch {}
    return @{ status = [int]$resp.StatusCode; body = $parsed; raw = $text }
  }
}

$script:passed = 0
$script:failed = 0
function Check($label, $ok, $detail) {
  if ($ok) { "  PASS  $label"; $script:passed++ }
  else { "  FAIL  $label"; "          $detail"; $script:failed++ }
}

'=== a disposable family ==='
Sql "delete from auth.users where email like 'pip-fn-%'" | Out-Null
Sql "delete from public.invites where label = 'fn test'" | Out-Null

$uid = (Sql @"
with created as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
    'authenticated', 'authenticated', '$email',
    extensions.crypt('$pass', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '', '', '', ''
  ) returning id
)
insert into auth.identities (user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
select id, jsonb_build_object('sub', id::text, 'email', '$email'), 'email', '$email', now(), now(), now()
  from created
returning user_id
"@)[0].user_id

# No invitation needed: a server context is not a parent, so the guard lets
# this through. See the guard_allows_server_context migration.
$famId = (Sql "insert into public.families (owner_id, parent_names, recurring_conflicts, house_rules) values ('$uid','{Mum,Dad}','bedtime','no hitting') returning id")[0].id

Sql @"
insert into public.children (family_id, first_name, age, personality, conflict_tendency, sort_order) values
 ('$famId', 'Alef', 9, 'Sensitive', 'Gives in quickly to keep the peace', 0),
 ('$famId', 'Bet', 7, 'Likes to win', 'Digs in and will not budge', 1)
"@ | Out-Null

$jwt = (Invoke-RestMethod -Uri "$url/auth/v1/token?grant_type=password" -Method Post `
  -Headers @{ apikey = $key; 'Content-Type' = 'application/json' } `
  -Body (@{ email = $email; password = $pass } | ConvertTo-Json -Compress) -TimeoutSec 30).access_token

Check 'the family exists and can sign in' ($famId -and $jwt) 'setup failed'

''
'=== a pending family cannot start ==='
$r = Call 'start-session' $jwt @{ }
Check 'refused while pending' ($r.body.error -eq 'not_approved') "got $($r.status) $($r.body.error)"

''
'=== a suspended family cannot start ==='
Sql "update public.families set status='suspended' where id='$famId'" | Out-Null
$r = Call 'start-session' $jwt @{ }
Check 'refused while suspended' ($r.body.error -eq 'suspended') "got $($r.status) $($r.body.error)"

''
'=== approved, with no minutes left ==='
Sql "update public.families set status='approved', monthly_minute_limit=0 where id='$famId'" | Out-Null
$r = Call 'start-session' $jwt @{ }
Check 'refused with no minutes' ($r.body.error -eq 'no_minutes') "got $($r.status) $($r.body.error)"

''
'=== approved, with minutes ==='
Sql "update public.families set monthly_minute_limit=120 where id='$famId'" | Out-Null
$kidIds = Sql "select id from public.children where family_id='$famId' order by sort_order"
$r = Call 'start-session' $jwt @{ child_ids = @($kidIds[0].id) }

Check 'a session starts' ($r.status -eq 200) "got $($r.status) $($r.raw)"
if ($r.status -eq 200) {
  Check 'a conversation token came back' (-not [string]::IsNullOrWhiteSpace($r.body.token)) 'no token'
  Check 'a conversation id came back' (-not [string]::IsNullOrWhiteSpace($r.body.conversation_id)) 'no conversation_id'
  Check 'minutes remaining reported' ($r.body.minutes_remaining -eq 120) "got $($r.body.minutes_remaining)"
  Check 'the cap is 900 seconds' ($r.body.max_duration_seconds -eq 900) "got $($r.body.max_duration_seconds)"

  $v = $r.body.dynamic_variables
  Check 'both children are in the profile' ($v.children -match 'Alef' -and $v.children -match 'Bet') "got: $($v.children)"
  Check 'only the chosen child is in this session' ($v.children_in_session -eq 'Alef') "got: $($v.children_in_session)"
  Check 'parent names joined readably' ($v.parent_names -eq 'Mum and Dad') "got: $($v.parent_names)"
  Check 'empty fields get wording, not blanks' ($v.extra_care -eq 'nothing noted') "got: $($v.extra_care)"

  $row = Sql "select conversation_id, agent_id, ended_at from public.sessions where id='$($r.body.session_id)'"
  Check 'the session was recorded' ($row[0].conversation_id -eq $r.body.conversation_id) 'conversation id not stored'
  Check 'it is open' ($null -eq $row[0].ended_at) 'already ended'

  $sessionId = $r.body.session_id
}

''
'=== what Pip is told about who is here ==='
# The whole point of the selection screen: the names have to reach the agent,
# or Pip opens by asking something the parent just answered.
#
# These use preview, which runs every check and formats the profile without
# requesting a token. Asking for three real tokens per run just to inspect a
# string hit ElevenLabs' rate limit and took the whole suite down with it.

$both = Call 'start-session' $jwt @{ child_ids = @($kidIds[0].id, $kidIds[1].id); preview = $true }
Check 'a preview issues no token' ($both.body.preview -eq $true -and $null -eq $both.body.token) 'a token was issued anyway'
Check 'both chosen children are named' ($both.body.dynamic_variables.children_in_session -eq 'Alef and Bet') "got: $($both.body.dynamic_variables.children_in_session)"
Check 'the spoken greeting gets names only' ($both.body.dynamic_variables.greeting_names -eq 'Alef and Bet') "got: $($both.body.dynamic_variables.greeting_names)"

$guest = Call 'start-session' $jwt @{ child_ids = @($kidIds[0].id); include_other = $true; preview = $true }
$desc = $guest.body.dynamic_variables.children_in_session
Check 'a visiting child is spelled out as unknown' ($desc -match 'Alef' -and $desc -match 'not in the profile') "got: $desc"
Check 'the greeting still uses the known name' ($guest.body.dynamic_variables.greeting_names -eq 'Alef') "got: $($guest.body.dynamic_variables.greeting_names)"

$onlyGuests = Call 'start-session' $jwt @{ include_other = $true; preview = $true }
Check 'visiting children alone is allowed' ($onlyGuests.status -eq 200) "got $($onlyGuests.status) $($onlyGuests.raw)"
Check 'and Pip is told it knows nobody' ($onlyGuests.body.dynamic_variables.children_in_session -match 'not in the profile') "got: $($onlyGuests.body.dynamic_variables.children_in_session)"
Check 'the greeting falls back to there' ($onlyGuests.body.dynamic_variables.greeting_names -eq 'there') "got: $($onlyGuests.body.dynamic_variables.greeting_names)"
Check 'the parent context variable is gone' ($null -eq $onlyGuests.body.dynamic_variables.parent_context) 'parent_context is still being sent'

$stillOne = (Sql "select count(*)::int as n from public.sessions where family_id='$famId' and ended_at is null")[0].n
Check 'a preview opened no session' ($stillOne -eq 1) "$stillOne open sessions"

''
'=== only one at a time ==='
# A real selection, so this reaches the one-session gate rather than being
# turned away earlier for choosing nobody.
$again = Call 'start-session' $jwt @{ child_ids = @($kidIds[0].id) }
Check 'a second start is refused' ($again.body.error -eq 'already_running') "got $($again.status) $($again.body.error)"

''
'=== ending it ==='
Start-Sleep -Seconds 3
$e = Call 'end-session' $jwt @{ session_id = $sessionId }
Check 'the session closes' ($e.status -eq 200) "got $($e.status) $($e.raw)"
Check 'the duration is measured server-side, not taken from us' ($e.body.duration_seconds -ge 2) "got $($e.body.duration_seconds)"

$closed = Sql "select ended_at, duration_seconds, duration_source from public.sessions where id='$sessionId'"
Check 'recorded as client-reported' ($closed[0].duration_source -eq 'client') "got $($closed[0].duration_source)"

$e2 = Call 'end-session' $jwt @{ session_id = $sessionId }
Check 'ending twice is harmless' ($e2.status -eq 200 -and $e2.body.already_closed -eq $true) "got $($e2.status)"

''
'=== a browser cannot forge a short session ==='
$forge = Call 'end-session' $jwt @{ session_id = $sessionId; duration_seconds = 0 }
$after = Sql "select duration_seconds from public.sessions where id='$sessionId'"
Check 'a duration sent by the caller is ignored' ($after[0].duration_seconds -ge 2) "got $($after[0].duration_seconds)"

''
'=== and cannot close a session it does not own ==='
$stranger = Call 'end-session' $jwt @{ session_id = [guid]::NewGuid().ToString() }
Check 'an unknown session is refused' ($stranger.body.error -eq 'not_found') "got $($stranger.status) $($stranger.body.error)"

''
'=== usage is derived, not counted ==='
$usage = Sql "select minutes_used, monthly_minute_limit from public.family_usage where family_id='$famId'"
Check 'the minute used shows up' ($usage[0].minutes_used -ge 1) "got $($usage[0].minutes_used)"

''
'=== a session with nobody chosen ==='
Sql "delete from public.children where family_id='$famId'" | Out-Null
$none = Call 'start-session' $jwt @{ }
Check 'refused with no children' ($none.body.error -eq 'no_children') "got $($none.status) $($none.body.error)"

''
'=== cleanup ==='
Sql "delete from auth.users where email like 'pip-fn-%'" | Out-Null
Sql "delete from public.invites where label = 'fn test'" | Out-Null
$left = Sql "select count(*)::int as n from public.sessions where family_id='$famId'"
Check 'deleting the family removed its sessions' ($left[0].n -eq 0) "$($left[0].n) left"

''
"=== $script:passed passed, $script:failed failed ==="
if ($script:failed -gt 0) { exit 1 }
