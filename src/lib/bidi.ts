const LEFT_TO_RIGHT_ISOLATE = "\u2066";
const FIRST_STRONG_ISOLATE = "\u2068";
const POP_DIRECTIONAL_ISOLATE = "\u2069";
const BIDI_CONTROL_CHARACTER_PATTERN =
  /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u206f]/gu;

export function stripBidiControlCharacters(value: string): string {
  return value.replace(BIDI_CONTROL_CHARACTER_PATTERN, "");
}

export function isolateLtrText(value: string): string {
  return `${LEFT_TO_RIGHT_ISOLATE}${stripBidiControlCharacters(value)}${POP_DIRECTIONAL_ISOLATE}`;
}

export function isolateAutoText(value: string): string {
  return `${FIRST_STRONG_ISOLATE}${stripBidiControlCharacters(value)}${POP_DIRECTIONAL_ISOLATE}`;
}
