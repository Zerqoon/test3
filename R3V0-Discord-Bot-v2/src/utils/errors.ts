export class UserError extends Error {}
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new UserError(message);
}
