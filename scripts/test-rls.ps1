# Security regression test for the row-level security rules.
#
#     .\scripts\test-rls.ps1
#
# Reading policies tells you what they say. This tells you what they do, by
# creating two real accounts, attacking the schema with them, and deleting them
# again. Run it after any change to policies, triggers or grants.
#
# What it proves:
#   - a parent cannot approve their own family, raise their own minute limit,
#     or write the reviewer's note, even by sending those fields directly
#   - a parent cannot create a family owned by somebody else
#   - one family cannot see, change or delete another family's rows
#   - the admin roster is invisible to a logged-in parent
#   - deleting an account takes the children with it
#
# The accounts are created straight in auth.users rather than through the
# signup endpoint. Signing up sends a confirmation email, and Supabase's
# built-in mailer is rate-limited to a handful per hour, which made this test
# pass once and then fail. The password below is deliberately throwaway.
#
# It writes to the live database and cleans up after itself. If it dies
# halfway, clear the leftovers with:
#   delete from auth.users where email like 'pip-rls-%';

Set-Location (Join-Path $PSScriptRoot '..')
. .\scripts\load-env.ps1 | Out-Null

$url = $env:VITE_SUPABASE_URL
$key = $env:VITE_SUPABASE_PUBLISHABLE_KEY
$ref = ([uri]$env:VITE_SUPABASE_URL).Host.Split('.')[0]
$api = "https://api.supabase.com/v1/projects/$ref/database/query"
$mg  = @{ Authorization = "Bearer $env:SUPABASE_ACCESS_TOKEN"; 'Content-Type' = 'application/json' }

$emailA = 'pip-rls-a@pip.invalid'
$emailB = 'pip-rls-b@pip.invalid'
$pass   = 'Correct-Horse-Battery-7!x'

function Sql($q) {
  Invoke-RestMethod -Uri $api -Method Post -Headers $mg -Body (@{ query = $q } | ConvertTo-Json -Compress) -TimeoutSec 60
}

function Rest($method, $path, $jwt, $body) {
  $h = @{ apikey = $key; 'Content-Type' = 'application/json'; Prefer = 'return=representation' }
  if ($jwt) { $h['Authorization'] = "Bearer $jwt" }
  try {
    $r = Invoke-WebRequest -Uri "$url/rest/v1/$path" -Method $method -Headers $h -Body $body -UseBasicParsing -TimeoutSec 30
    return @{ ok = $true; code = [int]$r.StatusCode; body = $r.Content }
  } catch {
    $resp = $_.Exception.Response
    $b = ''
    try { $sr = New-Object System.IO.StreamReader($resp.GetResponseStream()); $b = $sr.ReadToEnd() } catch {}
    return @{ ok = $false; code = [int]$resp.StatusCode; body = $b }
  }
}

# Counts rows in a PostgREST response.
#
# Do not inline this. PostgREST returns [] for no rows, ConvertFrom-Json turns
# [] into $null, and @($null).Count is 1 in PowerShell rather than 0. Getting
# that wrong once made this test report four data leaks that did not exist.
function RowCount($json) {
  if ([string]::IsNullOrWhiteSpace($json)) { return 0 }
  $parsed = $json | ConvertFrom-Json
  if ($null -eq $parsed) { return 0 }
  return @($parsed).Count
}

# Creates a confirmed, password-capable account without sending any email.
# auth.identities needs a row too, or GoTrue will not accept the password.
function MakeUser($email) {
  $q = @"
with created as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    -- These four have no column default, and GoTrue reads them into plain
    -- strings, so leaving them NULL makes sign-in fail with a 500.
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
insert into auth.identities (
  user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
)
select id,
       jsonb_build_object('sub', id::text, 'email', '$email'),
       'email', '$email', now(), now(), now()
  from created
returning user_id;
"@
  return (Sql $q)[0].user_id
}

function SignIn($email) {
  $b = @{ email = $email; password = $pass } | ConvertTo-Json -Compress
  $s = Invoke-RestMethod -Uri "$url/auth/v1/token?grant_type=password" `
        -Method Post -Headers @{ apikey = $key; 'Content-Type' = 'application/json' } `
        -Body $b -TimeoutSec 30
  return $s.access_token
}

$script:passed = 0
$script:failed = 0
function Check($label, $condition, $detail) {
  if ($condition) { "  PASS  $label"; $script:passed++ }
  else { "  FAIL  $label"; "          $detail"; $script:failed++ }
}


'=== preparing two test accounts ==='
Sql "delete from auth.users where email like 'pip-rls-%'" | Out-Null
$uidA = MakeUser $emailA
$uidB = MakeUser $emailB
$jwtA = SignIn $emailA
$jwtB = SignIn $emailB
Check 'both accounts can sign in'        ($jwtA -and $jwtB) 'no token returned'
Check 'the two accounts really differ'   ($uidA -ne $uidB)  'same id for both'

''
'=== creating a family owned by somebody else ==='
# Done as B, before B owns anything, so the unique constraint on owner_id
# cannot mask the result.
$steal = Rest POST 'families' $jwtB (@{ owner_id = $uidA; parent_names = @('Nope') } | ConvertTo-Json -Compress)
if ($steal.ok) {
  $row = ($steal.body | ConvertFrom-Json)[0]
  Check 'owner_id rewritten to the caller' ($row.owner_id -eq $uidB) "landed on $($row.owner_id)"
  Rest DELETE "families?id=eq.$($row.id)" $jwtB $null | Out-Null
} else {
  Check 'insert on behalf of another user refused outright' $true "HTTP $($steal.code)"
}

