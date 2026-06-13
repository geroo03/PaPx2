<#
  cleanup-backend.ps1
  Uso: Ejecutar en la raíz del repo.
  Hace un backup de carpetas legacy del backend plano y luego pregunta para borrar.
  Requiere PowerShell 5+ (Windows). No borra nada sin confirmación explícita.

  NOTA: El proyecto ya está organizado en frontend/ y backend/.
  Este script limpia solo restos de la estructura plana original (api/, src/, etc. en raíz).
  NO tocar: supabase/, frontend/, backend/, scripts/, tools/
#>

$root      = $PSScriptRoot
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $root "backend-backup-$timestamp"

# Solo carpetas legacy de la arquitectura plana original.
# EXCLUIDO A PROPÓSITO: supabase/ (migraciones SQL), frontend/, backend/
$toBackup = @("api", "src", "node_modules", "admin")

Write-Host ""
Write-Host "Backup target: $backupDir" -ForegroundColor Cyan
Write-Host "Carpetas a respaldar/borrar: $($toBackup -join ', ')" -ForegroundColor Cyan
Write-Host ""

# Verificar que al menos una exista antes de crear el directorio de backup
$anyExists = $toBackup | Where-Object { Test-Path (Join-Path $root $_) }
if (-not $anyExists) {
    Write-Host "Ninguna de las carpetas legacy existe en la raíz. Nada que hacer." -ForegroundColor Green
    exit 0
}

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

foreach ($d in $toBackup) {
    $full = Join-Path $root $d
    if (Test-Path -LiteralPath $full) {
        Write-Host "Backing up '$d'..."
        # -LiteralPath evita que [ ] en nombres de ruta se interpreten como wildcards
        Copy-Item -LiteralPath $full -Destination $backupDir -Recurse -Force
    } else {
        Write-Host "  SKIP '$d' (no existe en raíz)" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "Backup completo en: $backupDir" -ForegroundColor Green
Write-Host "Inspeccioná el backup antes de confirmar el borrado." -ForegroundColor Yellow
Write-Host ""

$confirm = Read-Host "¿Borrar las carpetas originales ahora? Escribí 'SI' para confirmar"
if ($confirm -ne 'SI') {
    Write-Host "Cancelado. No se borró nada." -ForegroundColor Yellow
    exit 0
}

foreach ($d in $toBackup) {
    $full = Join-Path $root $d
    if (Test-Path -LiteralPath $full) {
        Write-Host "Eliminando '$d'..." -ForegroundColor Red
        Remove-Item -LiteralPath $full -Recurse -Force
        Write-Host "  OK" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Eliminación completada. Backup disponible en: $backupDir" -ForegroundColor Green
