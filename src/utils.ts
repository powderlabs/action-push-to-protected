import { setFailed, endGroup, error as setError } from "@actions/core";

export async function to<T>(
  func: Promise<T>
): Promise<[T, null] | [null, Error]> {
  try {
    return [await func, null];
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    return [null, e];
  }
}

export function errorHandler(message: string, error?: Error) {
  error && setError(error.message);
  setFailed(message);
  endGroup();
}
