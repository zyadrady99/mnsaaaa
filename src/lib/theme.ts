export const themeCookie = "dorosna_theme";

export type Theme = "light" | "dark";

export function themeFromCookie(value?: string): Theme {
  return value === "dark" ? "dark" : "light";
}
