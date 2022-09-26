import { error as coreError } from "@actions/core";
import { getOctokit, context } from "@actions/github";

export interface StatusOfChecks {
  allSuccess: boolean;
  allFinished: boolean;
}

export interface GithubBranchInformation {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export interface TimeoutOptions {
  timeoutSeconds: number;
  intervalSeconds: number;
}

export async function deleteRemoteBranch(
  githubBranchInformation: GithubBranchInformation
) {
  const { owner, repo, branch, token } = githubBranchInformation;
  const octokit = getOctokit(token);
  try {
    await octokit.rest.git.deleteRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
  } catch (error) {
    if (error instanceof Error) coreError(error.message);
    throw error;
  }
}

export async function getRequiredStatusChecksForBranch(
  githubBranchInformation: GithubBranchInformation
) {
  try {
    const { branch, token } = githubBranchInformation;
    const octokit = getOctokit(token);

    return (
      await octokit.rest.repos.getStatusChecksProtection({
        owner: context.repo.owner,
        repo: context.repo.repo,
        branch,
      })
    ).data.contexts;
  } catch (error) {
    coreError(
      "Error getting branch protections. Potentially the branch doesn't exist or the token doesn't have access to it."
    );
    throw error;
  }
}

async function checkStatusOfChecks(
  githubBranchInformation: GithubBranchInformation
) {
  const { owner, repo, branch, token } = githubBranchInformation;
  const octokit = getOctokit(token);
  try {
    return (
      await octokit.rest.checks.listForRef({
        owner,
        repo,
        ref: branch,
      })
    ).data.check_runs;
  } catch (error) {
    coreError(
      "Error getting branch protections. Potentially the branch doesn't exist or the token doesn't have access to it."
    );
    throw error;
  }
}
export type ValueType<T> = T extends Promise<infer U> ? U : T;

export async function waitForCheckSuites(
  githubBranchInformation: GithubBranchInformation,
  timeoutOptions: TimeoutOptions
) {
  const { intervalSeconds, timeoutSeconds } = timeoutOptions;
  if (isNaN(intervalSeconds) || isNaN(timeoutSeconds)) {
    throw new Error("milliseconds not a number");
  }

  return new Promise<ValueType<ReturnType<typeof checkStatusOfChecks>>>(
    async (resolve) => {
      try {
        // Check to see if all of the check suites have already completed
        const firstStatusCheck = await checkStatusOfChecks(
          githubBranchInformation
        );
        if (firstStatusCheck.every((check) => check.status === "completed")) {
          resolve(firstStatusCheck);
          return;
        }

        // Is set by setTimeout after the below setInterval
        let timeoutId: ReturnType<typeof setTimeout>;

        // Continue to check for completion every ${intervalSeconds}
        const intervalId = setInterval(async () => {
          const status = await checkStatusOfChecks(githubBranchInformation);

          if (status.every((check) => check.status === "completed")) {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            clearInterval(intervalId);
            resolve(status);
            return;
          }
        }, intervalSeconds * 1000);

        // Fail action if ${timeoutSeconds} is reached
        if (timeoutSeconds) {
          timeoutId = setTimeout(() => {
            clearInterval(intervalId);
            coreError(`Timeout of ${timeoutSeconds} seconds reached.`);
            throw new Error(`Timeout of ${timeoutSeconds} seconds reached.`);
          }, timeoutSeconds * 1000);
        }
      } catch (error) {
        coreError("Error getting status of checks.");
        throw error;
      }
    }
  );
}
