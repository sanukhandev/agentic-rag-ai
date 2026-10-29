import tempfile,unittest
from pathlib import Path
from server import database,create_payment,settle,get_payment
VALID={'invoice_ref':'INV-DEV-001','amount':'100.00','currency':'AED'}
class MockPayTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.conn=database(Path(self.tmp.name)/'pay.sqlite3')
    def tearDown(self):self.conn.close();self.tmp.cleanup()
    def test_same_key_is_idempotent(self):
        a=create_payment(self.conn,'key-12345678',VALID);b=create_payment(self.conn,'key-12345678',VALID);self.assertEqual(a['id'],b['id'])
    def test_no_card_fields(self):
        with self.assertRaises(ValueError):create_payment(self.conn,'key-12345678',{**VALID,'card_number':'4111111111111111'})
    def test_key_conflict(self):
        create_payment(self.conn,'key-12345678',VALID)
        with self.assertRaises(ValueError):create_payment(self.conn,'key-12345678',{**VALID,'amount':'200.00'})
    def test_mock_paid(self):
        p=create_payment(self.conn,'key-12345678',VALID);done=settle(self.conn,p['id'],'settle-12345678');self.assertEqual(done['status'],'mock_paid');self.assertEqual(done['version'],1)
        self.assertEqual(settle(self.conn,p['id'],'settle-12345678')['version'],1)
    def test_invalid_amount(self):
        with self.assertRaises(ValueError):create_payment(self.conn,'key-12345678',{**VALID,'amount':'NaN'})
if __name__=='__main__':unittest.main()
