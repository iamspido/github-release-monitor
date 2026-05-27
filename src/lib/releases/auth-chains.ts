import type { AuthMode } from "@/lib/releases/fetch";
import type { GitlabAuthConfig } from "@/lib/repositories/providers";

export function buildGitlabAuthChain(
  headersWithoutAuth: Record<string, string>,
  auth: GitlabAuthConfig | null,
): Array<{ mode: AuthMode; options: RequestInit }> {
  const chain: Array<{ mode: AuthMode; options: RequestInit }> = [];
  const accessToken = auth?.accessToken ?? null;
  const deployToken = auth?.deployToken ?? null;

  if (accessToken) {
    chain.push({
      mode: "token",
      options: {
        headers: {
          ...headersWithoutAuth,
          "PRIVATE-TOKEN": accessToken,
        },
        cache: "no-store",
      },
    });
    chain.push({
      mode: "bearer",
      options: {
        headers: {
          ...headersWithoutAuth,
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      },
    });
  }

  if (deployToken) {
    const basicAuth = Buffer.from(
      `${deployToken.username}:${deployToken.token}`,
    ).toString("base64");
    chain.push({
      mode: "basic",
      options: {
        headers: {
          ...headersWithoutAuth,
          Authorization: `Basic ${basicAuth}`,
        },
        cache: "no-store",
      },
    });
  }

  chain.push({
    mode: "none",
    options: { headers: headersWithoutAuth, cache: "no-store" },
  });

  return chain;
}

export function buildCodebergAuthChain(
  headersWithoutAuth: Record<string, string>,
  authToken: string | null,
): Array<{ mode: AuthMode; options: RequestInit }> {
  const chain: Array<{ mode: AuthMode; options: RequestInit }> = [];

  if (authToken) {
    chain.push({
      mode: "token",
      options: {
        headers: {
          ...headersWithoutAuth,
          Authorization: `token ${authToken}`,
        },
        cache: "no-store",
      },
    });
    chain.push({
      mode: "bearer",
      options: {
        headers: {
          ...headersWithoutAuth,
          Authorization: `Bearer ${authToken}`,
        },
        cache: "no-store",
      },
    });
  }

  chain.push({
    mode: "none",
    options: { headers: headersWithoutAuth, cache: "no-store" },
  });

  return chain;
}
