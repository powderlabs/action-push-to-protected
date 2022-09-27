import { getBooleanInput, getInput, info } from "@actions/core";
import { context } from "@actions/github";
import { matchGitArgs } from "./utils";

export interface GitConfig {
  authorEmail: string;
  authorName: string;
  committerEmail: string;
  committerName: string;
}

export interface ActionsInputsSanCommit {
  token: string;
  shouldCommit: boolean;
  branchToPushTo: string;
  timeoutSeconds: number;
  intervalSeconds: number;
  owner: string;
  repo: string;
  GITHUB_RUN_ID?: string;
}

export interface ActionsInputsWithCommit
  extends ActionsInputsSanCommit,
    GitConfig {
  commitMessage: string;
  commitArgs: string[];
}

export function getInputs(): ActionsInputsSanCommit | ActionsInputsWithCommit {
  const {
    repo: { owner, repo },
  } = context;
  const token = getInput("token", { required: true });
  let branchToPushTo = getInput("branchToPushTo");
  if (emptyOrUndefinedString(branchToPushTo)) {
    info("> ${branchToPushTo} to was not specified, we'll try master.");
    branchToPushTo = "master";
  }
  const timeoutSeconds = parseInt(
    getInput("timeoutMinutes", { trimWhitespace: true })
  );
  const intervalSeconds = parseInt(
    getInput("intervalSeconds", { trimWhitespace: true })
  );
  if (timeoutSeconds < 0 || intervalSeconds < 0) {
    throw new Error(
      "The timeoutMinutes and intervalSeconds inputs must be positive numbers."
    );
  }
  if (isNaN(timeoutSeconds) || isNaN(intervalSeconds)) {
    throw new Error(
      "The timeoutMinutes and intervalSeconds inputs must be numbers."
    );
  }

  const shouldCommit = getBooleanInput("should-commit");
  const actionInputs: ActionsInputsSanCommit = {
    token,
    branchToPushTo,
    timeoutSeconds,
    intervalSeconds,
    owner,
    repo,
    shouldCommit,
    GITHUB_RUN_ID: context.runId.toString(),
  };
  if (shouldCommit) {
    const commitMessage = getInput("commit-message", { required: true });
    const commitArgs = matchGitArgs(getInput("commit-args"));
    const authorEmail = emptyOrUndefinedString(getInput("authorEmail"))
      ? context.actor
      : getInput("authorEmail");
    const authorName = emptyOrUndefinedString(getInput("authorName"))
      ? `${context.actor}@users.noreply.github.com`
      : getInput("authorName");
    const committerEmail = emptyOrUndefinedString(getInput("committerEmail"))
      ? authorEmail
      : getInput("committerEmail");
    const committerName = emptyOrUndefinedString(getInput("committerName"))
      ? authorName
      : getInput("committerName");
    const actionInputsWithCommit: ActionsInputsWithCommit = {
      ...actionInputs,
      commitMessage,
      commitArgs,
      authorEmail,
      authorName,
      committerEmail,
      committerName,
    };
    return actionInputsWithCommit;
  }
  return actionInputs;
}

function emptyOrUndefinedString(str: string): boolean {
  return str === "" || str === undefined || str === null;
}
