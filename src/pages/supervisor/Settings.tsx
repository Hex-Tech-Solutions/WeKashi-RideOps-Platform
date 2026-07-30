import { useEffect, useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  useSupervisorOffice,
  useSetSupervisorPhone,
  useSetFacility,
  useOfficeLocations,
  useCreateOfficeLocation,
  useUpdateOfficeLocation,
  useDeleteOfficeLocation,
  type OfficeLocationRow,
} from "@/lib/queries";
import { OfficeMapPicker } from "@/components/OfficeMapPicker";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, MapPin, Plus, Pencil, Trash2, Star, X, Check } from "lucide-react";

export default function SupervisorSettings() {
  const { profile } = useAuth();
  const { data: office } = useSupervisorOffice();
  const savePhone = useSetSupervisorPhone();
  const saveFacility = useSetFacility();
  const [phone, setPhone] = useState("");
  const [facility, setFacility] = useState("");
  useEffect(() => { if (office?.phone) setPhone(office.phone); }, [office?.phone]);
  useEffect(() => { if (office?.facility) setFacility(office.facility); }, [office?.facility]);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" description="Company profile, office locations & preferences." />
      <div className="space-y-6">

        {/* Company profile */}
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Company profile</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div><Label>Company</Label><Input defaultValue={profile?.org ?? ""} className="mt-1" /></div>
            <div>
              <Label>Facility / Client code</Label>
              <div className="flex gap-2 mt-1">
                <Input value={facility} onChange={(e) => setFacility(e.target.value)} placeholder="e.g. msi-MBlr, TechCorp-Pune" />
                <Button variant="outline" className="shrink-0" disabled={saveFacility.isPending}
                  onClick={() => saveFacility.mutate(facility, {
                    onSuccess: () => toast.success("Facility code saved"),
                    onError: (e: any) => toast.error(e?.message ?? "Failed"),
                  })}>
                  Save
                </Button>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">Used in OTD reports as the Facility column.</div>
            </div>
            <div><Label>Default broadcast radius (km)</Label><Input defaultValue="10" type="number" className="mt-1" /></div>
            <div className="col-span-2">
              <Label>Your contact number (POC for female employees)</Label>
              <div className="flex gap-2 mt-1">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98xxxxxxxx" />
                <Button variant="outline" className="shrink-0" disabled={savePhone.isPending}
                  onClick={() => savePhone.mutate(phone, {
                    onSuccess: () => toast.success("Contact number saved"),
                    onError: (e: any) => toast.error(e?.message ?? "Failed"),
                  })}>
                  Save
                </Button>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Drivers see this number for <b>female</b> passengers — you're the point of contact.
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Office locations */}
        <OfficeLocationManager />

        {/* Safety rules */}
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Safety rules</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Toggle label="No lone female at first/last stop" defaultChecked desc="The routing engine rejects unsafe sequences." />
            <Toggle label="Female pickup first (login) / drop last (logout)" defaultChecked />
            <Toggle label="Require male escort if only female is at edge" />
            <Toggle label="Auto-call SOS contact on panic alert" defaultChecked />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Office Location Manager ──────────────────────────────────────────────────

