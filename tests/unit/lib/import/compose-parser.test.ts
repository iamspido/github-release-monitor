import { parseComposeImageValues } from "@/lib/import/compose-parser";

describe("Compose image parser", () => {
  it("collects and deduplicates image fields from nested Compose data", () => {
    expect(
      parseComposeImageValues(`
services:
  app:
    image: ghcr.io/example/app:latest
  worker:
    image: ghcr.io/example/app:latest
x-extra:
  nested:
    image: docker.io/example/worker:1
`),
    ).toEqual(["ghcr.io/example/app:latest", "docker.io/example/worker:1"]);
  });
});
