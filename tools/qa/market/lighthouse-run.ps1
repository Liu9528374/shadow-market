<#
.SYNOPSIS
  尝试运行 Lighthouse（移动端）并把真实分数/状态写入 release/evidence-market/lighthouse/。
  网络或浏览器二进制不可用时**如实标注 UNAVAILABLE**，绝不伪造分数（docs/111 §9/§10 风险 5）。

.DESCRIPTION
  做法：
    1) 检查目标 URL 可访问（需先启动 market/serve.mjs，独立端口 189xx；run-phase2.ps1 会自动起）；
    2) 依次探测 Lighthouse 可执行：
       a. 本仓库 .tmp/lh/node_modules/lighthouse/cli/index.js（Lead/本机预装，node 直接执行）
       b. tools/qa/node_modules / node_modules 本地安装
       c. `npx --no-install lighthouse --version`（不联网）
       d. `npx --yes lighthouse --version`（允许联网安装，带超时）
    3) 可用则用 Edge headless 跑默认 mobile preset；主 URL + 可选 -Url2（如详情页）各跑一次，
       输出 JSON+HTML，解析 4 项分数写入 lighthouse-status.json；
    4) 不可用则写 lighthouse-status.json（status="unavailable" + 原因）与 UNAVAILABLE.md，退出码 0（不阻断 QA）。

.PARAMETER Url
  主目标 URL（默认 http://127.0.0.1:18921/）。

.PARAMETER Url2
  可选：第二个目标 URL（例如资源详情页），会作为第二次独立运行记录到 runs[]。

.PARAMETER OutDir
  输出目录（相对仓库根，默认 release/evidence-market/lighthouse）。

.PARAMETER TimeoutSec
  单次 Lighthouse 最长运行秒数（默认 240；超时如实记录）。

.PARAMETER LighthouseCli
  可选：强制指定 lighthouse CLI 的入口（默认自动探测 .tmp/lh → 本地安装 → npx）。
  例如 `-LighthouseCli D:\SHADOW-MARKET\.tmp\lh\node_modules\lighthouse\cli\index.js`。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\tools\qa\market\lighthouse-run.ps1 -Url http://127.0.0.1:18921/ -Url2 "http://127.0.0.1:18921/#/resource/com.shadow.course.cafe-order"
