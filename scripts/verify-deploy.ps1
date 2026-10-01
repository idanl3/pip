# Checks that what is live actually works.
#
#     .\scripts\verify-deploy.ps1
#
# This exists because of a specific mistake. GitHub Actions has no .env file,
# so the first deploy of the real pages went out with no Supabase
# configuration at all: the content security policy lost its connect-src
# origins and import.meta.env arrived undefined in the browser. Every page
# returned a cheerful HTTP 200 and none of them could reach the database. The
# deploy was green, the pages loaded, and the site was dead.
#
# HTTP 200 is therefore not evidence of anything. Run this after a deploy,
# before asking anyone to test.

param(
  [string]$Origin = 'https://pip.linnewiel.com'
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

$pages = @('/index.html', '/join.html', '/onboarding.html', '/home.html', '/admin.html', '/404.html')

'=== pages ==='
$documents = @{}
foreach ($p in $pages) {
  $r = Fetch $p
  Check "$p responds" ($null -ne $r -and $r.StatusCode -eq 200) 'no 200'
  if ($r) { $documents[$p] = $r.Content }
}

''
'=== the policy reaches Supabase ==='
foreach ($p in $pages) {
  if (-not $documents.ContainsKey($p)) { continue }
  $html = $documents[$p]
  $hasCsp = $html -match 'Content-Security-Policy'
  Check "$p carries a policy" $hasCsp 'no meta tag'

  # 404.html needs no database, so it is allowed to omit the origins.
  if ($hasCsp -and $p -ne '/404.html') {
    Check "$p policy allows $expectedHost" ($html -match [regex]::Escape($expectedHost)) `
      'connect-src has no Supabase origin - the build ran without VITE_SUPABASE_URL'
  }
}

''
'=== the bundle was built with configuration ==='
# This is the check that would have caught the dead deploy.
$joinHtml = $documents['/join.html']
$chunks = @()
if ($joinHtml) {
  $chunks += [regex]::Matches($joinHtml, '(?:src|href)="(/assets/[^"]+\.js)"') | ForEach-Object { $_.Groups[1].Value }
}
$chunks = $chunks | Select-Object -Unique
Check 'join.html references at least one script' ($chunks.Count -gt 0) 'no script tags found'

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
'=== live matches the local build ==='
if (Test-Path dist\join.html) {
  $localJs = ([regex]::Match((Get-Content dist\join.html -Raw), 'src="(/assets/join-[^"]+\.js)"')).Groups[1].Value
  $liveJs  = ([regex]::Match($joinHtml, 'src="(/assets/join-[^"]+\.js)"')).Groups[1].Value
  Check 'deployed bundle matches the last local build' ($localJs -eq $liveJs) `
    "live $liveJs vs local $localJs - the deploy may be mid-flight or from a different commit"
} else {
  '  skipped - no local dist/ to compare against'
}

''
"=== $script:passed passed, $script:failed failed ==="
if ($script:failed -gt 0) { exit 1 }
