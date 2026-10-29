import glob,json,unittest
from pathlib import Path
BASE=Path(__file__).resolve().parents[2]/'infra/n8n/workflows'
EXPECTED=('ANCInvoicePDFWF1.json','ANCPaymentMockWF1.json','ANCQuotePDFWF1.json')
class Tests(unittest.TestCase):
 def test_workflows_are_inactive_and_connected(self):
  paths=[BASE/name for name in EXPECTED]
  self.assertTrue(all(path.is_file() for path in paths))
  for p in paths:
   d=json.loads(p.read_text());self.assertFalse(d['active']);self.assertEqual(len(d['connections']),len(d['nodes'])-1)
   self.assertTrue(all(n['type'] in ('n8n-nodes-base.code','n8n-nodes-base.httpRequest','n8n-nodes-base.webhook') for n in d['nodes']))
   for n in d['nodes']:
    if n['type']=='n8n-nodes-base.httpRequest':
     self.assertEqual(n['parameters']['authentication'],'genericCredentialType');self.assertEqual(n['parameters']['genericAuthType'],'httpHeaderAuth')
 def test_no_credentials_or_fake_success(self):
  for p in BASE.glob('*.json'):
   text=p.read_text().lower();self.assertNotIn('client_secret',text);self.assertNotIn('access_token',text);self.assertNotIn('oauth2:',text)
  payment=json.loads((BASE/'ANCPaymentMockWF1.json').read_text())
  self.assertIn('pending only',payment['name']);self.assertNotIn('state:\'completed\'',json.dumps(payment))
 def test_unlinked_leads_create_and_linked_leads_reconcile(self):
  workflow=json.loads((BASE/'03-anc-lead-capture-wf-1.json').read_text())
  routes=workflow['connections']['Existing Remote CRM Identity?']['main']
  self.assertEqual(routes[0][0]['node'],'Remote CRM Create Lead')
  self.assertEqual(routes[1][0]['node'],'Reconcile Existing CRM Lead')
if __name__=='__main__':unittest.main()
