"""Compatibility entry point for the current portable static build."""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).with_name('build_update.py')),run_name='__main__')
