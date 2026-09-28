import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Client-side pager: fixed page size (default 6) with Prev/Next controls.
 * Replaces infinite scroll on list pages so each screen shows at most `pageSize`.
 */
export function usePagedList<T>(items: T[], pageSize = 6) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  // Clamp when the underlying list shrinks (e.g. realtime updates).
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pageItems = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize],
  );

  return { page, setPage, pageCount, pageItems, total: items.length, pageSize };
}

export function Pager({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
      <span>
        Page {page} of {pageCount} · {total} total
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
        >
          Next <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function PagedGrid<T>({
  items,
  pageSize = 6,
  className = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4",
  render,
}: {
  items: T[];
  pageSize?: number;
  className?: string;
  render: (item: T) => ReactNode;
}) {
  const { page, setPage, pageCount, pageItems, total } = usePagedList(items, pageSize);
  return (
    <>
      <div className={className}>{pageItems.map(render)}</div>
      <Pager page={page} pageCount={pageCount} total={total} onPage={setPage} />
    </>
  );
}
