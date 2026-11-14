/** Vehicle registration number rules. Same as the server (backend/src/lib/identity.ts). */
export const normalizeRegNo = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Standard (KA05AB1234) or Bharat series (22BH1234AB). Expects a normalised value. */
export const isValidRegNo = (s: string) =>
  /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/.test(s) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(s);
