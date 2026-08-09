import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  value: string;                    // "HH:MM", 24-hour
  onChange: (v: string) => void;
  className?: string;
  stepMinutes?: 5 | 10 | 15 | 30;    // default 15
}

function buildOptions(stepMinutes: number): string[] {
  const options: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += stepMinutes) {
      options.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return options;
}

// 24-hour time dropdown (e.g. "08:30", "18:30") — replaces free-text time entry
// so supervisors can't type an invalid or ambiguous (12h) value.
export function TimeSelect({ value, onChange, className, stepMinutes = 15 }: Props) {
  const options = buildOptions(stepMinutes);
  // If the current value doesn't fall on a step boundary (e.g. legacy data,
  // or a value saved before this component existed), still show it as a
  // selectable option so nothing silently changes on open.
  const allOptions = value && !options.includes(value) ? [...options, value].sort() : options;

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Select time…" />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {allOptions.map((t) => (
          <SelectItem key={t} value={t}>{t}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
