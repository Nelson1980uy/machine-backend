
$ErrorActionPreference = "Stop"

$envPath = Join-Path $PSScriptRoot ".env"
$line = Get-Content -LiteralPath $envPath |
    Where-Object { $_ -match '^SPARE_PARTS_BOOTSTRAP_SECRET=' } |
    Select-Object -Last 1

if (-not $line) {
    throw "No se encontró SPARE_PARTS_BOOTSTRAP_SECRET en .env"
}

$secret = $line.Substring("SPARE_PARTS_BOOTSTRAP_SECRET=".Length).Trim()

if ($secret.Length -ne 64) {
    throw "El secreto debe tener 64 caracteres."
}

$token = Read-Host "Pegá el token de sesión de MACHINE (no se mostrará automáticamente)"

if ([string]::IsNullOrWhiteSpace($token)) {
    throw "El token de sesión es obligatorio."
}

$headers = @{
    Authorization = "Bearer $token"
    "x-machine-spare-parts-bootstrap" = $secret
}

$body = @{
    reason = "Designación inicial autorizada del administrador oficial de repuestos de MACHINE."
} | ConvertTo-Json

$response = Invoke-RestMethod `
    -Uri "http://localhost:8080/api/spare-parts/governance/bootstrap" `
    -Method Post `
    -Headers $headers `
    -ContentType "application/json" `
    -Body $body

$response | ConvertTo-Json -Depth 8
