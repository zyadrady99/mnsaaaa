export function normalizePhone(value: unknown) {
  if (typeof value !== "string" || value.length > 40) return null;
  const phone = value
    .normalize("NFKC")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[\s().-]/g, "")
    .replace(/^(0020|\+20|20)/, "0");
  return /^01[0125][0-9]{8}$/.test(phone) ? `+20${phone.slice(1)}` : null;
}
export function validPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    new TextEncoder().encode(value).length <= 72 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}
export const passwordHint =
  "١٢ حرفًا على الأقل، وفيها حرف إنجليزي كبير وصغير ورقم ورمز.";
export function validUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
