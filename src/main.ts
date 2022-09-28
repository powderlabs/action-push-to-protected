import { startGroup, info, setFailed, endGroup, warning } from "@actions/core";
import {
  deleteRemoteBranch,
  getRequiredStatusChecksForBranch,
  GithubBranchInformation,
  waitForCheckSuites,
} from "./octokit-requests";
import path from "path";
import simpleGit from "simple-git";
import { ActionsInputsWithCommit, getInputs } from "./inputs";
import { errorHandler, outputGitStatus, to } from "./utils";
import { commit } from "./git-actions";

const baseDir = path.join(process.cwd());
const git = simpleGit({ baseDir });

async function run(): Promise<void> {
  try {
    startGroup("Internal logs");

    const {
      token,
      branchToPushTo,
      timeoutSeconds,
      intervalSeconds,
      owner,
      repo,
      GITHUB_RUN_ID,
      shouldCommit,
      ...gitCommitInputs
    } = getInputs();

    const branchToPushToInformation: GithubBranchInformation = {
      owner,
      repo,
      branch: branchToPushTo,
      token,
    };

    const [isRepo, isRepoError] = await to(simpleGit().checkIsRepo());
    if (!isRepo || isRepoError) {
      errorHandler("This is not a git repository. Aborting.");
      return;
    }

    info("> Checking for uncommitted changes in the git working tree...");
    const [gitStatus, gitStatusError] = await to(git.status());
    if (gitStatusError) {
      errorHandler("Error while checking for uncommitted changes.");
      return;
    }
    if (gitStatus.isClean()) {
      info("> Nothing to commit, working tree clean.");
    } else {
      outputGitStatus(
        gitStatus.modified,
        gitStatus.staged,
        gitStatus.not_added
      );
      if (shouldCommit) {
        info("> Committing changes...");
        const { commitMessage, commitArgs, ...gitConfig } =
          gitCommitInputs as ActionsInputsWithCommit;
        const [gitCommit, gitCommitError] = await to(
          commit(git, commitMessage, commitArgs, gitConfig)
        );
        if (gitCommitError) {
          errorHandler(
            "Error while committing changes. Aborting.",
            gitCommitError
          );
          return;
        }
        info(`> Committed changes with commit hash ${gitCommit}`);
      } else {
        warning(
          "> There are uncommitted changes in the git working tree and you haven't set `shouldCommit` to true. These dirty changes will not be pushed."
        );
      }
    }

    // Warn user if the tree is still dirty
    const [gitStatus2, gitStatusError2] = await to(git.status());
    if (gitStatusError2) {
      errorHandler("Error getting git status for the second time.");
      return;
    }
    if (!gitStatus2.isClean()) {
      warning("> The tree is dirty. Continuing...");
      outputGitStatus(
        gitStatus2.modified,
        gitStatus2.staged,
        gitStatus2.not_added
      );
    }

    info("> Fetching repo...");
    const [, fetchError] = await to(git.fetch());
    if (fetchError) {
      errorHandler("Error while fetching repo. Aborting.", fetchError);
      return;
    }

    info("> Verifying if target branch exists...");
    const [gitBranches, gitBranchesError] = await to(git.branch());
    if (gitBranchesError) {
      errorHandler(
        "Error while fetching branches. Aborting.",
        gitBranchesError
      );
      return;
    }
    if (!gitBranches.branches.hasOwnProperty(branchToPushTo)) {
      setFailed(`> Branch ${branchToPushTo} does not exist. Aborting.`);
      endGroup();
      return;
    }
    info(`> Branch ${branchToPushTo} exists. Continuing...`);

    info("> Verifying we are ahead of the remote branch...");
    const [head, gitRevParseError] = await to(git.revparse(["HEAD"]));
    if (gitRevParseError) {
      errorHandler(
        "Error while getting HEAD commit hash. Aborting.",
        gitRevParseError
      );
      return;
    }
    const [revListCount, revListCountError] = await to(
      git.raw(["rev-list", "--count", `origin/${branchToPushTo}..${head}`])
    );
    if (revListCountError) {
      errorHandler(
        "Error while getting number of commits ahead of remote branch. Aborting.",
        revListCountError
      );
      return;
    }
    const aheadCount = Number(revListCount.trim());
    if (aheadCount === 0) {
      setFailed(`> Local branch is behind the target branch. Aborting.`);
      return;
    }

    info("> Checking if the remote branch requires status checks...");
    const [requiredStatusChecks, requiredStatusChecksError] = await to(
      getRequiredStatusChecksForBranch(branchToPushToInformation)
    );
    if (requiredStatusChecksError) {
      errorHandler(
        `Problem getting required status checks on branch '${branchToPushTo}'. Aborting.`,
        requiredStatusChecksError
      );
      return;
    }

    // If the branch to push to requires status checks, we create a temporary branch and wait for the checks to pass on it before pushing. Else, we push directly to the branch.
    if (requiredStatusChecks.length > 0) {
      info(
        `> The remote branch requires status checks: ${requiredStatusChecks.join(
          ", "
        )}.`
      );
      info(
        "> Creating a temporary branch and throwing away all uncommitted changes..."
      );
      const temporaryBranch = `push-action/${GITHUB_RUN_ID}/${Date.now()}`;
      const [, checkoutError] = await to(
        git.checkout(temporaryBranch, ["-f", "-b"])
      );
      if (checkoutError) {
        errorHandler(
          `Could not create temporary branch ${temporaryBranch}. Aborting.`,
          checkoutError
        );
        return;
      }

      info("> Pushing the temporary branch to remote...");
      const [, pushError] = await to(
        git.push("origin", temporaryBranch, ["-f"])
      );
      if (pushError) {
        errorHandler(
          `Could not push temporary branch ${temporaryBranch} to remote. Aborting.`,
          pushError
        );
        return;
      }

      const temporaryBranchInformation: GithubBranchInformation = {
        owner,
        repo,
        branch: temporaryBranch,
        token,
      };

      info("> Waiting for the status checks to pass...");
      const [statusOnTemp, waitForChecksError] = await to(
        waitForCheckSuites(temporaryBranchInformation, {
          intervalSeconds,
          timeoutSeconds,
        })
      );
      if (waitForChecksError) {
        errorHandler(
          `Error while waiting on status checks on temporary branch ${temporaryBranch}. Aborting.`,
          waitForChecksError
        );
        return;
      }
      const passedOnTemp = statusOnTemp.every(
        (status) => status.conclusion !== "success"
      );
      if (!passedOnTemp) {
        setFailed(
          `> The status checks did not pass on the temporary branch. Aborting.`
        );
        return;
      }

      info(`> The status checks passed!`);
      info(`> Pushing ${temporaryBranch} --> origin/${branchToPushTo} ...`);
      const [, secondCheckoutError] = await to(git.checkout(branchToPushTo));
      if (secondCheckoutError) {
        errorHandler(
          `Could not checkout branch ${branchToPushTo}. Aborting.`,
          secondCheckoutError
        );
        return;
      }
      const [, resetError] = await to(git.reset(["--hard", temporaryBranch]));
      if (resetError) {
        errorHandler(
          `Could not reset branch ${branchToPushTo} to temporary branch ${temporaryBranch}. Aborting.`,
          resetError
        );
        return;
      }
      const [, secondPushError] = await to(git.push());
      if (secondPushError) {
        errorHandler(
          `Could not push branch ${branchToPushTo} to remote. Aborting.`,
          secondPushError
        );
        return;
      }

      info(`> Deleting ${temporaryBranch} ...`);
      await deleteRemoteBranch(temporaryBranchInformation);
    } else {
      setFailed(`> The remote branch does not require status checks.`);
      info(
        `> This action won't do anything right now, but it's easy to modify to just push to the branch.`
      );
    }

    endGroup();
    info("> Task completed.");
  } catch (error) {
    if (error instanceof Error) setFailed(error.message);
  }
}

run();
