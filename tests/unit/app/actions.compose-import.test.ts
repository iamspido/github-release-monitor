// vitest globals enabled

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  unstable_cache: (fn: any) => fn,
  updateTag: () => {},
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "en",
}));

function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("previewComposeImportAction", () => {
  const fetchBackup = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = fetchBackup;
  });

  it("finds recursive image keys and imports GitHub source labels from GHCR", async () => {
    const actions = await import("@/app/actions");
    const compose = `
x-zammad-service: &zammad-service
  image: "ghcr.io/zammad/zammad:7.0.1-0032"
services:
  app:
    <<: *zammad-service
  postgres:
    image: postgres:16
`;

    (global.fetch as any)
      .mockResolvedValueOnce(
        new Response(null, {
          status: 401,
          headers: {
            "www-authenticate":
              'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:zammad/zammad:pull"',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ token: "token" }))
      .mockResolvedValueOnce(
        jsonResponse({
          schemaVersion: 2,
          config: {
            digest: "sha256:config",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          config: {
            Labels: {
              "org.opencontainers.image.source":
                "https://github.com/zammad/zammad",
            },
          },
        }),
      );

    const result = await actions.previewComposeImportAction(
      "compose.yaml",
      compose,
    );

    expect(result.success).toBe(true);
    expect(result.repositories).toEqual([
      {
        id: "github:zammad/zammad",
        url: "https://github.com/zammad/zammad",
      },
    ]);
    expect(result.skipped.unsupported_registry).toBe(1);
  });

  it("reads source labels from multi-arch child manifests", async () => {
    const actions = await import("@/app/actions");

    (global.fetch as any)
      .mockResolvedValueOnce(
        jsonResponse({
          manifests: [
            {
              digest: "sha256:attestation",
              platform: { os: "unknown", architecture: "unknown" },
            },
            {
              digest: "sha256:linux-amd64",
              platform: { os: "linux", architecture: "amd64" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          config: {
            digest: "sha256:config",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          config: {
            Labels: {
              "org.opencontainers.image.source":
                "https://github.com/owner/repo",
            },
          },
        }),
      );

    const result = await actions.previewComposeImportAction(
      "compose.yml",
      "services:\n  app:\n    image: ghcr.io/owner/image@sha256:abc",
    );

    expect(result.success).toBe(true);
    expect(result.repositories.map((repo) => repo.id)).toEqual([
      "github:owner/repo",
    ]);
  });

  it("skips GHCR images with missing or invalid source labels", async () => {
    const actions = await import("@/app/actions");

    (global.fetch as any)
      .mockResolvedValueOnce(
        jsonResponse({
          config: {
            digest: "sha256:missing-label-config",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ config: { Labels: {} } }))
      .mockResolvedValueOnce(
        jsonResponse({
          annotations: {
            "org.opencontainers.image.source": "https://example.com/owner/repo",
          },
        }),
      );

    const result = await actions.previewComposeImportAction(
      "compose.yml",
      `
services:
  missing:
    image: ghcr.io/owner/missing:latest
  invalid:
    image: ghcr.io/owner/invalid:latest
`,
    );

    expect(result.success).toBe(true);
    expect(result.repositories).toEqual([]);
    expect(result.skipped.missing_source_label).toBe(1);
    expect(result.skipped.invalid_source_url).toBe(1);
  });

  it("ignores non-GHCR and non-owner image references", async () => {
    const actions = await import("@/app/actions");

    const result = await actions.previewComposeImportAction(
      "compose.yml",
      `
services:
  dockerhub:
    image: docker.io/owner/image:latest
  official:
    image: traefik:3
  shorthand:
    image: owner/image:latest
`,
    );

    expect(result.success).toBe(true);
    expect(result.repositories).toEqual([]);
    expect(result.skipped.unsupported_registry).toBe(3);
    expect((global.fetch as any).mock.calls.length).toBe(0);
  });
});
