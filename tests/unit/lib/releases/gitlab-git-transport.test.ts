import { deflateSync } from "node:zlib";
import {
  extractPackPayloadFromUploadPackResponse,
  parseFirstGitObjectMetadataFromPack,
  parseGitSmartHttpTagRefs,
} from "@/lib/releases/gitlab-git-transport";

function pktLine(data: string): Uint8Array {
  const encoder = new TextEncoder();
  const payload = encoder.encode(data);
  return pktLineBytes(payload);
}

function pktLineBytes(payload: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const header = encoder.encode(
    (payload.length + 4).toString(16).padStart(4, "0"),
  );
  return new Uint8Array([...header, ...payload]);
}

function encodeGitObjectHeader(type: number, size: number): number[] {
  let remaining = size;
  const bytes: number[] = [(type << 4) | (remaining & 0x0f)];
  remaining >>= 4;
  if (remaining > 0) {
    bytes[0] |= 0x80;
  }

  while (remaining > 0) {
    let next = remaining & 0x7f;
    remaining >>= 7;
    if (remaining > 0) {
      next |= 0x80;
    }
    bytes.push(next);
  }

  return bytes;
}

function encodeGitObject(type: number, objectText: string): Uint8Array {
  const encoder = new TextEncoder();
  const objectBytes = encoder.encode(objectText);
  const header = encodeGitObjectHeader(type, objectBytes.length);
  const compressed = deflateSync(objectBytes);
  return new Uint8Array([...header, ...compressed]);
}

function buildPack(objects: Array<{ type: number; text: string }>): Uint8Array {
  const packHeader = Buffer.alloc(12);
  packHeader.write("PACK", 0, "ascii");
  packHeader.writeUInt32BE(2, 4);
  packHeader.writeUInt32BE(objects.length, 8);

  return new Uint8Array([
    ...packHeader,
    ...objects.flatMap((object) => [
      ...encodeGitObject(object.type, object.text),
    ]),
    ...new Uint8Array(20),
  ]);
}

function buildSingleObjectPack(type: number, objectText: string): Uint8Array {
  return buildPack([{ type, text: objectText }]);
}

