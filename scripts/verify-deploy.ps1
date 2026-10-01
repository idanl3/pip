# Checks that what is live is actually what the repository says, and works.
#
#     .\scripts\verify-deploy.ps1
#
# This script exists because of two mistakes, and its own first version was the
# second of them.
#
# A deploy once went out with no Supabase configuration at all. Every page
# returned HTTP 200, looked completely normal, and could not reach the
# database. So HTTP 200 is not evidence of anything.
#
# Then this script reported 28 of 28 passing while the live site was two
# commits stale. It compared one live bundle against the local dist/ — but the
# local build had failed, so dist/ was equally stale, and two old things
# matched. Meanwhile CI had failed twice and nothing here looked.
#
# Hence: build first and refuse to continue if that fails, confirm CI actually
# succeeded on the current commit, and compare every page's assets rather than
# one.

param(
  [string]$Origin = 'https://pip.linnewiel.com',
  [switch]$SkipBuild
)

Set-Location (Join-Path $PSScriptRoot '..')
. .\scripts\load-env.ps1 | Out-Null

$expectedHost = ([uri]$env:VITE_SUPABASE_URL).Host
$script:passed = 0
$script:failed = 0

function Check($label, $condition, $detail) {
  if ($condition) { "  PASS  $label"; $script:passed++ }
  else { "  FAIL  $label"; "          $detail"; $script:failed++ }
}

function Fetch($path) {
  try { return (Invoke-WebRequest -Uri "$Origin$path" -UseBasicParsing -TimeoutSec 30) }
  catch { return $null }
}

function AssetRefs($html) {
  return [regex]::Matches($html, '(?:src|href)="(/assets/[^"]+)"') |
    ForEach-Object { $_.Groups[1].Value } |
    Sort-Object -Unique
}

# --- build, so the comparison below means something -------------------------
if (-not $SkipBuild) {
  '=== building ==='
  $out = npm run build 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    '  FAIL  the build does not succeed, so there is nothing trustworthy to compare against'
    $out
    exit 1
  }
  '  PASS  build succeeded'
  $script:passed++
}

# --- did CI actually deploy this commit? ------------------------------------
''
'=== continuous integration ==='
$localSha = (git rev-parse HEAD).Trim()
$run = gh run list --branch main --limit 1 --json headSha,conclusion,displayTitle | ConvertFrom-Json

if (-not $run) {
  Check 'a workflow run exists' $false 'none found'
} else {
  Check "latest run succeeded ($($run[0].displayTitle))" ($run[0].conclusion -eq 'success') `
    "conclusion is '$($run[0].conclusion)' - the live site does not have your changes"
  Check 'that run was for the current commit' ($run[0].headSha -eq $localSha) `
    "CI ran $($run[0].headSha.Substring(0,8)), local HEAD is $($localSha.Substring(0,8))"
}

$dirty = git status --porcelain
Check 'no uncommitted changes' ([string]::IsNullOrWhiteSpace($dirty)) `
  "uncommitted work cannot be live:`n$dirty"

# --- pages -------------------------------------------------------------------
$pages = @('/index.html', '/join.html', '/onboarding.html', '/home.html', '/admin.html', '/404.html')

''
'=== pages ==='
$documents = @{}
foreach ($p in $pages) {
  $r = Fetch $p
  Check "$p responds" ($null -ne $r -and $r.StatusCode -eq 200) 'no 200'
  if ($r) { $documents[$p] = $r.Content }
}

''
'=== live assets match the local build, page by page ==='
foreach ($p in $pages) {
  if (-not $documents.ContainsKey($p)) { continue }
  $localPath = "dist$($p.Replace('/', '\'))"
  if (-not (Test-Path $localPath)) {
    Check "$p exists in the build" $false "no $localPath"
    continue
  }
  $liveRefs  = AssetRefs $documents[$p]
  $localRefs = AssetRefs (Get-Content $localPath -Raw)
  $same = (($liveRefs -join '|') -eq ($localRefs -join '|'))
  Check "$p serves the built assets" $same `
    "live:  $($liveRefs -join ' ')`n          local: $($localRefs -join ' ')"
}

''
'=== the policy reaches Supabase ==='
foreach ($p in $pages) {
  if (-not $documents.ContainsKey($p)) { continue }
  $html = $documents[$p]
  $hasCsp = $html -match 'Content-Security-Policy'
  Check "$p carries a policy" $hasCsp 'no meta tag'
  # 404.html needs no database, so it may omit the origins.
  if ($hasCsp -and $p -ne '/404.html') {
    Check "$p policy allows $expectedHost" ($html -match [regex]::Escape($expectedHost)) `
      'connect-src has no Supabase origin - the build ran without VITE_SUPABASE_URL'
  }
}

''
'=== the bundle was built with configuration ==='
$chunks = @()
foreach ($p in $pages) {
  if ($documents.ContainsKey($p)) {
    $chunks += AssetRefs $documents[$p] | Where-Object { $_ -like '*.js' }
  }
}
$chunks = $chunks | Sort-Object -Unique
Check 'pages reference scripts' ($chunks.Count -gt 0) 'none found'

$configured = $false
foreach ($c in $chunks) {
  $js = Fetch $c
  if ($js -and $js.Content -match [regex]::Escape($expectedHost)) { $configured = $true }
}
Check 'a shipped chunk contains the Supabase URL' $configured `
  'no chunk mentions the project - import.meta.env was empty at build time'

''
'=== kept out of search engines ==='
$robots = Fetch '/robots.txt'
Check 'robots.txt disallows everything' ($robots -and $robots.Content -match 'Disallow: /') 'missing or permissive'
foreach ($p in $pages) {
  if ($documents.ContainsKey($p)) {
    Check "$p is noindex" ($documents[$p] -match 'noindex') 'no robots meta tag'
  }
}

''
'=== transport ==='
try {
  $r = Invoke-WebRequest -Uri ($Origin -replace '^https:', 'http:') -UseBasicParsing -TimeoutSec 25
  Check 'plain http redirects to https' ("$($r.BaseResponse.ResponseUri)" -like 'https://*') `
    "ended at $($r.BaseResponse.ResponseUri)"
} catch {
  Check 'plain http redirects to https' $false $_.Exception.Message.Split([char]10)[0]
}

''
"=== $script:passed passed, $script:failed failed ==="
if ($script:failed -gt 0) { exit 1 }
