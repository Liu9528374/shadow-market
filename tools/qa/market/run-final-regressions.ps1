# run-final-regressions.ps1 - r11 最终包（r11-final-mirror）串行验证链（qa-verify 独立验证用）
#
# 串行执行，避免浏览器/端口冲突：
#   1) desktop-import-e2e.mjs（导入/BYOM/仅文本/深链/保存重开/字体/插件）
#   2) run-all.ps1 -Takes 5 -Packaged -PkgRoot <最终镜像>（fake-mic/capture/server/app-smoke）
#   3) final-r8-subtitle-check.mjs（既有脚本副本，仅把硬编码镜像路径改为最终镜像）
#   4) final-r8-ass-check.mjs
#   5) final-r9-record-check.mjs
#
# 说明：r8/r9 既有脚本把镜像硬编码为 .tmp/r5-mirror（r10 包），为在**最终 r11 包**上复跑，
# 本目录内有三个副本（逻辑未改，仅替换 MIRROR/SHOTS 路径）；原脚本不改。
#
# 用法：pwsh -NoProfile -File tools\qa\market\run-final-regressions.ps1
param(
  [string]$Mirror = 'D:\FOLLOWSPEAK\tools\qa\v07\.tmp\r11-final-mirror',
  [switch]$SkipDesktop,
  [switch]$SkipRunAll,
  [switch]$SkipR8
)
$ErrorActionPreference = 'Continue'
$root = 'D:\FOLLOWSPEAK'
$qa = Join-Path $root 'tools\qa\market'
$v07 = Join-Path $root 'tools\qa\v07'
$tmp = Join-Path $root 'tools\qa\v07\.tmp\r11-verify-tmp\final'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$env:TEMP = $tmp; $env:TMP = $tmp
$node = 'D:\NODE\node.exe'
$results = New-Object System.Collections.Generic.List[object]

function Run-Step {
  param([string]$Name, [scriptblock]$Block, [string]$LogFile)
  Write-Host ''
  Write-Host ('=' * 78)
  Write-Host ("[final] " + $Name)
  Write-Host ('=' * 78)
  $t0 = Get-Date
  Push-Location $root
  try { & $Block *> $LogFile } finally { Pop-Location }
  $code = $LASTEXITCODE
  $sec = [Math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  if (Test-Path $LogFile) { Get-Content $LogFile -Tail 6 | ForEach-Object { Write-Host ('    ' + $_) } }
  $mark = if ($code -eq 0) { 'PASS' } else { 'FAIL' }
  Write-Host ("[final] $mark $Name exit=$code ${sec}s log=$LogFile")
  $results.Add([pscustomobject]@{ name = $Name; exit = $code; seconds = $sec; log = $LogFile; pass = ($code -eq 0) })
}

Write-Host ('[final] mirror=' + $Mirror)
$appHtml = Join-Path $Mirror 'app\SHADOW-Studio-0.7.0.html'
if (Test-Path $appHtml) {
  $sha = (Get-FileHash $appHtml -Algorithm SHA256).Hash
  Write-Host ('[final] appHtmlSha256=' + $sha)
} else {
  Write-Host ('[final] FATAL: 镜像缺 app html: ' + $appHtml)
  exit 2
}
if (-not (Test-Path (Join-Path $Mirror 'runtime\python.exe'))) { Write-Host '[final] FATAL: 镜像缺 runtime\python.exe'; exit 2 }

# 1) 桌面导入 E2E（最终包）
if (-not $SkipDesktop) {
  Run-Step 'desktop-import-e2e（最终包）' {
    & $node (Join-Path $qa 'desktop-import-e2e.mjs') ("--root=" + $Mirror) ("--report=" + (Join-Path $qa 'report-desktop.json'))
  } (Join-Path $qa 'final-desktop-e2e.log')
}

# 2) run-all（最终包，5 连录）
if (-not $SkipRunAll) {
  Run-Step 'run-all -Takes 5 -Packaged（最终镜像）' {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $v07 'run-all.ps1') -Takes 5 -Packaged -PkgRoot $Mirror -AppReport (Join-Path $qa 'report-app-packaged-r11.json')
  } (Join-Path $qa 'final-runall.log')
}

# 3–5) r8/r9 既有回归（副本，指向最终镜像）
if (-not $SkipR8) {
  $env:SUB_PACKAGED = '1'
  Run-Step 'final-r8-subtitle-check（最终包 25 项）' {
    & $node (Join-Path $qa 'final-r8-subtitle-check.mjs')
  } (Join-Path $qa 'final-r8-subtitle.log')
  Run-Step 'final-r8-ass-check（最终包 12 项）' {
    & $node (Join-Path $qa 'final-r8-ass-check.mjs')
  } (Join-Path $qa 'final-r8-ass.log')
  Run-Step 'final-r9-record-check（最终包 10 项）' {
    & $node (Join-Path $qa 'final-r9-record-check.mjs')
  } (Join-Path $qa 'final-r9-record.log')
  Remove-Item Env:SUB_PACKAGED -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ('=' * 78)
Write-Host '[final] 汇总'
Write-Host ('=' * 78)
foreach ($r in $results) { Write-Host ("  [{0}] {1}  exit={2}  {3}s  {4}" -f $(if ($r.pass) { 'PASS' } else { 'FAIL' }), $r.name, $r.exit, $r.seconds, $r.log) }
$failed = @($results | Where-Object { -not $_.pass }).Count
Write-Host ("[final] 通过 " + ($results.Count - $failed) + " / " + $results.Count + " 项；失败 " + $failed + " 项")
if ($failed -gt 0) { exit 1 }
Write-Host '[final] ALL PASS'
exit 0
