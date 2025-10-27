"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { pathnames } from "@/i18n/routing";
import { logger } from "@/lib/logger";
import { redirectLocalized } from "@/lib/redirect-localized";
import { getSession } from "@/lib/session";

export async function login(
  _previousState: { errorKey?: string } | undefined,
  formData: FormData,
) {
  const username = formData.get("username");
  const password = formData.get("password");
  const next = formData.get("next");

  // Security: Validate input types and presence
  if (
    typeof username !== "string" ||
    !username.trim() ||
    typeof password !== "string" ||
    !password
  ) {
    logger
      .withScope("Auth")
      .warn("Login attempt with invalid input (missing username or password)");
    return { errorKey: "error_invalid_credentials" };
  }

  if (
    username === process.env.AUTH_USERNAME &&
    password === process.env.AUTH_PASSWORD
  ) {
    const session = await getSession();
    session.isLoggedIn = true;
    session.username = username;
    await session.save();
    logger.withScope("Auth").info(`User '${username}' logged in`);

    // Revalidate the root path to ensure data is fresh after login.
    // The path revalidated must be the absolute path, not the translated one.
    revalidatePath("/", "layout");

    // Security: Only redirect to relative paths within the app to prevent open redirect vulnerabilities.
    if (
      typeof next === "string" &&
      next.startsWith("/") &&
      !next.startsWith("//") &&
      !next.includes("..")
    ) {
      const locale = await getLocale();
      // Remove the leading locale from the 'next' parameter before redirecting
      // e.g., transforms "/de/test" to "/test"
      const pathWithoutLocale = next.startsWith(`/${locale}`)
        ? next.substring(`/${locale}`.length)
        : next;

      // Ensure the path is not empty and starts with a slash
      const finalPath =
        (pathWithoutLocale.startsWith("/")
          ? pathWithoutLocale
          : `/${pathWithoutLocale}`) || "/";

      logger
        .withScope("Auth")
        .info(`Redirect after login to '${finalPath}' (locale=${locale})`);
      await redirectLocalized(finalPath, locale);
    } else {
      const locale = await getLocale();
      logger
        .withScope("Auth")
        .info(`Redirect after login to '/' (locale=${locale})`);
      await redirectLocalized("/", locale);
    }
  }

  logger
    .withScope("Auth")
    .warn(
      `Failed login attempt for username='${
        typeof username === "string" ? username : "unknown"
      }'`,
    );
  return { errorKey: "error_invalid_credentials" };
}

export async function logout() {
  const session = await getSession();
  const locale = await getLocale();
  const user = session.username || "unknown";
  logger.withScope("Auth").info(`User '${user}' logged out`);
  session.destroy();

  const loginPath = pathnames["/login"][locale as "en" | "de"];
  revalidatePath("/");
  await redirectLocalized(loginPath, locale);
}
