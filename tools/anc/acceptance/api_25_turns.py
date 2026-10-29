#!/usr/bin/env python3
"""25+ real HTTP customer turns in a single session; eight runs = 200 turns.
No fake API or bypass. Does NOT confirm external actions or claim Salesforce/provider completion.
Run against a sandbox instance configured with approved synthetic data.
"""
from __future__ import annotations
import argparse
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib import request, error, parse

TURNS=[
 'Hello, I want to set up a business.',
 'I am exploring a fashion boutique.',
 'What are the company setup options from your approved documents?',
 'I want to understand the licensing process.',
 'What are the eligibility requirements?',
 'I may need one visa for the business.',
 'Please explain the visa options only if they are in your sources.',
 'Can you explain the expected setup steps?',
 'I am thinking of a next-month timeline.',
 'My budget is not fixed yet.',
 'I would also like a quotation.',
 'Show only officially approved package information.',
 'If prices are not confirmed, please say so.',
 'I prefer to speak to an advisor.',
 'My name for this synthetic test is Demo Example.',
 'My test email address is demo.example@example.com.',
 'My test phone number is +971500000000.',
 'I consent to contact only for this company formation enquiry in this sandbox.',
 'Please do not disclose any other customer information.',
 'Actually, my planned timeline is two months, not next month.',
 'Can you explain which documents could be requested?',
 'Please do not ask for sensitive identification unless the approved policy requires it.',
 'Can you recap what I told you about the company and the visa?',
 'What is the current status of my enquiry, without assuming the CRM succeeded?',
 'Do we have anything else to clarify before a real adviser reviews it?',
]

def call(url,method='GET',payload=None,headers=None,timeout=40):
 data=json.dumps(payload).encode() if payload is not None else None
 req=request.Request(url,data=data,method=method,headers={'Content-Type':'application/json',**(headers or {})})
 try:
  with request.urlopen(req,timeout=timeout) as resp:return resp.status,json.loads(resp.read().decode())
 except error.HTTPError as ex:
  raw=ex.read().decode(errors='replace')
  try:obj=json.loads(raw)
  except json.JSONDecodeError:obj={'error':'non_json_response'}
  return ex.code,obj

def run(base,tenant,origin,idx,timeout):
 common={'Origin':origin}
 status,opened=call(base+'/api/v1/chat/sessions','POST',{'tenantSlug':tenant},common,timeout)
 if status!=201:raise RuntimeError(f'Cannot create sandbox session: HTTP {status}, {opened.get("error",{}).get("code","unknown")}')
 session=opened['sessionId'];report=[]
 for turn_no,message in enumerate(TURNS,1):
  idemp=f'ancfz-demo-{idx}-{turn_no}-{uuid.uuid4().hex[:12]}'
  status,resp=call(base+'/api/v1/chat/messages','POST',{'sessionId':session,'clientMessageId':idemp,'message':message},common,timeout)
  answer=resp.get('answer')
  report.append({'turn':turn_no,'status':status,'answer_present':isinstance(answer,str) and bool(answer.strip()),'error_code':resp.get('error',{}).get('code') if isinstance(resp.get('error'),dict) else None,'conversation_phase':resp.get('phase'),'catalog_requirement_key':resp.get('catalogRequirementKey')})
  if status!=200 or not isinstance(answer,str) or not answer.strip():break
 # Historical query verifies durable customer turns; it does not verify provider completion.
 status,history=call(base+'/api/v1/chat/sessions/'+session+'?limit=200',headers=common,timeout=timeout)
 user_ids=[m.get('clientMessageId') for m in history.get('messages',[]) if m.get('role')=='user'] if status==200 else []
 return {'session_id':session,'turns_sent':len(report),'all_http_answers':len(report)==25 and all(x['answer_present'] and x['status']==200 for x in report),'history_http_status':status,'durable_unique_user_messages':len(set(x for x in user_ids if x)),'history_has_25_turns':len(set(x for x in user_ids if x))>=25,'turn_checks':report}

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--api-base',default='http://127.0.0.1:4000');ap.add_argument('--tenant',default='anc-test');ap.add_argument('--origin',default='http://localhost:3000');ap.add_argument('--scenarios',type=int,choices=[1,8],default=1);ap.add_argument('--out',type=Path,default=Path('artifacts/ancfz/api-25-turns.json'));ap.add_argument('--timeout',type=int,default=40);a=ap.parse_args()
 if not a.api_base.startswith(('http://127.0.0.1:','http://localhost:','https://')):raise SystemExit('Refusing arbitrary HTTP API; local or HTTPS only')
 started=datetime.now(timezone.utc).isoformat();runs=[]
 for i in range(a.scenarios):
  r=run(a.api_base.rstrip('/'),a.tenant,a.origin,i+1,a.timeout);runs.append(r)
  print(json.dumps({'scenario':i+1,'sent':r['turns_sent'],'answered':r['all_http_answers'],'persisted':r['history_has_25_turns']}))
  if not r['all_http_answers'] or not r['history_has_25_turns']:break
 result={'started_at':started,'tenant':a.tenant,'scenarios_requested':a.scenarios,'scenarios_executed':len(runs),'customer_turns':sum(x['turns_sent'] for x in runs),'conversation_gate':'PASS' if len(runs)==a.scenarios and all(x['all_http_answers'] and x['history_has_25_turns'] for x in runs) else 'FAIL','external_crm_invoice_document_signing':'NOT_VERIFIED_BY_THIS_HARNESS','runs':runs}
 a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(result,indent=2),encoding='utf-8')
 print('Result:',result['conversation_gate'],'saved',a.out)
 if result['conversation_gate']!='PASS':raise SystemExit(1)
if __name__=='__main__':main()
