import { RE2JS } from "re2js";
import { translateJavaScriptPattern } from "@/lib/untrusted-pattern-syntax";

// User patterns run only on the linear-time RE2 engine (re2js), never on the
// backtracking one (CWE-1333). No server imports: the browser validates too.

export const MAX_UNTRUSTED_PATTERN_LENGTH = 512;
// re2js runs programs up to this size on its bounded backtracker.
export const MAX_UNTRUSTED_PATTERN_PROGRAM_SIZE = 500;
// Code points re2js may fold one by one under `i`, about 2.5 ms of compiling.
export const MAX_UNTRUSTED_PATTERN_FOLD_WORK = 32_768;
// Refused above this before compiling, which expands counted repetitions.
const PROGRAM_SIZE_BOUND_BEFORE_COMPILING =
  4 * MAX_UNTRUSTED_PATTERN_PROGRAM_SIZE;
export const MAX_CACHED_UNTRUSTED_PATTERNS = 128;
// Bounds the work per evaluation, not a Git limit. Real tag names are shorter.
export const MAX_PATTERN_TAG_NAME_LENGTH = 255;

export type UntrustedPatternError =
  | "invalid"
  | "unsupported"
  | "too_long"
  | "too_complex";

export type UntrustedPattern = {
  test(text: string): boolean;
  groups(text: string): Record<string, string | undefined> | null;
  hasGroup(name: string): boolean;
  /** Without the empty group written before a begin-text anchor. */
  readonly programSize: number;
};

export class UntrustedPatternEvaluationError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The RE2 engine could not evaluate the pattern.", options);
    this.name = "UntrustedPatternEvaluationError";
  }
}

export type UntrustedPatternResult =
  | { pattern: UntrustedPattern; error?: undefined }
  | { pattern?: undefined; error: UntrustedPatternError };

// Only constructs the RegExp to check the syntax and never runs it.
function parsesAsJavaScript(source: string, flags: string): boolean {
  try {
    new RegExp(source, flags);
    return true;
  } catch {
    return false;
  }
}

// `g`, `d` and `u` keep the first match. `y` and `v` have no RE2 equivalent.
function readFlags(flags: string) {
  for (const flag of flags) if (!"imsgdu".includes(flag)) return null;
  return {
    ignoreCase: flags.includes("i"),
    multiline: flags.includes("m"),
    dotAll: flags.includes("s"),
    unicode: flags.includes("u"),
  };
}

// JavaScript also ends lines at CR, U+2028 and U+2029, RE2 only at LF.
// Replacing them one for one keeps every position.
const LINE_TERMINATORS = /[\r\u2028\u2029]/g;
const withLineFeeds = (text: string) => text.replace(LINE_TERMINATORS, "\n");
const NEVER_MATCHING_PROGRAM_SIZE = 2;
const EMPTY_MATCHING_PROGRAM_SIZE = 3;

function evaluating<T>(evaluate: () => T): T {
  try {
    return evaluate();
  } catch (cause) {
    throw new UntrustedPatternEvaluationError({ cause });
  }
}

function wrap(
  compiled: RE2JS,
  lineTerminators: boolean,
  anchorGroupSize = 0,
): UntrustedPattern {
  const names = compiled.namedGroups();
  const size = compiled.programSize();
  const exec = (text: string) => {
    const match = compiled.exec(text) as
      | (unknown[] & { groups?: Record<string, string | undefined> })
      | null;
    return match ? { ...match.groups } : null;
  };
  return {
    test: (text) =>
      evaluating(() => {
        const read = lineTerminators ? withLineFeeds(text) : text;
        // Short texts skip RE2's DFA, which builds a new state per character
        // for some patterns.
        return read.length <= MAX_PATTERN_TAG_NAME_LENGTH
          ? compiled.matcher(read).find()
          : compiled.test(read);
      }),
    groups: (text) =>
      evaluating(() => {
        const read = lineTerminators ? withLineFeeds(text) : text;
        if (read === text) return exec(text);
        const matcher = compiled.matcher(read);
        if (!matcher.find()) return null;
        const groups: Record<string, string | undefined> = {};
        for (const name of Object.keys(names)) {
          const start = matcher.start(name);
          groups[name] =
            start < 0 ? undefined : text.slice(start, matcher.end(name));
        }
        return groups;
      }),
    hasGroup: (name) => Object.hasOwn(names, name),
    // A never-matching program shrinks to 2 instructions with the anchor group,
    // an empty-matching one shares its empty match with the group.
    programSize:
      size > NEVER_MATCHING_PROGRAM_SIZE
        ? Math.max(size - anchorGroupSize, EMPTY_MATCHING_PROGRAM_SIZE)
        : size,
  };
}

// Opcodes of re2js's `Inst`, which the package does not export.
const ALTERNATIVE_INSTRUCTIONS: ReadonlySet<number> = new Set([1, 2]);
const MATCH_INSTRUCTION = 6;
type CompiledProgram = {
  readonly start: number;
  readonly inst: ReadonlyArray<{
    readonly op: number;
    readonly out: number;
    readonly arg: number;
  }>;
};

