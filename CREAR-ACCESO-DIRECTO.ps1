$ErrorActionPreference = 'Stop'

$desktop = [Environment]::GetFolderPath('Desktop')
$target = Join-Path $PSScriptRoot 'INICIAR-QUANTUM-ASSISTANT.cmd'
$shortcutPath = Join-Path $desktop 'Quantum Assistant.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = 'Iniciar Quantum Assistant'
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,220"
$shortcut.Save()

Start-Process -FilePath $shortcutPath
