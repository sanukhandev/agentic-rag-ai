import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  PostgresConversationRepository,
  ConversationPersistenceError,
} from '../adapters/postgres-repository.js';
import {
  ExistingSessionTokenAuthorizer,
  customerActorFromSessionToken,
  SessionPermissionError,
} from '../adapters/session-authorizer.js';
import { ConversationTurnEngine } from '../turn-engine.js';

const TENANT='11111111-1111-4111-8111-111111111111', SESSION='22222222-2222-4222-8222-222222222222';
const PERSONA='33333333-3333-4333-8333-333333333333', CATALOG='44444444-4444-4444-8444-444444444444';
const TOKEN='server-session-token-secret';
const ACTOR=customerActorFromSessionToken({tenantId:TENANT, sessionId:SESSION, sessionAccessToken:TOKEN});
const reqHash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const ANSWER={message:'Hello, I can help.', evidenceRefs:[], goalCandidateKeys:[], verifiedFactPatches:[],pendingActionProposal:null};
class FakeDb {
  constructor(){this.sessions=new Map([[SESSION,{id:SESSION,tenant_id:TENANT,state_version:0,persona_version_id:null,conversation_state:{auditMarker:'preserved',conversationCore:{summary:'Pinned core summary',verifiedFacts:[{key:'business_activity',value:'Consulting',source:'customer',sourceReference:'customer-turn:test',revision:0}]}},closed_at:null,tenant_status:'active'}]]);
    this.messages=[];
    this.actions=[{id:'id-1',workflow_key:'crm.lead.create',state:'completed'}];
    this.persona={id:PERSONA,name:'Alex',greeting:'Hello',personality:'helpful',tone:'friendly',speaking_style:'clear',permitted_languages:['en']};
    this.catalog={id:CATALOG,catalog_json:{sheets:{BusinessGoals:[{businessGoalKey:'company_formation',active:true}]}}};
    this.tokens=new Set([ACTOR.principalId]);this.disallowed=false;this.injectFailure=false;this.connectionCount=0;
  }
  async verifySessionAccessToken(sessionId,hash){return sessionId===SESSION && this.tokens.has(hash)}
  async connect(){const db=this;db.connectionCount++;return new FakeClient(db)}
}
class FakeClient {
  constructor(db){this.db=db;this.backup=null;this.released=false}
  release(){this.released=true}
  async query(sql, params=[]){
    const s=sql.trim().replace(/\s+/g,' ');const lower=s.toLowerCase();const db=this.db;
    if(lower.startsWith('begin')){this.backup={sessions:structuredClone([...db.sessions]),messages:structuredClone(db.messages)};return {rows:[],rowCount:null}}
    if(lower.startsWith('commit')){this.backup=null;return {rows:[],rowCount:null}}
    if(lower.startsWith('rollback')){if(this.backup){db.sessions=new Map(this.backup.sessions);db.messages=this.backup.messages;}this.backup=null;return {rows:[],rowCount:null}}
    if(lower.includes('from chat_sessions s join tenants')){
      const row=db.sessions.get(params[0]);return {rows:row&&row.tenant_id===params[1]?[structuredClone(row)]:[],rowCount:row?1:0};
    }
    if(lower.includes('from persona_versions')){
      const matches=params[0]===TENANT && (params[1]===''||params[1]===PERSONA);
      return {rows:matches?[structuredClone(db.persona)]:[],rowCount:matches?1:0};
    }
    if(lower.includes('from intent_catalog_v2_versions')){
      const matches=params[0]===TENANT && (params[1]===''||params[1]===CATALOG);
      return {rows:matches?[structuredClone(db.catalog)]:[],rowCount:matches?1:0};
    }
    if(lower.includes('from chat_messages')&&lower.includes('client_message_id = $3')){
      const rows=db.messages.filter(x=>x.tenant_id===params[0]&&x.session_id===params[1]&&x.client_message_id===params[2]);return {rows:rows.map(x=>({role:x.role,response:x.response})),rowCount:rows.length}
    }
    if(lower.includes('from chat_messages'))return {rows:db.messages.filter(x=>x.tenant_id===params[0]&&x.session_id===params[1]).slice().reverse().map(({role,masked_content})=>({role,masked_content})),rowCount:db.messages.length};
    if(lower.includes('from action_requests'))return {rows:db.actions,rowCount:db.actions.length};
    if(lower.startsWith('insert into chat_messages')){
      if(db.injectFailure && sql.includes("'assistant'"))throw new Error('simulated insert failure');
      const role=sql.includes("'assistant'")?'assistant':'user';
      db.messages.push({id:params[0],tenant_id:params[2],session_id:params[1],role,masked_content:params[3],client_message_id:role==='user'?params[4]:null,response:role==='user'?JSON.parse(params[5]):null});
      return {rows:[],rowCount:1};
    }
    if(lower.startsWith('update chat_sessions')){
      const row=db.sessions.get(params[0]);
      if(!row||row.tenant_id!==params[1])return {rows:[],rowCount:0};
      const isSummary=params.length===5;
      const expected=params[isSummary?4:5];
      if(row.state_version!==expected)return {rows:[],rowCount:0};
      row.state_version=params[2];
      if(!isSummary)row.persona_version_id=row.persona_version_id??params[3];
      row.conversation_state.conversationCore=JSON.parse(params[isSummary?3:4]);
      return {rows:[],rowCount:1};
    }
    throw new Error('Unrecognized SQL: '+s.slice(0,120));
  }
}
const maskedPolicy={async assertSafeMaskedText(_actor,text){if(/@|\+971\d{7}/.test(text))throw new Error('unmasked customer secret')}};
function getRepo(db=new FakeDb()){return {db,repo:new PostgresConversationRepository(db,new ExistingSessionTokenAuthorizer(db),maskedPolicy)}}
const commit=(repo,text='Start a company',overrides={})=>repo.commitTurn(ACTOR,{
  expectedRevision:0, clientMessageId:'turn-1', customerMessage:text, requestDigest:reqHash(text),
  personaVersionId:PERSONA,catalogVersionId:CATALOG,response:ANSWER,...overrides,
});

