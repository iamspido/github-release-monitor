// Writes a JavaScript pattern in RE2 syntax with the same meaning and bounds
// its program size. What RE2 would read differently is written out or refused.

export type PatternTranslationOptions = {
  multiline: boolean;
  dotAll: boolean;
  unicode: boolean;
  ignoreCase: boolean;
  captures: boolean;
  discardGroups?: boolean;
};

export type PatternTranslation =
  | {
      error?: undefined;
      source: string;
      programSizeBound: number;
      anchorGroupSize: number;
      foldWork: number;
      /** Read the text with CR, U+2028 and U+2029 as LF. */
      lineTerminators: boolean;
    }
  | {
      error: "unsupported";
      source?: undefined;
    };

// JavaScript's `\s`, whose RE2 counterpart covers only ASCII whitespace.
const SPACE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x09, 0x0d],
  [0x20, 0x20],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
];
const LINE_TERMINATORS = [0x0a, 0x0d, 0x2028, 0x2029] as const;
const MAX_REPEAT = 1000;
const MAX_CODE_POINT = 0x10ffff;
const SIZE_CAP = 1e9;
// re2js's `Unicode.MIN_FOLD` and `MAX_FOLD`: under `i` it folds every code
// point between them one by one, unless a range covers them all.
const MIN_FOLD = 0x41;
const MAX_FOLD = 0x1e943;
// re2js folds `[A-Za-z_]` for `\w` and `\W`, while `\d` lies below `MIN_FOLD`.
const WORD_ESCAPE_FOLD_WORK = 53;
// `()`: two captures and the empty match between them.
const EMPTY_GROUP_SIZE = 3;

function foldedWidth(low: number, high: number): number {
  if (low <= MIN_FOLD && high >= MAX_FOLD) return 0;
  const from = Math.max(low, MIN_FOLD);
  const to = Math.min(high, MAX_FOLD);
  return to >= from ? to - from + 1 : 0;
}

function mergeRanges(
  ranges: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [low, high] of sorted) {
    const last = merged[merged.length - 1];
    if (last && low <= last[1] + 1) last[1] = Math.max(last[1], high);
    else merged.push([low, high]);
  }
  return merged;
}

function subtractRanges(
  ranges: ReadonlyArray<readonly [number, number]>,
  removed: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (const [low, high] of ranges) {
    let next = low;
    for (const [removedLow, removedHigh] of removed) {
      if (removedHigh < next || removedLow > high) continue;
      if (removedLow > next) result.push([next, removedLow - 1]);
      next = removedHigh + 1;
    }
    if (next <= high) result.push([next, high]);
  }
  return result;
}

const hex = (codePoint: number) => `\\x{${codePoint.toString(16)}}`;
const writeRanges = (ranges: ReadonlyArray<readonly [number, number]>) =>
  ranges
    .map(([low, high]) =>
      low === high ? hex(low) : `${hex(low)}-${hex(high)}`,
    )
    .join("");
const ANY_CODE_POINT = `${hex(0)}-${hex(MAX_CODE_POINT)}`;
const writeLiteral = (codePoint: number) =>
  (codePoint >= 0x30 && codePoint <= 0x39) ||
  (codePoint >= 0x41 && codePoint <= 0x5a) ||
  (codePoint >= 0x61 && codePoint <= 0x7a)
    ? String.fromCharCode(codePoint)
    : hex(codePoint);

// JavaScript without `u` reads these as the letters, RE2 as escapes.
const RE2_LETTER_ESCAPES = new Set(["a", "A", "z", "Q", "E"]);
const POSIX_CLASS = /^\[:\^?[A-Za-z]+:\]/;
const CLASS_ESCAPES = new Set(["d", "D", "w", "W", "s", "S"]);

// The line terminators are whitespace, matched by exactly `\s`, `\D` and `\W`.
function escapeMatchesLineTerminators(letter: string): boolean {
  return letter === "s" || letter === "D" || letter === "W";
}

function skipDigits(source: string, start: number): number {
  let end = start;
  while (end < source.length && source[end] >= "0" && source[end] <= "9") end++;
  return end;
}

class Unsupported extends Error {
  constructor() {
    super("unsupported");
  }
}

type Atom = {
  size: number;
  nullable: boolean;
  containsNamed: boolean;
  quantifiable: boolean;
};

