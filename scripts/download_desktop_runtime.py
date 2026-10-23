"""Download the pinned official Electron Windows x64 runtime and verify SHA-256."""
from pathlib import Path
import hashlib, urllib.request, zipfile, time, json

VERSION = '45.0.0'
SHA256 = 'ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47'
URL = f'https://github.com/electron/electron/releases/download/v{VERSION}/electron-v{VERSION}-win32-x64.zip'
root = Path(__file__).resolve().parents[1]
cache = root.parent / 'desktop-runtime'
cache.mkdir(exist_ok=True)
archive = cache / f'electron-v{VERSION}-win32-x64.zip'
if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
    partial = archive.with_suffix('.partial')
    with urllib.request.urlopen(urllib.request.Request(URL, headers={'User-Agent':'Xinqing-local-build'}), timeout=40) as response, partial.open('wb') as out:
        total = int(response.headers.get('Content-Length','0'))
        size = 0;last = time.monotonic()
        while True:
            block = response.read(1024 * 1024)
            if not block: break
            out.write(block);size += len(block)
            if time.monotonic() - last > 10:
                print(f'Electron official runtime: {size // 1048576}/{total // 1048576} MiB',flush=True);last = time.monotonic()
    if hashlib.sha256(partial.read_bytes()).hexdigest() != SHA256:
        raise RuntimeError('Official runtime SHA-256 mismatch')
    partial.replace(archive)
target = cache / 'electron-win32-x64'
target.mkdir(exist_ok=True)
with zipfile.ZipFile(archive) as z:
    for name in z.namelist():
        if not (target / name).resolve().is_relative_to(target.resolve()):
            raise RuntimeError('Unsafe archive path')
    z.extractall(target)
(cache/'runtime-lock.json').write_text(json.dumps({'version':VERSION,'url':URL,'sha256':SHA256},indent=2),encoding='utf-8')
print('PASS verified official Electron runtime:',target,flush=True)
