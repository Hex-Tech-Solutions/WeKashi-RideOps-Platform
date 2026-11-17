import { useEffect, useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PhoneInput, toE164, isValidMobile, mobileDigits } from "@/components/PhoneInput";
import { useVendorProfile, useUpdateVendorProfile } from "@/lib/queries";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/** Vendor's own company + contact details. Drivers see the company name. */
export default function VendorSettings() {
  const { data: profile, isLoading } = useVendorProfile();
  const save = useUpdateVendorProfile();
  const [form, setForm] = useState({ name: "", contactName: "", contactPhone: "", contactEmail: "" });

  useEffect(() => {
    if (profile) {
      setForm({
        name: profile.name,
        contactName: profile.contactName,
        contactPhone: mobileDigits(profile.contactPhone),
        contactEmail: profile.contactEmail,
      });
    }
  }, [profile]);

  const submit = () => {
    if (form.name.trim().length < 2) { toast.error("Company name is required"); return; }
    if (form.contactName.trim().length < 2) { toast.error("Primary contact is required"); return; }
    if (!isValidMobile(form.contactPhone)) { toast.error("Enter a valid 10-digit phone number"); return; }
    if (!/^\S+@\S+\.\S+$/.test(form.contactEmail.trim())) { toast.error("Enter a valid email"); return; }
    save.mutate(
      {
        name: form.name.trim(),
        contactName: form.contactName.trim(),
        contactPhone: toE164(form.contactPhone),
        contactEmail: form.contactEmail.trim(),
      },
      {
        onSuccess: () => toast.success("Settings saved"),
        onError: (e: any) => toast.error(e?.message ?? "Could not save"),
      },
    );
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" />
      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Vendor profile</CardTitle></CardHeader>
        {isLoading ? (
          <CardContent className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gold" /></CardContent>
        ) : (
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="vs-name">Company name</Label>
              <Input id="vs-name" className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <p className="text-[11px] text-muted-foreground mt-1">Drivers see this name when they join your fleet.</p>
            </div>
            <div>
              <Label htmlFor="vs-code">Vendor code</Label>
              <Input id="vs-code" className="mt-1 font-mono tracking-widest bg-muted/50" value={profile?.vendorCode ?? ""} readOnly />
              <p className="text-[11px] text-muted-foreground mt-1">Share this code with drivers to sign up.</p>
            </div>
            <div>
              <Label htmlFor="vs-contact">Primary contact</Label>
              <Input id="vs-contact" className="mt-1" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="vs-phone">Phone</Label>
              <PhoneInput id="vs-phone" className="mt-1" value={form.contactPhone} onChange={(contactPhone) => setForm({ ...form, contactPhone })} />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="vs-email">Contact email</Label>
              <Input id="vs-email" type="email" className="mt-1" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
            </div>
          </CardContent>
        )}
      </Card>
      <div className="flex justify-end mt-4">
        <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={submit} disabled={save.isPending || isLoading}>
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
