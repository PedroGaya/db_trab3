@echo off
setlocal
rem ---------------------------------------------------------------------------
rem  Runs every measurement needed for the Neo4j vs SQLite strengths/weaknesses
rem  table and extracts the numbers into CSV files.
rem
rem    gen_table.bat                          sizes 1000, 10000, 100000 (slow)
rem    gen_table.bat --sizes 1000,10000       smaller and faster
rem    gen_table.bat --skip-startup           don't restart the Neo4j container
rem    gen_table.bat --help                   all options
rem
rem  WARNING: reseeds both databases for every size, wiping existing data.
rem  Output goes to results\table-<timestamp>\ :
rem    table_summary.csv   the table (one row per metric, at the largest size)
rem    table_detail.csv    every number measured, at every size
rem    measurements.json   raw data
rem    benchmark-*.json/csv the individual benchmark runs
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

echo.
echo This can take a while at 100000 users. Leave the window open.
echo.

cd server
bun run gen-table %*
set EXITCODE=%ERRORLEVEL%
cd ..

echo.
if %EXITCODE% neq 0 (
  echo Finished with problems. Scroll up for details.
) else (
  echo Finished. See the newest folder under "results".
)
exit /b %EXITCODE%