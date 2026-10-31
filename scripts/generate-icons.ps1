# Generate Antigravity-style ProLogic Icons & Branding
# Uses Electron Chromium Canvas pipeline for subpixel anti-aliasing and zero-artifact alpha transparency
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$jsScript = Join-Path $scriptDir "generate-icons.js"

Write-Host "Generating pristine icons and branding via $jsScript..."
npx electron $jsScript
