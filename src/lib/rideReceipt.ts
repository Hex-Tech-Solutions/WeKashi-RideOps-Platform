import type { RideDetail } from "@/lib/queries";

/**
 * Build a printable, self-contained ride receipt (HTML) and open the browser
 * print dialog so the supervisor can save it as PDF / print it for bill claims.
 *
 * No external dependency — the whole document is inline HTML + CSS. Times are
 * rendered in IST so they match the console and the OTD report.
 */
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  if (/^\d{2}:\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
}

function esc(s: string | null | undefined): string {
  return (s ?? "—").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

export function downloadRideReceipt(ride: RideDetail): void {
  const tripId = ride.id.slice(0, 8);
  const generated = new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour12: false });

  const paxRows = ride.passengers
    .map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(p.name)} <span class="muted">(${esc(p.empId)})</span></td>
        <td>${esc(p.pickupAddress)}</td>
        <td>${esc(p.dropAddress)}</td>
        <td>${p.noShow ? "No-show" : p.droppedAt ? "Completed" : p.pickedAt ? "In transit" : "Not picked"}</td>
        <td>${fmtTime(p.pickedAt)}</td>
        <td>${fmtTime(p.droppedAt)}</td>
      </tr>`)
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Ride Receipt ${tripId}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 32px; font-size: 13px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: #666; font-size: 12px; margin-bottom: 20px; }
  .brand { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #D5B036; padding-bottom:12px; margin-bottom:20px; }
  .brand .right { text-align:right; font-size:12px; color:#555; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 24px; margin-bottom:20px; }
  .row { display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid #eee; }
  .row .k { color:#666; }
  .row .v { font-weight:600; text-align:right; }
  .section { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#999; margin:18px 0 8px; font-weight:700; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th, td { border:1px solid #ddd; padding:6px 8px; text-align:left; vertical-align:top; }
  th { background:#f6f6f6; font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  .muted { color:#888; font-weight:normal; }
  .fare { margin-top:20px; border:2px solid #111; border-radius:8px; padding:14px 18px; display:flex; justify-content:space-between; align-items:center; }
  .fare .amt { font-size:26px; font-weight:800; }
  .foot { margin-top:28px; font-size:11px; color:#999; text-align:center; }
  @media print { body { margin:12mm; } }
</style></head>
<body>
  <div class="brand">
    <div>
      <h1>Wekashi Cab — Ride Receipt</h1>
      <div class="sub">Trip ID: <b>${tripId}</b> · For bill claim / reimbursement</div>
    </div>
    <div class="right">
      Generated: ${esc(generated)} IST<br/>
      Status: ${esc(ride.status)}
    </div>
  </div>

  <div class="grid">
    <div>
      <div class="row"><span class="k">Type</span><span class="v">${esc(ride.type)}</span></div>
      <div class="row"><span class="k">Vehicle</span><span class="v">${esc(ride.vehicleType)}</span></div>
      <div class="row"><span class="k">Distance</span><span class="v">${ride.distanceKm != null ? ride.distanceKm + " km" : "—"}</span></div>
      <div class="row"><span class="k">Passengers</span><span class="v">${ride.paxCount}</span></div>
    </div>
    <div>
      <div class="row"><span class="k">Planned pickup</span><span class="v">${fmtTime(ride.plannedStartTime)}</span></div>
      <div class="row"><span class="k">Driver arrived</span><span class="v">${fmtDateTime(ride.driverReportingTime)}</span></div>
      <div class="row"><span class="k">Started</span><span class="v">${fmtDateTime(ride.startedAt)}</span></div>
      <div class="row"><span class="k">Completed</span><span class="v">${fmtDateTime(ride.completedAt)}</span></div>
    </div>
  </div>

  <div class="section">Route</div>
  <div class="row"><span class="k">Pickup</span><span class="v">${esc(ride.pickupAddress)}</span></div>
  <div class="row"><span class="k">Drop</span><span class="v">${esc(ride.dropAddress)}</span></div>

  <div class="section">Driver &amp; Vendor</div>
  <div class="grid">
    <div>
      <div class="row"><span class="k">Driver</span><span class="v">${esc(ride.driver?.fullName)}</span></div>
      <div class="row"><span class="k">Phone</span><span class="v">${esc(ride.driver?.phone)}</span></div>
    </div>
    <div>
      <div class="row"><span class="k">Vehicle No.</span><span class="v">${esc(ride.driver?.vehicle?.regNo)}</span></div>
      <div class="row"><span class="k">Vendor</span><span class="v">${esc(ride.vendor?.name)}</span></div>
    </div>
  </div>

  <div class="section">Passengers (${ride.passengers.length})</div>
  <table>
    <thead><tr><th>#</th><th>Employee</th><th>Pickup</th><th>Drop</th><th>Status</th><th>Picked</th><th>Dropped</th></tr></thead>
    <tbody>${paxRows || `<tr><td colspan="7" class="muted">No passenger records.</td></tr>`}</tbody>
  </table>

  <div class="fare">
    <div>
      <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;">Total fare</div>
      <div style="font-size:12px;color:#666;">Paid directly to the driver by UPI</div>
    </div>
    <div class="amt">₹${ride.price ?? 0}</div>
  </div>

  <div class="foot">Wekashi Cab by Shreeya Tours and Travels · This is a system-generated receipt for internal claim/reimbursement use.</div>

  <script>window.onload = () => { window.print(); };</script>
</body></html>`;

  const win = window.open("", "_blank");
  if (!win) {
    // Popup blocked — fall back to a downloadable .html file.
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `RideReceipt_${tripId}.html`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  win.document.write(html);
  win.document.close();
}
