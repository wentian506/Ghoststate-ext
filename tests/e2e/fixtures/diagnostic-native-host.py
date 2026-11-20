#!/usr/bin/env python3
"""Synthetic status-only native host for Chromium diagnostics tests; no BLE."""
import json, os, struct, sys
from pathlib import Path
path=Path(os.environ['HOME'])/'diagnostic-status.json'
while True:
    header=sys.stdin.buffer.read(4)
    if len(header)!=4: break
    n=struct.unpack('=I',header)[0]
    if not 0<n<=65536: break
    body=sys.stdin.buffer.read(n)
    if len(body)!=n: break
    message=json.loads(body)
    data=json.loads(path.read_text())
    if data.get('crash'): sys.exit(0)
    result={'id':message['id'],'ok':message.get('op')=='status','data':data,'error':'Test host only supports status'}
    encoded=json.dumps(result).encode()
    sys.stdout.buffer.write(struct.pack('=I',len(encoded))+encoded);sys.stdout.buffer.flush()
