@echo off
setlocal
rem ---------------------------------------------------------------------------
rem  Runs the Neo4j vs SQLite benchmark suite.
rem
rem    benchmark.bat                              seed 1000 users, run everything
rem    benchmark.bat --users 10000 --runs 50      bigger dataset, more runs
rem    benchmark.bat --no-seed --ops reachable    reuse existing data, one operation
rem    benchmark.bat --help                       all options
rem
rem  Results are written to the "results" folder (JSON + CSV).
rem ---------------------------------------------------------------------------

cd /d "%~dp0"

where bun >nul 2>&1 || (
  echo Bun was not found. Install it from https://bun.sh
  exit /b 1
)
where docker >nul 2>&1 || (
  echo Docker was not found. Install Docker Desktop to run Neo4j.
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env from .env.example
)

if not exist "node_modules" (
  echo Installing dependencies...
  bun install || exit /b 1
)

echo Starting Neo4j...
docker compose up -d neo4j || (
  echo Could not start Neo4j. Is Docker Desktop running?
  exit /b 1
)

cd server
bun run benchmark %*
set EXITCODE=%ERRORLEVEL%
cd ..

echo.
if %EXITCODE% neq 0 (
  echo Finished with problems. Scroll up for details.
) else (
  echo Finished. Results are in the "results" folder.
)
exit /b %EXITCODE%