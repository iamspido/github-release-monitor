export const PASSWORD_MIN_LENGTH = 12;

const PASSWORD_HAS_LOWERCASE_REGEX = /[a-z]/;
const PASSWORD_HAS_UPPERCASE_REGEX = /[A-Z]/;
const PASSWORD_HAS_NUMBER_REGEX = /\d/;

export function isPasswordPolicyValid(password: string): boolean {
  return (
    password.length >= PASSWORD_MIN_LENGTH &&
    PASSWORD_HAS_LOWERCASE_REGEX.test(password) &&
    PASSWORD_HAS_UPPERCASE_REGEX.test(password) &&
    PASSWORD_HAS_NUMBER_REGEX.test(password)
  );
}
