import { describe, expect, it } from 'vitest';
import { N8nEventBridge } from './event-bus.js';

describe('N8n document event routing', () => {
  it.each(['queued', 'processing'] as const)('routes a V2 OCR job through the pinned V2 workflow binding while %s', async (status) => {
    const tenantId = '00000000-0000-4000-8000-000000000001';
    const documentId = '00000000-0000-4000-8000-000000000002';
    const catalogVersionRef = 'anc:r7:' + 'a'.repeat(64);
    const store = {
      getDocumentProcessingJob: async () => ({ documentId, tenantId, status, workflowKey: 'anc.document.ocr.extract' }),
      getSupportingDocument: async () => ({ id: documentId, tenantId, catalogVersionId: catalogVersionRef }),
      listIntentCatalogV2Versions: async () => [{
        status: 'published',
        catalogVersionRef,
        catalog: { sheets: { WorkflowBindings: [{ workflowKey: 'anc.document.ocr.extract', registryKey: 'document.sf02.upload', providerType: 'node', payloadSchemaRef: 'payload.anc.document.ocr.v1', callbackSchemaRef: 'callback.anc.document.ocr.v1', evidencePolicyKey: 'document.ocr.queued', n8nWorkflowId: 'DOC01DocumentProcessing', webhookPath: 'anc-test-document-ocr-wf-1', payloadContract: 'anc-document-ocr-v1', enabled: true }] } },
      }],
    } as unknown as ConstructorParameters<typeof N8nEventBridge>[0];
    const bridge = new N8nEventBridge(store, 'http://n8n:5678', 'secret');
    const route = await (bridge as unknown as { documentRoute(input: { payloadRef: string; tenantId: string }): Promise<unknown> }).documentRoute({ payloadRef: '00000000-0000-4000-8000-000000000003', tenantId });
    expect(route).toEqual({ workflowKey: 'anc.document.ocr.extract', webhookPath: 'anc-test-document-ocr-wf-1', n8nWorkflowId: 'DOC01DocumentProcessing', payloadContract: 'anc-document-ocr-v1' });
  });
});
