export const parsePermittedLanguages = (value: string): string[] => [...new Set(value.split(',').map((language) => language.trim().toLowerCase()).filter(Boolean))];
