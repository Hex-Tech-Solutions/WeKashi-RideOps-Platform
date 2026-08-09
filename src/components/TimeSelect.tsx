import { useRef } from "react";
import { Input } from "@/components/ui/input";

interface Props extends Omit<React.ComponentPropsWithoutRef<"input">, "type" | "step" | "lang" | "value" | "onChange" | "ref"> {
  value: string;                    // "HH:MM", 24-hour
  onChange: (v: string) => void;
  className?: string;
}

// 24-hour time input — uses the browser/OS native time picker (the wheel/spinner
// UI you get on Android Chrome, iOS Safari, etc.) instead of a custom dropdown.
// step=60 hides the seconds wheel; lang="en-GB" nudges browsers that default to
// 12-hour AM/PM display (e.g. desktop Chrome on a US-locale OS) toward 24-hour.
export function TimeSelect({ value, onChange, className, ...rest }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Input
      ref={inputRef}
      type="time"
      step={60}
      lang="en-GB"
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        // Chrome's native time spinner only closes on blur/Enter/Tab, not
        // automatically after picking a value — close it as soon as a
        // complete time is set instead of leaving it open over the form.
        if (e.target.value) inputRef.current?.blur();
      }}
      className={className}
      {...rest}
    />
  );
}
