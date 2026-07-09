param(
  [string]$HostName = $env:VIBE_REMOTE_HOST,
  [int]$Port = $(if ($env:VIBE_REMOTE_PORT) { [int]$env:VIBE_REMOTE_PORT } else { 39271 }),
  [string]$Token = $env:VIBE_REMOTE_TOKEN,
  [int]$PollSeconds = 2,
  [int]$DecisionTimeoutSeconds = 60,
  [string]$LogPath = $env:VIBE_REMOTE_APPROVAL_BROKER_LOG,
  [switch]$Loop,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $HostName) {
  $HostName = "127.0.0.1"
}
if (-not $Token) {
  throw "VIBE_REMOTE_TOKEN is required. Pass -Token or set VIBE_REMOTE_TOKEN."
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Write-Log([string]$Message) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "[$ts] $Message"
  Write-Host $line
  if ($LogPath) {
    $directory = Split-Path -Parent $LogPath
    if ($directory) {
      New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    Add-Content -LiteralPath $LogPath -Value $line
  }
}

function New-UiCondition([object]$Property, [object]$Value) {
  New-Object System.Windows.Automation.PropertyCondition($Property, $Value)
}

function Get-VsCodeWindows {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windowCondition = New-UiCondition `
    ([System.Windows.Automation.AutomationElement]::ControlTypeProperty) `
    ([System.Windows.Automation.ControlType]::Window)
  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)
  foreach ($window in $windows) {
    try {
      $name = $window.Current.Name
      $className = $window.Current.ClassName
      if ($className -eq "Chrome_WidgetWin_1" -and $name -match "Visual Studio Code") {
        $window
      }
    } catch {
      # UIA elements can disappear while walking.
    }
  }
}

function Get-DescendantsByControlType(
  [System.Windows.Automation.AutomationElement]$Root,
  [System.Windows.Automation.ControlType]$ControlType
) {
  $condition = New-UiCondition `
    ([System.Windows.Automation.AutomationElement]::ControlTypeProperty) `
    $ControlType
  $Root.FindAll([System.Windows.Automation.TreeScope]::Subtree, $condition)
}

function Get-DocumentText([System.Windows.Automation.AutomationElement]$Window) {
  $documents = Get-DescendantsByControlType $Window ([System.Windows.Automation.ControlType]::Document)
  foreach ($document in $documents) {
    try {
      $textPattern = $document.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
      $text = $textPattern.DocumentRange.GetText(20000)
      if ($text) {
        return $text
      }
    } catch {
      # Not every document supports TextPattern reliably.
    }
  }
  ""
}

function Get-ButtonByNamePattern(
  [System.Windows.Automation.AutomationElement]$Window,
  [string]$Pattern
) {
  $buttons = Get-DescendantsByControlType $Window ([System.Windows.Automation.ControlType]::Button)
  foreach ($button in $buttons) {
    try {
      if ($button.Current.IsEnabled -and $button.Current.Name -match $Pattern) {
        return $button
      }
    } catch {
      # UIA elements can disappear while walking.
    }
  }
  $null
}

function Get-ApprovalCandidate {
  foreach ($window in Get-VsCodeWindows) {
    $allow = Get-ButtonByNamePattern $window "^Allow(\s|\(|$)"
    $skip = Get-ButtonByNamePattern $window "^(Skip|Proceed without executing this command)(\s|\(|$)"
    if (-not $allow -or -not $skip) {
      continue
    }

    $text = Get-DocumentText $window
    if ($text -notmatch "Run bash command\?") {
      continue
    }

    $summary = Get-CommandSummary $text
    return [pscustomobject]@{
      Window = $window
      Allow = $allow
      Skip = $skip
      WindowName = $window.Current.Name
      Summary = $summary
    }
  }
  $null
}

