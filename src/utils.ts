import { setFailed, endGroup, error as setError } from '@actions/core';

export async function to<T>(
  func: Promise<T>,
): Promise<[T, null] | [null, Error]> {
  try {
    return [await func, null];
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    return [null, e];
  }
}

export function errorHandler(e: Error, setFailedMessage?: string): void {
  setError(e.message);
  if (setFailedMessage) {
    setFailed(setFailedMessage);
    endGroup();
  }
}
