$ErrorActionPreference = 'Stop'
$port = if ($env:REMOTE_SMART_TRACKPAD_PORT) { $env:REMOTE_SMART_TRACKPAD_PORT } else { '8765' }
$url = "http://127.0.0.1:$port/setup"
try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/setup" -TimeoutSec 2
    if ($status.app -ne 'remote-smart-trackpad') { exit 1 }
    Start-Process -FilePath $url
    exit 0
} catch {
    exit 1
}
