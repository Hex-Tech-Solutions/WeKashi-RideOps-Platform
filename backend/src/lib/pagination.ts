/**
 * Safe pagination helpers — prevent clients from dumping entire tables
 * by passing limit=99999.
 */
export const MAX_PAGE_SIZE = 100;

export function parsePagination(
  pageParam: unknown,
  limitParam: unknown,
  defaultLimit = 20,
): { page: number; limit: number } {
  const page  = Math.max(1, Number(pageParam)  || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(limitParam) || defaultLimit));
  return { page, limit };
}
