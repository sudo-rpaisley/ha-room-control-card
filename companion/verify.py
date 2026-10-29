#!/usr/bin/env python3
"""Stdlib-only offline companion gate; does not access Home Assistant or deploy."""
import compileall
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
if not compileall.compile_dir(ROOT / 'custom_components', quiet=1):
    sys.exit('FAIL: Python compilation')
result = subprocess.run([sys.executable,'-m','unittest','discover','-s',str(ROOT/'tests'),'-v'], cwd=ROOT,check=False)
if result.returncode:
    sys.exit(result.returncode)
print('PASS: companion static/offline checks (HAOS runtime unverified)')
