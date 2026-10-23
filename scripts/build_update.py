"""Build the supplied update for Sites and ordinary static hosting."""
from pathlib import Path
import re, shutil, zipfile

root=Path(__file__).resolve().parents[1]
public=root/'public'
core=(public/'core.mjs').read_text(encoding='utf-8')
wellbeing=(public/'wellbeing.mjs').read_text(encoding='utf-8')
assessment=(public/'assessment.mjs').read_text(encoding='utf-8')
automatic=(public/'automatic.mjs').read_text(encoding='utf-8')
observations=(public/'observations.mjs').read_text(encoding='utf-8')
adapter=(public/'recognition-adapter.mjs').read_text(encoding='utf-8')
adapter=re.sub(r'^import [^;]+;\s*','',adapter,flags=re.MULTILINE)
app=(public/'app.mjs').read_text(encoding='utf-8')
app,n=re.subn(r'^import [^;]+;\s*','',app,flags=re.MULTILINE)
assert n==6
bundle=';(function(){\n"use strict";\n'+re.sub(r'\bexport\s+','',core)+'\n'+re.sub(r'\bexport\s+','',wellbeing)+'\n'+re.sub(r'\bexport\s+','',assessment)+'\n'+re.sub(r'\bexport\s+','',automatic)+'\n'+re.sub(r'\bexport\s+','',observations)+'\n'+re.sub(r'\bexport\s+','',adapter)+'\n'+app+'\n})();\n'
(public/'app.js').write_text(bundle,encoding='utf-8')
target=root/'dist';target.mkdir(exist_ok=True)
# Only remove obsolete module entry points inside this checkout's build directory.
for name in ['app.mjs','core.mjs','wellbeing.mjs','assessment.mjs','automatic.mjs','observations.mjs','recognition-adapter.mjs','mobile.css']:
    path=target/name
    if path.exists():path.unlink()
for path in public.rglob('*'):
    if path.is_file() and path.suffix!='.mjs' and path.name!='mobile.css':
        dest=target/path.relative_to(public);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,dest)
(target/'_headers').write_text("/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(self), microphone=()\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'\n/index.html\n  Cache-Control: no-cache\n",encoding='utf-8')
(target/'.nojekyll').write_text('',encoding='utf-8')
archive=root.parent/'心晴伴_v6_静态部署包_20261023.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for path in sorted(target.rglob('*')):
        if path.is_file():z.write(path,path.relative_to(target).as_posix())
with zipfile.ZipFile(archive) as z:
    assert 'index.html' in z.namelist() and 'app.js' in z.namelist()
    assert 'models/face_landmark_68_tiny_model-shard1' in z.namelist()
    assert not any(n.endswith('.mjs') or '.git' in n or 'test-results' in n for n in z.namelist())
    assert not any(b'chatgpt.site' in z.read(n) for n in z.namelist())
print('PASS build and portable ZIP:',archive.name,archive.stat().st_size,'bytes')
