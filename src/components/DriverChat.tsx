import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useIssueMessages, useSendIssueMessage, type IssueRow } from "@/lib/queries";
import { useDriverAuth } from "@/pages/driver/useDriverAuth";
import { Send, Loader2, AlertTriangle, Phone } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

const ISSUE_TYPE_LABELS: Record<string, string> = {
  vehicle_issue:      "Vehicle Issue",
  medical_emergency:  "Medical Emergency",
  other:              "Other Issue",
};

interface Props {
  issue: IssueRow;
}

export function DriverChat({ issue }: Props) {
  const { session } = useDriverAuth();
  const { data, isLoading } = useIssueMessages(issue.id, true);
  const send = useSendIssueMessage();
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const messages = data?.messages ?? [];

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    send.mutate(
      { issueId: issue.id, body },
      {
        onSuccess: () => setText(""),
        onError: (e: any) => toast.error(e?.message ?? "Failed to send"),
      },
    );
  };

  const issueTypeLabel = issue.issueType
    ? (ISSUE_TYPE_LABELS[issue.issueType] ?? issue.issueType)
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Issue header */}
      <div className="px-4 py-3 border-b bg-destructive/10 space-y-1">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <span className="text-sm font-semibold text-destructive">
            {issueTypeLabel ?? "SOS Alert"}
          </span>
          <Badge
            variant="outline"
            className={`ml-auto text-[10px] py-0 ${
              issue.status === "resolved"
                ? "border-success/40 text-success"
                : "border-destructive/40 text-destructive"
            }`}
          >
            {issue.status}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{issue.description}</p>
        <p className="text-[11px] text-muted-foreground">
          {formatDistanceToNow(new Date(issue.createdAt), { addSuffix: true })}
          {" · "}Supervisor: {issue.supervisor?.fullName ?? "—"}
        </p>
        {issue.supervisor?.phone && issue.status !== "resolved" && (
          <a
            href={`tel:${issue.supervisor.phone}`}
            className="flex items-center justify-center gap-2 w-full rounded-md border border-destructive/40 bg-destructive/5 text-destructive py-2 text-sm font-medium mt-1 hover:bg-destructive/10 transition-colors"
          >
            <Phone className="h-4 w-4" />
            Call supervisor · {issue.supervisor.phone}
          </a>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
        {isLoading && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isLoading && messages.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-6">
            Your supervisor has been notified. Messages will appear here.
          </div>
        )}
        {messages.map((m) => {
          const mine = m.senderId === session?.id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  mine
                    ? "bg-gold text-gold-foreground rounded-br-sm"
                    : "bg-secondary rounded-bl-sm"
                }`}
              >
                {!mine && (
                  <div className="text-[10px] font-semibold opacity-70 mb-0.5 capitalize">
                    {m.senderName} · {m.senderRole}
                  </div>
                )}
                <div>{m.body}</div>
                <div className={`text-[10px] mt-0.5 text-right ${mine ? "opacity-70" : "text-muted-foreground"}`}>
                  {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {issue.status !== "resolved" && (
        <div className="px-4 py-3 border-t flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message your supervisor…"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            className="flex-1"
          />
          <Button
            size="icon"
            className="bg-foreground text-background hover:bg-foreground/90 shrink-0"
            disabled={send.isPending || !text.trim()}
            onClick={submit}
          >
            {send.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Send className="h-4 w-4" />}
          </Button>
        </div>
      )}
      {issue.status === "resolved" && (
        <div className="px-4 py-3 border-t text-center text-xs text-success">
          This issue has been resolved.
        </div>
      )}
    </div>
  );
}
