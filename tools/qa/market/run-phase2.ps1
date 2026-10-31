<#
.SYNOPSIS
  SHADOW 市场 Phase 2 P0 全量 QA（串行）：起独立端口静态服务 → 数据契约 → 静态审计 → E2E → Lighthouse → 证据归档。

.DESCRIPTION
  约束：
    - 浏览器套件串行；服务用独立端口（默认 18921，冲突时自动 +1 找空闲），**绝不使用/杀用户 18765/8765/18920 进程**；
    - 只结束本脚本自己启动的 serve.mjs 进程（taskkill /PID <pid> /T /F）；
    - 每个步骤的退出码如实记录；任一硬失败时最终退出码非 0（不伪造 PASS）。
  顺序：
    1) data-contract-check（纯文件）
    2) static-audit（纯文件；含部署配置检查）
    3) market-e2e（--base-url 复用本脚本启动的服务；浏览器串行）
    4) lighthouse-run（不可用则如实标 UNAVAILABLE）
    5) collect-evidence（报告/截图/SHA256 → release/evidence-market/）
  日志：release/evidence-market/phase2-run.log（Start-Transcript）

.PARAMETER Port
  静态服务起始端口（默认 18921；被占用时向后找空闲端口，上限 18999）。

.PARAMETER SkipE2E
  跳过浏览器 E2E（只跑数据/静态审计）。

.PARAMETER SkipLighthouse
  跳过 Lighthouse。

.PARAMETER SkipEvidence
  跳过证据归档。

.PARAMETER EvidenceNote
  可选：写入 release/evidence-market/phase2-summary.md 的本轮备注（例如「pwa.js 首访自动刷新修复后重跑」）。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\tools\qa\market\run-phase2.ps1 -Port 18921
#>
[CmdletBinding()]
param(
  [int]$Port = 18921,
  [switch]$SkipE2E,
  [switch]$SkipLighthouse,
  [switch]$SkipEvidence,
  [string]$EvidenceNote = ''
)

$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}
$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
Set-Location $repoRoot
$nodeExe = if (Test-Path -LiteralPath 'D:\NODE\node.exe') { 'D:\NODE\node.exe' } else { (Get-Command node).Source }
$evidenceDir = Join-Path $repoRoot 'release\evidence-market'
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
$logFile = Join-Path $evidenceDir 'phase2-run.log'
try { Start-Transcript -LiteralPath $logFile -Force | Out-Null } catch { }

function Test-PortFree([int]$p) {
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p)
    $listener.Start(); $listener.Stop(); return $true
  } catch { return $false }
}
$port = $Port
$tries = 0
while (-not (Test-PortFree $port)) {
  $port++; $tries++
  if ($tries -gt 60 -or $port -gt 18999) { throw "找不到空闲端口（从 $Port 起）" }
}

$baseUrl = "http://127.0.0.1:$port"
$serveLog = Join-Path $env:TEMP "shadow-market-phase2-serve-$port.log"
$serveProc = $null
$results = [ordered]@{}

function Invoke-Step([string]$name, [scriptblock]$body) {
  Write-Host ''
  Write-Host "===== [$name] =====" -ForegroundColor Yellow
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $code = 0
  $global:LASTEXITCODE = 0
  try { & $body } catch { Write-Warning "[$name] 异常：$($_.Exception.Message)"; $code = 2 }
  if ($code -eq 0 -and $LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) { $code = [int]$LASTEXITCODE }
  $sw.Stop()
  $results[$name] = [ordered]@{ exitCode = $code; seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1) }
  Write-Host "[$name] exit=$code elapsed=$([math]::Round($sw.Elapsed.TotalSeconds,1))s" -ForegroundColor $(if ($code -eq 0) { 'Green' } else { 'Red' })
}

