#!/bin/bash
# Runs once, when the database volume is first created. The app connects as
# erp_app, a regular role, so Postgres row-level security applies to it.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username postgres <<SQL
CREATE ROLE erp_app LOGIN PASSWORD '${APP_DB_PASSWORD}';
CREATE DATABASE erp OWNER erp_app;
SQL
