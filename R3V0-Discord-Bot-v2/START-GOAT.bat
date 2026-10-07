@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo GOAT: Install Node.js 24 LTS first from https://nodejs.org/
  pause
  exit /b 1
)
node -e "const p=process.versions.node.split('.').map(Number);process.exit(p[0]>24 || p[0]===24&&p[1]>=15?0:1)"
if errorlevel 1 (
  echo GOAT: Node.js 24.15 or newer is required. Install the latest Node.js 24 LTS.
  pause
  exit /b 1
)
if not exist .env (
  copy .env.example .env >nul
  echo GOAT: Add your bot token in the file that opens. Save, close, then run this launcher again.
  notepad .env
  exit /b 0
)
node -e "const fs=require('fs');const s=fs.readFileSync('.env','utf8');const m=s.match(/^\s*DISCORD_TOKEN\s*=\s*(.*)$/m);process.exit(!m||!m[1].trim()||m[1].includes('PASTE_YOUR_BOT_TOKEN_HERE')?1:0)"
if errorlevel 1 (
  echo GOAT: Add your token as DISCORD_TOKEN in .env, then save the file.
  notepad .env
  exit /b 0
)
if not exist node_modules (
  call npm ci --no-audit --no-fund
  if errorlevel 1 goto failed
)
call npm run build
if errorlevel 1 goto failed
call npm start
if errorlevel 1 goto failed
exit /b 0
:failed
echo GOAT could not start. Read the error above and START_HERE_PL.md.
pause
exit /b 1
