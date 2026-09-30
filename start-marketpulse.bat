@echo off
rem Starts the Abulkour backend so the phone app can connect.
rem Keep this window open (minimize it). Close it to stop Abulkour.
title Abulkour server
cd /d "%~dp0server"
echo Starting Abulkour server on port 4000...
echo Phone app download page: http://localhost:4000/download
npm run start
pause
