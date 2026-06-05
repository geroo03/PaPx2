# reorganize.ps1
# Reorganiza puertaapuerta-main en arquitectura frontend/ + backend/ limpia.
# Ejecutar desde la raíz del proyecto:  .\reorganize.ps1
# Por seguridad corre en DRY-RUN por defecto. Para ejecutar: .\reorganize.ps1 -Apply

param([switch]$Apply)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$dryRun = -not $Apply.IsPresent
if ($dryRun) {
  Write-Host "`n[DRY-RUN] Ningún archivo será movido. Pasá -Apply para ejecutar.`n" -ForegroundColor Yellow
} else {
  Write-Host "`n[APLICANDO] Moviendo archivos...`n" -ForegroundColor Green
}

function Move-Safe($src, $dest) {
  if (Test-Path $src) {
    if ($dryRun) {
      Write-Host "  MOVER  $src  →  $dest"
    } else {
      $destDir = Split-Path -Parent $dest
      if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
      Move-Item -Path $src -Destination $dest -Force
      Write-Host "  OK     $src  →  $dest" -ForegroundColor Cyan
    }
  } else {
    Write-Host "  SKIP   $src  (no existe)" -ForegroundColor DarkGray
  }
}

# ── Crear carpetas destino ────────────────────────────────────────────────────
if (-not $dryRun) {
  New-Item -ItemType Directory -Force -Path "frontend"  | Out-Null
  New-Item -ItemType Directory -Force -Path "backend"   | Out-Null
}

Write-Host "-- CARPETAS -> frontend/ ------------------------------------------"
$frontendFolders = @("assets","cliente","comercio","cadete","embajador","shared","src","admin","api")
foreach ($f in $frontendFolders) { Move-Safe $f "frontend\$f" }

Write-Host "`n-- ARCHIVOS HTML y STATIC -> frontend/ --------------------------"
$frontendFiles = @(
  "index.html", "home-cliente.html", "login.html", "login.fixed.html",
  "registro-comercio.html", "admin.html", "cadete.html",
  "env.js", "env.js.template", "env.template.js",
  "sw.js", "firebase-messaging-sw.js",
  "_redirects", "vercel.json"
)
foreach ($f in $frontendFiles) { Move-Safe $f "frontend\$f" }

Write-Host "`n-- ARCHIVOS -> backend/ ------------------------------------------"
$backendFiles = @("server.js", ".env", ".env.example")
foreach ($f in $backendFiles) { Move-Safe $f "backend\$f" }

# package.json y package-lock.json: mover solo si existen
Move-Safe "package.json"      "backend\package.json"
Move-Safe "package-lock.json" "backend\package-lock.json"

Write-Host "`n-- QUEDAN EN RAIZ (sin mover) -----------------------------------"
Write-Host "  .gitignore, supabase/, scripts/, tools/"
Write-Host "  netlify_build/, test_agente_claude/   <- revisa si los necesitas"
Write-Host "  README.md, DEPLOYMENT.md, *.sql, *.zip, *.ps1, *.js (otros)"

if ($dryRun) {
  Write-Host "[OK] Simulacion completa. Ejecuta  .\reorganize.ps1 -Apply  para aplicar." -ForegroundColor Yellow
} else {
  Write-Host "[OK] Reorganizacion aplicada." -ForegroundColor Green
  Write-Host "PROXIMOS PASOS MANUALES:" -ForegroundColor Magenta
  Write-Host "  1. cd backend && npm init -y && npm install express @supabase/supabase-js mercadopago cors dotenv"
  Write-Host "  2. Actualizar vercel.json"
  Write-Host "  3. Vercel Dashboard -> Settings -> Root Directory = frontend"
  Write-Host "  4. Leer la seccion AJUSTES DE RUTAS"
}
