param(
  [string]$TaskName = "GYO6-Job-Feed",
  [string]$RunnerRoot = "D:\apps\meister-platform\.job-feed-local-runner"
)

$ErrorActionPreference = "Stop"
$sourceRunner = Join-Path $PSScriptRoot "run_local_job_feed.ps1"
$binRoot = Join-Path $RunnerRoot "bin"
$installedRunner = Join-Path $binRoot "run_local_job_feed.ps1"

if (-not (Test-Path -LiteralPath $sourceRunner)) {
  throw "Local job-feed runner not found: $sourceRunner"
}

New-Item -ItemType Directory -Path $binRoot -Force | Out-Null
Copy-Item -LiteralPath $sourceRunner -Destination $installedRunner -Force

$powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$installedRunner`" -RunnerRoot `"$RunnerRoot`""
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $RunnerRoot
$triggers = @(
  New-ScheduledTaskTrigger -Daily -At "09:10"
  New-ScheduledTaskTrigger -Daily -At "14:10"
  New-ScheduledTaskTrigger -Daily -At "23:10"
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 45)
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description "GYO6 official-source vocational job feed collection at 09:10, 14:10, and 23:10 KST."

foreach ($legacyTaskName in @("GYO6-Local-Ollama-Job-Feed")) {
  if ($legacyTaskName -ne $TaskName -and (Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue)) {
    Unregister-ScheduledTask -TaskName $legacyTaskName -Confirm:$false
  }
}

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName,State,@{N="Triggers";E={$_.Triggers.StartBoundary -join " | "}}
