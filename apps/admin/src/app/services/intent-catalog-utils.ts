import type { IngestionJobStatus } from '../types/admin.types';

export function isCatalogJobPending(status: IngestionJobStatus): boolean {
  return status === 'queued' || status === 'processing';
}
