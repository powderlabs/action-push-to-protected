import * as core from '@actions/core';
import * as github from '@actions/github';

export interface Inputs {
  token: string;
  branchToPushTo: string;
  timeoutSeconds: number;
  intervalSeconds: number;
  owner: string;
  repo: string;
  GITHUB_RUN_ID?: string;
}

export function getInputs(): Inputs {
  const { GITHUB_RUN_ID } = process.env;
  const {
    repo: { owner, repo },
  } = github.context;
  const token = core.getInput('token', { required: true });
  let branchToPushTo = core.getInput('branch-to-push-to');
  if (
    branchToPushTo === '' ||
    branchToPushTo === undefined ||
    branchToPushTo === null
  ) {
    core.info('> ${branch-to-push-to} to was not specified, using "master"');
    branchToPushTo = 'master';
  }
  const timeoutSeconds = parseInt(
    core.getInput('timeoutMinutes', { trimWhitespace: true }) || '300',
  );
  const intervalSeconds = parseInt(
    core.getInput('intervalSeconds', { trimWhitespace: true }) || '5',
  );
  return {
    token,
    branchToPushTo,
    timeoutSeconds,
    intervalSeconds,
    owner,
    repo,
    GITHUB_RUN_ID,
  };
}
