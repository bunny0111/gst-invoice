# Starts the Django API (:8000) and the React dev server (:5173) in two windows.
#   .\start-dev.ps1
# Then open http://localhost:5173  (business workspaces open at http://<slug>.localhost:5173)
$root = $PSScriptRoot
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\backend'; .\.venv\Scripts\python.exe manage.py runserver 8000"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\frontend'; npm run dev"
Write-Host "API  -> http://localhost:8000   (Django)"
Write-Host "Site -> http://localhost:5173   (React - open this one)"
