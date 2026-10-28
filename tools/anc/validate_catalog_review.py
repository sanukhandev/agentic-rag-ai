#!/usr/bin/env python3
"""Self-contained structural audit of proposed ANCFZ catalog review JSON; does not publish the XLSX."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
REQUIRED=['README','Intents','Signals','Slots','Relations','WorkflowBindings','JourneyRequirements','BusinessStages','CatalogManifest']

def validate(data):
 for name in REQUIRED:
  assert name in data and len(data[name])>1, f'Missing sheet or content: {name}'
 intents={r[0] for r in data['Intents'][1:]}
 bindings={r[0] for r in data['WorkflowBindings'][1:]}
 assert 'anc.company_setup' in intents
 assert len(intents)==len(data['Intents'])-1
 assert all(r[0] in intents for r in data['Signals'][1:])
 assert all(r[0] in intents for r in data['Slots'][1:])
 assert all(r[0] in intents for r in data['JourneyRequirements'][1:])
 assert all(r[4] in bindings for r in data['Intents'][1:])
 assert all(r[5] is False for r in data['WorkflowBindings'][1:]),'Premature activation forbidden'
 assert all(r[0]==idx for idx,r in enumerate(data['BusinessStages'][1:],1))
 for k in ['lead_generation','lead_qualification','account_creation','package_selection','document_upload','billing_invoice','contract']:
  assert k in {r[1] for r in data['BusinessStages'][1:]}
 assert any(r[1]=='contact_consent' and r[7]=='boolean:explicit_opt_in' for r in data['Slots'][1:])
 assert data['DocumentSettings'][1][1] is False
 assert len(data['TestUtterances'])>=26
 return {'result':'PASS','intents':len(intents),'signals':len(data['Signals'])-1,'workflow_bindings':len(bindings),'business_stages':7,'source_approved':False,'publish_ready':False}

if __name__=='__main__':
 data=json.loads((ROOT/'intent-source/ANCFZ_CATALOG_REVIEW_ROWS.json').read_text(encoding='utf-8'))
 print(json.dumps(validate(data),indent=2))
