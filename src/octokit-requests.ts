import * as core from '@actions/core';
import * as github from '@actions/github';

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
  githubBranchInformation: GithubBranchInformation,
) {
  const { owner, repo, branch, token } = githubBranchInformation;
  const octokit = github.getOctokit(token);
  try {
    await octokit.rest.git.deleteRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
  } catch (error) {
    if (error instanceof Error) core.error(error.message);
    throw error;
  }
}

export async function getRequiredStatusChecksForBranch(
  githubBranchInformation: GithubBranchInformation,
) {
  try {
    const { branch, token } = githubBranchInformation;
    const octokit = github.getOctokit(token);

    return (
      await octokit.rest.repos.getStatusChecksProtection({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        branch: branch,
      })
    ).data.contexts;
  } catch (error) {
    core.error(
      "Error getting branch protections. Potentially the branch doesn't exist or the token doesn't have access to it.",
    );
    throw error;
  }
}

async function checkStatusOfChecks(
  githubBranchInformation: GithubBranchInformation,
) {
  const { owner, repo, branch, token } = githubBranchInformation;
  const octokit = github.getOctokit(token);
  try {
    return (
      await octokit.rest.checks.listForRef({
        owner,
        repo,
        ref: branch,
      })
    ).data.check_runs;
  } catch (error) {
    core.error(
      "Error getting branch protections. Potentially the branch doesn't exist or the token doesn't have access to it.",
    );
    throw error;
  }
}
export type ValueType<T> = T extends Promise<infer U> ? U : T;

export async function waitForCheckSuites(
  githubBranchInformation: GithubBranchInformation,
  timeoutOptions: TimeoutOptions,
) {
  const { intervalSeconds, timeoutSeconds } = timeoutOptions;
  if (isNaN(intervalSeconds) || isNaN(timeoutSeconds)) {
    throw new Error('milliseconds not a number');
  }

  return new Promise<ValueType<ReturnType<typeof checkStatusOfChecks>>>(
    async resolve => {
      try {
        // Check to see if all of the check suites have already completed
        let status = await checkStatusOfChecks(githubBranchInformation);
        if (status.every(check => check.status === 'completed')) {
          resolve(status);
          return;
        }

        // Is set by setTimeout after the below setInterval
        let timeoutId: NodeJS.Timeout;

        // Continue to check for completion every ${intervalSeconds}
        const intervalId = setInterval(async () => {
          let status = await checkStatusOfChecks(githubBranchInformation);

          if (status.every(check => check.status === 'completed')) {
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
            core.error(`Timeout of ${timeoutSeconds} seconds reached.`);
            throw new Error(`Timeout of ${timeoutSeconds} seconds reached.`);
          }, timeoutSeconds * 1000);
        }
      } catch (error) {
        core.error('Error getting status of checks.');
        throw error;
      }
    },
  );
}
