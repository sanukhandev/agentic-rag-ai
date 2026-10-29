#!/usr/bin/env python3
"""Generate DEVELOPMENT-ONLY PDFs for validated quote and invoice objects.
The production Node API must gate monetary facts, document ownership, private storage, and approval.
No arbitrary URL/file references are loaded; no card or bank data permitted.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.utils import simpleSplit
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer, KeepTogether

MONEY=Decimal('0.01')
ALLOWED={'quote','invoice'}

def amount(v):
    try:d=Decimal(str(v)).quantize(MONEY)
    except (InvalidOperation,ValueError) as e:raise ValueError('Invalid amount') from e
    if not d.is_finite() or d<0 or d>Decimal('999999999.99'):raise ValueError('Amount out of bounds')
    return d

def clean(v,limit=140):
    t=str(v or '')
    t=' '.join(t.split())
    if len(t)>limit or any(ord(c)<32 for c in t):raise ValueError('Invalid text field')
    return t

def validate(payload):
    if payload.get('mode')!='MOCK':raise ValueError('Refusing non-MOCK PDF. Use provider-approved production document flow.')
    kind=payload.get('document_type')
    if kind not in ALLOWED:raise ValueError('document_type must be quote or invoice')
    for k in ['reference','issue_date','currency','customer_label','seller_label']:
        if not clean(payload.get(k)):raise ValueError('Missing '+k)
    if not re.fullmatch(r'[A-Z]{3}',payload['currency']):raise ValueError('Invalid ISO currency')
    rows=payload.get('items')
    if not isinstance(rows,list) or not 1<=len(rows)<=30:raise ValueError('Require 1..30 line items')
    total=Decimal('0')
    for r in rows:
        if not clean(r.get('description')):raise ValueError('Missing line item description')
        q=amount(r.get('quantity'));price=amount(r.get('unit_price'))
        if q<=0:raise ValueError('Quantity must be positive')
        total+=q*price
    tax=amount(payload.get('tax_amount','0.00')) # Tax is INPUT from approved quote; NEVER assumed.
    expected=amount(payload.get('grand_total'))
    if (total+tax).quantize(MONEY)!=expected:raise ValueError('Total mismatch with line items and explicit tax_amount')
    return kind,expected

def render(payload,out_path):
    kind,total=validate(payload)
    out_path=Path(out_path)
    out_path.parent.mkdir(parents=True,exist_ok=True)
    # destination is controlled by caller and must be a private local volume, never a web public directory
    styles=getSampleStyleSheet()
    styles.add(ParagraphStyle(name='RightSmall',parent=styles['BodyText'],alignment=TA_RIGHT,fontSize=9,leading=14))
    doc=SimpleDocTemplate(str(out_path),pagesize=A4,topMargin=54,bottomMargin=52,leftMargin=52,rightMargin=52,
                          title=f'MOCK {kind.title()} {clean(payload["reference"])}')
    elems=[]
    heading='QUOTE' if kind=='quote' else 'INVOICE'
    elems.append(Paragraph(f'<font color="#253C55"><b>ANCFZ — {heading}</b></font>',styles['Title']))
    elems.append(Paragraph('<font color="#B91C1C"><b>TEST DOCUMENT — NOT A REAL CHARGE OR COMMERCIAL OFFER</b></font>',styles['Normal']))
    elems.append(Spacer(1,20))
    meta=[['Document reference',clean(payload['reference'])],['Issued on',clean(payload['issue_date'])],['Seller',clean(payload['seller_label'])],['Customer',clean(payload['customer_label'])],['Currency',payload['currency']]]
    if payload.get('due_date'):meta.append(['Due / expiry (test)',clean(payload['due_date'])])
    table=Table(meta,colWidths=[140,350]);table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('TEXTCOLOR',(0,0),(0,-1),colors.HexColor('#475569')),('BOTTOMPADDING',(0,0),(-1,-1),9)]));elems.append(table)
    elems.append(Spacer(1,20))
    line_items=[['Item','Qty','Unit price','Line total']]
    for item in payload['items']:
        q=amount(item['quantity']); unit=amount(item['unit_price']);line_items.append([clean(item['description']),str(q),f'{unit:,.2f}',f'{(q*unit):,.2f}'])
    l=Table(line_items,colWidths=[270,60,85,75],repeatRows=1,hAlign='LEFT')
    l.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#17324D')),('TEXTCOLOR',(0,0),(-1,0),colors.white),('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('GRID',(0,0),(-1,-1),0.3,colors.HexColor('#CBD5E1')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]));elems.append(l)
    elems.append(Spacer(1,14))
    elems.append(Paragraph(f'Tax amount (explicit mock input): {amount(payload.get("tax_amount","0")):,.2f} {payload["currency"]}',styles['RightSmall']))
    elems.append(Paragraph(f'<b>GRAND TOTAL: {total:,.2f} {payload["currency"]}</b>',styles['RightSmall']))
    elems.append(Spacer(1,25))
    elems.append(Paragraph('Generated by the ANCFZ development PDF adapter. No legal, payment or Salesforce effect occurs by generating this file.',styles['Normal']))
    doc.build(elems)
    return {'document_type':kind,'sha256':hashlib.sha256(out_path.read_bytes()).hexdigest(),'bytes':out_path.stat().st_size,'output_path':str(out_path)}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args()
    payload=json.loads(a.input.read_text(encoding='utf-8'))
    print(json.dumps(render(payload,a.output),indent=2))
