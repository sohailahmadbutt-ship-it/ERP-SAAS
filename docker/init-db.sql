-- The app connects as a regular role (not superuser), so Postgres row-level
-- security policies apply to every query it makes.
CREATE ROLE erp_app LOGIN PASSWORD 'erp_app' CREATEDB;
CREATE DATABASE erp OWNER erp_app;