function OfficeLocationManager() {
  const { data, isLoading } = useOfficeLocations();
  const createOffice = useCreateOfficeLocation();
  const updateOffice = useUpdateOfficeLocation();
  const deleteOffice = useDeleteOfficeLocation();

  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const offices = data?.offices ?? [];

  return (
    <Card className="shadow-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4 text-gold" /> Office Locations
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => { setShowAdd(true); setEditId(null); }}>
            <Plus className="h-3.5 w-3.5" /> Add office
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Add all your company offices. The <b className="text-foreground">default</b> is used as the destination for login rides. Each employee can be linked to a specific office.
        </p>

        {isLoading && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>}

        {/* Saved offices list */}
        {offices.map((o) => (
          editId === o.id
            ? <OfficeForm
                key={o.id}
                initial={o}
                onSave={(data) => updateOffice.mutate(
                  { id: o.id, ...data },
                  { onSuccess: () => { toast.success("Office updated"); setEditId(null); }, onError: (e: any) => toast.error(e?.message ?? "Failed") },
                )}
                onCancel={() => setEditId(null)}
                saving={updateOffice.isPending}
              />
            : <OfficeCard
                key={o.id}
                office={o}
                onEdit={() => setEditId(o.id)}
                onDelete={() => deleteOffice.mutate(o.id, {
                  onSuccess: () => toast.success("Office removed"),
                  onError: (e: any) => toast.error(e?.message ?? "Failed"),
                })}
                onSetDefault={() => updateOffice.mutate(
                  { id: o.id, isDefault: true },
                  { onSuccess: () => toast.success(`${o.name} set as default`), onError: (e: any) => toast.error(e?.message ?? "Failed") },
                )}
                deleting={deleteOffice.isPending}
              />
        ))}

        {offices.length === 0 && !isLoading && (
          <div className="text-sm text-muted-foreground text-center py-4 border-2 border-dashed rounded-md">
            No office locations yet — add one above.
          </div>
        )}

        {/* Add new office form */}
        {showAdd && (
          <OfficeForm
            onSave={(data) => createOffice.mutate(
              data,
              { onSuccess: () => { toast.success("Office added"); setShowAdd(false); }, onError: (e: any) => toast.error(e?.message ?? "Failed") },
            )}
            onCancel={() => setShowAdd(false)}
            saving={createOffice.isPending}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Office Card ──────────────────────────────────────────────────────────────

function OfficeCard({ office, onEdit, onDelete, onSetDefault, deleting }: {
  office: OfficeLocationRow;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  deleting: boolean;
}) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${office.isDefault ? "border-gold/40 bg-gold-soft/30" : "border-border"}`}>
      <MapPin className={`h-4 w-4 mt-0.5 shrink-0 ${office.isDefault ? "text-gold" : "text-muted-foreground"}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{office.name}</span>
          {office.isDefault && (
            <Badge variant="outline" className="border-gold/40 text-gold-dark bg-gold-soft text-[10px] py-0">
              Default
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 truncate">{office.address}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">Grace period: {office.gracePeriodSecs}s ({Math.round(office.gracePeriodSecs / 60)} min)</div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {!office.isDefault && (
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-gold" title="Set as default" onClick={onSetDefault}>
            <Star className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" disabled={deleting} onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Office Form (add / edit) ─────────────────────────────────────────────────

function OfficeForm({ initial, onSave, onCancel, saving }: {
  initial?: OfficeLocationRow;
  onSave: (data: { name: string; address: string; lat: number; lng: number; isDefault?: boolean; gracePeriodSecs: number }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [gracePeriodSecs, setGracePeriodSecs] = useState(initial?.gracePeriodSecs ?? 600);
  const [picked, setPicked] = useState<{ lat: number; lng: number; address: string } | null>(
    initial ? { lat: initial.lat, lng: initial.lng, address: initial.address } : null
  );

  const submit = () => {
    if (!name.trim()) { toast.error("Enter an office name (e.g. HQ, Whitefield Campus)"); return; }
    if (!picked) { toast.error("Select the office location on the map"); return; }
    onSave({ name: name.trim(), address: picked.address, lat: picked.lat, lng: picked.lng, gracePeriodSecs });
  };

  return (
    <div className="rounded-lg border border-gold/30 bg-gold-soft/20 p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Office name</Label>
          <Input
            className="mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. HQ, Whitefield Campus"
            autoFocus
          />
        </div>
        <div>
          <Label>Grace period (seconds)</Label>
          <Input
            className="mt-1"
            type="number"
            min={0}
            max={3600}
            value={gracePeriodSecs}
            onChange={(e) => setGracePeriodSecs(Number(e.target.value))}
          />
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Buffer after planned time before marking "late". Default 600 = 10 min.
          </div>
        </div>
      </div>
      <OfficeMapPicker
        initial={initial ? { lat: initial.lat, lng: initial.lng, address: initial.address } : null}
        onChange={setPicked}
      />
      {picked && (
        <div className="text-xs rounded bg-secondary p-2">{picked.address}</div>
      )}
      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" className="flex-1" onClick={onCancel} disabled={saving}>
          <X className="h-3.5 w-3.5" /> Cancel
        </Button>
        <Button size="sm" className="flex-1 bg-foreground text-background hover:bg-foreground/90" onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Check className="h-3.5 w-3.5" /> {initial ? "Update" : "Save"} office</>}
        </Button>
      </div>
    </div>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ label, desc, defaultChecked }: { label: string; desc?: string; defaultChecked?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <div className="font-medium text-sm">{label}</div>
        {desc && <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>}
      </div>
      <Switch defaultChecked={defaultChecked} />
    </div>
  );
}
