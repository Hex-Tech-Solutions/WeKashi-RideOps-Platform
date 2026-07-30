import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function VendorSettings() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" />
      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Vendor profile</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div><Label>Company name</Label><Input defaultValue="Apex Fleet" className="mt-1" /></div>
          <div><Label>Primary contact</Label><Input defaultValue="Rohan Kapoor" className="mt-1" /></div>
          <div><Label>Phone</Label><Input defaultValue="+91 98800 11000" className="mt-1" /></div>
          <div><Label>GST</Label><Input defaultValue="29AABCU9603R1ZX" className="mt-1" /></div>
          <div className="col-span-2"><Label>Address</Label><Input defaultValue="HSR Layout, Bangalore" className="mt-1" /></div>
        </CardContent>
      </Card>
      <div className="flex justify-end mt-4"><Button className="bg-foreground text-background hover:bg-foreground/90">Save changes</Button></div>
    </div>
  );
}
