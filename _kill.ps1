$ports = @(3001, 18789)
foreach ($port in $ports) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        foreach ($c in $conn) {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}
Start-Sleep -Seconds 2
$remaining = netstat -ano | Select-String '18789|3001' | Select-String 'LISTEN'
if ($remaining) {
    Write-Host 'Ports still in use:'
    Write-Host $remaining
} else {
    Write-Host 'All ports cleared'
}
