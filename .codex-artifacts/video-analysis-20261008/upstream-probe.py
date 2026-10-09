import json, math
from pathlib import Path
from datetime import datetime
from collections import Counter

out = Path('.codex-artifacts/video-analysis-20261008')
up = Path(r'C:\Users\1548u\Desktop\UWB\ui\loc_engine\v9\View\arayuz\logs\yogun_20261008_180124')
source = json.loads(Path('config/maps/necmettin-yogun-bakim/regions.json').read_text(encoding='utf-8'))
positions = [json.loads(l) for l in (up / 'positions.jsonl').read_text(encoding='utf-8').splitlines()]
rows = [json.loads(l) for l in Path('tools/room-benchmark/datasets/test-2a7fecc4-d625-4091-8b6c-a5a056302913/raw.jsonl').read_text(encoding='utf-8').splitlines()]
truth = json.loads(Path('tools/room-benchmark/datasets/test-2a7fecc4-d625-4091-8b6c-a5a056302913/truth.json').read_text(encoding='utf-8'))
def epoch(s): return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
def inside(x, y, polygon):
    result = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if (a['y'] > y) != (b['y'] > y) and x < (b['x'] - a['x']) * (y - a['y']) / (b['y'] - a['y']) + a['x']:
            result = not result
    return result
def location(x, y):
    for r in source['regions']:
        if inside(x, y, [p['world'] for p in r['polygon']]): return r['id']
    return 'outside'
matched = []
for row in rows:
    candidates = [p for p in positions if p['uid'] == row['tag_code'] and -.002 <= epoch(row['created_at']) - p['updated_at'] <= 2 and math.hypot(row['x'] - p['x'], row['y'] - p['y']) < 1e-8]
    if candidates:
        p = min(candidates, key=lambda p: abs(p['updated_at'] - epoch(row['created_at'])))
        matched.append((row, p))
visits = []
for v in truth['visits']:
    pairs = [(r, p) for r, p in matched if epoch(v['from']) <= epoch(r['created_at']) <= epoch(v['to'])]
    visits.append({**v, 'matchedRows': len(pairs), 'upstreamRawLocations': dict(Counter(location(p['raw_x'], p['raw_y']) for r, p in pairs)), 'forwardedLocations': dict(Counter(location(r['x'], r['y']) for r, p in pairs)), 'displayChangedRawByOver1m': sum(math.hypot(p['x'] - p['raw_x'], p['y'] - p['raw_y']) > 1 for r, p in pairs), 'outsideArea': sum(p['outside_area'] for r, p in pairs), 'solverCandidates': dict(Counter(p['solver_candidate'] for r, p in pairs)), 'examples': [{ 'at': r['created_at'], 'forwarded': [r['x'], r['y']], 'solverRaw': [p['raw_x'], p['raw_y']], 'rawLocation': location(p['raw_x'], p['raw_y']), 'forwardedLocation': location(r['x'], r['y']), 'outsideArea': p['outside_area'], 'candidate': p['solver_candidate'] } for r, p in pairs if location(p['raw_x'], p['raw_y']) == v['roomId'] and location(r['x'], r['y']) != v['roomId']][:4]})
result = {'sourceSession': str(up), 'sourcePositions': len(positions), 'dbRows': len(rows), 'matchedRows': len(matched), 'sameDisplayCoordinates': sum(math.hypot(r['x'] - p['x'], r['y'] - p['y']) < 1e-8 for r, p in matched), 'visits': visits, 'forwardedOutsideExamples': [{ 'at': r['created_at'], 'forwarded': [r['x'], r['y']], 'solverRaw': [p['raw_x'], p['raw_y']], 'quality': p['solution_quality'], 'pdop': p['geometry_pdop'], 'outsideArea': p['outside_area'], 'candidate': p['solver_candidate'] } for r, p in matched if location(r['x'], r['y']) == 'outside']}
(out / 'upstream-probe-results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=True, indent=2))
