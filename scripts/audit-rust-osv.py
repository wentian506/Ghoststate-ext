#!/usr/bin/env python3
"""Query OSV for the exact crates.io versions in Cargo.lock. Network is required."""
import json, sys, tomllib, urllib.request
from pathlib import Path
lock = Path(__file__).resolve().parents[1] / 'apps/desktop-companion/Cargo.lock'
data = tomllib.loads(lock.read_text())
packages = [(p['name'],p['version']) for p in data['package'] if p.get('source','').startswith('registry+')]
queries = [{'package':{'name':name,'ecosystem':'crates.io'},'version':version} for name,version in packages]
request = urllib.request.Request('https://api.osv.dev/v1/querybatch',data=json.dumps({'queries':queries}).encode(),headers={'Content-Type':'application/json'})
try:
    with urllib.request.urlopen(request,timeout=40) as response: results=json.load(response)['results']
except Exception as exc:
    print(f'OSV scan failed: {exc}',file=sys.stderr);sys.exit(2)
if not isinstance(results,list) or len(results) != len(packages):
    print('OSV scan failed: incomplete batch response',file=sys.stderr);sys.exit(2)
found=[]
for (name,version),result in zip(packages,results):
    for vuln in result.get('vulns',[]): found.append((name,version,vuln['id']))
print(f'OSV scanned {len(packages)} locked crates; {len(found)} advisory matches.')
for name,version,ident in found: print(f'{name}@{version}: {ident}')
sys.exit(1 if found else 0)
