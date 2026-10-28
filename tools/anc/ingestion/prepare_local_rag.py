#!/usr/bin/env python3
"""Preflight a local ANCFZ ZIP safely. DOES NOT ingest, publish, or trust the extracted content.

Usage: python tools/anc/ingestion/prepare_local_rag.py --zip 'C:/Users/.../OneDrive_1_23-10-2026.zip' --out ./data/ancfz-review
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import stat
from pathlib import Path, PurePosixPath
from zipfile import ZipFile, BadZipFile

EXTENSIONS={'.md','.txt','.docx','.xlsx','.pdf','.csv','.json','.html','.htm'}
MAX_FILES=2500
MAX_FILE=35*1024*1024
MAX_TOTAL=400*1024*1024
MAX_RATIO=150

def safe_member(info):
    raw=info.filename.replace('\\','/')
    p=PurePosixPath(raw)
    if not raw or p.is_absolute() or '..' in p.parts or any(x in ('','.') for x in p.parts):
        return False,'unsafe_path'
    if ':' in raw or raw.startswith('//'):
        return False,'unsafe_path'
    mode=(info.external_attr >> 16)
    if stat.S_ISLNK(mode):
        return False,'symlink'
    if info.flag_bits & 1:
        return False,'encrypted'
    if not raw.endswith('/') and p.suffix.lower() not in EXTENSIONS:
        return False,'unsupported_extension'
    if info.file_size>MAX_FILE:
        return False,'oversized'
    if info.file_size>0 and info.file_size/max(1,info.compress_size)>MAX_RATIO:
        return False,'high_compression_ratio'
    return True,'ok'

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--zip',required=True,type=Path)
    ap.add_argument('--out',required=True,type=Path)
    a=ap.parse_args()
    if not a.zip.is_file():
        raise SystemExit(f'MISSING_LOCAL_INPUT: {a.zip}. Copy the ZIP to this machine; do not substitute the older 21-Oct archive.')
    root=a.out.resolve(); data=root/'staged'; root.mkdir(parents=True,exist_ok=True); data.mkdir(parents=True,exist_ok=True)
    all_files=[]; rejected=[]; total=0; sha=hashlib.sha256(a.zip.read_bytes()).hexdigest()
    try:
        with ZipFile(a.zip) as z:
            infos=z.infolist()
            if len(infos)>MAX_FILES: raise ValueError('Too many ZIP members')
            for info in infos:
                ok,reason=safe_member(info)
                if not ok:
                    rejected.append({'source_name':info.filename,'reason':reason});continue
                if info.is_dir():continue
                total+=info.file_size
                if total>MAX_TOTAL:raise ValueError('Total uncompressed archive size exceeds limit')
                # Do not trust source paths or overwrite a staged file: content-addressed names.
                data_bytes=z.read(info)
                digest=hashlib.sha256(data_bytes).hexdigest()
                out=data/(digest+PurePosixPath(info.filename.replace('\\','/')).suffix.lower())
                if not out.exists():out.write_bytes(data_bytes)
                all_files.append({'source_name':info.filename,'staged_file':str(out.relative_to(root)),'sha256':digest,'bytes':len(data_bytes),'approval':'pending_human_review','visibility':'disabled','ingestion_status':'not_submitted'})
    except BadZipFile as exc:
        raise SystemExit('The input is not a valid ZIP archive') from exc
    manifest={'source_zip':a.zip.name,'source_zip_sha256':sha,'source_date':'2026-10-23','tenant_slug':'anc-test','scope':'ANCFZ_DEDICATED','note':'Preflight only. Requires rights, content, privacy, policy and source version review before ingestion.','files':all_files,'rejected':rejected}
    (root/'source-manifest.review.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False),encoding='utf-8')
    (root/'APPROVAL_REQUIRED.txt').write_text('No source has been approved or ingested. Review manifest and files, redact PII, validate ANCFZ source facts, then use existing authenticated source ingestion and publication APIs. Never turn private customer documents into public RAG.\n',encoding='utf-8')
    print(json.dumps({'zip_sha256':sha,'staged':len(all_files),'rejected':len(rejected),'manifest':str(root/'source-manifest.review.json')},indent=2))
if __name__=='__main__':main()