type Frame = {
  closedSize: number;
  alternatives: number;
  anyClosedNullable: boolean;
  size: number;
  nullableBeforeLast: boolean;
  last: Atom | null;
  containsNamed: boolean;
  capturing: boolean;
};

const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

// Tells a backreference from a legacy octal escape, as JavaScript does.
function countCapturingGroups(source: string): number {
  let count = 0;
  let inClass = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === "\\") {
      index++;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") {
      inClass = true;
      // A `]` right after `[` or `[^` ends JavaScript's (empty) class.
      if (source[index + 1] === "^") index++;
      if (source[index + 1] === "]") {
        index++;
        inClass = false;
      }
      continue;
    }
    if (char !== "(") continue;
    if (source[index + 1] !== "?") count++;
    else if (
      source[index + 2] === "<" &&
      source[index + 3] !== "=" &&
      source[index + 3] !== "!"
    )
      count++;
  }
  return count;
}

export function translateJavaScriptPattern(
  source: string,
  options: PatternTranslationOptions,
): PatternTranslation {
  try {
    return translate(source, options);
  } catch (error) {
    if (error instanceof Unsupported) return { error: "unsupported" };
    throw error;
  }
}

function translate(
  source: string,
  options: PatternTranslationOptions,
): PatternTranslation {
  const unicode = options.unicode;
  const groupCount = countCapturingGroups(source);
  let output = "";
  let index = 0;
  const { multiline, dotAll, ignoreCase } = options;
  let usesLineAnchors = false;
  let usesTextStart = false;
  let distinguishesLineTerminators = false;
  let namedGroups = 0;
  let namedRepeated = false;
  let nullableRepeated = false;
  let foldWork = 0;
  const unsupported = (): never => {
    throw new Unsupported();
  };
  const countFolding = (
    ranges: ReadonlyArray<readonly [number, number]>,
    escapes: readonly string[] = [],
  ) => {
    if (!ignoreCase) return;
    let work = 0;
    for (const [low, high] of ranges) work += foldedWidth(low, high);
    for (const letter of escapes)
      if (letter === "w" || letter === "W") work += WORD_ESCAPE_FOLD_WORK;
    foldWork = Math.min(SIZE_CAP, foldWork + work);
  };
  const writeClass = (
    negated: boolean,
    ranges: ReadonlyArray<readonly [number, number]>,
    escapes: readonly string[] = [],
  ) => {
    const merged = mergeRanges(ranges);
    const letters = [...new Set(escapes)];
    countFolding(merged, letters);
    return `[${negated ? "^" : ""}${writeRanges(merged)}${letters
      .map((letter) => `\\${letter}`)
      .join("")}]`;
  };

  const newFrame = (capturing: boolean, named: boolean): Frame => ({
    closedSize: 0,
    alternatives: 0,
    anyClosedNullable: false,
    size: 0,
    nullableBeforeLast: true,
    last: null,
    containsNamed: named,
    capturing,
  });
  const stack: Frame[] = [newFrame(false, false)];
  const top = () => stack[stack.length - 1];

  const addAtom = (atom: Atom) => {
    const frame = top();
    frame.nullableBeforeLast =
      frame.nullableBeforeLast && (frame.last?.nullable ?? true);
    frame.size = Math.min(SIZE_CAP, frame.size + atom.size);
    frame.last = atom;
    frame.containsNamed ||= atom.containsNamed;
  };
  const closeAlternative = (frame: Frame) => {
    frame.closedSize = Math.min(SIZE_CAP, frame.closedSize + frame.size);
    frame.alternatives++;
    frame.anyClosedNullable ||=
      frame.nullableBeforeLast && (frame.last?.nullable ?? true);
    frame.size = 0;
    frame.nullableBeforeLast = true;
    frame.last = null;
  };
  const frameSize = (frame: Frame) =>
    Math.min(
      SIZE_CAP,
      frame.closedSize +
        Math.max(0, frame.alternatives - 1) +
        (frame.capturing ? 2 : 0),
    );

  const readChar = (): number => {
    const unit = source.charCodeAt(index);
    if (isHighSurrogate(unit)) {
      const next = source.charCodeAt(index + 1);
      if (!isLowSurrogate(next)) unsupported();
      index += 2;
      return ((unit - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
    }
    if (isLowSurrogate(unit)) unsupported();
    index++;
    return unit;
  };

  // RE2 reads a third octal digit after a first digit 4-7, JavaScript does not.
  const readLegacyOctal = (): number => {
    const first = source.charCodeAt(index) - 0x30;
    const isOctal = (at: number) => {
      const code = source.charCodeAt(at);
      return code >= 0x30 && code <= 0x37;
    };
    if (first >= 4 && isOctal(index + 1) && isOctal(index + 2)) unsupported();
    let value = first;
    let length = 1;
    const maxLength = first <= 3 ? 3 : 2;
    while (length < maxLength && isOctal(index + length)) {
      value = value * 8 + (source.charCodeAt(index + length) - 0x30);
      length++;
    }
    index += length;
    return value;
  };

  // An escaped surrogate is refused (RE2 never sees one in a text), as is a
  // `\u` that JavaScript without `u` reads as the letter `u`.
  const readUnicodeEscape = (): number => {
    let digits: string;
    let length: number;
    if (unicode && source[index + 1] === "{") {
      const end = source.indexOf("}", index + 2);
      digits = end < 0 ? "" : source.slice(index + 2, end);
      if (!/^[0-9a-fA-F]{1,6}$/.test(digits)) unsupported();
      length = digits.length + 3;
    } else {
      digits = source.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(digits)) unsupported();
      length = 5;
    }
    const codePoint = Number.parseInt(digits, 16);
    if (
      codePoint > MAX_CODE_POINT ||
      isHighSurrogate(codePoint) ||
      isLowSurrogate(codePoint)
    )
      unsupported();
    index += length;
    return codePoint;
  };

  const readEscape = (inClass: boolean): number | string => {
    const char = source[index];
    if (char === undefined) unsupported();
    if (CLASS_ESCAPES.has(char)) {
      index++;
      return char;
    }
    if (char === "b") {
      index++;
      return inClass ? 0x08 : "b";
    }
    if (char === "B" && !inClass) {
      index++;
      return "B";
    }
    const named: Record<string, number> = {
      t: 0x09,
      n: 0x0a,
      v: 0x0b,
      f: 0x0c,
      r: 0x0d,
    };
    if (named[char] !== undefined) {
      index++;
      return named[char];
    }
    if (char === "x") {
      const digits = source.slice(index + 1, index + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(digits)) unsupported();
      index += 3;
      return Number.parseInt(digits, 16);
    }
    if (char === "u") return readUnicodeEscape();
    if (char === "c" || char === "k" || char === "p" || char === "P")
      unsupported();
    if (char >= "0" && char <= "9") {
      if (!inClass && char !== "0") {
        let end = index;
        while (end < source.length && source[end] >= "0" && source[end] <= "9")
          end++;
        if (Number(source.slice(index, end)) <= groupCount) unsupported();
      }
      if (
        char === "0" &&
        !(source[index + 1] >= "0" && source[index + 1] <= "9")
      ) {
        index++;
        return 0;
      }
      // Without `u`: a legacy octal escape, or `\8` and `\9` themselves.
      if (char === "8" || char === "9") {
        index++;
        return char.charCodeAt(0);
      }
      return readLegacyOctal();
    }
    if (!unicode && RE2_LETTER_ESCAPES.has(char)) unsupported();
    return readChar();
  };

  const readClass = () => {
    const negated = source[index] === "^";
    if (negated) index++;
    if (source[index] === "]") unsupported();
    const ranges: Array<[number, number]> = [];
    const escapes: string[] = [];
    const readClassAtom = (): number | string => {
      if (source[index] === "\\") {
        index++;
        return readEscape(true);
      }
      if (
        source[index] === "[" &&
        POSIX_CLASS.test(source.slice(index, index + 64))
      )
        unsupported();
      return readChar();
    };
    while (index < source.length && source[index] !== "]") {
      const atomStart = index;
      const first = readClassAtom();
      if (
        source[index] === "-" &&
        index + 1 < source.length &&
        source[index + 1] !== "]"
      ) {
        index++;
        const second = readClassAtom();
        if (typeof first === "number" && typeof second === "number") {
          // Without `u`, JavaScript ends such a range at a surrogate of
          // the pair, RE2 at the character.
          if (!unicode && (first > 0xffff || second > 0xffff)) unsupported();
          ranges.push([first, second]);
          continue;
        }
        // Without `u`, a class escape at either end makes `-` literal.
        for (const item of [first, 0x2d, second]) {
          if (typeof item === "number") ranges.push([item, item]);
          else escapes.push(item);
        }
        continue;
      }
      if (typeof first === "number") ranges.push([first, first]);
      else escapes.push(first);
      if (index === atomStart) unsupported();
    }
    if (source[index] !== "]") unsupported();
    index++;
    const matches = LINE_TERMINATORS.map(
      (terminator) =>
        negated !==
        (ranges.some(
          ([low, high]) => low <= terminator && terminator <= high,
        ) || escapes.some(escapeMatchesLineTerminators)),
    );
    if (matches.some((match) => match !== matches[0]))
      distinguishesLineTerminators = true;
    if (escapes.includes("S")) {
      // `[X\S]` is written as the negated class of the whitespace X lacks, so
      // re2js need not fold all of `\S`. Whitespace has no case variants.
      const unmatched = escapes.some(escapeMatchesLineTerminators)
        ? []
        : subtractRanges(SPACE_RANGES, mergeRanges(ranges));
      output += unmatched.length
        ? writeClass(!negated, unmatched)
        : `[${negated ? "^" : ""}${ANY_CODE_POINT}]`;
    } else {
      output += writeClass(
        negated,
        escapes.includes("s") ? [...ranges, ...SPACE_RANGES] : ranges,
        escapes.filter((letter) => letter !== "s"),
      );
    }
    addAtom({
      size: 1,
      nullable: false,
      containsNamed: false,
      quantifiable: true,
    });
  };

  const readQuantifier = (): boolean => {
    const char = source[index];
    let min: number;
    let max: number;
    let text: string;
    if (char === "*" || char === "+" || char === "?") {
      min = char === "+" ? 1 : 0;
      max = char === "?" ? 1 : Number.POSITIVE_INFINITY;
      text = char;
      index++;
    } else if (char === "{") {
      // Without `u`, anything but `{min}`, `{min,}` or `{min,max}` is literal.
      const minEnd = skipDigits(source, index + 1);
      if (minEnd === index + 1) return false;
      let end = minEnd;
      let maxText: string | undefined;
      if (source[end] === ",") {
        const maxEnd = skipDigits(source, end + 1);
        maxText = source.slice(end + 1, maxEnd);
        end = maxEnd;
      }
      if (source[end] !== "}") return false;
      min = Number(source.slice(index + 1, minEnd));
      max =
        maxText === undefined
          ? min
          : maxText === ""
            ? Number.POSITIVE_INFINITY
            : Number(maxText);
      if (min > MAX_REPEAT || (Number.isFinite(max) && max > MAX_REPEAT))
        unsupported();
      text =
        maxText === undefined
          ? `{${min}}`
          : Number.isFinite(max)
            ? `{${min},${max}}`
            : `{${min},}`;
      index = end + 1;
    } else return false;
    if (source[index] === "?") {
      text += "?";
      index++;
    }
    const frame = top();
    const atom = frame.last;
    if (!atom?.quantifiable) unsupported();
    const quantified = atom as Atom;
    if (max > 1 && quantified.containsNamed) namedRepeated = true;
    if (max > min && quantified.nullable) nullableRepeated = true;
    const copies = Number.isFinite(max) ? Math.max(max, 1) : min + 1;
    const size = Math.min(SIZE_CAP, copies * (quantified.size + 1));
    frame.size = Math.min(SIZE_CAP, frame.size - quantified.size + size);
    frame.last = {
      size,
      nullable: min === 0 || quantified.nullable,
      containsNamed: quantified.containsNamed,
      quantifiable: false,
    };
    output += text;
    return true;
  };

  const readGroupOpen = () => {
    const discard = options.discardGroups === true;
    if (source[index] !== "?") {
      stack.push(newFrame(!discard, false));
      output += discard ? "(?:" : "(";
      return;
    }
    const kind = source[index + 1];
    if (kind === ":") {
      index += 2;
      stack.push(newFrame(false, false));
      output += "(?:";
      return;
    }
    if (kind === "=" || kind === "!") unsupported();
    if (kind === "<") {
      if (source[index + 2] === "=" || source[index + 2] === "!") unsupported();
      const end = source.indexOf(">", index + 2);
      if (end < 0) unsupported();
      const name = source.slice(index + 2, end);
      index = end + 1;
      namedGroups++;
      stack.push(newFrame(!discard, true));
      output += discard ? "(?:" : `(?P<${name}>`;
      return;
    }
    // V8 evaluates modifier groups `(?ims-ims:…)` against the specification:
    // `(?i:a|[b])` does not match `B`.
    unsupported();
  };

  const readGroupClose = () => {
    if (stack.length < 2) unsupported();
    const frame = stack.pop() as Frame;
    closeAlternative(frame);
    output += ")";
    addAtom({
      size: frameSize(frame),
      nullable: frame.anyClosedNullable,
      containsNamed: frame.containsNamed,
      quantifiable: true,
    });
  };

  const addAssertion = (text: string) => {
    output += text;
    addAtom({
      size: 1,
      nullable: true,
      containsNamed: false,
      quantifiable: false,
    });
  };

  const addCharacter = (codePoint: number) => {
    if (LINE_TERMINATORS.some((terminator) => terminator === codePoint))
      distinguishesLineTerminators = true;
    countFolding([[codePoint, codePoint]]);
    output += writeLiteral(codePoint);
    addAtom({
      size: 1,
      nullable: false,
      containsNamed: false,
      quantifiable: true,
    });
  };

  while (index < source.length) {
    const char = source[index];
    if (readQuantifier()) continue;
    if (char === "\\") {
      index++;
      const escaped = readEscape(false);
      if (typeof escaped === "number") addCharacter(escaped);
      else if (escaped === "b" || escaped === "B") {
        // With `i` and `u`, JavaScript's word characters include the
        // long s and the Kelvin sign, RE2's word boundary only ASCII ones.
        if (ignoreCase && unicode) unsupported();
        addAssertion(`\\${escaped}`);
      } else {
        if (!CLASS_ESCAPES.has(escaped)) unsupported();
        if (escaped === "s" || escaped === "S")
          output += writeClass(escaped === "S", SPACE_RANGES);
        else {
          countFolding([], [escaped]);
          output += `\\${escaped}`;
        }
        addAtom({
          size: 1,
          nullable: false,
          containsNamed: false,
          quantifiable: true,
        });
      }
      continue;
    }
    index++;
    switch (char) {
      case "[":
        readClass();
        break;
      case "(":
        readGroupOpen();
        break;
      case ")":
        readGroupClose();
        break;
      case "|":
        closeAlternative(top());
        output += "|";
        break;
      case ".":
        output += dotAll
          ? "(?s:.)"
          : writeClass(
              true,
              LINE_TERMINATORS.map((terminator) => [terminator, terminator]),
            );
        addAtom({
          size: 1,
          nullable: false,
          containsNamed: false,
          quantifiable: true,
        });
        break;
      case "^":
      case "$":
        if (multiline) usesLineAnchors = true;
        else if (char === "^") usesTextStart = true;
        addAssertion(multiline ? `(?m:${char})` : char);
        break;
      default:
        index--;
        addCharacter(readChar());
    }
  }

  if (stack.length !== 1) unsupported();
  const root = stack[0];
  closeAlternative(root);
  // Line terminators read as LF can no longer be told apart.
  if (usesLineAnchors && distinguishesLineTerminators) unsupported();
  // JavaScript resets a repeated group's captures per iteration and ends a loop
  // at an empty iteration. RE2 does neither.
  if (
    options.captures &&
    namedGroups > 0 &&
    (namedRepeated || nullableRepeated)
  )
    unsupported();
  return {
    // re2js builds a one-pass program, cubic for anchored optional chains, for
    // one that starts with `^`, which a leading empty group avoids.
    source: usesTextStart ? `()(?:${output})` : output,
    // Capture group 0, the match instruction and FAIL at 0.
    programSizeBound: Math.min(
      SIZE_CAP,
      frameSize(root) + 4 + (usesTextStart ? EMPTY_GROUP_SIZE : 0),
    ),
    anchorGroupSize: usesTextStart ? EMPTY_GROUP_SIZE : 0,
    foldWork,
    lineTerminators: usesLineAnchors,
  };
}
