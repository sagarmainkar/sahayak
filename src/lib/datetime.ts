/**
 * Returns a human-readable current UTC datetime string for injection
 * into the system prompt at session start. Used instead of relying
 * on the LLM to call the date tool.
 */
export function currentDatetimeContext(): string {
  const now = new Date();
  const dayName = now.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
  const ymd = now.toLocaleDateString("en-CA", { timeZone: "UTC" }); // YYYY-MM-DD
  const hms = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
    hour12: false,
  });
  return `Current date and time: ${dayName}, ${ymd} ${hms} UTC`;
}
