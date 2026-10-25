import { describe, expect, it } from "vitest";
import { isLikelyEmail } from "@/lib/auth/request-context";

// Up to 254 characters `isLikelyEmail` accepts exactly what the former pattern
// accepted, which serves as the oracle. Longer values fail.

const FORMER = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALPHABET = ["a", ".", "@", " ", "\t", "ä"];
const NAME_CHARACTERS = ["a", "a", "ä", "."];
const CORPUS_SIZE = 255 * 80;

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function generatedValues(): string[] {
  const next = seededRandom(254);
  const pick = (values: readonly string[]) =>
    values[Math.floor(next() * values.length)];
  const values: string[] = [];
  for (let index = 0; index < CORPUS_SIZE; index += 1) {
    const length = index % 255;
    const characters: string[] = [];
    if (index % 2 === 0) {
      for (let position = 0; position < length; position += 1)
        characters.push(pick(ALPHABET));
    } else {
      const at = Math.floor(next() * length);
      for (let position = 0; position < length; position += 1)
        characters.push(position === at ? "@" : pick(NAME_CHARACTERS));
      const replacements = length > 0 ? Math.floor(next() * 3) : 0;
      for (let replacement = 0; replacement < replacements; replacement += 1)
        characters[Math.floor(next() * length)] = pick(ALPHABET);
    }
    values.push(characters.join(""));
  }
  return values;
}

describe("the e-mail address check", () => {
  it("accepts and refuses exactly the values of up to 254 characters that the former pattern accepted and refused", () => {
    const values = generatedValues();
    const differences = values.filter(
      (value) => isLikelyEmail(value) !== FORMER.test(value),
    );
    const accepted = values.filter((value) => FORMER.test(value)).length;

    expect({
      differences,
      values: values.length,
      longest: Math.max(...values.map((value) => value.length)),
      enoughAccepted: accepted > 2_000,
      enoughRefused: values.length - accepted > 2_000,
    }).toEqual({
      differences: [],
      values: CORPUS_SIZE,
      longest: 254,
      enoughAccepted: true,
      enoughRefused: true,
    });
  });

  it.each([
    ["a@b.c", true],
    ["@b.c", false],
    ["a@.c", false],
    ["a@b.", false],
    ["a@@b.c", false],
    ["a b@c.d", false],
    ["a@.b.c", true],
    ["a@b..c", true],
    ["a.b@c.d", true],
    ["ä@ä.ä", true],
    ["a@b.c@d.e", false],
    ["a@bc", false],
    ["a@b.c\t", false],
    ["a@b.c\n", false],
    ["a\u00a0b@c.d", false],
    ["a@b.c\u2028", false],
    ["", false],
  ])("decides %j as the former pattern did (%s)", (value, expected) => {
    expect([isLikelyEmail(value), FORMER.test(value)]).toEqual([
      expected,
      expected,
    ]);
  });

  it("accepts an address of 254 characters and refuses one of 255 (RFC 5321 section 4.5.3.1.3)", () => {
    const longest = `${"a".repeat(64)}@${"b".repeat(184)}.test`;
    const tooLong = `${"a".repeat(64)}@${"b".repeat(185)}.test`;

    expect({
      longest: [longest.length, isLikelyEmail(longest), FORMER.test(longest)],
      tooLong: [tooLong.length, isLikelyEmail(tooLong), FORMER.test(tooLong)],
    }).toEqual({
      longest: [254, true, true],
      tooLong: [255, false, true],
    });
  });
});
