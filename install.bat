@echo off
rem Codex Design 3D kurulumu: atolyeyi GitHub'dan indirir, Claude / Codex / Antigravity skill klasorlerini
rem C:\ D:\ ... suruculerinde arar ve bulunanlarin hepsine codex-design-3d skill'ini kurar.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:CODEX_DEST='%~1'; $f='%~f0'; iex ((Get-Content -LiteralPath $f -Raw -Encoding UTF8) -split '#PS_BEGIN\r?\n',2)[1]"
pause
exit /b
#PS_BEGIN
$ErrorActionPreference = 'Stop'
$repo = 'AstraServices/Codex-Design'
Write-Host ''
Write-Host '=== Codex Design 3D Kurulum ===' -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js bulunamadi. Once https://nodejs.org adresinden Node.js 22+ kur.' -ForegroundColor Red
  return
}

# 1) Atolye klasoru: otomatik (ilk arguman ile degistirilebilir: install.bat D:\CodexDesign)
$dest = if ($env:CODEX_DEST) { $env:CODEX_DEST } else { Join-Path $env:USERPROFILE 'CodexDesign' }
$dest = [IO.Path]::GetFullPath($dest.Trim('"'))
Write-Host "Atolye klasoru: $dest"

if (Test-Path (Join-Path $dest 'version.txt')) {
  Write-Host "Mevcut kurulum bulundu: $dest (dosyalar guncellenecek, projelerin korunur)"
}
$tmp = Join-Path $env:TEMP ("codex-design-install-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  Write-Host 'GitHub''dan indiriliyor...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $zip = Join-Path $tmp 'main.zip'
  Invoke-WebRequest "https://codeload.github.com/$repo/zip/refs/heads/main" -OutFile $zip -UseBasicParsing
  tar -xf $zip -C $tmp
  $src = Get-ChildItem $tmp -Directory | Select-Object -First 1
  New-Item -ItemType Directory -Force $dest | Out-Null
  $keep = @('projects', 'workspace.json', 'gfx.config.json', 'install.json')
  foreach ($item in Get-ChildItem $src.FullName -Force) {
    $target = Join-Path $dest $item.Name
    if ($keep -contains $item.Name -and (Test-Path $target)) { continue }
    Copy-Item $item.FullName $dest -Recurse -Force
  }
} finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host 'Bagimliliklar kuruluyor (npm install)...'
Push-Location $dest
& npm.cmd install
Pop-Location

# 2) Skill klasorlerini tum suruculerde otomatik ara ve hepsine kur
Write-Host ''
Write-Host 'Claude / Codex / Antigravity klasorleri araniyor (C:\, D:\ ...)...' -ForegroundColor Cyan
# Rel: klasor varsa bu ajan kurulu sayilir. Skills: SKILL.md'nin gidecegi global skill klasoru.
$agents = @(
  @{ Name = 'Claude Code';     Rel = '.claude';                Skills = '.claude\skills' },
  @{ Name = 'Codex';           Rel = '.codex';                 Skills = '.codex\skills' },
  @{ Name = 'Antigravity';     Rel = '.gemini\antigravity';    Skills = '.gemini\config\skills' },
  @{ Name = 'Antigravity CLI'; Rel = '.gemini\antigravity-cli'; Skills = '.gemini\antigravity-cli\skills' },
  @{ Name = 'Gemini CLI';      Rel = '.gemini\settings.json';  Skills = '.gemini\skills' },
  @{ Name = 'Agents (ortak)';  Rel = '.agents';                Skills = '.agents\skills' }
)
$homes = New-Object System.Collections.Generic.List[string]
foreach ($drive in Get-PSDrive -PSProvider FileSystem) {
  $r = $drive.Root
  if (-not (Test-Path $r)) { continue }
  $homes.Add($r)
  if (Test-Path (Join-Path $r 'Users')) {
    Get-ChildItem (Join-Path $r 'Users') -Directory -ErrorAction SilentlyContinue | ForEach-Object { $homes.Add($_.FullName) }
  }
}
$chosen = @()
foreach ($h in ($homes | Select-Object -Unique)) {
  foreach ($a in $agents) {
    if (Test-Path (Join-Path $h $a.Rel)) {
      $chosen += [pscustomobject]@{ Name = $a.Name; Path = (Join-Path (Join-Path $h $a.Skills) 'codex-design-3d') }
    }
  }
}
if ($chosen.Count -eq 0) { Write-Host 'Hic Claude / Codex / Antigravity klasoru bulunamadi; skill kurulmadi.' -ForegroundColor Yellow }

$skillText = (Get-Content (Join-Path $dest 'skill\SKILL.md') -Raw -Encoding UTF8).Replace('C:/Users/astra/Documents/CodexDesign', $dest.Replace('\', '/'))
$utf8 = New-Object System.Text.UTF8Encoding $false
foreach ($c in $chosen) {
  New-Item -ItemType Directory -Force $c.Path | Out-Null
  [IO.File]::WriteAllText((Join-Path $c.Path 'SKILL.md'), $skillText, $utf8)
  Write-Host ("Skill kuruldu: {0} -> {1}" -f $c.Name, $c.Path) -ForegroundColor Green
}
# Auto update yeni SKILL.md'yi bu klasorlere de yazar.
$info = @{ skills = @($chosen | ForEach-Object { $_.Path }) } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $dest 'install.json'), $info, $utf8)

Write-Host ''
Write-Host "Kurulum tamam: $dest" -ForegroundColor Green
Write-Host "Baslatmak icin: cd `"$dest`" ; npm.cmd start   (her acilista GitHub'daki surumu kontrol eder)"
