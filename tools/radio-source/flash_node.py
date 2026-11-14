"""Flash the locked package and provision a backed-up secondary node entirely in memory."""
import argparse,base64,contextlib,hashlib,importlib.util,io,json,sys
from pathlib import Path
from configure_source import NVS_OFFSET,NVS_SIZE,PAGE_SIZE,inspect_config
EXPECTED={'bootloader.bin':0,'partition-table.bin':0x8000,'ota_data_initial.bin':0xf000,'esp32-csi-node.bin':0x20000}

def package_images(package,lock):
 manifest=json.loads((package/'flash-manifest.json').read_text(encoding='utf-8-sig'))
 if manifest['firmwareCommit']!=lock['commit'] or manifest['chip']!='esp32s3' or manifest['flashSettings']!={'mode':'dio','frequency':'80m','size':'8MB'}:raise ValueError('Package does not match documented lock')
 if len(manifest['files'])!=len(EXPECTED) or {f['name'] for f in manifest['files']}!=set(EXPECTED):raise ValueError('Unexpected package artifacts')
 images=[]
 for f in manifest['files']:
  if int(f['offset'],0)!=EXPECTED[f['name']]:raise ValueError('Unexpected flash offset')
  data=(package/f['name']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Package checksum mismatch')
  images.append((EXPECTED[f['name']],data))
 return images

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['flash','restore']);p.add_argument('--port',required=True);p.add_argument('--private-root',type=Path,required=True);p.add_argument('--backup',type=Path,required=True);p.add_argument('--node-id',type=int,choices=range(2,6),required=True);p.add_argument('--package',type=Path);p.add_argument('--lock',type=Path);a=p.parse_args()
 spec=importlib.util.spec_from_file_location('credential_store',a.private_root/'credential_store.py');helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
 saved=json.loads(helper.crypt(a.backup.read_bytes(),decrypt=True));factory=base64.b64decode(saved['flash'])
 if len(factory)!=8*1024*1024 or hashlib.sha256(factory).hexdigest()!=saved['sha256']:raise ValueError('Recovery backup integrity failure')
 images=[(0,factory)]
 if a.action=='flash':
  if not a.package or not a.lock:raise ValueError('Locked package required')
  images=package_images(a.package,json.loads(a.lock.read_text(encoding='utf-8-sig')))
  config=json.loads(helper.crypt((a.private_root/'wifi-profile.dpapi').read_bytes(),decrypt=True));source=json.loads((a.private_root/'radio-source.local.json').read_text(encoding='utf-8-sig'))
  mac=bytes.fromhex(source['filter_mac'].replace(':',''))
  if len(mac)!=6 or mac[0]&1 or not 2400<=source['frequency_mhz']<2500:raise ValueError('Expected verified 2.4 GHz unicast source')
  from esp_idf_nvs_partition_gen.nvs_partition_gen import nvs_open,Page
  out=io.BytesIO()
  with nvs_open(out,NVS_SIZE-PAGE_SIZE,version=Page.VERSION2) as nvs:
   nvs.write_namespace('csi_cfg')
   for key in ['ssid','password','target_ip']:nvs.write_entry(key,config[key],'string')
   nvs.write_entry('target_port',config['target_port'],'u16');nvs.write_entry('node_id',a.node_id,'u8');nvs.write_entry('filter_mac',mac.hex(),'hex2bin')
  nvs_data=out.getvalue()
  if helper.decode_config(nvs_data)!=config or inspect_config(nvs_data)[1]['node_id'][24]!=a.node_id:raise ValueError('NVS generation verification failed')
  images.append((NVS_OFFSET,nvs_data));images.sort(key=lambda item:item[0])
 import esptool
 from esptool.cmds import detect_flash_size,write_flash
 output=sys.stdout
 def report(message):print(message,file=output,flush=True)
 esp=None
 with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
  try:
   esp=esptool.detect_chip(a.port,baud=115200)
   if esp.CHIP_NAME!='ESP32-S3':raise ValueError('Unexpected chip')
   esp=esp.run_stub();esp.change_baud(921600)
   if detect_flash_size(esp)!='8MB' or list(esp.read_mac())!=saved['device']:raise ValueError('Recovery backup belongs to another board')
   first=json.loads(helper.crypt((a.private_root/'node1-pre-source-filter-nvs.dpapi').read_bytes(),decrypt=True))
   if saved['device']==first['device']:raise ValueError('Refusing to modify first node')
   report('Recovery backup, board identity, package and NVS verified. Writing secondary node.')
   if a.action=='flash':write_flash(esp,images,flash_mode='dio',flash_freq='80m',flash_size='8MB')
   else:write_flash(esp,images,flash_mode='keep',flash_freq='keep',flash_size='keep')
   for offset,data in images:
    if esp.read_flash(offset,len(data))!=data:raise ValueError('Flash readback mismatch')
   report(json.dumps({'action':a.action,'node_id':a.node_id,'all_written_regions_verified':True}))
  finally:
   if esp is not None:
    try:esp.hard_reset()
    finally:esp._port.close()

if __name__=='__main__':
 try:main()
 except Exception as exc:
  print('Secondary node operation failed: '+type(exc).__name__,file=sys.stderr);sys.exit(1)
