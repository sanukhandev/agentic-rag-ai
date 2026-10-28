#!/usr/bin/env python3
"""Local-only mock payment API, NO cards, NO charges, NO production credentials.
HTTP routes: POST /v1/payments, POST /v1/payments/{id}/settle, GET /v1/payments/{id}.
All routes require x-mock-api-key. POST requires Idempotency-Key. Listen on loopback by default.
"""
import hashlib
import hmac
import json
import os
import re
import sqlite3
import sys
import uuid
from decimal import Decimal, InvalidOperation
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

DB_FILE=Path(os.environ.get('MOCK_PAYMENT_DB','./data/mock-payments.sqlite3'))
KEY=os.environ.get('MOCK_PAYMENT_API_KEY','')
MAX_BYTES=8192

def database(path=DB_FILE):
    path.parent.mkdir(parents=True,exist_ok=True)
    conn=sqlite3.connect(str(path),timeout=5)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, idem TEXT UNIQUE NOT NULL, invoice_ref TEXT NOT NULL, amount TEXT NOT NULL, currency TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0)')
    return conn

def valid_request(body):
    # Never permit card, bank or raw customer data to enter the payment mock.
    if not isinstance(body,dict) or set(body)!={'invoice_ref','amount','currency'}:raise ValueError('Only invoice_ref, amount and currency are permitted')
    if not isinstance(body['invoice_ref'],str) or not re.fullmatch('[A-Za-z0-9._:-]{1,100}',body['invoice_ref']):raise ValueError('invalid invoice_ref')
    if not isinstance(body['currency'],str) or not re.fullmatch('[A-Z]{3}',body['currency']):raise ValueError('invalid currency')
    try: d=Decimal(str(body['amount']))
    except (ValueError,InvalidOperation): raise ValueError('invalid amount')
    if not d.is_finite() or d<=0 or d>Decimal('99999999') or d.as_tuple().exponent < -2:raise ValueError('invalid amount')
    return (body['invoice_ref'],str(d.quantize(Decimal('.01'))),body['currency'])

def create_payment(conn,idem,body):
    if not re.fullmatch('[A-Za-z0-9._:-]{8,140}',idem):raise ValueError('Invalid idempotency key')
    ref,amt,cur=valid_request(body)
    with conn:
        existing=conn.execute('SELECT id,invoice_ref,amount,currency,state,version FROM payments WHERE idem=?',(idem,)).fetchone()
        if existing:
            if existing[1:4]!=(ref,amt,cur):raise ValueError('Idempotency conflict: different invoice or amount')
            return {'id':existing[0],'invoice_ref':existing[1],'amount':existing[2],'currency':existing[3],'status':existing[4],'version':existing[5],'mock':True}
        pid='mockpay_'+uuid.uuid4().hex
        conn.execute('INSERT INTO payments (id,idem,invoice_ref,amount,currency,state) VALUES (?,?,?,?,?,?)',(pid,idem,ref,amt,cur,'pending'))
    return {'id':pid,'invoice_ref':ref,'amount':amt,'currency':cur,'status':'pending','version':0,'mock':True}

def get_payment(conn,pid):
    row=conn.execute('SELECT id,invoice_ref,amount,currency,state,version FROM payments WHERE id=?',(pid,)).fetchone()
    return ({'id':row[0],'invoice_ref':row[1],'amount':row[2],'currency':row[3],'status':row[4],'version':row[5],'mock':True} if row else None)

def settle(conn,pid,idem):
    if not re.fullmatch('[A-Za-z0-9._:-]{8,140}',idem):raise ValueError('Invalid idempotency key')
    with conn:
        entry=get_payment(conn,pid)
        if not entry:return None
        if entry['status']=='pending':conn.execute("UPDATE payments SET state='mock_paid',version=version+1 WHERE id=? AND state='pending'",(pid,))
        return get_payment(conn,pid)

class Handler(BaseHTTPRequestHandler):
    def reply(self,status,obj):
        b=json.dumps(obj,sort_keys=True).encode();self.send_response(status)
        self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)))
        self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(b)
    def authorized(self):
        if not KEY or not hmac.compare_digest(self.headers.get('x-mock-api-key',''),KEY):
            self.reply(401,{'error':'UNAUTHORIZED'});return False
        return True
    def read_json(self):
        try:
            n=int(self.headers.get('Content-Length','0'))
            if n<=0 or n>MAX_BYTES:raise ValueError('Invalid request length')
            return json.loads(self.rfile.read(n))
        except Exception:raise ValueError('Invalid JSON body')
    def do_POST(self):
        if not self.authorized():return
        path=urlparse(self.path).path
        try:
            conn=database()
            try:
                idem=self.headers.get('Idempotency-Key','')
                if path=='/v1/payments':out=create_payment(conn,idem,self.read_json())
                elif path.startswith('/v1/payments/') and path.endswith('/settle'):
                    pid=path.split('/')[3]
                    if not re.fullmatch('mockpay_[a-f0-9]{32}',pid):raise ValueError('Invalid ID')
                    out=settle(conn,pid,idem)
                    if out is None:return self.reply(404,{'error':'NOT_FOUND'})
                else:return self.reply(404,{'error':'NOT_FOUND'})
            finally:conn.close()
            self.reply(200,out)
        except ValueError as exc:self.reply(409,{'error':str(exc)})
        except Exception:self.reply(500,{'error':'INTERNAL_MOCK_ERROR'})
    def do_GET(self):
        if not self.authorized():return
        path=urlparse(self.path).path
        if not re.fullmatch('/v1/payments/mockpay_[a-f0-9]{32}',path):return self.reply(404,{'error':'NOT_FOUND'})
        conn=database()
        try:out=get_payment(conn,path.split('/')[3])
        finally:conn.close()
        self.reply(200,out) if out else self.reply(404,{'error':'NOT_FOUND'})
    def log_message(self,fmt,*args):pass # Never log potentially sensitive requests

if __name__=='__main__':
    if os.environ.get('MOCK_PAYMENTS_ENABLED')!='true':raise SystemExit('Refusing to start: set MOCK_PAYMENTS_ENABLED=true for local development only')
    if len(KEY)<20:raise SystemExit('Set a random MOCK_PAYMENT_API_KEY of at least 20 characters')
    host=os.environ.get('MOCK_PAYMENT_HOST','127.0.0.1');port=int(os.environ.get('MOCK_PAYMENT_PORT','8098'))
    if host not in ('127.0.0.1','localhost','::1') and os.environ.get('MOCK_PAYMENT_PRIVATE_DOCKER')!='true':raise SystemExit('Non-loopback binding requires explicit private Docker mode')
    print(f'MOCK ONLY / NO REAL CHARGES on {host}:{port}')
    ThreadingHTTPServer((host,port),Handler).serve_forever()
