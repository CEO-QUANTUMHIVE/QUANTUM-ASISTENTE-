$ErrorActionPreference = 'Stop'

Set-Location $PSScriptRoot

$corepack = Get-Command corepack.cmd -ErrorAction SilentlyContinue
if ($null -eq $corepack) {
  throw 'No encontré Corepack. Reinstalá Node.js con Corepack incluido.'
}

& $corepack.Source pnpm --filter '@quantumhive/assistant-desktop' dev
