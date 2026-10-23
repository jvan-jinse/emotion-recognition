"""Download pinned upstream browser assets, with provenance and SHA-256 hashes."""
from pathlib import Path
import concurrent.futures
import hashlib
import json
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REPO = 'justadudewhohacks/face-api.js'
UPSTREAM_COMMIT = 'a86f011d72124e5fb93e59d5c4ab98f699dd5c9c'


def get(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'expression-observatory-demo'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def main():
    commit = UPSTREAM_COMMIT
    raw = f'https://raw.githubusercontent.com/{REPO}/{commit}'
    sample_path = 'examples/images/bbt1.jpg'
    assets = {
        'public/vendor/face-api.min.js': f'{raw}/dist/face-api.min.js',
        'public/models/tiny_face_detector_model-weights_manifest.json': f'{raw}/weights/tiny_face_detector_model-weights_manifest.json',
        'public/models/tiny_face_detector_model-shard1': f'{raw}/weights/tiny_face_detector_model-shard1',
        'public/models/face_expression_model-weights_manifest.json': f'{raw}/weights/face_expression_model-weights_manifest.json',
        'public/models/face_expression_model-shard1': f'{raw}/weights/face_expression_model-shard1',
        'THIRD_PARTY_LICENSES/face-api.js-LICENSE': f'{raw}/LICENSE',
        'tests/fixtures/bbt1.jpg': f'{raw}/{sample_path}',
    }

    def download(item):
        relative, url = item
        data = get(url)
        target = ROOT / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        print(f'{relative}: {len(data)} bytes', flush=True)
        return {'path': relative, 'url': url, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        records = list(pool.map(download, assets.items()))
    (ROOT / 'assets.lock.json').write_text(json.dumps({'repository': f'https://github.com/{REPO}', 'commit': commit, 'assets': records}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Pinned commit: {commit}')


if __name__ == '__main__':
    main()
