import {
  startGroup,
  info,
  setFailed,
  endGroup,
  error as setError,
} from '@actions/core';
import {
  deleteRemoteBranch,
  getRequiredStatusChecksForBranch,
  GithubBranchInformation,
  waitForCheckSuites,
} from './octokit-requests';
import path from 'path';
import simpleGit from 'simple-git';
import { getInputs } from './inputs';
import { errorHandler, to } from './utils';

const baseDir = path.join(process.cwd());
const git = simpleGit({ baseDir });

async function run(): Promise<void> {
  try {
    startGroup('Internal logs');

    const {
      token,
      branchToPushTo,
      timeoutSeconds,
      intervalSeconds,
      owner,
      repo,
      GITHUB_RUN_ID,
    } = getInputs();

    const branchToPushToInformation: GithubBranchInformation = {
      owner,
      repo,
      branch: branchToPushTo,
      token,
    };

    info('> Checking for uncommitted changes in the git working tree...');
    const changedFiles = (await git.diffSummary(['--cached'])).files.length;
    if (changedFiles > 0) {
      setFailed(
        '> There are uncommitted changes in the git working tree. Make sure to commit changes before running this action. Aborting.',
      );
      endGroup();
      return;
    }

    info('> Fetching repo...');
    await git.fetch();

    info('> Verifying if target branch exists...');
    const gitBranches = await git.branch();
    if (!gitBranches.branches.hasOwnProperty(branchToPushTo)) {
      setFailed(`> Branch ${branchToPushTo} does not exist. Aborting.`);
      endGroup();
      return;
    }
    info(`> Branch ${branchToPushTo} exists. Continuing...`);

    info('> Verifying we are ahead of the remote branch...');
    const head = await git.revparse(['HEAD']);
    const aheadCount = Number(
      (
        await git.raw([
          'rev-list',
          '--count',
          `origin/${branchToPushTo}..${head}`,
        ])
      ).trim(),
    );
    if (aheadCount === 0) {
      setFailed(`> Local branch is behind the target branch. Aborting.`);
      return;
    }

    info('> Checking if the remote branch requires status checks...');

    const [requiredStatusChecks, requiredStatusChecksError] = await to(
      getRequiredStatusChecksForBranch(branchToPushToInformation),
    );
    if (requiredStatusChecksError) {
      setError(requiredStatusChecksError.message);
      setFailed(
        `> Could not get required status checks for branch ${branchToPushTo}. Aborting.`,
      );
      endGroup();
      return;
    }

    // If the branch to push to requires status checks, we create a temporary branch and wait for the checks to pass on it before pushing. Else, we push directly to the branch.
    if (requiredStatusChecks.length > 0) {
      info(
        `> The remote branch requires status checks: ${requiredStatusChecks.join(
          ', ',
        )}.`,
      );
      info(
        '> Creating a temporary branch and throwing away all uncommitted changes...',
      );
      const temporaryBranch = `push-action/${GITHUB_RUN_ID}/${Date.now()}`;
      await git.checkout(temporaryBranch, ['-f', '-b']);

      info('> Pushing the temporary branch to remote...');
      await git.push('origin', temporaryBranch, ['-f'], (err, data?) => {
        return log(err, data);
      });

      const temporaryBranchInformation: GithubBranchInformation = {
        owner,
        repo,
        branch: temporaryBranch,
        token,
      };

      info('> Waiting for the status checks to pass...');
      const statusOnTemp = await waitForCheckSuites(
        temporaryBranchInformation,
        {
          intervalSeconds,
          timeoutSeconds,
        },
      );
      const passedOnTemp = statusOnTemp.every(
        status => status.conclusion !== 'success',
      );
      if (!passedOnTemp) {
        setFailed(
          `> The status checks did not pass on the temporary branch. Aborting.`,
        );
        return;
      }
      info(`> The status checks passed!`);
      info(`> Pushing ${temporaryBranch} --> origin/${branchToPushTo} ...`);

      await git.checkout(branchToPushTo);
      await git.reset(['--hard', temporaryBranch]);
      await git.push((err, data?) => {
        return log(err, data);
      });

      info(`> Deleting ${temporaryBranch} ...`);
      await deleteRemoteBranch(temporaryBranchInformation);
    } else {
      info(`> The remote branch does not require status checks.`);
    }

    endGroup();
    info('> Task completed.');
  } catch (error) {
    if (error instanceof Error) setFailed(error.message);
  }
}

run();
