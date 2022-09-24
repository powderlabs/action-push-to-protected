import { getInput, info } from '@actions/core';
import { context } from '@actions/github';

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
  } = context;
  const token = getInput('token', { required: true });
  let branchToPushTo = getInput('branch-to-push-to');
  if (
    branchToPushTo === '' ||
    branchToPushTo === undefined ||
    branchToPushTo === null
  ) {
    info('> ${branch-to-push-to} to was not specified, using "master"');
    branchToPushTo = 'master';
  }
  const timeoutSeconds = parseInt(
    getInput('timeoutMinutes', { trimWhitespace: true }) || '300',
  );
  const intervalSeconds = parseInt(
    getInput('intervalSeconds', { trimWhitespace: true }) || '5',
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
