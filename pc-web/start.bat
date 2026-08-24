@echo off
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=msedge"
start "" "%EDGE%" --app="file:///F:/Claude-memory/our-space/pc-web/index.html" --user-data-dir="F:\Claude-memory\our-space\pc-web\profile"
