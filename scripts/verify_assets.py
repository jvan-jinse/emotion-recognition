from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parents[1]
lock = json.loads((root / 'assets.lock.json').read_text(encoding='utf-8'))
for asset in lock['assets']:
    data = (root / asset['path']).read_bytes()
    assert len(data) == asset['bytes'], f"Size mismatch: {asset['path']}"
    assert hashlib.sha256(data).hexdigest() == asset['sha256'], f"Hash mismatch: {asset['path']}"
for manifest in (root / 'public/models').glob('*manifest.json'):
    for group in json.loads(manifest.read_text()):
        for shard in group['paths']:
            assert (manifest.parent / shard).is_file(), f'Missing shard: {shard}'
print(f"PASS {len(lock['assets'])} pinned assets, SHA-256 and model shards")