try {
  # ---------- 0. 启动静态服务（独立端口） ----------
  Write-Host "[serve] node market/serve.mjs --port $port --host 127.0.0.1" -ForegroundColor Cyan
  $serveProc = Start-Process -FilePath $nodeExe -ArgumentList @('market/serve.mjs', '--port', "$port", '--host', '127.0.0.1') `
    -WorkingDirectory $repoRoot -NoNewWindow -PassThru -RedirectStandardOutput $serveLog -RedirectStandardError "$serveLog.err"
  $up = $false
  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 250
    try {
      $r = Invoke-WebRequest -Uri "$baseUrl/index.html" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) { $up = $true; break }
    } catch { }
    if ($serveProc.HasExited) { break }
  }
  if (-not $up) {
    $logTail = if (Test-Path $serveLog) { (Get-Content $serveLog -Tail 20) -join "`n" } else { '(no log)' }
    throw "静态服务未就绪：$baseUrl（pid=$($serveProc.Id)）`n--- serve log ---`n$logTail"
  }
  Write-Host "[serve] up: $baseUrl (pid=$($serveProc.Id))" -ForegroundColor Green

  # ---------- 1/2. 纯文件校验 ----------
  Invoke-Step 'data-contract' { & $nodeExe 'tools/qa/market/data-contract-check.mjs' }
  Invoke-Step 'static-audit' { & $nodeExe 'tools/qa/market/static-audit.mjs' }

  # ---------- 3. E2E ----------
  if (-not $SkipE2E) {
    Invoke-Step 'market-e2e' { & $nodeExe 'tools/qa/market/market-e2e.mjs' "--base-url=$baseUrl" }
  } else { Write-Host '[market-e2e] skipped' -ForegroundColor Yellow }

  # ---------- 4. Lighthouse（主 URL + 首个课程详情页，各一次 mobile 运行；固定优先本机 .tmp/lh 12.6.1） ----------
  if (-not $SkipLighthouse) {
    $detailHash = ''
    try {
      $detailHash = (& $nodeExe -e "try{const r=require('./market/catalog/resources.json').items.find(x=>x.type==='course');process.stdout.write(r?('#/resource/'+r.id):'')}catch(e){process.stdout.write('')}").Trim()
    } catch { $detailHash = '' }
    $lhArgs = @('-ExecutionPolicy', 'Bypass', '-File', (Join-Path $repoRoot 'tools/qa/market/lighthouse-run.ps1'), '-Url', "$baseUrl/")
    $lhCli = Join-Path $repoRoot '.tmp/lh/node_modules/lighthouse/cli/index.js'
    if (Test-Path -LiteralPath $lhCli) { $lhArgs += @('-LighthouseCli', $lhCli) }
    if ($detailHash) { $lhArgs += @('-Url2', "$baseUrl/$detailHash") }
    Invoke-Step 'lighthouse' { & powershell @lhArgs }
  } else { Write-Host '[lighthouse] skipped' -ForegroundColor Yellow }

  # ---------- 5. 证据归档 ----------
  if (-not $SkipEvidence) {
    $ceArgs = @()
    if ($EvidenceNote) { $ceArgs += "--note=$EvidenceNote" }
    Invoke-Step 'collect-evidence' { & $nodeExe 'tools/qa/market/collect-evidence.mjs' @ceArgs }
  } else { Write-Host '[collect-evidence] skipped' -ForegroundColor Yellow }
} finally {
  if ($serveProc -and -not $serveProc.HasExited) {
    Write-Host "[serve] stopping pid=$($serveProc.Id)（只结束本脚本启动的进程）" -ForegroundColor Cyan
    try { taskkill /PID $serveProc.Id /T /F | Out-Null } catch { }
  }
  Write-Host ''
  Write-Host '===== Phase 2 QA 汇总 =====' -ForegroundColor Yellow
  foreach ($k in $results.Keys) {
    $v = $results[$k]
    $color = if ($v.exitCode -eq 0) { 'Green' } else { 'Red' }
    Write-Host ("  {0,-16} exit={1,-3} {2,7}s" -f $k, $v.exitCode, $v.seconds) -ForegroundColor $color
  }
  Write-Host "证据目录：$evidenceDir" -ForegroundColor Cyan
  Write-Host "运行日志：$logFile" -ForegroundColor Cyan
  try { Stop-Transcript | Out-Null } catch { }
}
$failed = @($results.Keys | Where-Object { $results[$_].exitCode -ne 0 })
if ($failed.Count -gt 0) {
  Write-Warning "存在失败步骤：$($failed -join ', ')（详见报告与证据目录，不伪造通过）"
  exit 1
}
exit 0
