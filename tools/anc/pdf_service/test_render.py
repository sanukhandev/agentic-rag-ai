import sys,unittest
sys.path.insert(0,str(__import__('pathlib').Path(__file__).parent))
from render import render, validate
from tempfile import TemporaryDirectory
from pathlib import Path
from pypdf import PdfReader
VALID={'mode':'MOCK','document_type':'invoice','reference':'TEST-001','issue_date':'2026-10-29','currency':'AED','customer_label':'Test visitor','seller_label':'ANCFZ sandbox','items':[{'description':'Approved mock service','quantity':'1','unit_price':'10.00'}],'tax_amount':'0.00','grand_total':'10.00'}
class PdfContract(unittest.TestCase):
    def test_valid(self):self.assertEqual(validate(VALID)[0],'invoice')
    def test_bad_total(self):
        with self.assertRaises(ValueError):validate({**VALID,'grand_total':'12.00'})
    def test_no_real(self):
        with self.assertRaises(ValueError):validate({**VALID,'mode':'PRODUCTION'})
    def test_no_guess_tax(self):
        with self.assertRaises(ValueError):validate({**VALID,'tax_amount':'0.50'})
    def test_quote_renders_explicit_customer_fields(self):
        payload={**VALID,'document_type':'quote','customer_name':'Synthetic Customer','customer_email':'synthetic.provider@example.test','customer_phone':'+971501234567'}
        with TemporaryDirectory() as directory:
            output=Path(directory)/'quote.pdf'
            render(payload,output)
            text='\n'.join(page.extract_text() or '' for page in PdfReader(output).pages)
        self.assertIn('Synthetic Customer',text)
        self.assertIn('synthetic.provider@example.test',text)
        self.assertIn('+971501234567',text)
if __name__=='__main__':unittest.main()
