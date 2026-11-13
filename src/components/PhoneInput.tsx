/**
 * Indian mobile number input: a fixed, non-editable "+91" prefix and exactly
 * 10 digits (numeric keypad on phones). `value` / `onChange` carry the 10
 * digits only — use `toE164()` to send "+91XXXXXXXXXX" to the API.
 */
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const toE164 = (digits: string) => `+91${digits}`;

/** True for a valid Indian mobile: 10 digits starting 6–9. */
export const isValidMobile = (digits: string) => /^[6-9]\d{9}$/.test(digits);

/** Strip "+91" / leading 0 / punctuation from a stored number for editing. */
export function mobileDigits(stored?: string | null): string {
  if (!stored) return "";
  let d = stored.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d.slice(-10);
}

export const PhoneInput = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (digits: string) => void;
    id?: string;
    className?: string;
    disabled?: boolean;
    "aria-label"?: string;
    onEnter?: () => void;
  }
>(function PhoneInput({ value, onChange, id, className, disabled, onEnter, ...rest }, ref) {
  return (
    <div
      className={cn(
        "flex h-10 w-full items-center rounded-md border border-input bg-background text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        disabled && "opacity-50",
        className,
      )}
    >
      <span className="pl-3 pr-2 text-muted-foreground select-none border-r h-full flex items-center" aria-hidden="true">
        +91
      </span>
      <input
        ref={ref}
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        maxLength={10}
        placeholder="10-digit mobile number"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
        onKeyDown={(e) => { if (e.key === "Enter") onEnter?.(); }}
        className="flex-1 h-full bg-transparent px-3 outline-none placeholder:text-muted-foreground tracking-wide"
        aria-label={rest["aria-label"] ?? "Mobile number"}
      />
    </div>
  );
});
