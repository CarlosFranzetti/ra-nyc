import { format, parseISO } from "date-fns";

/**
 * RA returns times either as a full ISO timestamp or a bare `HH:mm`, so both
 * have to be handled. Output is deliberately terse — `11pm`, not `11:00 PM` —
 * which is what keeps the compact card readable.
 */
export function formatTime(time: string): string {
  if (!time) return "";

  if (time.includes("T")) {
    const d = parseISO(time);
    if (Number.isNaN(d.getTime())) return "";
    return format(d, "h:mma").toLowerCase().replace(":00", "");
  }

  const [hours, minutes = "00"] = time.split(":");
  const h = Number.parseInt(hours ?? "", 10);
  if (Number.isNaN(h)) return "";

  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  const mins = minutes === "00" ? "" : `:${minutes}`;
  return `${hour12}${mins}${suffix}`;
}
