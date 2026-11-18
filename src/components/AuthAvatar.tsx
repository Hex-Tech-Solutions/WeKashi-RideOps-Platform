import { useQuery } from "@tanstack/react-query";
import { fetchFileBlob } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Round avatar. Uploaded files need an auth token, so the image is fetched as
 * a blob. Falls back to initials when there is no photo or it can't be loaded.
 */
export function AuthAvatar({
  fileUrl, name, className,
}: { fileUrl?: string | null; name: string; className?: string }) {
  const { data: src } = useQuery({
    queryKey: ["protected-image", fileUrl],
    queryFn: async () => URL.createObjectURL(await fetchFileBlob(fileUrl as string)),
    enabled: !!fileUrl,
    staleTime: Infinity,
    retry: false,
  });
  const initials = (name || "D").split(" ").map((n) => n[0]).join("").slice(0, 2);
  return (
    <div
      className={cn(
        "rounded-full bg-foreground text-background flex items-center justify-center font-bold shrink-0 overflow-hidden",
        className,
      )}
    >
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : initials}
    </div>
  );
}
