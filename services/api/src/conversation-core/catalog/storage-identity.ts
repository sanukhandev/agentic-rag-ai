/** Maintain safe legacy UUID foreign keys while persisting canonical catalog references. */
const uuidVersionId = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;

export const catalogVersionStorage = (
  version: string | null | undefined,
): { legacy: string | null; catalogRef: string | null } => {
  const value = version ?? null;
  return {
    legacy: value && uuidVersionId.test(value) ? value : null,
    catalogRef: value && !uuidVersionId.test(value) ? value : null,
  };
};
