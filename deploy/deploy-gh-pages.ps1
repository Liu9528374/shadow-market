<#
.SYNOPSIS
  把 D:\SHADOW-MARKET\market\ 内容发布到 GitHub Pages 的 gh-pages 分支（临时克隆方式，不写工作区 git）。

.DESCRIPTION
  设计约束（D:\FOLLOWSPEAK\docs\111-market-architecture.md §2.4 / §6.4）：
    - P0 使用 hash 路由（#/…），静态托管零配置，**不需要** 404.html / SPA fallback；
    - 只发布 market/ 目录内容（站点根），排除 .git/node_modules；
    - 生成 .nojekyll（禁止 Jekyll 处理）、可选 CNAME、SHA256SUMS.txt（供应链完整性）；
    - 发布前默认执行校验（包/catalog v2/数据契约/静态审计），任一失败即中止（质量门：失败不发布）；
    - 不修改原仓库 git：在 %TEMP% 临时目录 git init/commit，push --force 到远端 gh-pages 分支；
    - gh-pages 是生成分支（每次整体替换），不使用 subtree 以免污染 main 历史。

.PARAMETER Remote
  原仓库的 remote 名（默认 origin），用于解析 push URL。

.PARAMETER Branch
  目标分支（默认 gh-pages）。

.PARAMETER SourceDir
  要发布的目录（相对仓库根，默认 market）。

.PARAMETER Cname
  可选：自定义域名（写入发布根的 CNAME；DNS 需先配置好 CNAME 记录）。

.PARAMETER Message
  可选：提交信息（默认自动生成，含时间）。

.PARAMETER DryRun
  演练：只做校验 + 打印发布清单，不建临时目录、不 commit、不 push。

.PARAMETER SkipValidate
  跳过校验（不推荐；仅用于站点数据尚未生成时的发布脚本自检）。

.PARAMETER RequireClean
  market/ 有未提交改动时中止（默认警告后继续，因为允许发布工作区演示版）。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy\deploy-gh-pages.ps1 -DryRun

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy\deploy-gh-pages.ps1 -Remote origin -Branch gh-pages

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy\deploy-gh-pages.ps1 -Cname shadowmarket.example
#>
[CmdletBinding()]
param(
  [string]$Remote = 'origin',
  [string]$Branch = 'gh-pages',
  [string]$SourceDir = 'market',
  [string]$Cname = '',
  [string]$Message = '',
  [switch]$DryRun,
  [switch]$SkipValidate,
  [switch]$RequireClean
)

$ErrorActionPreference = 'Stop'
$env:GIT_TERMINAL_PROMPT = '0'

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $repoRoot $SourceDir
if (-not (Test-Path -LiteralPath $sourcePath)) { throw "发布源目录不存在：$sourcePath" }
$sourcePath = (Resolve-Path -LiteralPath $sourcePath).Path
if (-not $sourcePath.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "发布源目录必须在仓库内：$sourcePath（repo=$repoRoot）"
}

$nodeExe = if (Test-Path -LiteralPath 'D:\NODE\node.exe') { 'D:\NODE\node.exe' } else { 'node' }
$required = @(
  'index.html', 'assets/js/app.js', 'assets/styles/app.css', 'sw.js',
  'manifest.webmanifest', 'offline.html', 'plugins/index.json',
  'catalog/resources.json', 'catalog/site.json', 'data/packages'
)
$missing = @()
foreach ($rel in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $sourcePath $rel))) { $missing += $rel }
}
if ($missing.Count -gt 0) { throw "站点发布产物不完整，缺少：$($missing -join ', ')" }

# ---------- 1. 校验（失败不发布） ----------
function Invoke-NodeCheck([string]$label, [string]$scriptRel, [string[]]$scriptArgs) {
  $scriptPath = Join-Path $repoRoot $scriptRel
  if (-not (Test-Path -LiteralPath $scriptPath)) { throw "[$label] 校验脚本不存在：$scriptRel（数据/构建层未就绪，拒绝发布）" }
  Write-Host "[validate] $label ..." -ForegroundColor Cyan
  & $nodeExe $scriptPath @scriptArgs
  if ($LASTEXITCODE -ne 0) { throw "[$label] 校验失败（exit=$LASTEXITCODE），按质量门中止发布" }
  Write-Host "[validate] $label PASS" -ForegroundColor Green
}

if ($SkipValidate) {
  Write-Warning '[validate] 已跳过校验（-SkipValidate）：产物正确性由调用方自行负责'
} else {
  Invoke-NodeCheck 'shadowcourse validate --dir' 'tools/shadowcourse/validate.mjs' @('--dir', 'market/data/packages')
  Invoke-NodeCheck 'catalog v2 validate' 'tools/catalog/validate-catalog.mjs' @()
  Invoke-NodeCheck 'QA data contract' 'tools/qa/market/data-contract-check.mjs' @()
  Invoke-NodeCheck 'QA static audit' 'tools/qa/market/static-audit.mjs' @()
}

# ---------- 2. 工作区状态检查 ----------
$dirty = @()
try {
  $dirty = @(git -C $repoRoot status --porcelain -- $SourceDir 2>$null)
} catch { $dirty = @() }
if ($dirty.Count -gt 0) {
  if ($RequireClean) { throw "market/ 有 $($dirty.Count) 个未提交改动（-RequireClean）：先提交或加 -SkipValidate 显式发布工作区" }
  Write-Warning "market/ 有 $($dirty.Count) 个未提交改动：本次将发布**工作区当前内容**（不是 HEAD）"
}