describe("gitlab git transport parsers", () => {
  it("parses smart HTTP tag refs and associates peeled annotated tags", () => {
    const payload = new Uint8Array([
      ...pktLine("# service=git-upload-pack\n"),
      ...new TextEncoder().encode("0000"),
      ...pktLine(
        "1111111111111111111111111111111111111111 refs/heads/main\u0000multi_ack\n",
      ),
      ...pktLine("2222222222222222222222222222222222222222 refs/tags/v1.0.0\n"),
      ...pktLine(
        "3333333333333333333333333333333333333333 refs/tags/v1.0.0^{}\n",
      ),
      ...pktLine("4444444444444444444444444444444444444444 refs/tags/v2.0.0\n"),
    ]);

    expect(parseGitSmartHttpTagRefs(payload)).toEqual([
      {
        name: "v1.0.0",
        objectId: "2222222222222222222222222222222222222222",
        peeledObjectId: "3333333333333333333333333333333333333333",
      },
      {
        name: "v2.0.0",
        objectId: "4444444444444444444444444444444444444444",
      },
    ]);
  });

  it("parses commit metadata from a single-object pack", () => {
    const pack = buildSingleObjectPack(
      1,
      [
        "tree 0000000000000000000000000000000000000000",
        "author A <a@example.test> 1700000000 +0000",
        "committer C <c@example.test> 1700001234 +0000",
        "",
        "Release commit message",
      ].join("\n"),
    );

    expect(parseFirstGitObjectMetadataFromPack(pack)).toEqual({
      date: "2023-11-14T22:33:54.000Z",
      message: "Release commit message",
    });
  });

  it("parses annotated tag metadata from a single-object pack", () => {
    const pack = buildSingleObjectPack(
      4,
      [
        "object 0000000000000000000000000000000000000000",
        "type commit",
        "tag v1.0.0",
        "tagger T <t@example.test> 1700004321 +0000",
        "",
        "Annotated tag message",
      ].join("\n"),
    );

    expect(parseFirstGitObjectMetadataFromPack(pack)).toEqual({
      date: "2023-11-14T23:25:21.000Z",
      message: "Annotated tag message",
    });
  });

  it("extracts PACK data from sideband upload-pack responses split across pkt-lines", () => {
    const pack = buildSingleObjectPack(
      1,
      [
        "tree 0000000000000000000000000000000000000000",
        "committer C <c@example.test> 1700000001 +0000",
        "",
        "Sideband commit message",
      ].join("\n"),
    );
    const splitIndex = Math.floor(pack.length / 2);
    const sidebandResponse = new Uint8Array([
      ...pktLineBytes(
        new Uint8Array([2, ...new TextEncoder().encode("counting\n")]),
      ),
      ...pktLineBytes(new Uint8Array([1, ...pack.slice(0, splitIndex)])),
      ...pktLineBytes(new Uint8Array([1, ...pack.slice(splitIndex)])),
      ...new TextEncoder().encode("0000"),
    ]);

    const extracted =
      extractPackPayloadFromUploadPackResponse(sidebandResponse);

    expect(extracted).toEqual(pack);
    expect(
      parseFirstGitObjectMetadataFromPack(extracted ?? new Uint8Array()),
    ).toEqual({
      date: "2023-11-14T22:13:21.000Z",
      message: "Sideband commit message",
    });
  });

  it("parses first-object metadata from a multi-object pack", () => {
    const pack = buildPack([
      {
        type: 1,
        text: [
          "tree 0000000000000000000000000000000000000000",
          "committer C <c@example.test> 1700002222 +0000",
          "",
          "First object commit message",
        ].join("\n"),
      },
      {
        type: 4,
        text: [
          "object 0000000000000000000000000000000000000000",
          "type commit",
          "tag v2.0.0",
          "tagger T <t@example.test> 1700003333 +0000",
          "",
          "Second object tag message",
        ].join("\n"),
      },
    ]);

    expect(parseFirstGitObjectMetadataFromPack(pack)).toEqual({
      date: "2023-11-14T22:50:22.000Z",
      message: "First object commit message",
    });
  });

  it("ignores malformed and irrelevant smart HTTP ref packets", () => {
    const encoder = new TextEncoder();
    const malformedRefs = new Uint8Array([
      ...pktLine("missing-space\n"),
      ...pktLine("not-an-object-id refs/tags/v1.0.0\n"),
      ...pktLine("1111111111111111111111111111111111111111 refs/heads/main\n"),
      ...pktLine("2222222222222222222222222222222222222222 refs/tags/\n"),
    ]);

    expect(parseGitSmartHttpTagRefs(malformedRefs)).toEqual([]);
    expect(parseGitSmartHttpTagRefs(encoder.encode("zzzzpayload"))).toEqual([]);
    expect(parseGitSmartHttpTagRefs(encoder.encode("0010short"))).toEqual([]);
  });

  it("fails closed for malformed upload-pack packet framing", () => {
    const encoder = new TextEncoder();

    expect(
      extractPackPayloadFromUploadPackResponse(encoder.encode("zzzzpayload")),
    ).toBeNull();
    expect(
      extractPackPayloadFromUploadPackResponse(encoder.encode("0010short")),
    ).toBeNull();
    expect(
      extractPackPayloadFromUploadPackResponse(
        pktLineBytes(new Uint8Array([2, ...encoder.encode("progress\n")])),
      ),
    ).toBeNull();

    const directPack = encoder.encode("noisePACKpayload");
    expect(extractPackPayloadFromUploadPackResponse(directPack)).toEqual(
      encoder.encode("PACKpayload"),
    );
  });

  it("returns null for truncated, corrupt, empty, and unsupported packs", () => {
    const nonPackHeader = new Uint8Array(32);
    const emptyPack = buildPack([]);
    const corruptPack = buildSingleObjectPack(1, "message");
    corruptPack[13] = 0xff;
    corruptPack[14] = 0xff;
    const unsupportedObject = buildSingleObjectPack(
      3,
      "blob content without metadata",
    );
    const metadataLessCommit = buildSingleObjectPack(
      1,
      "tree 0000000000000000000000000000000000000000",
    );

    expect(parseFirstGitObjectMetadataFromPack(new Uint8Array())).toBeNull();
    expect(parseFirstGitObjectMetadataFromPack(nonPackHeader)).toBeNull();
    expect(parseFirstGitObjectMetadataFromPack(emptyPack)).toBeNull();
    expect(parseFirstGitObjectMetadataFromPack(corruptPack)).toBeNull();
    expect(parseFirstGitObjectMetadataFromPack(unsupportedObject)).toBeNull();
    expect(parseFirstGitObjectMetadataFromPack(metadataLessCommit)).toBeNull();
  });
});
