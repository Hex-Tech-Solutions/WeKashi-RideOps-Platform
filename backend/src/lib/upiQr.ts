// Build a `upi://pay` intent string for direct supervisor → driver payment.
// The frontend renders this as a QR code the supervisor scans in their UPI app.
// This payment happens off-platform and is never recorded as a platform txn.

export interface UpiQrParams {
  vpa: string;        // payee UPI VPA (driver)
  payeeName: string;  // account-holder name from VPA validation
  amount: number;     // rupees
  note?: string;      // transaction note (e.g. ride id)
}

export function buildUpiIntent({ vpa, payeeName, amount, note }: UpiQrParams): string {
  const params = new URLSearchParams({
    pa: vpa,
    pn: payeeName,
    am: amount.toFixed(2),
    cu: 'INR',
  });
  if (note) params.set('tn', note);
  return `upi://pay?${params.toString()}`;
}
