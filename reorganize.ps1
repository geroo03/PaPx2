# reorganize.ps1
# Reorganiza puertaapuerta-main en arquitectura frontend/ + backend/ limpia.
# Ejecutar desde la raíz del proyecto:  .\reorganize.ps1
# Por seguridad corre en DRY-RUN por defecto. Para ejecutar: .\reorganize.ps1 -Apply
#
# ESTADO ACTUAL (post Fase 5):
#   El proyecto YA está organizado. Los archivos listados acá están en frontend/.
#   Correr este script hoy resultará en SKIPs porque no existen en raíz.
#   Conservado como referencia y para onboarding de nuevas instancias del repo.

param([switch]$Apply)

# $PSScriptRoot: variable automática de PowerShell que siempre apunta
# al directorio del script, independientemente de cómo se lo invoque.
# Más confiable que Split-Path -Parent $MyInvocation.MyCommand.Path.
$root = $PSScriptRoot
Set-Location $root

$dryRun = -not $Apply.IsPresent
if ($dryRun) {
    Write-Host "`n[DRY-RUN] Ningún archivo será movido. Pasá -Apply para ejecutar.`n" -ForegroundColor Yellow
} else {
    Write-Host "`n[APLICANDO] Moviendo archivos...`n" -ForegroundColor Green
}

function Move-Safe {
    param([string]$src, [string]$dest)
    if (Test-Path -LiteralPath $src) {
        if ($dryRun) {
            Write-Host "  MOVER  $src  ->  $dest"
        } else {
            $destDir = Split-Path -Parent $dest
            if (-not (Test-Path -LiteralPath $destDir)) {
                New-Item -ItemType Directory -Force -Path $destDir | Out-Null
            }
            # -LiteralPath en origen: evita que [ ] se interpreten como wildcards
            Move-Item -LiteralPath $src -Destination $dest -Force
            Write-Host "  OK     $src  ->  $dest" -ForegroundColor Cyan
        }
    } else {
        Write-Host "  SKIP   $src  (no existe)" -ForegroundColor DarkGray
    }
}

# ── Crear carpetas destino ────────────────────────────────────────────────────
if (-not $dryRun) {
    New-Item -ItemType Directory -Force -Path "frontend" | Out-Null
    New-Item -ItemType Directory -Force -Path "backend"  | Out-Null
}

Write-Host "-- CARPETAS -> frontend/ ------------------------------------------"
$frontendFolders = @("assets", "cliente", "comercio", "cadete", "embajador", "shared", "admin", "api")
foreach ($f in $frontendFolders) {
    Move-Safe $f (Join-Path "frontend" $f)
}

Write-Host "`n-- ARCHIVOS HTML y STATIC -> frontend/ --------------------------"
$frontendFiles = @(
    "index.html", "home-cliente.html", "login.html", "login.fixed.html",
    "registro-comercio.html", "admin.html", "cadete.html",
    "env.js", "env.js.template",
    "sw.js", "firebase-messaging-sw.js",
    "_redirects", "vercel.json"
)
# Nota: env.template.js fue eliminado en Fase 5 (estaba duplicado).
foreach ($f in $frontendFiles) {
    Move-Safe $f (Join-Path "frontend" $f)
}

Write-Host "`n-- ARCHIVOS -> backend/ ------------------------------------------"
$backendFiles = @("server.js", ".env", ".env.example")
foreach ($f in $backendFiles) {
    Move-Safe $f (Join-Path "backend" $f)
}

Move-Safe "package.json"      (Join-Path "backend" "package.json")
Move-Safe "package-lock.json" (Join-Path "backend" "package-lock.json")

Write-Host "`n-- QUEDAN EN RAIZ (sin mover) -----------------------------------"
Write-Host "  .gitignore, supabase/, scripts/, tools/"
Write-Host "  netlify_build/, test_agente_claude/   <- revisa si los necesitas"
Write-Host "  README.md, DEPLOYMENT.md, *.sql, *.zip, *.ps1, *.js (otros)"

if ($dryRun) {
    Write-Host "`n[OK] Simulacion completa. Ejecuta  .\reorganize.ps1 -Apply  para aplicar.`n" -ForegroundColor Yellow
} else {
    Write-Host "`n[OK] Reorganizacion aplicada.`n" -ForegroundColor Green
    Write-Host "PROXIMOS PASOS MANUALES:" -ForegroundColor Magenta
    Write-Host "  1. cd backend"
    Write-Host "     npm init -y"
    Write-Host "     npm install express @supabase/supabase-js mercadopago cors dotenv"
    Write-Host "  2. Actualizar vercel.json"
    Write-Host "  3. Vercel Dashboard -> Settings -> Root Directory = frontend"
}
