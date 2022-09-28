import { error as coreError, debug as coreDebug } from "@actions/core";
import { getOctokit } from "@actions/github";
import { RequestError } from "@octokit/request-error";

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
    const { owner, repo, branch, token } = githubBranchInformation;
    const octokit = getOctokit(token);

    const branchInfo = await octokit.rest.repos.getBranch({
      owner,
      repo,
      branch,
    });
    return branchInfo.data.protection.required_status_checks?.contexts ?? [];
  } catch (error) {
    coreError(
      "Error getting branch protections. Potentially the branch doesn't exist or the token doesn't have access to it or the branch is not protected."
    );
    throw error;
  }
}

export async function checkStatusOfChecks(
  githubBranchInformation: GithubBranchInformation
) {
  const { owner, repo, branch, token } = githubBranchInformation;
  const octokit = getOctokit(token);
  try {
    const checkRuns = (
      await octokit.rest.checks.listForRef({
        owner,
        repo,
        ref: branch,
      })
    ).data.check_runs;
    coreDebug(JSON.stringify(checkRuns));
    return checkRuns;
  } catch (error) {
    if (error instanceof RequestError) {
      if (error.status === 401) {
        coreError("The token provided does not have access to the branch.");
        throw error;
      }
      if (error.status === 422) {
        coreDebug(
          error.message +
            " This is probably because the branch doesn't exist yet."
        );
        throw error;
      }
    } else {
      coreError(
        `Unexpected error getting status of checks on branch ${branch}.`
      );
      throw error;
    }
  }
}
export type ValueType<T> = T extends Promise<infer U> ? U : T;

export async function waitForCheckSuites(
  githubBranchInformation: GithubBranchInformation,
  timeoutOptions: TimeoutOptions
) {
  const { intervalSeconds, timeoutSeconds } = timeoutOptions;

  return new Promise<ValueType<ReturnType<typeof checkStatusOfChecks>>>(
    async (resolve) => {
      try {
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
