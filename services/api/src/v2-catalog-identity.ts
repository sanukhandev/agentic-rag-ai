/** Preserve the existing V1 UUID foreign key while persisting canonical V2 text refs. */
const uuidVersionId = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;

export const catalogVersionStorage = (
  version: string | null | undefined,
): { legacy: string | null; v2: string | null } => {
  const value = version ?? null;
  return {
    legacy: value && uuidVersionId.test(value) ? value : null,
    v2: value && !uuidVersionId.test(value) ? value : null,
  };
};
