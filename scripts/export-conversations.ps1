# Downloads ElevenLabs conversations to this machine.
#
#     .\scripts\export-conversations.ps1
#     .\scripts\export-conversations.ps1 -NoAudio
#
# Writes to recordings/, which is gitignored. Read that twice: this script
# saves real children's voices and the words they said during a fight. The
# repository is public, so nothing from recordings/ may ever be committed, and
# the ignore rule was added before the folder existed.
#
# Why it exists: the agents keep conversations for seven days, which is the
# right policy and also means anything worth keeping has to be taken off
# ElevenLabs deliberately. Having it on the owner's own machine is better than
# having a vendor hold it indefinitely.
#
# Each conversation becomes a folder holding the raw API response, a transcript
# that can be read without tooling, and the audio if any was recorded.

param(
  [switch]$NoAudio,
  [string]$OutDir = 'recordings'
)

Set-Location (Join-Path $PSScriptRoot '..')
. .\scripts\load-env.ps1 | Out-Null

if ([string]::IsNullOrWhiteSpace($env:ELEVENLABS_API_KEY)) {
  Write-Warning 'ELEVENLABS_API_KEY is not set in .env.'
  exit 1
}

$headers = @{ 'xi-api-key' = $env:ELEVENLABS_API_KEY }

$agents = @(
  @{ label = 'pip-english'; id = $env:ELEVENLABS_AGENT_ID_EN },
  @{ label = 'pip-hebrew';  id = $env:ELEVENLABS_AGENT_ID_HE }
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_.id) }

$saved = 0
$skipped = 0

foreach ($agent in $agents) {
  "=== $($agent.label) ==="

  $list = Invoke-RestMethod -Headers $headers -TimeoutSec 60 `
    -Uri "https://api.elevenlabs.io/v1/convai/conversations?agent_id=$($agent.id)&page_size=100"

  if (-not $list.conversations -or $list.conversations.Count -eq 0) {
    '  nothing stored'
    continue
  }

  foreach ($summary in $list.conversations) {
    $id = $summary.conversation_id
    $when = [DateTimeOffset]::FromUnixTimeSeconds($summary.start_time_unix_secs).ToLocalTime()
    $folder = Join-Path $OutDir (Join-Path $agent.label ("{0:yyyy-MM-dd_HHmm}_{1}" -f $when, $id))

    if (Test-Path (Join-Path $folder 'conversation.json')) {
      "  already have $id"
      $skipped++
      continue
    }

    New-Item -ItemType Directory -Force -Path $folder | Out-Null

    $detail = Invoke-RestMethod -Headers $headers -TimeoutSec 60 `
      -Uri "https://api.elevenlabs.io/v1/convai/conversations/$id"

    # The raw response, so nothing is lost to the formatting below.
    ($detail | ConvertTo-Json -Depth 20) |
      Set-Content -Path (Join-Path $folder 'conversation.json') -Encoding utf8

    # A transcript a person can read.
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add("Conversation $id")
    $lines.Add("Agent      : $($agent.label)")
    $lines.Add("Started    : $($when.ToString('yyyy-MM-dd HH:mm:ss'))")
    $lines.Add("Duration   : $($detail.metadata.call_duration_secs) seconds")
    $lines.Add("Audio saved: $($detail.has_audio)")
    $lines.Add('')
    $lines.Add(('-' * 60))
    $lines.Add('')

    foreach ($turn in $detail.transcript) {
      $who = if ($turn.role -eq 'agent') { 'Pip ' } else { 'Them' }
      $at = if ($null -ne $turn.time_in_call_secs) {
        '[{0:mm\:ss}] ' -f [TimeSpan]::FromSeconds($turn.time_in_call_secs)
      } else { '' }
      $text = if ($turn.message) { $turn.message } else { '(no words - tool call or silence)' }
      $lines.Add("$at$who  $text")
    }

    # UTF-8 with no BOM: PowerShell's -Encoding utf8 writes one, and a BOM in a
    # text file is a nuisance everywhere downstream.
    [System.IO.File]::WriteAllLines(
      (Join-Path $folder 'transcript.txt'),
      $lines,
      (New-Object System.Text.UTF8Encoding $false)
    )

    $note = "$id  $($detail.metadata.call_duration_secs)s  $(($detail.transcript | Measure-Object).Count) turns"

    if (-not $NoAudio -and $detail.has_audio) {
      try {
        Invoke-WebRequest -Headers $headers -TimeoutSec 180 `
          -Uri "https://api.elevenlabs.io/v1/convai/conversations/$id/audio" `
          -OutFile (Join-Path $folder 'audio.mp3')
        $size = [math]::Round((Get-Item (Join-Path $folder 'audio.mp3')).Length / 1KB)
        $note += "  audio ${size}KB"
      } catch {
        $note += '  AUDIO FAILED'
      }
    }

    "  saved $note"
    $saved++
  }
}

''
"$saved saved, $skipped already present. In $((Resolve-Path $OutDir).Path)"
'This folder is gitignored and must stay that way.'