#>
[CmdletBinding()]
param(
  [string]$Url = 'http://127.0.0.1:18921/',
  [string]$Url2 = '',
  [string]$OutDir = 'release/evidence-market/lighthouse',
  [int]$TimeoutSec = 240,
  [string]$LighthouseCli = '',
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}
$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$outPath = if ([System.IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $repoRoot $OutDir }
New-Item -ItemType Directory -Path $outPath -Force | Out-Null
$statusFile = Join-Path $outPath 'lighthouse-status.json'
function Write-Utf8NoBom([string]$path, [string]$text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}
$status = [ordered]@{
  tool = 'lighthouse'
  status = 'unavailable'
  reason = $null
  url = $Url
  checkedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  mode = 'mobile (Lighthouse 默认 preset)'
  scores = $null
  thresholds = @{ performance = 0.9; accessibility = 0.9 }
  pass = $false
  runs = @()
}
function Write-StatusFile() {
  Write-Utf8NoBom $statusFile (($status | ConvertTo-Json -Depth 8) + "`n")
}
function Mark-Unavailable([string]$reason) {
  $status.status = 'unavailable'
  $status.reason = $reason
  Write-StatusFile
  $md = @(
    '# Lighthouse：UNAVAILABLE（未取得分数，不伪造）',
    '',
    "- 时间：$($status.checkedAt)",
    "- URL：$Url",
    "- 原因：$reason",
    '',
    '处理建议：',
    '1) 预装 lighthouse 到 `D:\SHADOW-MARKET\.tmp\lh`（npm install --prefix .tmp/lh lighthouse）；或',
    '2) 确认网络/npm 代理后执行 `npx --yes lighthouse --version` 预装；或',
    '3) 用 Edge DevTools → Lighthouse 面板手动跑一次，导出 JSON 到本目录；',
    '4) 重跑 `tools/qa/market/lighthouse-run.ps1`。',
    '',
    '> 依据 docs/111 §10 风险 5：Lighthouse 工具获取受网络限制时如实标注，不写入虚构分数。'
  ) -join "`n"
  Write-Utf8NoBom (Join-Path $outPath 'UNAVAILABLE.md') $md
  Write-Warning "[lighthouse] UNAVAILABLE: $reason（已如实写入 $statusFile）"
}

# ---------- 0) 目标可访问（-CheckOnly 时只测工具探测，不要求站点已启动） ----------
$probe = $null
if (-not $CheckOnly) {
  try {
    $probe = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
    if ($probe.StatusCode -ne 200) { throw "HTTP $($probe.StatusCode)" }
    Write-Host "[lighthouse] 目标可访问：$Url（HTTP 200）"
  } catch {
    Mark-Unavailable "目标站点不可访问（$Url）：$($_.Exception.Message)。请先启动 node market/serve.mjs --port 189xx。"
    exit 0
  }
}

# ---------- 1) 探测 Lighthouse 可执行 ----------
$nodeExe = if (Test-Path -LiteralPath 'D:\NODE\node.exe') { 'D:\NODE\node.exe' } else { (Get-Command node).Source }
$nodeDir = Split-Path -Parent $nodeExe
$npxExe = $null
foreach ($cand in @((Join-Path $nodeDir 'npx.cmd'), (Join-Path $nodeDir 'npx.exe'), (Join-Path $nodeDir 'npx.ps1'))) {
  if (Test-Path -LiteralPath $cand) { $npxExe = $cand; break }
}
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path -LiteralPath $edge)) { $edge = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe' }
$env:CHROME_PATH = $edge   # Lighthouse 官方支持的浏览器路径环境变量（与 --chrome-path 双保险）

function Invoke-CmdWithTimeout([string]$exe, [string[]]$cmdArgs, [int]$timeoutSec, [string]$logBase) {
  $argString = ($cmdArgs | ForEach-Object { if ($_ -match '\s') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
  # 用 .NET Process（UseShellExecute=false）保证 ExitCode 可靠、异步读流避免管道死锁
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = $argString
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $psi.WorkingDirectory = (Get-Location).Path
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  $timedOut = $false
  try {
    $null = $p.Start()
    $outTask = $p.StandardOutput.ReadToEndAsync()
    $errTask = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($timeoutSec * 1000)) {
      $timedOut = $true
      try { $p.Kill($true) } catch { }
      try { $p.WaitForExit(5000) | Out-Null } catch { }
    }
    $stdout = ''
    $stderr = ''
    try { $stdout = $outTask.GetAwaiter().GetResult() } catch { }
    try { $stderr = $errTask.GetAwaiter().GetResult() } catch { }
    $code = if ($timedOut) { -1 } else { $p.ExitCode }
  } catch {
    $stdout = ''
    $stderr = String($_.Exception.Message)
    $code = -2
  } finally {
    try { $p.Dispose() } catch { }
  }
  try { Set-Content -LiteralPath "$logBase.out.log" -Value $stdout -Encoding utf8 } catch { }
  try { Set-Content -LiteralPath "$logBase.err.log" -Value $stderr -Encoding utf8 } catch { }
  return @{ exitCode = $code; timedOut = $timedOut; stdout = $stdout; stderr = $stderr }
}

$runs = @()
$detectLog = @()
$runner = $null   # @{ exe = ...; prefix = @(); note = ... }
# 0. 显式指定（-LighthouseCli，优先级最高；便于 Lead/CI 固定本机工具）
if ($LighthouseCli) {
  $forced = if ([System.IO.Path]::IsPathRooted($LighthouseCli)) { $LighthouseCli } else { Join-Path $repoRoot $LighthouseCli }
  if (Test-Path -LiteralPath $forced) {
    $v = Invoke-CmdWithTimeout $nodeExe @($forced, '--version') 60 (Join-Path $outPath '_detect_forced')
    $detectLog += "forced cli --version => exit=$($v.exitCode) stdout=$($v.stdout.Trim())"
    if ($v.exitCode -eq 0) { $runner = @{ exe = $nodeExe; prefix = @($forced); note = "forced cli $forced" } }
  } else { $detectLog += "forced cli 不存在: $forced" }
}
# a. 本仓库 .tmp/lh（Lead 预装；先验证 --version 可执行，避免半装状态误用）
$tmpCli = Join-Path $repoRoot '.tmp/lh/node_modules/lighthouse/cli/index.js'
if (-not $runner -and (Test-Path -LiteralPath $tmpCli)) {
  $v = Invoke-CmdWithTimeout $nodeExe @($tmpCli, '--version') 60 (Join-Path $outPath '_detect_tmp')
  $verText = ''
  try { $verText = (Get-Content -LiteralPath (Join-Path $outPath '_detect_tmp.out.log') -Raw -ErrorAction SilentlyContinue).Trim() } catch { }
  $detectLog += ".tmp/lh cli --version => exit=$($v.exitCode) timedOut=$($v.timedOut) version=$verText"
  if ($v.exitCode -eq 0) {
    $runner = @{ exe = $nodeExe; prefix = @($tmpCli); note = ".tmp/lh 预装 lighthouse $verText" }
    $status.lighthouseCli = $tmpCli
  }
}
# b. 常规本地安装
if (-not $runner) {
  $local = @(
    (Join-Path $repoRoot 'tools\qa\node_modules\lighthouse\cli\index.js'),
    (Join-Path $repoRoot 'tools\qa\node_modules\.bin\lighthouse.cmd'),
    (Join-Path $repoRoot 'node_modules\.bin\lighthouse.cmd')
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($local) {
    $detectLog += "found local: $local"
    if ($local -like '*.js') { $runner = @{ exe = $nodeExe; prefix = @($local); note = "local $local" } }
    else { $runner = @{ exe = $local; prefix = @(); note = "local $local" } }
  }
}
# c/d. npx（先不联网，再允许联网安装；带超时）
if (-not $runner -and $npxExe) {
  $detect = Invoke-CmdWithTimeout $npxExe @('--no-install', 'lighthouse', '--version') 40 (Join-Path $outPath '_detect')
  $detectLog += "npx --no-install => exit=$($detect.exitCode) timedOut=$($detect.timedOut)"
  if ($detect.exitCode -eq 0) {
    $runner = @{ exe = $npxExe; prefix = @('--no-install', 'lighthouse'); note = 'npx --no-install' }
  } else {
    Write-Host '[lighthouse] 本机无 lighthouse，尝试 npx --yes（允许联网安装，可能耗时 1–3 分钟）…' -ForegroundColor Yellow
    $detect2 = Invoke-CmdWithTimeout $npxExe @('--yes', 'lighthouse', '--version') 300 (Join-Path $outPath '_detect_install')
    $detectLog += "npx --yes => exit=$($detect2.exitCode) timedOut=$($detect2.timedOut)"
    if ($detect2.exitCode -eq 0) {
      $runner = @{ exe = $npxExe; prefix = @('--yes', 'lighthouse'); note = 'npx --yes（联网安装）' }
    }
  }
}

if (-not $runner) {
  Mark-Unavailable "本机未安装 lighthouse；npx --no-install 与 npx --yes 均不可用。探测：$($detectLog -join '; ')"
  exit 0
}
if (-not (Test-Path -LiteralPath $edge)) {
  Mark-Unavailable "未找到 Edge 浏览器可执行（$edge），Lighthouse 需要 Chromium 内核；请安装 Edge/Chrome 或改用 DevTools 手动导出。"
  exit 0
}
$status.runner = $runner.note
$status.detected = $detectLog
if ($CheckOnly) {
  Write-Host "[lighthouse] CheckOnly：runner=$($runner.note) exe=$($runner.exe) prefix=$($runner.prefix -join ' ')"
  Write-Host "[lighthouse] CheckOnly：edge=$edge；不运行、不写状态文件。"
  foreach ($f in @(Get-ChildItem -LiteralPath $outPath -Filter '_detect*' -ErrorAction SilentlyContinue)) { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue }
  exit 0
}

# ---------- 2) 运行（主 URL + 可选 Url2，各一次独立运行） ----------
function Invoke-Lighthouse([string]$targetUrl, [int]$index) {
  $prefixPath = Join-Path $outPath ("market-mobile-$index")
  $jsonPath = "$prefixPath.report.json"
  $htmlPath = "$prefixPath.report.html"
  $argList = @()
  $argList += $runner.prefix
  $argList += $targetUrl
  $argList += '--quiet'
  $argList += '--output=json'
  $argList += '--output=html'
  $argList += "--output-path=$prefixPath"
  $argList += "--chrome-path=$edge"
  $argList += '--chrome-flags="--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage"'
  $argList += '--only-categories=performance,accessibility,best-practices,seo'
  # 明确 mobile 形态（Lighthouse 默认即 mobile；不传 --preset=desktop）
  $argList += '--form-factor=mobile'
  Write-Host "[lighthouse] 运行 #${index}：$targetUrl（最长 ${TimeoutSec}s）" -ForegroundColor Cyan
  $started = Get-Date
  $r = Invoke-CmdWithTimeout $runner.exe $argList $TimeoutSec (Join-Path $outPath ("_run-$index"))
  $elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
  $scores = $null
  $reportJson = $null
  if (Test-Path -LiteralPath $jsonPath) {
    try { $reportJson = Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json } catch { $reportJson = $null }
  }
  if ($reportJson -and $reportJson.categories) {
    $scores = [ordered]@{
      performance = [math]::Round([double]$reportJson.categories.performance.score, 3)
      accessibility = [math]::Round([double]$reportJson.categories.accessibility.score, 3)
      'best-practices' = [math]::Round([double]$reportJson.categories.'best-practices'.score, 3)
      seo = [math]::Round([double]$reportJson.categories.seo.score, 3)
    }
    Write-Host "[lighthouse] 完成 #${index}（${elapsed}s）：P=$($scores.performance) A=$($scores.accessibility) BP=$($scores.'best-practices') SEO=$($scores.seo)" -ForegroundColor Green
    Write-Host "[lighthouse] 报告：$jsonPath / $htmlPath"
  } else {
    Write-Warning "[lighthouse] #${index} 未产出报告（exit=$($r.exitCode) timedOut=$($r.timedOut) elapsed=${elapsed}s）"
  }
  return [ordered]@{
    index = $index
    url = $targetUrl
    status = if ($scores) { 'ok' } else { 'failed' }
    scores = $scores
    elapsedSec = $elapsed
    exitCode = $r.exitCode
    timedOut = $r.timedOut
    jsonFile = if (Test-Path -LiteralPath $jsonPath) { [System.IO.Path]::GetFileName($jsonPath) } else { $null }
    htmlFile = if (Test-Path -LiteralPath $htmlPath) { [System.IO.Path]::GetFileName($htmlPath) } else { $null }
    reason = if (-not $scores) { "未产出报告（exit=$($r.exitCode) timedOut=$($r.timedOut)）" } else { $null }
  }
}

$runs += Invoke-Lighthouse $Url 1
if ($Url2) { $runs += Invoke-Lighthouse $Url2 2 }
$status.runs = $runs
$okRuns = @($runs | Where-Object { $_.status -eq 'ok' })
if ($okRuns.Count -gt 0) {
  $main = $okRuns[0]
  $status.status = if ($okRuns.Count -eq $runs.Count) { 'ok' } else { 'partial' }
  $status.scores = $main.scores
  $status.url = $main.url
  $status.pass = (($main.scores.performance -ge 0.9) -and ($main.scores.accessibility -ge 0.9))
  $status.reason = if ($okRuns.Count -lt $runs.Count) { "部分运行失败：" + (($runs | Where-Object { $_.status -ne 'ok' } | ForEach-Object { "#$($_.index):$($_.reason)" }) -join '; ') } else { $null }
  Write-StatusFile
  # 成功时清理上一轮失败遗留的 UNAVAILABLE.md（避免证据自相矛盾）
  try { Remove-Item -LiteralPath (Join-Path $outPath 'UNAVAILABLE.md') -Force -ErrorAction SilentlyContinue } catch { }
  Write-Host ("[lighthouse] 汇总：{0}；P/A={1}/{2}（阈值 P>=0.9 & A>=0.9 => pass={3}）" -f $status.status, $status.scores.performance, $status.scores.accessibility, $status.pass) -ForegroundColor Green
} else {
  Mark-Unavailable ("全部运行均未产出报告：" + (($runs | ForEach-Object { "#$($_.index) $($_.reason)" }) -join '; '))
}
exit 0
