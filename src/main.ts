import * as core from '@actions/core';
import {
  deleteRemoteBranch,
  getRequiredStatusChecksForBranch,
  GithubBranchInformation,
  waitForCheckSuites,
} from './octokit-requests';
import path from 'path';
import { log } from './utils';
import simpleGit, { Response } from 'simple-git';
import { getInputs } from './inputs';

const baseDir = path.join(process.cwd());
const git = simpleGit({ baseDir });

const exitErrors: Error[] = [];

async function run(): Promise<void> {
  try {
    core.startGroup('Internal logs');

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

    core.info('> Checking for uncommitted changes in the git working tree...');
    const changedFiles = (await git.diffSummary(['--cached'])).files.length;
    if (changedFiles > 0) {
      core.setFailed(
        '> There are uncommitted changes in the git working tree. Make sure to commit changes before running this action. Aborting.',
      );
      core.endGroup();
      return;
    }

    core.info('> Fetching repo...');
    await git.fetch(log);

    core.info('> Verifying if target branch exists...');
    const gitBranches = await git.branch();
    if (!gitBranches.branches.hasOwnProperty(branchToPushTo)) {
      core.setFailed(`> Branch ${branchToPushTo} does not exist. Aborting.`);
      core.endGroup();
      return;
    }
    core.info(`> Branch ${branchToPushTo} exists. Continuing...`);

    core.info('> Verifying we are ahead of the remote branch...');
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
    if (aheadCount == 0) {
      core.setFailed(`> Local branch is behind the target branch. Aborting.`);
      return;
    }

    core.info('> Checking if the remote branch requires status checks...');
    const requiredStatusChecks = await getRequiredStatusChecksForBranch(
      branchToPushToInformation,
    );

    // If the branch to push to requires status checks, we create a temporary branch and wait for the checks to pass on it before pushing. Else, we push directly to the branch.
    if (requiredStatusChecks.length > 0) {
      core.info(
        `> The remote branch requires status checks: ${requiredStatusChecks.join(
          ', ',
        )}.`,
      );
      core.info(
        '> Creating a temporary branch and throwing away all uncommitted changes...',
      );
      const temporaryBranch = `push-action/${GITHUB_RUN_ID}/${Date.now()}`;
      await git.checkout(temporaryBranch, ['-f', '-b']);

      core.info('> Pushing the temporary branch to remote...');
      await git.push('origin', temporaryBranch, ['-f'], (err, data?) => {
        return log(err, data);
      });

      const temporaryBranchInformation: GithubBranchInformation = {
        owner,
        repo,
        branch: temporaryBranch,
        token,
      };

      core.info('> Waiting for the status checks to pass...');
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
        core.setFailed(
          `> The status checks did not pass on the temporary branch. Aborting.`,
        );
        return;
      }
      core.info(`> The status checks passed!`);
      core.info(
        `> Pushing ${temporaryBranch} --> origin/${branchToPushTo} ...`,
      );

      await git.checkout(branchToPushTo);
      await git.reset(['--hard', temporaryBranch]);
      await git.push((err, data?) => {
        return log(err, data);
      });

      core.info(`> Deleting ${temporaryBranch} ...`);
      await deleteRemoteBranch(temporaryBranchInformation);
    } else {
      core.info(`> The remote branch does not require status checks.`);
    }

    core.endGroup();
    core.info('> Task completed.');
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

run();
