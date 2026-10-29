import sys,unittest
sys.path.insert(0,str(__import__('pathlib').Path(__file__).parent))
from render import validate
VALID={'mode':'MOCK','document_type':'invoice','reference':'TEST-001','issue_date':'2026-10-29','currency':'AED','customer_label':'Test visitor','seller_label':'ANCFZ sandbox','items':[{'description':'Approved mock service','quantity':'1','unit_price':'10.00'}],'tax_amount':'0.00','grand_total':'10.00'}
class PdfContract(unittest.TestCase):
    def test_valid(self):self.assertEqual(validate(VALID)[0],'invoice')
    def test_bad_total(self):
        with self.assertRaises(ValueError):validate({**VALID,'grand_total':'12.00'})
    def test_no_real(self):
        with self.assertRaises(ValueError):validate({**VALID,'mode':'PRODUCTION'})
    def test_no_guess_tax(self):
        with self.assertRaises(ValueError):validate({**VALID,'tax_amount':'0.50'})
if __name__=='__main__':unittest.main()
