param(
  [string]$RunnerRoot = "D:\apps\meister-platform\.job-feed-local-runner",
  [string]$RemoteUrl = "https://github.com/neojoin1-cyber/neojoin1-cyber-homepage.git",
  [string]$OllamaModel = "qwen3:4b-instruct"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$logRoot = Join-Path $RunnerRoot "logs"
$runRoot = Join-Path $RunnerRoot "runs"
$statusPath = Join-Path $RunnerRoot "status.json"
$lockPath = Join-Path $RunnerRoot "runner.lock"
$runId = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $runRoot "$runId-$PID"
$logPath = Join-Path $logRoot "$runId.log"

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null

function Write-RunnerLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  $line | Tee-Object -FilePath $logPath -Append
}

function Invoke-Checked {
  param(
    [string]$Command,
    [string[]]$Arguments
  )
  Write-RunnerLog ("RUN {0} {1}" -f $Command, ($Arguments -join " "))
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Command @Arguments 2>&1 | Tee-Object -FilePath $logPath -Append
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  if ($exitCode -ne 0) {
    throw "$Command failed with exit code $exitCode"
  }
}

function Write-RunnerStatus {
  param(
    [string]$State,
    [string]$Message,
    [hashtable]$Extra = @{}
  )
  $payload = [ordered]@{
    version = 1
    state = $State
    checkedAt = (Get-Date).ToString("o")
    runId = $runId
    message = $Message
    logPath = $logPath
  }
  foreach ($key in $Extra.Keys) { $payload[$key] = $Extra[$key] }
  $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $statusPath -Encoding UTF8
}

$lockStream = $null
try {
  $lockStream = [System.IO.File]::Open($lockPath, "OpenOrCreate", "ReadWrite", "None")
} catch {
  Write-RunnerLog "Another local job-feed run is active. This trigger is skipped."
  exit 0
}

try {
  Write-RunnerStatus -State "running" -Message "Local Ollama job-feed collection started."
  $tags = Invoke-RestMethod -UseBasicParsing -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 10
  $availableModels = @($tags.models | ForEach-Object { $_.name })
  if ($availableModels -notcontains $OllamaModel) {
    throw "Required Ollama model is unavailable: $OllamaModel"
  }
  Write-RunnerLog "Ollama ready: $OllamaModel"

  Invoke-Checked -Command "git" -Arguments @("clone", "--depth", "1", "--branch", "main", $RemoteUrl, $runDir)
  Push-Location $runDir
  try {
    $env:OLLAMA_ENABLED = "1"
    $env:OLLAMA_REQUIRED = "1"
    $env:OLLAMA_MODEL = $OllamaModel
    $env:OLLAMA_BASE_URL = "http://127.0.0.1:11434"
    $env:OLLAMA_BATCH_SIZE = "1"
    $env:OLLAMA_MAX_ITEMS = "6"
    $env:OLLAMA_TIMEOUT_MS = "120000"

    Invoke-Checked -Command "node" -Arguments @("--check", "tools\fetch_vocational_jobs.mjs")
    Invoke-Checked -Command "node" -Arguments @("tools\fetch_vocational_jobs.mjs")
    Invoke-Checked -Command "node" -Arguments @("tools\verify_platform_reliability.mjs")

    $feedSummaryJson = & node -e "const fs=require('fs');const f=JSON.parse(fs.readFileSync('assets/job-feed.json','utf8'));process.stdout.write(JSON.stringify({generatedAt:f.generatedAt,defaultItems:(f.items||[]).length,supplementalItems:(f.supplementalItems||[]).length,aiEngine:f.aiBriefing?.engine||'',ollamaAttempted:Number(f.aiBriefing?.attempted||0),ollamaSucceeded:Number(f.aiBriefing?.succeeded||0)}));"
    if ($LASTEXITCODE -ne 0) { throw "Unable to read generated job-feed summary." }
    $feedSummary = $feedSummaryJson | ConvertFrom-Json
    $ollamaAttempted = [int]$feedSummary.ollamaAttempted
    $ollamaSucceeded = [int]$feedSummary.ollamaSucceeded
    $ollamaMinimumSuccess = [Math]::Max(1, [Math]::Ceiling($ollamaAttempted / 2))
    if ($feedSummary.aiEngine -ne "ollama" -or $ollamaSucceeded -lt $ollamaMinimumSuccess) {
      throw "Ollama briefing gate failed."
    }

    Invoke-Checked -Command "git" -Arguments @("add", "assets/job-feed.json", "assets/job-detail-vault.json", "assets/job-feed-health.json")
    if (Test-Path -LiteralPath "assets\job-attachment-files") {
      Invoke-Checked -Command "git" -Arguments @("add", "assets/job-attachment-files")
    }

    $pending = (& git status --porcelain -- assets/job-feed.json assets/job-detail-vault.json assets/job-feed-health.json assets/job-attachment-files 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "git status failed with exit code $LASTEXITCODE" }

    if ($pending.Trim()) {
      Invoke-Checked -Command "git" -Arguments @("config", "user.name", "gyo6-local-job-feed")
      Invoke-Checked -Command "git" -Arguments @("config", "user.email", "admin@gyo6.kr")
      Invoke-Checked -Command "git" -Arguments @("commit", "-m", "Update vocational job feed (local Ollama)")
      $pushed = $false
      for ($attempt = 1; $attempt -le 3; $attempt++) {
        $previousErrorAction = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
          & git push origin HEAD:main 2>&1 | Tee-Object -FilePath $logPath -Append
          $pushExitCode = $LASTEXITCODE
        } finally {
          $ErrorActionPreference = $previousErrorAction
        }
        if ($pushExitCode -eq 0) { $pushed = $true; break }
        Write-RunnerLog "Push retry $attempt/3 after rebase."
        Invoke-Checked -Command "git" -Arguments @("fetch", "origin", "main")
        Invoke-Checked -Command "git" -Arguments @("rebase", "origin/main")
      }
      if (-not $pushed) { throw "Unable to publish local job feed after 3 attempts." }
    } else {
      Write-RunnerLog "No feed changes to publish."
    }

    $commit = (& git rev-parse HEAD).Trim()
    Write-RunnerStatus -State "success" -Message "Local Ollama job feed published." -Extra @{
      commit = $commit
      generatedAt = $feedSummary.generatedAt
      defaultItems = [int]$feedSummary.defaultItems
      supplementalItems = [int]$feedSummary.supplementalItems
      ollamaSucceeded = $ollamaSucceeded
    }
    Write-RunnerLog "SUCCESS commit=$commit default=$($feedSummary.defaultItems) supplemental=$($feedSummary.supplementalItems)"
  } finally {
    Pop-Location
  }
} catch {
  Write-RunnerStatus -State "failed" -Message $_.Exception.Message -Extra @{ runDirectory = $runDir }
  Write-RunnerLog "FAILED $($_.Exception.Message)"
  exit 1
} finally {
  if ($lockStream) { $lockStream.Dispose() }
}
