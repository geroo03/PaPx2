<#
  cleanup-backend.ps1
  Uso: Ejecutar en la raíz del repo. El script hace un backup de las carpetas de backend y luego pregunta para borrar.
  Requiere PowerShell 5+ (Windows). No borra nada sin confirmación explícita.
#>

$root = (Get-Location).Path
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $root "backend-backup-$timestamp"
$toBackup = @("api","src","node_modules","supabase","admin")

Write-Host "Backup target will be created at: $backupDir"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

foreach($d in $toBackup){
    $full = Join-Path $root $d
    if(Test-Path $full){
        Write-Host "Backing up $d..."
        Copy-Item -Path $full -Destination $backupDir -Recurse -Force
    } else {
        Write-Host "Not found: $d"
    }
}

Write-Host "Backup complete. Inspect contents of $backupDir before deleting originals."

$confirm = Read-Host "¿Borrar las carpetas originales ahora? Escribe 'SI' para confirmar"
if($confirm -ne 'SI'){
    Write-Host "Cancelado por el usuario. No se borró nada."
    exit 0
}

foreach($d in $toBackup){
    $full = Join-Path $root $d
    if(Test-Path $full){
        Write-Host "Eliminando $d..."
        Remove-Item -LiteralPath $full -Recurse -Force
    }
}

Write-Host "Eliminación completada. Revisa el backup en $backupDir si necesitas restaurar archivos."