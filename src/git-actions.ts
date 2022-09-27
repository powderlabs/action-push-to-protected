import { info, error as setError } from "@actions/core";
import { SimpleGit as SimpleGitInterface } from "simple-git";
import { GitConfig } from "./inputs";
import { to, log } from "./utils";

/**
 * Creates a commit with the given message and arguments.
 * @param git Built SimpleGit instance
 * @param commitMessage Commit message
 * @param commitArgs Commit arguments
 * @param gitConfig Git config
 * @returns Commit hash
 */
export async function commit(
  git: SimpleGitInterface,
  commitMessage: string,
  commitArgs: string[],
  gitConfig: GitConfig
) {
  const { authorEmail, authorName, committerEmail, committerName } = gitConfig;
  try {
    await git
      .addConfig("user.email", authorEmail, undefined, log)
      .addConfig("user.name", authorName, undefined, log)
      .addConfig("author.email", authorEmail, undefined, log)
      .addConfig("author.name", authorName, undefined, log)
      .addConfig("committer.email", committerEmail, undefined, log)
      .addConfig("committer.name", committerName, undefined, log);
  } catch (error) {
    setError("> Failed while setting up git config. Aborting");
    error instanceof Error && setError(error);
    throw error;
  }

  info(
    `> Current git config\n${JSON.stringify(
      (await git.listConfig()).all,
      null,
      2
    )}`
  );
  info("> Creating commit...");
  const [commitResult, commitError] = await to(
    git.commit(commitMessage, commitArgs)
  );
  if (commitError) {
    throw new Error(`Error while creating commit. Aborting. ${commitError}`);
  }
  return commitResult.commit;
}
