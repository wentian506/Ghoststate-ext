#!/usr/bin/env python3
"""Synthetic-only Firefox consent test double; this does not implement or test BLE."""
import json, os, struct, sys, time
from pathlib import Path

def state():
    return {'version':'test-only','platform':'mock','centralSupported':True,'peripheralSupported':True,'listening':False,
            'connectionLimit':8,'pairings':[{'peerId':'synthetic-peer','code':'12345678','peerFingerprint':'test-only-one','localConfirmed':True,'verified':True,'role':'sender'},{'peerId':'synthetic-peer-2','code':'87654321','peerFingerprint':'test-only-two','localConfirmed':True,'verified':True,'role':'sender'}], 'receiverPairing':None,
            'incoming':[{'id':'synthetic-incoming','origin':'https://incoming.example','expires':int(time.time())+120}]}
while True:
    header=sys.stdin.buffer.read(4)
    if len(header)!=4: break
    n=struct.unpack('=I',header)[0]
    if not 0<n<=65536: break
    body=sys.stdin.buffer.read(n)
    if len(body)!=n: break
    msg=json.loads(body);op=msg.get('op');payload=msg.get('payload') or {}
    if op=='status': data=state()
    elif op=='send_grant':
        if payload.get('peerId') not in ('synthetic-peer','synthetic-peer-2') or payload!={'peerId':payload.get('peerId'),'origin':'https://example.test','username':'test-user','password':'test-password'}:
            result={'id':msg['id'],'ok':False,'error':'Unexpected synthetic test data'}
        else:
            marker=Path(os.environ['HOME'])/'mock-send-count'
            marker.write_text(str(int(marker.read_text() if marker.exists() else '0')+1))
            routed=Path(os.environ['HOME'])/'mock-routed-peers'
            routed.write_text((routed.read_text() if routed.exists() else '')+payload['peerId']+'\n')
            result={'id':msg['id'],'ok':True,'data':{'pending':True,'id':'synthetic-sent','expires':int(time.time())+120}}
    elif op=='accept_transfer' and payload.get('id')=='synthetic-incoming':
        data={'id':'synthetic-incoming','origin':'https://incoming.example','username':'incoming-test','password':'incoming-password'}
    else: result={'id':msg['id'],'ok':False,'error':'Unsupported test operation'}
    if op=='status' or (op=='accept_transfer' and payload.get('id')=='synthetic-incoming'):
        result={'id':msg['id'],'ok':True,'data':data}
    encoded=json.dumps(result).encode();sys.stdout.buffer.write(struct.pack('=I',len(encoded))+encoded);sys.stdout.buffer.flush()
