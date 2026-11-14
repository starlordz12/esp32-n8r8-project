"""Reversibly bind CSI to one transmitter without replacing firmware or NVS settings."""
import argparse
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import zlib

NVS_OFFSET = 0x9000
NVS_SIZE = 0x6000
PAGE_SIZE = 4096


def entries(data):
    if len(data) != NVS_SIZE:
        raise ValueError('Unexpected NVS partition size')
    pages = sorted((data[i:i+PAGE_SIZE] for i in range(0,len(data),PAGE_SIZE)
                    if struct.unpack_from('<I',data,i)[0] in (0xfffffffe,0xfffffffc)),
                   key=lambda p:struct.unpack_from('<I',p,4)[0])
    for page in pages:
        if zlib.crc32(page[4:28],0xffffffff)&0xffffffff != struct.unpack_from('<I',page,28)[0]:
            raise ValueError('NVS page CRC mismatch')
        i=0
        while i<126:
            state=(page[32+i//4] >> (2*(i%4)))&3
            entry=page[64+i*32:96+i*32]
            if state != 2:
                i+=1
                continue
            span=entry[2]
            if not 1<=span<=126-i:
                raise ValueError('Invalid NVS span')
            if zlib.crc32(entry[:4]+entry[8:],0xffffffff)&0xffffffff != struct.unpack_from('<I',entry,4)[0]:
                raise ValueError('NVS entry CRC mismatch')
            yield entry
            i+=span


def inspect_config(data):
    namespaces={}; keys={}
    for entry in entries(data):
        key=entry[8:24].split(b'\0',1)[0].decode('utf-8')
        if entry[0]==0 and entry[1]==1:
            namespaces[entry[24]]=key
        elif namespaces.get(entry[0])=='csi_cfg':
            keys[key]=entry
    matches=[idx for idx,name in namespaces.items() if name=='csi_cfg']
    if len(matches)!=1 or 'node_id' not in keys or keys['node_id'][1]!=1:
        raise ValueError('Expected an explicitly provisioned CSI node')
    return matches[0],keys


def append_source_filter(data,mac):
    from esp_idf_nvs_partition_gen.nvs_partition_gen import nvs_open,Page
    namespace,keys=inspect_config(data)
    if 'filter_mac' in keys:
        raise ValueError('An existing source filter must be reviewed before replacement')
    octets=bytes.fromhex(mac.replace(':',''))
    if len(octets)!=6 or octets[0]&1 or octets==bytes(6):
        raise ValueError('Expected a unicast transmitter address')
    # Generate an official v2 blob, then append its entries into unused slots.
    # Existing namespaces, blobs, credentials, and Wi-Fi runtime state stay intact.
    out=io.BytesIO()
    with nvs_open(out,NVS_SIZE-PAGE_SIZE,version=Page.VERSION2) as nvs:
        nvs.write_entry('filter_mac',octets.hex(),'hex2bin',namespace_idx=namespace)
    page=out.getvalue()[:PAGE_SIZE]
    count=sum(((page[32+i//4]>>(2*(i%4)))&3)==2 for i in range(126))
    fragment=page[64:64+count*32]
    if not 1<=count<=5:
        raise ValueError('Unexpected generated filter layout')
    result=bytearray(data)
    for offset in range(0,NVS_SIZE,PAGE_SIZE):
        p=data[offset:offset+PAGE_SIZE]
        if struct.unpack_from('<I',p)[0]!=0xfffffffe or p[8]!=Page.VERSION2:
            continue
        states=[(p[32+i//4]>>(2*(i%4)))&3 for i in range(126)]
        start=max((i+1 for i,s in enumerate(states) if s!=3),default=0)
        if start+count>126:
            continue
        begin=offset+64+start*32
        if data[begin:begin+len(fragment)]!=b'\xff'*len(fragment):
            raise ValueError('NVS free slots contain unexpected data')
        result[begin:begin+len(fragment)]=fragment
        for i in range(start,start+count):
            result[offset+32+i//4]&=~(1<<(2*(i%4)))
        inspect_config(bytes(result))
        return bytes(result)
    raise ValueError('No active NVS page has enough free slots; no settings were changed')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['apply','restore'])
    parser.add_argument('--port',required=True)
    parser.add_argument('--private-root',type=Path,required=True)
    parser.add_argument('--backup',type=Path,required=True)
    parser.add_argument('--node-id',type=int,required=True)
    args=parser.parse_args()
    spec=importlib.util.spec_from_file_location('credential_store',args.private_root/'credential_store.py')
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    import esptool
    from esptool.cmds import write_flash
    esp=None
    with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
        try:
            esp=esptool.detect_chip(args.port,baud=115200)
            if esp.CHIP_NAME!='ESP32-S3':raise ValueError('Unexpected chip')
            esp=esp.run_stub();esp.change_baud(460800)
            device=list(esp.read_mac())
            if args.action=='apply':
                if args.backup.exists():raise ValueError('Refusing to overwrite backup')
                before=esp.read_flash(NVS_OFFSET,NVS_SIZE)
                if before!=esp.read_flash(NVS_OFFSET,NVS_SIZE):raise ValueError('Backup read mismatch')
                _,keys=inspect_config(before)
                if keys['node_id'][24]!=args.node_id:raise ValueError('Unexpected node identity')
                expected=json.loads(helper.crypt((args.private_root/'wifi-profile.dpapi').read_bytes(),decrypt=True))
                if helper.decode_config(before)!=expected:raise ValueError('Unexpected network configuration')
                payload=json.dumps({'device':device,'node_id':args.node_id,'sha256':hashlib.sha256(before).hexdigest(),
                                    'nvs':base64.b64encode(before).decode()}).encode()
                encrypted=helper.crypt(payload)
                args.backup.write_bytes(encrypted)
                if helper.crypt(args.backup.read_bytes(),decrypt=True)!=payload:raise ValueError('Encrypted backup verification failed')
                source=json.loads((args.private_root/'radio-source.local.json').read_text(encoding='utf-8-sig'))
                after=append_source_filter(before,source['filter_mac'])
                if helper.decode_config(after)!=expected:raise ValueError('Network preservation check failed')
            else:
                saved=json.loads(helper.crypt(args.backup.read_bytes(),decrypt=True))
                if saved['device']!=device or saved['node_id']!=args.node_id:raise ValueError('Backup device mismatch')
                after=base64.b64decode(saved['nvs'])
                if len(after)!=NVS_SIZE or hashlib.sha256(after).hexdigest()!=saved['sha256']:raise ValueError('Backup integrity failure')
            write_flash(esp,[(NVS_OFFSET,after)],flash_mode='keep',flash_freq='keep',flash_size='keep')
            if esp.read_flash(NVS_OFFSET,NVS_SIZE)!=after:raise ValueError('Written NVS verification failed; restore the encrypted backup')
        finally:
            if esp is not None:
                try:esp.hard_reset()
                finally:esp._port.close()
    print(json.dumps({'action':args.action,'verified':True,'node_id':args.node_id,'firmware_changed':False}))


if __name__=='__main__':
    try:main()
    except Exception as exc:
        # Tool errors may contain configuration data. Never print exception values.
        print('Radio configuration failed: '+type(exc).__name__,file=sys.stderr)
        sys.exit(1)