function Get-CommandSummary([string]$Text) {
  $lines = @(
    $Text -replace "\r", "`n" -split "`n" |
      ForEach-Object { ($_ -replace "\s+", " ").Trim().Trim('"', "'") } |
      Where-Object { $_ }
  )

  for ($index = $lines.Count - 1; $index -ge 0; --$index) {
    $line = $lines[$index]
    if ($line -match "^Running\s+" -and $line -match "/tmp/|mkdir|printf|ls|npm|python|node|bash|sh") {
      $summary = $line -replace "^Running\s+", ""
      if ($summary.Length -gt 160) {
        $summary = $summary.Substring(0, 157) + "..."
      }
      return $summary
    }
  }

  $marker = "Run bash command?"
  $index = $Text.LastIndexOf($marker, [StringComparison]::OrdinalIgnoreCase)
  if ($index -lt 0) {
    return "bash approval"
  }
  $tail = $Text.Substring($index + $marker.Length) -replace "\r", "`n"
  $tailLines = @(
    $tail -split "`n" |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ -and $_ -notmatch "^(Allow|Skip|Creates|Run|Ran|The editor is not accessible)" }
  )
  if ($tailLines.Count -eq 0) {
    return "bash approval"
  }
  $summary = $tailLines[0]
  if ($summary -match "editor is not accessible|UIA broker|Run bash command|そのまま残して|DryRun|Vibe Remote") {
    return "bash command approval"
  }
  if ($summary.Length -gt 160) {
    $summary = $summary.Substring(0, 157) + "..."
  }
  $summary
}

function Invoke-UiButton([System.Windows.Automation.AutomationElement]$Button) {
  $invoke = $Button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invoke.Invoke()
}

function New-WebSocket {
  $ws = [System.Net.WebSockets.ClientWebSocket]::new()
  $uri = [Uri]::new("ws://${HostName}:${Port}")
  [void]$ws.ConnectAsync($uri, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
  $ws
}

function Send-WsJson(
  [System.Net.WebSockets.ClientWebSocket]$Ws,
  [hashtable]$Payload
) {
  try {
    $json = $Payload | ConvertTo-Json -Depth 8 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $segment = [ArraySegment[byte]]::new($bytes)
    [void]$Ws.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    return $true
  } catch [System.Net.WebSockets.WebSocketException] {
    return $false
  } catch [InvalidOperationException] {
    return $false
  }
}

function Receive-WsJson(
  [System.Net.WebSockets.ClientWebSocket]$Ws,
  [int]$TimeoutMilliseconds
) {
  $buffer = New-Object byte[] 65536
  $segment = [ArraySegment[byte]]::new($buffer)
  $cts = [Threading.CancellationTokenSource]::new($TimeoutMilliseconds)
  try {
    $result = $Ws.ReceiveAsync($segment, $cts.Token).GetAwaiter().GetResult()
    if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
      return $null
    }
    $text = [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
    $text | ConvertFrom-Json
  } catch [OperationCanceledException] {
    $null
  } catch [System.Net.WebSockets.WebSocketException] {
    $null
  } catch [InvalidOperationException] {
    $null
  } finally {
    $cts.Dispose()
  }
}

function Wait-VibeAction(
  [string]$UiId,
  [int]$TimeoutSeconds
) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $ws = New-WebSocket
  Send-WsJson $ws @{ type = "hello"; token = $Token } | Out-Null
  while ((Get-Date) -lt $deadline) {
    $sent = Send-WsJson $ws @{
      type = "getUiAction"
      token = $Token
      uiId = $UiId
      consume = $true
    }
    if (-not $sent) {
      try { $ws.Dispose() } catch {}
      Start-Sleep -Milliseconds 300
      $ws = New-WebSocket
      Send-WsJson $ws @{ type = "hello"; token = $Token } | Out-Null
      continue
    }
    $until = (Get-Date).AddSeconds(1)
    while ((Get-Date) -lt $until) {
      $msg = Receive-WsJson $ws 500
      if ($null -eq $msg) {
        continue
      }
      $hasAction = $msg.PSObject.Properties.Name -contains "action"
      if ($msg.type -eq "uiActionResult" -and $hasAction -and $null -ne $msg.action) {
        $hasActionId = $msg.action.PSObject.Properties.Name -contains "actionId"
        if ($hasActionId) {
          return $msg.action.actionId
        }
      }
    }
  }
  try { $ws.Dispose() } catch {}
  "timeout"
}

