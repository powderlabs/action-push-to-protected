import { setFailed, endGroup, debug, error as setError } from "@actions/core";
import parseArgsStringToArgv from "string-argv";

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

/**
 * Matches the given string to an array of arguments.
 * The parsing is made by `string-argv`: if your way of using argument is not supported, the issue is theirs!
 * {@link https://www.npm.im/string-argv}
 * @example
 * ```js
 * matchGitArgs(`
    -s
    --longOption 'This uses the "other" quotes'
    --foo 1234
    --file=message.txt
    --file2="Application 'Support'/\"message\".txt"
  `) => [
    '-s',
    '--longOption',
    'This uses the "other" quotes',
    '--foo',
    '1234',
    '--file=message.txt',
    `--file2="Application 'Support'/\\"message\\".txt"`
  ]
 * matchGitArgs('      ') => [ ]
 * ```
 * @returns An array, if there's no match it'll be empty
 */
export function matchGitArgs(string: string) {
  const parsed = parseArgsStringToArgv(string);
  debug(`Git args parsed:
    - Original: ${string}
    - Parsed: ${JSON.stringify(parsed)}`);
  return parsed;
}

export function log(err: unknown, result: unknown) {
  if (err) {
    typeof err === "string" ? setError(err) : setError(JSON.stringify(err));
  }
  debug(result as string);
}
