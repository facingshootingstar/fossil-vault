@echo off
rem Serves Fossil Vault at http://localhost:5173 (ES modules need http://, not file://)
cd /d "%~dp0"
start "" http://localhost:5173
python -m http.server 5173