// re2js's bounded backtracker throws at FAIL (pc 0), reachable via a capturing
// group around an empty class under a quantifier allowing zero repetitions.
function reachesFailInstruction(compiled: RE2JS): boolean {
  const program: CompiledProgram = compiled.re2Input.prog;
  if (program.start === 0) return false;
  const seen = new Set<number>([program.start]);
  const pending = [program.start];
  for (let pc = pending.pop(); pc !== undefined; pc = pending.pop()) {
    const { op, out, arg } = program.inst[pc];
    if (op === MATCH_INSTRUCTION) continue;
    for (const next of ALTERNATIVE_INSTRUCTIONS.has(op) ? [out, arg] : [out]) {
      if (next === 0) return true;
      if (!seen.has(next)) {
        seen.add(next);
        pending.push(next);
      }
    }
  }
  return false;
}

export type UntrustedPatternOptions = {
  /** Groups are read, so one RE2 would capture differently is refused. */
  captures?: boolean;
  /** Only matching is asked, so groups compile without capturing. */
  discardGroups?: boolean;
};

function readAndCompileUntrustedPattern(
  source: string,
  flags: string,
  options: UntrustedPatternOptions,
): UntrustedPatternResult {
  if (!parsesAsJavaScript(source, flags)) return { error: "invalid" };
  const readFlagsResult = readFlags(flags);
  if (!readFlagsResult) return { error: "unsupported" };
  const { ignoreCase } = readFlagsResult;
  const translation = translateJavaScriptPattern(source, {
    multiline: readFlagsResult.multiline,
    dotAll: readFlagsResult.dotAll,
    unicode: readFlagsResult.unicode,
    ignoreCase,
    captures: options.captures === true,
    discardGroups: options.discardGroups === true,
  });
  if (translation.error) return { error: translation.error };
  if (
    translation.programSizeBound > PROGRAM_SIZE_BOUND_BEFORE_COMPILING ||
    translation.foldWork > MAX_UNTRUSTED_PATTERN_FOLD_WORK
  )
    return { error: "too_complex" };
  let compiled: RE2JS;
  try {
    compiled = RE2JS.compile(
      translation.source,
      ignoreCase ? RE2JS.CASE_INSENSITIVE : 0,
    );
  } catch {
    return { error: "unsupported" };
  }
  if (compiled.programSize() > MAX_UNTRUSTED_PATTERN_PROGRAM_SIZE)
    return { error: "too_complex" };
  if (reachesFailInstruction(compiled)) return { error: "unsupported" };
  return {
    pattern: wrap(
      compiled,
      translation.lineTerminators,
      translation.anchorGroupSize,
    ),
  };
}

// A result depends only on its key and holds no other data.
const compiledPatterns = new Map<string, UntrustedPatternResult>();

/** Compiles a pattern with its JavaScript `flags`, or names why it cannot. */
export function compileUntrustedPattern(
  source: string,
  flags = "",
  options: UntrustedPatternOptions = {},
): UntrustedPatternResult {
  if (source.length > MAX_UNTRUSTED_PATTERN_LENGTH)
    return { error: "too_long" };
  // The length of the flags keeps the key unambiguous for any flags.
  const key = `${options.captures === true ? "c" : "-"}${
    options.discardGroups === true ? "d" : "-"
  }${flags.length}:${flags}${source}`;
  const kept = compiledPatterns.get(key);
  if (kept) {
    compiledPatterns.delete(key);
    compiledPatterns.set(key, kept);
    return kept;
  }
  const result = readAndCompileUntrustedPattern(source, flags, options);
  if (compiledPatterns.size >= MAX_CACHED_UNTRUSTED_PATTERNS) {
    const oldest = compiledPatterns.keys().next().value;
    if (oldest !== undefined) compiledPatterns.delete(oldest);
  }
  compiledPatterns.set(key, result);
  return result;
}

export function untrustedPatternError(
  source: string,
  flags = "",
): UntrustedPatternError | null {
  return compileUntrustedPattern(source, flags).error ?? null;
}

// One instruction per literal character, so only the length is bounded.
export function compileUntrustedLiteral(
  text: string,
  flags = "i",
): UntrustedPatternResult {
  if (text.length > MAX_UNTRUSTED_PATTERN_LENGTH) return { error: "too_long" };
  return {
    pattern: wrap(
      RE2JS.compile(
        RE2JS.quote(text),
        flags.includes("i") ? RE2JS.CASE_INSENSITIVE : 0,
      ),
      false,
    ),
  };
}

export function normalizePatternInput(
  value: string | null | undefined,
): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

// The release filters apply it case-insensitively.
export function regexFilterError(
  value: string | null | undefined,
): UntrustedPatternError | null {
  const pattern = normalizePatternInput(value);
  return pattern ? untrustedPatternError(pattern, "i") : null;
}
