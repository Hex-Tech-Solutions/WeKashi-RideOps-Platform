import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useBulkCreateEmployees, buildEmployeePayload, type CreateEmployeePayload } from "@/lib/queries";
import { toast } from "sonner";
import { Upload } from "lucide-react";

const SAMPLE = `empId,name,gender,phone,pickup,drop,loginTime,logoutTime
EMP-2001,Aarti Nair,F,+91 98111 22233,HSR Layout Sector 2,Embassy Tech Village,08:30,18:30
EMP-2002,Sandeep Rao,M,+91 98111 33344,Marathahalli,Embassy Tech Village,08:30,18:30
EMP-2003,Kavita Joshi,F,+91 98111 44455,Indiranagar,Embassy Tech Village,08:30,18:30`;

function parseCsvToPayload(csv: string): { rows: CreateEmployeePayload[]; errors: string[] } {
  const errors: string[] = [];
  const rows: CreateEmployeePayload[] = [];
  const lines = csv.trim().split(/\r?\n/);
  if (!lines.length || !lines[0]) return { rows, errors: ["Empty CSV"] };
  const hasHeader = lines[0].toLowerCase().includes("empid") || lines[0].toLowerCase().includes("name");
  const dataLines = hasHeader ? lines.slice(1) : lines;
  dataLines.forEach((line, i) => {
    if (!line.trim()) return;
    const cols = line.split(",").map((c) => c.trim());
    if (cols.length < 6) { errors.push(`Row ${i + 1}: needs at least empId,name,gender,phone,pickup,drop`); return; }
    const [empId, name, gender, phone, pickup, drop, loginTime, logoutTime] = cols;
    if (!name || !empId) { errors.push(`Row ${i + 1}: missing name/empId`); return; }
    rows.push(buildEmployeePayload({
      empId, name, gender, phone, pickup: pickup || "Jayanagar 4th Block", drop,
      loginTime: loginTime || "08:30", logoutTime: logoutTime || "18:30",
    }));
  });
  return { rows, errors };
}

export function CsvImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const bulkCreate = useBulkCreateEmployees();
  const [csv, setCsv] = useState(SAMPLE);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File) => {
    const text = await f.text();
    setCsv(text);
  };

  const submit = () => {
    const { rows, errors } = parseCsvToPayload(csv);
    if (errors.length) toast.error(`${errors.length} row(s) skipped`, { description: errors[0] });
    if (!rows.length) return;
    bulkCreate.mutate(rows, {
      onSuccess: (res) => {
        toast.success(`Imported ${res.successCount} employee${res.successCount === 1 ? "" : "s"}`);
        if (res.failCount) toast.error(`${res.failCount} row(s) failed`, { description: res.results.find((r) => !r.success)?.error });
        if (res.successCount) onOpenChange(false);
      },
      onError: (e: any) => toast.error(e?.message ?? "Import failed"),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Import employees from CSV</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="h-3.5 w-3.5" /> Choose .csv file</Button>
            <Button variant="ghost" size="sm" onClick={() => setCsv(SAMPLE)}>Reset to sample</Button>
          </div>
          <Textarea value={csv} onChange={(e) => setCsv(e.target.value)} className="font-mono text-xs h-56" />
          <div className="text-xs text-muted-foreground">Columns: empId, name, gender (M/F), phone, pickup, drop, loginTime, logoutTime</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={submit} disabled={bulkCreate.isPending}>{bulkCreate.isPending ? "Importing…" : "Parse & import"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
