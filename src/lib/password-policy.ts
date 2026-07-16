export const PASSWORD_MIN_LENGTH = 12;

const PASSWORD_HAS_LOWERCASE_REGEX = /[a-z]/;
const PASSWORD_HAS_UPPERCASE_REGEX = /[A-Z]/;
const PASSWORD_HAS_NUMBER_REGEX = /\d/;
const PASSWORD_HAS_WHITESPACE_REGEX = /\s/u;

export function containsPasswordWhitespace(password: string): boolean {
  return PASSWORD_HAS_WHITESPACE_REGEX.test(password);
}

export function keepPasswordInputWhitespaceFree(
  currentValue: string,
  nextValue: string,
): string {
  return containsPasswordWhitespace(nextValue) ? currentValue : nextValue;
}

export function isPasswordPolicyValid(password: string): boolean {
  const trimmedPassword = password.trim();

  return (
    trimmedPassword === password &&
    !containsPasswordWhitespace(trimmedPassword) &&
    trimmedPassword.length >= PASSWORD_MIN_LENGTH &&
    PASSWORD_HAS_LOWERCASE_REGEX.test(trimmedPassword) &&
    PASSWORD_HAS_UPPERCASE_REGEX.test(trimmedPassword) &&
    PASSWORD_HAS_NUMBER_REGEX.test(trimmedPassword)
  );
}
