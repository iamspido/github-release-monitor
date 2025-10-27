export const SETTINGS_LOCALE_COOKIE = "grm.locale";
export const NEXT_LOCALE_COOKIE = "NEXT_LOCALE";
export const SETTINGS_LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export const settingsLocaleCookieOptions = {
  path: "/",
  sameSite: "lax" as const,
  httpOnly: true,
  secure: process.env.HTTPS !== "false",
  maxAge: SETTINGS_LOCALE_COOKIE_MAX_AGE,
};

export const nextLocaleCookieOptions = {
  path: "/",
  sameSite: "lax" as const,
  httpOnly: false,
  secure: process.env.HTTPS !== "false",
  maxAge: SETTINGS_LOCALE_COOKIE_MAX_AGE,
};