describe('Conversation core — atomic PostgreSQL repository',()=>{
  it('reads new-core summary, verified facts, history, persona and catalog without altering state',async()=>{
    const {db,repo}=getRepo();
    const snapshot=await repo.loadAuthorizedSnapshot(ACTOR);
    assert.equal(snapshot.revision,0);
    assert.equal(snapshot.conversationSummary,'Pinned core summary');
    assert.equal(snapshot.verifiedFacts[0].value,'Consulting');
    assert.equal(snapshot.verifiedFacts[0].source,'customer');
    assert.deepEqual(snapshot.publishedGoalKeys,['company_formation']);
    assert.equal(snapshot.pendingActionStatus[0].status,'reconciliation_required');
    assert.match(snapshot.personaInstructions,/Alex/);
    assert.equal(db.messages.length,0);
  });
  it('atomically commits both turns, verified fact patch, persona/catalog pin and preserves unrelated state',async()=>{
    const {db,repo}=getRepo();
    const changed=await commit(repo,'Company setup', {customerMessage:'Company setup',requestDigest:reqHash('Company setup'),response:{...ANSWER,verifiedFactPatches:[{key:'visa_count',value:'2',source:'customer',sourceReference:'turn-1',revision:1}]}});
    assert.equal(changed.revision,1);
    assert.equal(db.messages.length,2);
    assert.equal(db.messages[0].role,'user');assert.equal(db.messages[1].role,'assistant');
    assert.equal(db.sessions.get(SESSION).conversation_state.auditMarker,'preserved');
    const latest=await repo.loadAuthorizedSnapshot(ACTOR);
    assert.equal(latest.revision,1);assert.equal(latest.personaVersionId,PERSONA);assert.equal(latest.catalogVersionId,CATALOG);
    assert.equal(latest.verifiedFacts.find(f=>f.key==='visa_count').value,'2');
    assert.deepEqual(latest.recentTurns.map(v=>v.role),['customer','assistant']);
  });
  it('idempotent replay returns original result and never creates duplicate messages',async()=>{
    const {db,repo}=getRepo();const one=await commit(repo);
    const two=await commit(repo);
    assert.deepEqual(one,two);assert.equal(db.messages.length,2);assert.equal(db.sessions.get(SESSION).state_version,1);
    const byId=await repo.findExistingTurn(ACTOR,'turn-1',reqHash('Start a company'));
    assert.deepEqual(byId,one);
  });
  it('same client id with different content is a conflict, not a silent replay',async()=>{
    const {db,repo}=getRepo();await commit(repo);
    await assert.rejects(()=>commit(repo,'different content',{requestDigest:reqHash('different content')}),e=>e.code==='REPLAY_CONFLICT');
    assert.equal(db.messages.length,2);
  });
  it('stale revision cannot append another turn or overwrite facts',async()=>{
    const {db,repo}=getRepo();await commit(repo);
    await assert.rejects(()=>commit(repo,'second',{clientMessageId:'turn-2',requestDigest:reqHash('second')}),e=>e.code==='STALE_REVISION');
    assert.equal(db.messages.length,2);
  });
  it('fails closed when session token revoked, another tenant is requested or admin role is fabricated',async()=>{
    const {db,repo}=getRepo();db.tokens.clear();
    await assert.rejects(()=>repo.loadAuthorizedSnapshot(ACTOR),SessionPermissionError);
    db.tokens.add(ACTOR.principalId);
    await assert.rejects(()=>repo.loadAuthorizedSnapshot({...ACTOR,tenantId:'wrong'}),SessionPermissionError);
    await assert.rejects(()=>repo.loadAuthorizedSnapshot({...ACTOR,role:'platform_admin'}),SessionPermissionError);
    assert.equal(db.messages.length,0);
  });
  it('transaction failure rolls back both messages and session revision',async()=>{
    const {db,repo}=getRepo();db.injectFailure=true;
    await assert.rejects(()=>commit(repo));
    assert.equal(db.sessions.get(SESSION).state_version,0);
    assert.equal(db.messages.length,0);
  });
  it('summary storage uses a revision guard, a privacy policy and is visible after restart',async()=>{
    const {db,repo}=getRepo();
    const revision=await repo.updateDurableSummary(ACTOR,{expectedRevision:0,maskedSummary:'They chose consulting and asked about visas.'});
    assert.equal(revision,1);
    const rebooted=getRepo(db).repo;
    const snapshot=await rebooted.loadAuthorizedSnapshot(ACTOR);
    assert.equal(snapshot.conversationSummary,'They chose consulting and asked about visas.');
    await assert.rejects(()=>repo.updateDurableSummary(ACTOR,{expectedRevision:0,maskedSummary:'older'}),e=>e.code==='STALE_REVISION');
    await assert.rejects(()=>repo.updateDurableSummary(ACTOR,{expectedRevision:1,maskedSummary:'email a@b.com'}),/unmasked/);
  });
  it('full turn-engine handoff retains durable summary and persists via new repository',async()=>{
    const {db,repo}=getRepo();let envelope=null;
    const gateway={async runTurn(e){envelope=e;return {message:'Yes, we can discuss options.', evidenceRefs:[],goalCandidateKeys:['company_formation'],proposedFacts:[],actionProposal:null}}};
    const tools={async listFor(){return []},async issueBoundScope(){return 'signed-test-scope'}};
    const verifier={async verify(){return {ok:true}}};
    const proposals={async validateFacts(){return []},async validateActionProposal(){return null}};
    const privacy={async prepareForModel(_actor,env){return env},async validateMaskedResponse(){}};
    const engine=new ConversationTurnEngine(repo,gateway,tools,verifier,proposals,privacy);
    const result=await engine.process(ACTOR,{clientMessageId:'engine-turn',text:'I want to open a company'});
    assert.match(envelope.conversationSummary,/Pinned core summary/);
    assert.equal(result.revision,1);assert.equal(db.messages.length,2);
    assert.equal((await engine.process(ACTOR,{clientMessageId:'engine-turn',text:'I want to open a company'})).revision,1);
    await assert.rejects(()=>engine.process(ACTOR,{clientMessageId:'engine-turn',text:'Different question'}),e=>e.code==='REPLAY_CONFLICT');
  });
});
