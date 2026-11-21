"""Create a verified, Windows-user-encrypted full-flash backup of a new board."""
import argparse,base64,contextlib,hashlib,importlib.util,io,json,sys
from pathlib import Path

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--port',required=True);p.add_argument('--private-root',type=Path,required=True);p.add_argument('--backup',type=Path,required=True);a=p.parse_args()
 spec=importlib.util.spec_from_file_location('credential_store',a.private_root/'credential_store.py');helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
 import esptool
 from esptool.cmds import detect_flash_size
 output=sys.stdout
 def report(message):print(message,file=output,flush=True)
 def progress(stage):
  last=[-1]
  def update(done,total,*unused):
   part=done//(2*1024*1024)
   if part!=last[0]:last[0]=part;report(stage+': '+str(min(100,int(done*100/total)))+'%')
  return update
 esp=None
 with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
  try:
   if a.backup.exists():raise ValueError('Existing backup requires review')
   esp=esptool.detect_chip(a.port,baud=115200)
   if esp.CHIP_NAME!='ESP32-S3':raise ValueError('Unexpected chip')
   esp=esp.run_stub();esp.change_baud(921600)
   if detect_flash_size(esp)!='8MB':raise ValueError('Unexpected flash size')
   device=list(esp.read_mac());first=json.loads(helper.crypt((a.private_root/'node1-pre-source-filter-nvs.dpapi').read_bytes(),decrypt=True))
   if device==first['device']:raise ValueError('Refusing to operate on first node')
   report('Distinct ESP32-S3 / 8 MB board verified. Starting full recovery backup.')
   data=esp.read_flash(0,8*1024*1024,progress_fn=progress('Backup read'))
   digest=hashlib.sha256(data).hexdigest()
   check=esp.read_flash(0,8*1024*1024,progress_fn=progress('Verification read'))
   if hashlib.sha256(check).hexdigest()!=digest:raise ValueError('Independent read mismatch')
   payload=json.dumps({'device':device,'chip':'ESP32-S3','size':len(data),'sha256':digest,'flash':base64.b64encode(data).decode()}).encode()
   with a.backup.open('xb') as f:f.write(helper.crypt(payload))
   saved=json.loads(helper.crypt(a.backup.read_bytes(),decrypt=True))
   if hashlib.sha256(base64.b64decode(saved['flash'])).hexdigest()!=digest:raise ValueError('Encrypted backup verification failed')
   report('Full recovery backup independently verified and encrypted. No flash writes performed.')
  finally:
   if esp is not None:
    try:esp.hard_reset()
    finally:esp._port.close()

if __name__=='__main__':
 try:main()
 except Exception as exc:
  print('Board backup failed: '+type(exc).__name__,file=sys.stderr);sys.exit(1)
