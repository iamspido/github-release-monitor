import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { normalizeLocale } from "@/i18n/config";
import { authenticatePassword } from "@/lib/auth/password-login";
import { readJsonPayload, toSafeString } from "@/lib/auth/request-context";
import { logger } from "@/lib/logger";
import { normalizeLocalizedRedirectPath } from "@/lib/safe-redirect";

type LoginPayload = {
  identifier?: unknown;
  password?: unknown;
  next?: unknown;
  locale?: unknown;
};

function getSetCookieHeaders(headers: Headers): string[] {
  const headersWithSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headersWithSetCookie.getSetCookie === "function") {
    return headersWithSetCookie.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function attachSetCookieHeaders(response: NextResponse, source: Response) {
  for (const cookie of getSetCookieHeaders(source.headers)) {
    response.headers.append("set-cookie", cookie);
  }
}

export async function POST(request: Request) {
  const jsonResult = await readJsonPayload<LoginPayload>(request);
  if (!jsonResult.ok) {
    return NextResponse.json(
      { errorKey: "error_invalid_credentials" },
      { status: 400 },
    );
  }
  const payload = jsonResult.payload;

  const identifier = toSafeString(payload.identifier);
  const password = typeof payload.password === "string" ? payload.password : "";
  const locale = normalizeLocale(payload.locale);
  const result = await authenticatePassword({
    headers: request.headers,
    identifier,
    password,
  });

  if (!result.ok) {
    return NextResponse.json(
      { errorKey: result.errorKey },
      { status: result.status },
    );
  }

  if (result.requiresTwoFactor) {
    const response = NextResponse.json({ requiresTwoFactor: true });
    attachSetCookieHeaders(response, result.response);
    return response;
  }

  const finalPath = normalizeLocalizedRedirectPath(
    typeof payload.next === "string" ? payload.next : undefined,
    locale,
  );
  logger
    .withScope("Auth")
    .info(`Password login completed; redirecting to a localized path.`);
  revalidatePath("/", "layout");
  const response = NextResponse.json({ redirectTo: `/${locale}${finalPath}` });
  attachSetCookieHeaders(response, result.response);
  return response;
}
