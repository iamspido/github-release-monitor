export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

const BETTER_AUTH_DEFAULT_USERNAME_REGEX = /^[A-Za-z0-9_.]+$/;

export function isUsernamePolicyValid(username: string): boolean {
  return (
    username.length >= USERNAME_MIN_LENGTH &&
    username.length <= USERNAME_MAX_LENGTH &&
    BETTER_AUTH_DEFAULT_USERNAME_REGEX.test(username)
  );
}
