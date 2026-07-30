import { useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useRegistrationRequests, useReviewRegistrationRequest, type RegistrationRequestRow } from "@/lib/queries";
import { Loader2, CheckCircle2, XCircle, Clock, User, Building2, Phone, MapPin, FileText } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export default function RegistrationRequests() {
  const { data: allData, isLoading } = useRegistrationRequests();
  const requests = allData?.requests ?? [];

  const pending  = requests.filter((r) => r.status === "pending");
  const reviewed = requests.filter((r) => r.status !== "pending");

  return (
    <div>
      <PageHeader
        title="Account Requests"
        description="Review vendor and supervisor registration requests."
        actions={
          pending.length > 0
            ? <Badge className="bg-destructive text-destructive-foreground">{pending.length} pending</Badge>
            : undefined
        }
      />

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="reviewed">Reviewed ({reviewed.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          {isLoading
            ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
            : pending.length === 0
            ? <Empty text="No pending requests." />
            : <div className="space-y-4">{pending.map((r) => <RequestCard key={r.id} request={r} showActions />)}</div>}
        </TabsContent>

        <TabsContent value="reviewed" className="mt-4">
          {reviewed.length === 0
            ? <Empty text="No reviewed requests yet." />
            : <div className="space-y-4">{reviewed.map((r) => <RequestCard key={r.id} request={r} />)}</div>}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Request Card ─────────────────────────────────────────────────────────────

function RequestCard({ request: r, showActions }: { request: RegistrationRequestRow; showActions?: boolean }) {
  const review = useReviewRegistrationRequest();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");

  const approve = () => {
    review.mutate(
      { id: r.id, decision: "approved" },
      {
        onSuccess: () => toast.success(`${r.fullName} approved — account created`),
        onError: (e: any) => toast.error(e?.message ?? "Failed"),
      },
    );
  };

  const reject = () => {
    review.mutate(
      { id: r.id, decision: "rejected", reviewNote: note.trim() || undefined },
      {
        onSuccess: () => { toast.success("Request rejected"); setRejectOpen(false); setNote(""); },
        onError: (e: any) => toast.error(e?.message ?? "Failed"),
      },
    );
  };

  const statusColor = r.status === "approved"
    ? "border-success/40 text-success bg-success/10"
    : r.status === "rejected"
    ? "border-destructive/40 text-destructive bg-destructive/10"
    : "border-warning/40 text-warning bg-warning/10";

  return (
    <>
      <Card className={`shadow-card ${r.status === "pending" ? "border-warning/30" : ""}`}>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-2 flex-1 min-w-[280px]">
              {/* Header */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{r.fullName}</span>
                <Badge variant="outline" className="capitalize text-[10px] py-0">{r.role}</Badge>
                <Badge variant="outline" className={`text-[10px] py-0 ${statusColor}`}>
                  {r.status === "pending" ? <><Clock className="h-3 w-3 mr-1" />Pending</> : r.status}
                </Badge>
                <span className="text-xs text-muted-foreground ml-auto">
                  {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                </span>
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                <Detail icon={<User className="h-3.5 w-3.5" />} label="Email" value={r.email} />
                <Detail icon={<Phone className="h-3.5 w-3.5" />} label="Mobile" value={r.mobile} />
                <Detail icon={<Building2 className="h-3.5 w-3.5" />} label={r.role === "vendor" ? "Company" : "Organisation"} value={r.companyName} />
                {r.gstin && <Detail icon={<FileText className="h-3.5 w-3.5" />} label="GSTIN" value={r.gstin} />}
                <div className="sm:col-span-2">
                  <Detail icon={<MapPin className="h-3.5 w-3.5" />} label="Address" value={r.address} />
                </div>
              </div>

              {r.reviewNote && (
                <div className="text-xs text-muted-foreground rounded bg-secondary px-3 py-2">
                  <b>Note:</b> {r.reviewNote}
                </div>
              )}
            </div>

            {/* Actions */}
            {showActions && (
              <div className="flex flex-col gap-2 shrink-0">
                <Button
                  size="sm"
                  className="bg-success text-success-foreground hover:bg-success/90 gap-1.5"
                  disabled={review.isPending}
                  onClick={approve}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 gap-1.5"
                  disabled={review.isPending}
                  onClick={() => setRejectOpen(true)}
                >
                  <XCircle className="h-3.5 w-3.5" /> Reject
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject request — {r.fullName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <p className="text-sm text-muted-foreground">Optionally add a note explaining why (visible to admin only, not sent to applicant).</p>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="e.g. Duplicate request / missing details…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={reject}
              disabled={review.isPending}
            >
              {review.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-1.5 text-sm">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <span className="text-muted-foreground text-xs">{label}: </span>
        <span className="break-words">{value}</span>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Card className="shadow-card">
      <CardContent className="py-12 text-center text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}
