$ErrorActionPreference = 'Continue'
while ($true) {
    Write-Host "[Tunnel] Connecting to localhost.run..."
    ssh -R 80:localhost:3000 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=no nokey@localhost.run 2>&1 | ForEach-Object {
        $line = $_.ToString()
        Write-Host $line
        if ($line -match 'https://[a-zA-Z0-9]+\.lhr\.life') {
            $url = $matches[0]
            Set-Content -Path "public_url.txt" -Value $url -Force
            Write-Host ">>> SAVED LIVE URL: $url <<<"
        }
    }
    Write-Host "[Tunnel] Disconnected. Reconnecting in 3 seconds..."
    Start-Sleep -Seconds 3
}
