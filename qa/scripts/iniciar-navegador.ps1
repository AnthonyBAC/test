param([int]$Port=9227)
$ErrorActionPreference='Stop'
$repo=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$profile=Join-Path $repo 'qa\.private\edge-profile'
$candidates=@((Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),(Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'))
$edge=$candidates|Where-Object {Test-Path -LiteralPath $_}|Select-Object -First 1
if(!$edge){throw 'No se encontró Microsoft Edge; inicia un navegador Chromium con depuración local en el puerto configurado.'}
New-Item -ItemType Directory -Path $profile -Force|Out-Null
Start-Process -FilePath $edge -WindowStyle Hidden -ArgumentList @("--remote-debugging-port=$Port",'--remote-debugging-address=127.0.0.1',"--user-data-dir=`"$profile`"",'--no-first-run','--no-default-browser-check','about:blank')
Write-Output "Navegador QA con perfil independiente y depuración local: http://localhost:$Port"
