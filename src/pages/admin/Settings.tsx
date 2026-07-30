import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export default function AdminSettings() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Platform Settings" />
      <div className="space-y-6">
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Operational defaults</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between"><Label>Default broadcast radius (km)</Label><Input defaultValue="5" type="number" className="w-24" /></div>
            <div className="flex items-center justify-between"><Label>Auction window (sec)</Label><Input defaultValue="180" type="number" className="w-24" /></div>
            <div className="flex items-center justify-between"><Label>Auto-blacklist on doc expiry</Label><Switch defaultChecked /></div>
            <div className="flex items-center justify-between"><Label>SMS OTP enabled</Label><Switch defaultChecked /></div>
          </CardContent>
        </Card>
        <div className="flex justify-end"><Button className="bg-foreground text-background hover:bg-foreground/90">Save</Button></div>
      </div>
    </div>
  );
}
