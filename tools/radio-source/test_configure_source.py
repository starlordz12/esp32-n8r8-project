import io,unittest
from configure_source import append_source_filter,inspect_config,NVS_SIZE
from esp_idf_nvs_partition_gen.nvs_partition_gen import nvs_open,Page

class SourceFilterTests(unittest.TestCase):
    def fixture(self):
        output=io.BytesIO()
        with nvs_open(output,NVS_SIZE-4096,version=Page.VERSION2) as nvs:
            nvs.write_namespace('csi_cfg')
            nvs.write_entry('node_id',42,'u8')
            nvs.write_entry('ssid','placeholder network ','string')
            nvs.write_entry('password','placeholder password','string')
            nvs.write_namespace('unrelated')
            nvs.write_entry('opaque','00112233445566778899aabbccddeeff','hex2bin')
        return output.getvalue()
    def test_append_preserves_existing_partition_bytes(self):
        before=self.fixture();self.assertEqual(len(before),NVS_SIZE)
        after=append_source_filter(before,'02:11:22:33:44:55')
        self.assertEqual(len(after),len(before))
        _,keys=inspect_config(after)
        self.assertIn('filter_mac',keys)
        self.assertEqual(keys['node_id'][24],42)
        # No existing payload/header/bitmap bits may be changed from 0 to 1.
        self.assertTrue(all((a&b)==b for a,b in zip(before,after)))
        for offset in range(len(before)):
            if before[offset]!=255 and offset%4096>=64:
                self.assertEqual(before[offset],after[offset])
        with self.assertRaises(ValueError):append_source_filter(after,'02:11:22:33:44:55')
    def test_rejects_bad_address_and_corrupt_page(self):
        before=self.fixture()
        with self.assertRaises(ValueError):append_source_filter(before,'ff:ff:ff:ff:ff:ff')
        bad=bytearray(before);bad[10]^=1
        with self.assertRaises(ValueError):append_source_filter(bytes(bad),'02:11:22:33:44:55')

if __name__=='__main__':unittest.main()
