/**
 * In-app viewer for an uploaded document (image or PDF).
 *
 * The file is fetched with the auth header and shown from a local blob URL, so
 * it works inside the Android app's WebView, where target="_blank" links do
 * nothing, and never relies on a token baked into the URL.
 */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";
import { fetchFileBlob } from "@/lib/api";

export function DocumentViewer({
  fileUrl,
  title,
  onClose,
}: {
  fileUrl: string | null;
  title: string;
  onClose: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [type, setType] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fileUrl) return;
    let url: string | null = null;
    let cancelled = false;
    setBlobUrl(null);
    setError(null);

    fetchFileBlob(fileUrl)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setType(blob.type);
        setBlobUrl(url);
      })
      .catch((e: any) => { if (!cancelled) setError(e?.message ?? "Could not load the file"); });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileUrl]);

  const isPdf = type === "application/pdf";

  return (
    <Dialog open={!!fileUrl} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl w-[95vw] p-4">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="sr-only">Preview of the uploaded document</DialogDescription>
        </DialogHeader>

        <div className="min-h-[50vh] max-h-[75vh] flex items-center justify-center bg-secondary/40 rounded-md overflow-auto">
          {error ? (
            <div className="flex flex-col items-center gap-2 text-sm text-destructive p-6 text-center">
              <AlertTriangle className="h-5 w-5" /> {error}
            </div>
          ) : !blobUrl ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading document" />
          ) : isPdf ? (
            <iframe src={blobUrl} title={title} className="w-full h-[70vh] rounded-md bg-white" />
          ) : (
            <img src={blobUrl} alt={title} className="max-w-full max-h-[70vh] object-contain" />
          )}
        </div>

        {/* Some Android WebViews can't render PDFs inline — offer a download. */}
        {blobUrl && isPdf && (
          <Button asChild variant="outline" size="sm" className="w-full">
            <a href={blobUrl} download={`${title}.pdf`}>Download PDF</a>
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
