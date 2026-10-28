#!/usr/bin/env python3
"""Generate inactive, credential-free ANCFZ n8n workflow exports for implementation/review.
ALL internal /ancfz/lifecycle endpoints are NEW contracts; Node must implement and test them before activation.
"""
from pathlib import Path
import json

OUT=Path(__file__).resolve().parents[2]/'infra/n8n/workflows'
OUT.mkdir(parents=True,exist_ok=True)
API='http://api:4000/api/v1/internal'

def node(name,kind,id,x,y,params,**kw):
    return dict(id=id,name=name,type=kind,typeVersion=(2 if kind=='n8n-nodes-base.code' else 4.2 if kind=='n8n-nodes-base.httpRequest' else 2),position=[x,y],parameters=params,**kw)

def req(name,id,x,y,url,body,method='POST',extra=None):
    params={'method':method,'url':url,'authentication':'genericCredentialType','genericAuthType':'httpHeaderAuth','options':{}}
    if body is not None:params.update({'sendBody':True,'specifyBody':'json','jsonBody':body})
    if extra:params.update(extra)
    return node(name,'n8n-nodes-base.httpRequest',id,x,y,params)

def connect(names):
    return {a:{'main':[[{'node':b,'type':'main','index':0}]]} for a,b in zip(names,names[1:])}

def base(name,id,path,workflow,contract,stage):
    nodes=[
        node('Internal Lifecycle Webhook','n8n-nodes-base.webhook',id+'-hook',0,0,{'httpMethod':'POST','path':path,'responseMode':'onReceived','responseCode':202,'options':{}},webhookId=path),
        node('Validate Opaque Event','n8n-nodes-base.code',id+'-validate',220,0,{'jsCode':f"const x=$json.body??$json; for (const k of ['tenantId','actionId','eventId','correlationId']) if(typeof x[k]!=='string'||!x[k]) throw new Error('Invalid opaque lifecycle event '+k); if(x.workflowKey!=={json.dumps(workflow)}||x.contract!=={json.dumps(contract)}) throw new Error('Workflow contract mismatch'); if(!Number.isInteger(x.attempt)||x.attempt<1)throw new Error('Invalid attempt');return [{{json:{{tenantId:x.tenantId,actionId:x.actionId,eventId:x.eventId,correlationId:x.correlationId,attempt:x.attempt,workflowKey:x.workflowKey,contract:x.contract}}}}];"}),
        req('Claim Authorized Action',id+'-claim',450,0,API+'/workflow-events/claim',"={{ JSON.stringify({ actionId:$json.actionId,tenantId:$json.tenantId,eventId:$json.eventId,correlationId:$json.correlationId,attempt:$json.attempt,workflowKey:$json.workflowKey,contract:$json.contract,executionReference:$execution.id,n8nWorkflowId:$workflow.id,limit:1 }) }}"),
        node('Require One Claimed Action','n8n-nodes-base.code',id+'-one',670,0,{'jsCode':"const items=$json.items;if(!Array.isArray(items)||items.length!==1)throw new Error('Exactly one authorized action claim required');const x=items[0];if(!x.actionId||!x.tenantId||!x.eventId||!x.correlationId||!Number.isInteger(x.attempt))throw new Error('Incomplete claimed action');return [{json:x}];"}),
    ]
    names=[n['name'] for n in nodes]
    return nodes,names

