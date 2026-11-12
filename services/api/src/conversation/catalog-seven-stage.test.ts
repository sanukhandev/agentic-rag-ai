import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateCatalogV2, catalogV2VersionRef } from './catalog.js';
import { validatePublishedCatalogV2 } from './catalog-runtime.js';
const catalog=JSON.parse(readFileSync(new URL('../fixtures/ancfz-catalog-v2-seven-stage.json',import.meta.url),'utf8'));
const stages=['lead_generation','lead_qualification','account_creation','package_selection','document_upload','payment_invoice','contract'];
describe('ANCFZ seven-stage draft catalog',()=>{
 it('validates with seven sequential stages and stable revision',()=>{
   const result=validateCatalogV2(catalog);
   expect(result.errors).toEqual([]);
   expect(result.document).not.toBeNull();
   expect(catalog.sheets.BusinessStages.map((x:{stageKey:string})=>x.stageKey)).toEqual(stages);
   const version=catalogV2VersionRef(result.document!);
   expect(version).toMatch(/^ancfz:r2:[a-f0-9]{64}$/u);
   expect(validatePublishedCatalogV2(catalog,{published:true,tenantScope:'ancfz',pinnedVersionRef:version}).errors).toEqual([]);
 });
 it('keeps side-effectful action bindings consent-gated',()=>{
   expect(catalog.sheets.BusinessGoals[0].confirmationRequired).toBe(true);
   const writes=catalog.sheets.ToolBindings.filter((x:{sideEffectClass:string})=>x.sideEffectClass!=='read_only');
   expect(writes).toHaveLength(10);
   expect(writes.every((x:{consent:string,confirmation:string})=>x.consent==='purpose_specific'&&x.confirmation==='explicit_customer')).toBe(true);
   expect(catalog.sheets.WorkflowBindings.filter((x:{enabled:boolean})=>x.enabled).map((x:{workflowKey:string})=>x.workflowKey)).toEqual(['crm.lead.create','sales.quote.generate','document.sf02.upload']);
   for(const stageKey of stages) expect(writes.some((x:{stageKey:string})=>x.stageKey===stageKey)).toBe(true);
 });
});
