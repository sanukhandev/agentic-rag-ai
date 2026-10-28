#!/usr/bin/env python3
"""Private, development-only HTTP adapter for reportlab quote/invoice renderer.
Requires Authorization: Bearer <ANCFZ_PDF_API_KEY> and mode MOCK.
Do not expose this service on public ingress. Node verifies all stage/consent/amount prerequisites.
"""
from __future__ import annotations
import hashlib,hmac,json,os,re
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from render import render

KEY=os.environ.get('ANCFZ_PDF_API_KEY','')
DEST=Path(os.environ.get('ANCFZ_PDF_OUTPUT_ROOT','./data/private-pdfs'))

class Handler(BaseHTTPRequestHandler):
    def reply(self,status,data):
        b=json.dumps(data).encode('utf-8');self.send_response(status)
        self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(b)
    def do_POST(self):
        if self.path!='/v1/render':return self.reply(404,{'error':'NOT_FOUND'})
        if not KEY or not hmac.compare_digest(self.headers.get('Authorization',''), 'Bearer '+KEY):return self.reply(401,{'error':'UNAUTHORIZED'})
        try:
            n=int(self.headers.get('Content-Length','0'))
            if not 0<n<20_000:raise ValueError('Invalid payload size')
            raw=self.rfile.read(n);payload=json.loads(raw)
            if not isinstance(payload,dict):raise ValueError('Expected JSON object')
            # Name derived exclusively from bounded content hash, never client-controlled file names.
            artifact_id=hashlib.sha256(json.dumps(payload,sort_keys=True).encode('utf-8')).hexdigest()
            path=DEST/(artifact_id+'.pdf')
            output=render(payload,path)
            return self.reply(200,{'artifactId':artifact_id,'sha256':output['sha256'],'bytes':output['bytes'],'documentType':output['document_type'],'mock':True,'privatelyStored':True})
        except (ValueError,TypeError,KeyError,json.JSONDecodeError):return self.reply(422,{'error':'INVALID_RENDER_INPUT'})
        except Exception:return self.reply(500,{'error':'RENDER_FAILED'})
    def log_message(self,format,*args):pass

if __name__=='__main__':
    if os.environ.get('ANCFZ_PDF_ENABLED')!='true':raise SystemExit('ANCFZ_PDF_ENABLED=true required for mock-only server')
    if len(KEY)<24:raise SystemExit('Require random ANCFZ_PDF_API_KEY of >=24 characters')
    host=os.environ.get('ANCFZ_PDF_HOST','127.0.0.1')
    if host not in ('127.0.0.1','localhost','::1') and os.environ.get('ANCFZ_PDF_PRIVATE_DOCKER')!='true':raise SystemExit('Non-loopback bind not allowed outside private Docker')
    port=int(os.environ.get('ANCFZ_PDF_PORT','8097'))
    DEST.mkdir(parents=True,exist_ok=True)
    print('ANCFZ PRIVATE MOCK PDF service',host,port)
    ThreadingHTTPServer((host,port),Handler).serve_forever()