function Show-ApprovalOnVibe(
  [System.Net.WebSockets.ClientWebSocket]$Ws,
  [object]$Candidate
) {
  $uiId = "vscode-approval-" + [Guid]::NewGuid().ToString("N").Substring(0, 8)
  Send-WsJson $Ws @{
    type = "agentStatus"
    token = $Token
    status = "waiting"
    source = "approval-broker"
    message = "VS Code approval"
    ttlMs = ($DecisionTimeoutSeconds * 1000)
  } | Out-Null
  Send-WsJson $Ws @{
    type = "deviceUi"
    token = $Token
    ui = @{
      id = $uiId
      title = "VS Code Approval"
      state = "waiting"
      mode = "menu"
      message = "Run bash command?"
      fields = @(
        @{ label = "cmd"; value = $Candidate.Summary }
      )
      actions = @(
        @{ id = "allow"; label = "Allow" },
        @{ id = "skip"; label = "Skip" },
        @{ id = "cancel"; label = "Cancel" }
      )
      source = "approval-broker"
      ttlMs = ($DecisionTimeoutSeconds * 1000)
    }
  } | Out-Null
  $uiId
}

function Clear-VibeUi(
  [System.Net.WebSockets.ClientWebSocket]$Ws,
  [string]$UiId
) {
  try {
    Send-WsJson $Ws @{
      type = "clearDeviceUi"
      token = $Token
      uiId = $UiId
    } | Out-Null
  } catch {
    Write-Log "clear Vibe UI skipped: $($_.Exception.Message)"
  }
}

function Handle-Candidate([object]$Candidate) {
  Write-Log "approval detected: $($Candidate.Summary)"
  $ws = $null
  try {
    $ws = New-WebSocket
    Send-WsJson $ws @{ type = "hello"; token = $Token } | Out-Null
    $uiId = Show-ApprovalOnVibe $ws $Candidate
    Write-Log "waiting for Vibe Remote action: $uiId"
    $action = Wait-VibeAction $uiId $DecisionTimeoutSeconds
    Write-Log "action: $action"
    Clear-VibeUi $ws $uiId

    if ($DryRun) {
      Write-Log "dry-run: not pressing VS Code approval button"
      return
    }

    if ($action -eq "allow") {
      $fresh = Get-ApprovalCandidate
      if ($null -eq $fresh) {
        Write-Log "approval disappeared before Allow"
        return
      }
      Invoke-UiButton $fresh.Allow
      Write-Log "pressed Allow"
      return
    }

    if ($action -eq "skip") {
      $fresh = Get-ApprovalCandidate
      if ($null -eq $fresh) {
        Write-Log "approval disappeared before Skip"
        return
      }
      Invoke-UiButton $fresh.Skip
      Write-Log "pressed Skip"
      return
    }

    Write-Log "no VS Code button pressed"
  } finally {
    if ($null -ne $ws) {
      $ws.Dispose()
    }
  }
}

Write-Log "VS Code approval broker started host=$HostName port=$Port loop=$($Loop.IsPresent) dryRun=$($DryRun.IsPresent)"

do {
  $candidate = Get-ApprovalCandidate
  if ($candidate) {
    Handle-Candidate $candidate
    if (-not $Loop) {
      exit 0
    }
    Start-Sleep -Seconds $PollSeconds
    continue
  }

  if (-not $Loop) {
    Write-Log "no pending VS Code bash approval found"
    exit 2
  }
  Start-Sleep -Seconds $PollSeconds
} while ($true)
