export function cairoDate(value: Date | string | number) {
  return new Intl.DateTimeFormat("ar-EG", {
    timeZone: "Africa/Cairo",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
export function cairoInput(value: Date | string | number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function fromCairoInput(value: string) {
  if (!value) return "";
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
    throw new Error("راجع موعد الامتحان.");
  const wall = Date.parse(`${value}:00Z`);
  let utc = wall;
  for (let i = 0; i < 3; i++)
    utc += wall - Date.parse(`${cairoInput(utc)}:00Z`);
  if (cairoInput(utc) !== value)
    throw new Error("الوقت ده غير متاح مع تغيير التوقيت. اختار وقتًا آخر.");
  return new Date(utc).toISOString();
}