# ---------- 3. 发布清单 ----------
$files = @(Get-ChildItem -LiteralPath $sourcePath -Recurse -File -Force | Where-Object {
  $_.FullName -notmatch '[\\/]\.git[\\/]' -and $_.FullName -notmatch '[\\/]node_modules[\\/]'
})
$totalBytes = ($files | Measure-Object -Property Length -Sum).Sum
$catalogFiles = @($files | Where-Object { $_.FullName -match '[\\/]catalog[\\/]' -and $_.Extension -eq '.json' })
$packageFiles = @($files | Where-Object { $_.FullName -match '[\\/]data[\\/]packages[\\/]' })
Write-Host ''
Write-Host '=== 发布清单 ===' -ForegroundColor Yellow
Write-Host ("源目录 : {0}" -f $sourcePath)
Write-Host ("文件数 : {0}（catalog {1} / packages {2}）" -f $files.Count, $catalogFiles.Count, $packageFiles.Count)
Write-Host ("总大小 : {0:N2} MiB" -f ($totalBytes / 1MB))
Write-Host ("目标   : {0} → 分支 {1}" -f $Remote, $Branch)
if ($Cname) { Write-Host ("CNAME  : {0}" -f $Cname) }
Write-Host '必检文件：' -NoNewline
Write-Host ($required -join ', ')
if ($files.Count -gt 0) {
  Write-Host '样例文件（前 12）：'
  $files | Select-Object -First 12 | ForEach-Object { Write-Host ("  - {0} ({1:N0} B)" -f $_.FullName.Substring($sourcePath.Length).TrimStart('\'), $_.Length) }
}

if ($DryRun) {
  Write-Host ''
  Write-Host '[dry-run] 校验 + 清单完成；未创建临时目录、未 commit、未 push。' -ForegroundColor Yellow
  Write-Host '[dry-run] 正式发布去掉 -DryRun 即可。' -ForegroundColor Yellow
  exit 0
}

# ---------- 4. 解析远端 URL ----------
$remoteUrl = $null
try { $remoteUrl = (git -C $repoRoot remote get-url $Remote 2>$null) } catch { }
if (-not $remoteUrl) { throw "无法解析 remote '$Remote' 的 URL（仓库未配置该 remote）。示例：git remote add origin https://github.com/<owner>/<repo>.git" }
Write-Host "[publish] remote URL: $remoteUrl" -ForegroundColor Cyan

if (-not $Message) {
  $now = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  $Message = "deploy(market): gh-pages from $SourceDir @ $now"
}

# ---------- 5. 临时克隆 + 发布 ----------
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ('shadow-market-gh-pages-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
Write-Host "[publish] 临时目录: $tempDir" -ForegroundColor Cyan
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
$pushed = $false
try {
  Push-Location $tempDir
  try {
    git init -q
    git config user.name 'SHADOW Market Deploy'
    git config user.email 'deploy@shadow-market.local'
    git config core.autocrlf false

    Get-ChildItem -LiteralPath $sourcePath -Force | Where-Object { $_.Name -notin @('.git', 'node_modules') } |
      ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $tempDir -Recurse -Force }

    # Jekyll 关闭（GitHub Pages 默认会忽略下划线开头文件）
    New-Item -ItemType File -Path (Join-Path $tempDir '.nojekyll') -Force | Out-Null
    if ($Cname) { Set-Content -LiteralPath (Join-Path $tempDir 'CNAME') -Value $Cname -Encoding ascii }

    # SHA256 清单（供应链完整性：发布物可复核）
    $sums = New-Object System.Collections.Generic.List[string]
    $publishFiles = @(Get-ChildItem -LiteralPath $tempDir -Recurse -File -Force | Where-Object { $_.FullName -notmatch '[\\/]\.git[\\/]' })
    foreach ($f in $publishFiles) {
      $rel = $f.FullName.Substring($tempDir.Length).TrimStart('\').Replace('\', '/')
      $hash = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      $sums.Add("$hash  $rel")
    }
    Set-Content -LiteralPath (Join-Path $tempDir 'SHA256SUMS.txt') -Value $sums -Encoding utf8
    Write-Host ("[publish] 已生成 SHA256SUMS.txt（{0} 个文件）" -f $publishFiles.Count)

    git add -A
    git commit -q -m $Message
    $commit = (git rev-parse --short HEAD).Trim()
    Write-Host "[publish] 本地提交: $commit"
    git remote add origin $remoteUrl
    git push --force origin "HEAD:$Branch"
    if ($LASTEXITCODE -ne 0) { throw "git push 失败（exit=$LASTEXITCODE）：检查远端权限/分支保护/网络" }
    $pushed = $true
    Write-Host "[publish] 已推送 $commit → $Remote/$Branch" -ForegroundColor Green
  } finally {
    Pop-Location
  }
} finally {
  if (Test-Path -LiteralPath $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue }
}

if ($pushed) {
  Write-Host ''
  Write-Host '=== 发布完成 ===' -ForegroundColor Green
  Write-Host '后续：'
  Write-Host '  1) 仓库 Settings → Pages → Source = Deploy from a branch / Branch = gh-pages / root'
  Write-Host '  2) 等待 Pages 构建后无痕窗口验证站点（hash 路由无需 404.html）'
  Write-Host '  3) 运行 tools/qa/market/collect-evidence.mjs 归档本次证据'
}
