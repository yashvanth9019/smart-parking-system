# SmartPark RTD - Start MongoDB, FastAPI Backend, and Next.js Frontend
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

# 1. Start MongoDB if port 27017 is not listening
$mongoListening = (Get-NetTCPConnection -LocalPort 27017 -State Listen -ErrorAction SilentlyContinue)
if (-not $mongoListening) {
    $dbPath = Join-Path $Root "data\db"
    New-Item -ItemType Directory -Force -Path $dbPath | Out-Null
    $mongodExe = "C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe"
    if (Test-Path $mongodExe) {
        Write-Host "[1/3] Starting MongoDB on port 27017..." -ForegroundColor Cyan
        Start-Process -FilePath $mongodExe -ArgumentList "--dbpath `"$dbPath`" --port 27017 --bind_ip 127.0.0.1" -WindowStyle Minimized
        Start-Sleep -Seconds 3
    } else {
        Write-Host "[!] mongod.exe not found at $mongodExe. Ensure MongoDB is running on port 27017." -ForegroundColor Yellow
    }
} else {
    Write-Host "[1/3] MongoDB is already running on port 27017." -ForegroundColor Green
}

# 2. Start FastAPI Backend
$backendListening = (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)
if (-not $backendListening) {
    Write-Host "[2/3] Starting FastAPI backend on http://localhost:8000..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000"
    Start-Sleep -Seconds 3
} else {
    Write-Host "[2/3] FastAPI backend is already running on port 8000." -ForegroundColor Green
}

# 3. Start Next.js Frontend
$frontendListening = (Get-NetTCPConnection -LocalPort 3005 -State Listen -ErrorAction SilentlyContinue)
if (-not $frontendListening) {
    Write-Host "[3/3] Starting Next.js frontend on http://localhost:3005..." -ForegroundColor Cyan
    $frontendDir = Join-Path $Root "frontend"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$frontendDir'; npm run dev"
} else {
    Write-Host "[3/3] Next.js frontend is already running on port 3005." -ForegroundColor Green
}

Write-Host "`nAll services launched!" -ForegroundColor Green
Write-Host "  Frontend: http://localhost:3005"
Write-Host "  API Docs: http://localhost:8000/docs"

