import hashlib,json,tempfile,unittest
from pathlib import Path
from flash_node import package_images,EXPECTED
class ManifestTests(unittest.TestCase):
 def test_rejects_wrong_pin_and_dangerous_offset_even_with_valid_checksums(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);files=[]
   for name,offset in EXPECTED.items():
    data=name.encode();(root/name).write_bytes(data);files.append({'name':name,'offset':hex(offset),'sha256':hashlib.sha256(data).hexdigest()})
   manifest={'firmwareCommit':'pinned-test','chip':'esp32s3','flashSettings':{'mode':'dio','frequency':'80m','size':'8MB'},'files':files}
   path=root/'flash-manifest.json';path.write_text(json.dumps(manifest))
   self.assertEqual(len(package_images(root,{'commit':'pinned-test'})),4)
   with self.assertRaises(ValueError):package_images(root,{'commit':'other'})
   manifest['files'][0]['offset']='0x9000';path.write_text(json.dumps(manifest))
   with self.assertRaises(ValueError):package_images(root,{'commit':'pinned-test'})
 def test_rejects_modified_image(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);files=[]
   for name,offset in EXPECTED.items():
    (root/name).write_bytes(b'changed');files.append({'name':name,'offset':hex(offset),'sha256':hashlib.sha256(b'original').hexdigest()})
   (root/'flash-manifest.json').write_text(json.dumps({'firmwareCommit':'pinned-test','chip':'esp32s3','flashSettings':{'mode':'dio','frequency':'80m','size':'8MB'},'files':files}))
   with self.assertRaises(ValueError):package_images(root,{'commit':'pinned-test'})
if __name__=='__main__':unittest.main()