def export(doc_kind):
    is_quote=doc_kind=='quote'
    id='ANCQuotePDFWF1' if is_quote else 'ANCInvoicePDFWF1'
    name=f'ANCFZ {doc_kind.title()} PDF Generation — gated'
    contract=f'anc-pdf-{doc_kind}-v1'
    workflow='sales.quote.generate' if is_quote else 'billing.invoice.issue'
    path=f'anc-{doc_kind}-pdf-wf-1'
    nodes,names=base(name,id,path,workflow,contract,doc_kind)
    nodes.extend([
       req('Generate PDF Via Node Python Boundary',id+'-execute',910,0,API+'/ancfz/lifecycle/pdf-actions/execute',"={{ JSON.stringify({ tenantId:$json.tenantId,actionId:$json.actionId,eventId:$json.eventId,correlationId:$json.correlationId,attempt:$json.attempt,documentType:'"+doc_kind+"',executionReference:$execution.id }) }}"),
       node('Check Durable PDF Verification','n8n-nodes-base.code',id+'-verify',1130,0,{'jsCode':"const x=$json;if(x.verified!==true||x.mock!==true||typeof x.documentId!=='string'||!/^[a-f0-9]{64}$/i.test(String(x.sha256||'')))throw new Error('PDF is not verified and persisted as a mock');return [{json:{...$('Require One Claimed Action').first().json,documentId:x.documentId,sha256:x.sha256}}];"}),
       req('Finalize Verified PDF Action',id+'-finish',1350,0,API+'/workflow-events/complete',"={{ JSON.stringify({ tenantId:$json.tenantId,actionId:$json.actionId,eventId:$json.eventId,correlationId:$json.correlationId,attempt:$json.attempt,state:'completed',executionReference:$execution.id,externalReference:$json.documentId }) }}")
    ])
    names.extend(n['name'] for n in nodes[-3:])
    wf={'id':id,'name':name,'nodes':nodes,'connections':connect(names),'active':False,'settings':{'executionOrder':'v1'},'versionId':id+'-draft-v1','meta':{'templateCredsSetupCompleted':False},'tags':[],'notes':'INACTIVE / NOT DEPLOYABLE: Node endpoint /ancfz/lifecycle/pdf-actions/execute must be implemented, server-side authorized and wired to private Python ReportLab service. Bind managed HTTP Header Auth credential on each internal HTTP node. Never generate authoritative prices in n8n.'}
    file=OUT/(f'{id}.json');file.write_text(json.dumps(wf,indent=2),encoding='utf-8');return str(file)

def payment_export():
    id='ANCPaymentMockWF1';nodes,names=base('ANCFZ Mock Payment Pending',id,'anc-mock-payment-wf-1','billing.payment.mock','anc-payment-mock-v1','billing')
    nodes.extend([
     req('Get Approved Invoice Payment Input',id+'-prepare',890,0,API+'/ancfz/lifecycle/mock-payments/prepare',"={{ JSON.stringify({tenantId:$json.tenantId,actionId:$json.actionId,eventId:$json.eventId,correlationId:$json.correlationId,attempt:$json.attempt}) }}"),
     req('Create MOCK Payment Intent',id+'-create',1110,0,'http://mock-payments:8098/v1/payments',"={{ JSON.stringify({invoice_ref:$json.invoiceRef,amount:$json.amount,currency:$json.currency}) }}",extra={'sendHeaders':True,'headerParameters':{'parameters':[{'name':'Idempotency-Key','value':"={{ $('Require One Claimed Action').first().json.actionId+'-'+$('Require One Claimed Action').first().json.attempt }}"}]}}),
     node('Validate MOCK Provider Intent','n8n-nodes-base.code',id+'-validate-mock',1330,0,{'jsCode':"const x=$json;if(x.mock!==true||typeof x.id!=='string'||!/^mockpay_[0-9a-f]{32}$/.test(x.id)||x.status!=='pending')throw new Error('Mock payment intent must start pending');return [{json:{...$('Require One Claimed Action').first().json,mockPaymentId:x.id,providerStatus:x.status,mock:true}}];"}),
     req('Persist Pending MOCK Payment',id+'-pending',1550,0,API+'/ancfz/lifecycle/mock-payments/record-pending',"={{ JSON.stringify({tenantId:$json.tenantId,actionId:$json.actionId,eventId:$json.eventId,correlationId:$json.correlationId,attempt:$json.attempt,mockPaymentId:$json.mockPaymentId,providerStatus:'pending',executionReference:$execution.id}) }}")
    ])
    names.extend(n['name'] for n in nodes[-4:])
    wf={'id':id,'name':'ANCFZ Mock Payment — creates pending only','nodes':nodes,'connections':connect(names),'active':False,'settings':{'executionOrder':'v1'},'versionId':id+'-draft-v1','meta':{'templateCredsSetupCompleted':False},'tags':[],
    'notes':'INACTIVE: Node endpoints must be implemented. The mock API creates only pending state; it never charges real money. Manually settle via protected mock endpoint, then a separate Node reconciliation verifies mock_paid; never mark a real payment paid.'}
    file=OUT/(id+'.json');file.write_text(json.dumps(wf,indent=2),encoding='utf-8');return str(file)

if __name__=='__main__':
    for k in ['quote','invoice']:print(export(k))
    print(payment_export())
