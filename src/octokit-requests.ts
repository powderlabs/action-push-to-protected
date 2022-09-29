import {
  error as coreError,
  debug as coreDebug,
  info as coreInfo,
} from "@actions/core";
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

class ChecksError extends Error {}

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
    coreDebug(
      "Error getting branch protections. Potentially the branch doesn't exist or the token doesn't have access to it or the branch is not protected."
    );
    throw error;
  }
}

export async function getStatusOfChecks(
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
    const requiredChecksOnBranch = await getRequiredStatusChecksForBranch(
      githubBranchInformation
    );
    if (checkRuns.length === 0 && requiredChecksOnBranch.length > 0) {
      coreError(
        "The branch is expected to have checks, but none were reported by the Checks API. This is unexpected. If this is a timing issue, the action logic needs to be changed. Contact the author or make a PR"
      );
      throw new ChecksError("Status protected branch has no checks");
    }
    coreDebug(`Status checks status: ${JSON.stringify(checkRuns)}`);
    return checkRuns;
  } catch (error) {
    if (error instanceof RequestError) {
      if (error.status === 401) {
        coreError("The token provided does not have access to the branch.");
        throw error;
      }
      if (error.status === 422) {
        coreDebug(
          `${error.message} This is probably because the branch doesn't exist yet.`
        );
        throw error;
      }
    } else {
      coreError(
        `Unexpected error getting status of checks on branch ${branch}.`
      );
      throw error;
    }
    throw error;
  }
}
export type ValueType<T> = T extends Promise<infer U> ? U : T;

export async function waitForCheckSuites(
  githubBranchInformation: GithubBranchInformation,
  timeoutOptions: TimeoutOptions,
  requiredStatusChecks: string[]
) {
  const { intervalSeconds, timeoutSeconds } = timeoutOptions;

  return new Promise<ValueType<ReturnType<typeof getStatusOfChecks>>>(
    async (resolve) => {
      try {
        // Fail action if ${timeoutSeconds} is reached
        const timeoutId = setTimeout(async () => {
          clearInterval(intervalId);
          coreError(`Timeout of ${timeoutSeconds} seconds reached.`);

          const statusOfChecks = await getStatusOfChecks(
            githubBranchInformation
          );
          if (!statusOfChecks.every((check) => check.status === "completed")) {
            coreInfo(
              "Seems like there are still a few outstanding status checks. Try increasing the timeout."
            );
          } else if (
            !statusOfChecks.every((check) =>
              requiredStatusChecks.includes(check.name)
            )
          ) {
            coreInfo(
              "Seems like not all required status checks on the branch we are trying to push to were run on the temporary branch. This can happen if you haven't configured the git repo with the correct token or configured status checks to run on the temp branch correctly. Check the Readme for more information."
            );
          }
          throw new Error(`Timeout of ${timeoutSeconds} seconds reached.`);
        }, timeoutSeconds * 1000);

        // Continue to check for completion every ${intervalSeconds}
        const intervalId = setInterval(async () => {
          const statusOfChecks = await getStatusOfChecks(
            githubBranchInformation
          );

          const hasAllRequiredChecksCompleted = requiredStatusChecks.every(
            (requiredCheck) => {
              const checkRun = statusOfChecks.find(
                (check) => check.name === requiredCheck
              );
              if (checkRun === undefined) {
                coreDebug(
                  `Required check ${requiredCheck} is not present in the list of checks. The check might not have started on the branch or `
                );
                return false;
              }
              if (checkRun.status !== "completed") return false;
              return true;
            }
          );

          if (hasAllRequiredChecksCompleted) {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            clearInterval(intervalId);
            resolve(statusOfChecks);
            return;
          }
        }, intervalSeconds * 1000);
      } catch (error) {
        coreError("Error getting status of checks.");
        throw error;
      }
    }
  );
}
