import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const root = new URL('./ancfz-v2/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('./ancfz-v2-manifest.json', import.meta.url),'utf8'));
const names=['Receive Node Dispatch','Validate Dispatch Envelope','Claim Authorized Action','Require V2 Stage Authorization','Call Provider - Configure Credential','Read Back Provider State','Ask Node to Verify Provider Evidence','Require Trusted Node Attestation','Complete Correlated Action'];
const leadNames=['Receive Node Dispatch','Validate Dispatch Envelope','Claim Authorized Action','Require V2 Stage Authorization','Call Provider - Configure Credential','Read Back Provider State','Build Provider Evidence Payload','Ask Node to Verify Provider Evidence','Require Trusted Node Attestation','Complete Correlated Action'];
test('all ANCFZ V2 workflows are structurally connected and non-executable by default',async()=>{
 const files=(await readdir(root)).filter(name=>name.endsWith('.json')).sort();
 assert.equal(files.length,12);
 assert.equal(files.length,manifest.templates.length);
 const ids=new Set(), paths=new Set(), keys=new Set();
 for(const [i,file] of files.entries()){
  const raw=await readFile(new URL(file,root),'utf8'),w=JSON.parse(raw);
  assert.equal(w.active,false,file);
  assert.equal(w.settings.saveDataSuccessExecution,'none');
  assert.equal(w.settings.saveDataErrorExecution,'none');
  const expectedNames=file === '01-lead-create.json' ? leadNames : names;
  assert.equal(w.nodes.length,expectedNames.length,file);
  assert.deepEqual(w.nodes.map(node=>node.name),expectedNames,file);
  assert.ok(!ids.has(w.id),'duplicate workflow id');ids.add(w.id);
  assert.ok(!paths.has(w.nodes[0].parameters.path),'duplicate webhook path');paths.add(w.nodes[0].parameters.path);
  assert.ok(!keys.has(file),'duplicate file');keys.add(file);
  assert.equal(w.nodes[0].parameters.authentication,'headerAuth');
  assert.equal(w.nodes[0].parameters.responseMode,'onReceived');
  assert.ok(w.nodes.every(node=>!node.credentials||!Object.keys(node.credentials).length),'no credential ids allowed');
  if (file === '01-lead-create.json') {
   assert.equal(w.nodes[4].parameters.url,'={{ $env.REMOTE_CRM_LEAD_URL }}');
   assert.match(w.nodes[1].parameters.jsCode,/opportunityId/);
   assert.match(w.nodes[1].parameters.jsCode,/catalogVersionId/);
   assert.match(w.nodes[1].parameters.jsCode,/idempotencyKey/);
   assert.match(w.nodes[1].parameters.jsCode,/actionRevision/);
   assert.match(w.nodes[4].parameters.jsonBody,/Name:.*providerPayload\.name/);
   assert.match(w.nodes[4].parameters.jsonBody,/Email:.*providerPayload\.email/);
   assert.match(w.nodes[4].parameters.jsonBody,/Description:.*providerPayload\.description/);
   assert.equal(w.nodes[4].parameters.sendHeaders,false);
   assert.equal(w.nodes[4].parameters.headerParameters,undefined);
   assert.match(w.nodes[3].parameters.jsCode,/action\.actionKey !== "lead\.create"/);
   assert.match(w.nodes[8].parameters.jsCode,/result\[key\] !== source\[key\]/);
   assert.match(w.nodes[6].parameters.jsCode,/Missing trusted action correlation/);
   assert.match(w.nodes[7].parameters.jsonBody,/Build Provider Evidence Payload/);
   assert.match(w.nodes[7].parameters.jsonBody,/providerReadback/);
   assert.match(w.nodes[5].parameters.url,/\$env\.REMOTE_CRM_LEAD_READ_URL/);
   assert.match(w.nodes[5].parameters.url,/\{leadId\}/);
   assert.equal(w.nodes[5].parameters.sendHeaders,false);
   assert.equal(w.nodes[5].parameters.headerParameters,undefined);
  } else if (file === '03c-account-create.json') {
   assert.equal(w.nodes[4].parameters.url,'={{ $env.REMOTE_CRM_ACCOUNT_URL }}');
   assert.equal(w.nodes[5].type,'n8n-nodes-base.code');
   assert.match(w.nodes[5].parameters.jsCode,/compositeResponse/);
   assert.match(w.nodes[5].parameters.jsCode,/accountId:ids\.join/);
  } else {
   assert.equal(w.nodes[4].parameters.url.startsWith('https://configure-provider.invalid/'),true);
   assert.equal(w.nodes[5].parameters.url.startsWith('https://configure-provider.invalid/'),true);
  }
  const evidenceIndex=file === '01-lead-create.json' ? 7 : 6;
  assert.equal(w.nodes[evidenceIndex].parameters.url,file === '03c-account-create.json' ? 'http://api:4000/api/v2/internal/provider-evidence/account' : 'http://api:4000/api/v2/internal/provider-evidence/verify');
  assert.equal(w.nodes[2].parameters.url,'http://api:4000/api/v1/internal/workflow-events/claim');
  assert.match(w.nodes[2].parameters.jsonBody,/n8nWorkflowId:\s*\$workflow\.id/);
  assert.match(w.nodes[2].parameters.jsonBody,/limit:1/);
  assert.match(w.nodes[3].parameters.jsCode,/action\.providerEnabled !== true/);
  assert.match(w.nodes[3].parameters.jsCode,/action\.purposeConsentVerified !== true/);
  const attestationIndex=file === '01-lead-create.json' ? 8 : 7;
  const completionIndex=file === '01-lead-create.json' ? 9 : 8;
  assert.match(w.nodes[attestationIndex].parameters.jsCode,/result\.evidenceTier !== 'provider_record_verified'/);
  assert.match(w.nodes[completionIndex].parameters.jsonBody,/state:'completed'/);
  for(const node of w.nodes.filter(node=>node.type==='n8n-nodes-base.httpRequest'))assert.ok(node.parameters.authentication==='predefinedCredentialType'||node.parameters.authentication==='genericCredentialType');
  for(let n=0;n<expectedNames.length-1;n++)assert.deepEqual(w.connections[expectedNames[n]].main,[[{node:expectedNames[n+1],type:'main',index:0}]]);
  assert.doesNotMatch(file === '01-lead-create.json' ? raw : raw.replaceAll('https://configure-provider.invalid/', ''),/N8N_WEBHOOK_SECRET|access_token|refresh_token|password|clientSecret|apiKey|SalesForce ANC - CREDS/i);
  const expected=manifest.templates.find(s=>s.file===file);
  assert.ok(expected,file);
  assert.match(w.nodes[1].parameters.jsCode,new RegExp(expected.workflowKey.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(w.nodes[3].parameters.jsCode,new RegExp(expected.stageKey));
 }
});
test('stage 2 qualification stays Node-owned and V2 workflow wiring is explicitly gated',()=>{
 assert.equal(manifest.qualificationPolicy,'node_only');
 assert.equal(manifest.backendV2ClaimIntegrated,false);
 assert.equal(manifest.backendV2EvidenceEndpointImplemented,false);
 assert.ok(!manifest.templates.some(w=>w.stageKey==='lead_qualification'));
 assert.ok(manifest.templates.some(w=>w.workflowKey==='crm.lead.create'));
 assert.ok(manifest.templates.some(w=>w.workflowKey==='contract.sign'));
});