''
'=== a parent submitting a hostile profile ==='
$hostile = @{
  owner_id             = $uidA
  parent_names         = @('Mum', 'Dad')
  status               = 'approved'
  monthly_minute_limit = 99999
  review_note          = 'approved by me, thanks'
  recurring_conflicts  = 'bedtime'
} | ConvertTo-Json -Compress

$famId = $null
$ins = Rest POST 'families' $jwtA $hostile
if ($ins.ok) {
  $fam = ($ins.body | ConvertFrom-Json)[0]
  $famId = $fam.id
  Check 'status forced to pending, not the requested approved' ($fam.status -eq 'pending') "got '$($fam.status)'"
  Check 'minute limit forced to 120, not the requested 99999'  ($fam.monthly_minute_limit -eq 120) "got $($fam.monthly_minute_limit)"
  Check 'reviewer note forced empty'                           ([string]::IsNullOrEmpty($fam.review_note)) "got '$($fam.review_note)'"
  Check 'content the parent does own was kept'                 ($fam.recurring_conflicts -eq 'bedtime') "got '$($fam.recurring_conflicts)'"
} else {
  Check 'parent can create their own family' $false "HTTP $($ins.code) $($ins.body)"
}

''
'=== a parent approving themselves afterwards ==='
if ($famId) {
  $up = Rest PATCH "families?id=eq.$famId" $jwtA (@{ status = 'approved'; monthly_minute_limit = 50000 } | ConvertTo-Json -Compress)
  if ($up.ok) {
    $after = ($up.body | ConvertFrom-Json)[0]
    Check 'self-approval reverted to pending' ($after.status -eq 'pending') "got '$($after.status)'"
    Check 'minute limit still 120'            ($after.monthly_minute_limit -eq 120) "got $($after.monthly_minute_limit)"
  } else {
    Check 'parent can edit their own family' $false "HTTP $($up.code) $($up.body)"
  }
}

''
'=== children ==='
if ($famId) {
  $k = Rest POST 'children' $jwtA (@{ family_id = $famId; first_name = 'Testy'; age = 7; gender = 'girl'; personality = 'curious' } | ConvertTo-Json -Compress)
  Check 'parent can add a child' $k.ok "HTTP $($k.code) $($k.body)"

  $bad = Rest POST 'children' $jwtA (@{ family_id = $famId; first_name = 'TooOld'; age = 40 } | ConvertTo-Json -Compress)
  Check 'age 40 refused by the constraint' (-not $bad.ok) 'the insert unexpectedly succeeded'

  $long = Rest POST 'children' $jwtA (@{ family_id = $famId; first_name = 'Verbose'; age = 8; personality = ('x' * 900) } | ConvertTo-Json -Compress)
  Check 'over-long personality refused' (-not $long.ok) 'the insert unexpectedly succeeded'

  # Editing a child is editing the profile, so it must go back for review.
  Sql "update public.families set status = 'approved' where id = '$famId'" | Out-Null
  Rest PATCH "children?family_id=eq.$famId&first_name=eq.Testy" $jwtA (@{ age = 8 } | ConvertTo-Json -Compress) | Out-Null
  $st = Sql "select status from public.families where id = '$famId'"
  Check 'editing a child sent the family back to pending' ($st[0].status -eq 'pending') "status is '$($st[0].status)'"
}

''
'=== the other family cannot reach any of it ==='
$bFam = Rest GET 'families?select=id' $jwtB $null
if ($bFam.ok) { Check 'user B sees zero families' ((RowCount $bFam.body) -eq 0) "saw $(RowCount $bFam.body)" }
else          { Check 'user B can query families at all' $false "HTTP $($bFam.code)" }

$bKid = Rest GET 'children?select=id,first_name' $jwtB $null
if ($bKid.ok) { Check 'user B sees zero children' ((RowCount $bKid.body) -eq 0) "saw $(RowCount $bKid.body)" }

if ($famId) {
  $bPatch = Rest PATCH "families?id=eq.$famId" $jwtB (@{ recurring_conflicts = 'vandalised' } | ConvertTo-Json -Compress)
  if ($bPatch.ok) { Check 'user B changed nothing' ((RowCount $bPatch.body) -eq 0) "changed $(RowCount $bPatch.body) rows" }

  $bDel = Rest DELETE "families?id=eq.$famId" $jwtB $null
  if ($bDel.ok) { Check 'user B deleted nothing' ((RowCount $bDel.body) -eq 0) "deleted $(RowCount $bDel.body) rows" }

  # And prove the row is genuinely still there and unchanged.
  $still = Sql "select recurring_conflicts from public.families where id = '$famId'"
  Check 'the row survived user B untouched' ($still[0].recurring_conflicts -eq 'bedtime') "now '$($still[0].recurring_conflicts)'"
}

''
'=== the admin roster stays invisible to a logged-in parent ==='
$adm = Rest GET 'admins?select=*' $jwtA $null
Check 'admins unreadable' (-not $adm.ok) "HTTP $($adm.code) returned $($adm.body)"

''
'=== cleanup ==='
Sql "delete from auth.users where email like 'pip-rls-%'" | Out-Null
$left = Sql 'select count(*)::int as n from public.families'
Check 'deleting the accounts removed their families' ($left[0].n -eq 0) "$($left[0].n) rows left behind"

''
"=== $script:passed passed, $script:failed failed ==="
if ($script:failed -gt 0) { exit 1 }
