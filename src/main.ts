import {
  info as coreInfo,
  warning as coreWarning,
  debug as coreDebug,
  setFailed,
  startGroup,
  endGroup,
} from "@actions/core";
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
    startGroup("Setting up action");
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
    endGroup();
    coreInfo("> Checking for uncommitted changes in the git working tree...");
    const [gitStatus, gitStatusError] = await to(git.status());
    if (gitStatusError) {
      errorHandler("Error while checking for uncommitted changes.");
      return;
    }
    coreDebug(`> Git status: ${JSON.stringify(gitStatus)}`);
    if (gitStatus.isClean()) {
      coreInfo("> Nothing to commit, working tree clean.");
    } else {
      outputGitStatus(
        gitStatus.modified,
        gitStatus.staged,
        gitStatus.not_added
      );
      if (shouldCommit) {
        coreInfo("> Committing changes...");
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
        coreDebug(`> Git commit: ${JSON.stringify(gitCommit)}`);
        coreInfo(`> Committed changes with commit hash ${gitCommit}`);
      } else {
        coreWarning(
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
      coreWarning("> The tree is dirty. Continuing...");
      outputGitStatus(
        gitStatus2.modified,
        gitStatus2.staged,
        gitStatus2.not_added
      );
    }

    coreInfo("> Fetching repo...");
    const [, fetchError] = await to(git.fetch());
    if (fetchError) {
      errorHandler("Error while fetching repo. Aborting.", fetchError);
      return;
    }

    startGroup("Checking the target branch");

    coreInfo("> Verifying if target branch exists...");
    const [gitBranches, gitBranchesError] = await to(git.branch());
    if (gitBranchesError) {
      errorHandler(
        "Error while fetching branches. Aborting.",
        gitBranchesError
      );
      return;
    }
    coreDebug(`> Git branches: ${JSON.stringify(gitBranches)}`);
    if (!gitBranches.branches.hasOwnProperty(branchToPushTo)) {
      setFailed(`> Branch ${branchToPushTo} does not exist. Aborting.`);
      return;
    }
    coreInfo(`> Branch ${branchToPushTo} exists. Continuing...`);

    coreInfo("> Verifying we are ahead of the remote branch...");
    const [head, gitRevParseError] = await to(git.revparse(["HEAD"]));
    if (gitRevParseError) {
      errorHandler(
        "Error while getting HEAD commit hash. Aborting.",
        gitRevParseError
      );
      return;
    }
    coreDebug(`> HEAD commit hash: ${head}`);
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
    coreDebug(`> Number of commits ahead of remote branch: ${revListCount}`);
    const aheadCount = Number(revListCount.trim());
    if (aheadCount === 0) {
      setFailed(`> Local branch is behind the target branch. Aborting.`);
      return;
    }

    coreInfo("> Checking if the remote branch requires status checks...");
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
    coreDebug(
      `> Required status checks for branch ${branchToPushTo}: ${JSON.stringify(
        requiredStatusChecks
      )}`
    );
    endGroup();

    if (requiredStatusChecks.length <= 0) {
      // TODO: Do stuff here
      setFailed(`> The remote branch does not require status checks.`);
      coreInfo(
        `> This action won't do anything right now. Please open an issue on the repo if you want this feature.`
      );
    }

    startGroup("Handling status checks");
    // If the branch to push to requires status checks, we create a temporary branch and wait for the checks to pass on it before pushing.
    coreInfo(
      `> The remote branch requires status checks: ${requiredStatusChecks.join(
        ", "
      )}.`
    );
    const temporaryBranch = `push-action/${GITHUB_RUN_ID}/${Date.now()}`;
    coreInfo(
      `> Creating the temporary branch ${temporaryBranch} and throwing away all uncommitted changes...`
    );
    const [, checkoutError] = await to(
      git.checkout(["-f", "-b", `${temporaryBranch}`])
    );
    if (checkoutError) {
      errorHandler(
        `Could not create temporary branch ${temporaryBranch}. Check if you have a branch called 'push-action' if the error is something like: 'cannot lock ref...'. Aborting.`,
        checkoutError
      );
      return;
    }

    coreInfo("> Pushing the temporary branch to remote...");
    const [, pushError] = await to(git.push("origin", temporaryBranch, ["-f"]));
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

    // Now that the temporary branch is pushed, we want to delete that branch even if the next steps fails.
    try {
      coreInfo("> Waiting for the status checks to pass...");
      const [statusOnTemp, waitForChecksError] = await to(
        waitForCheckSuites(
          temporaryBranchInformation,
          {
            intervalSeconds,
            timeoutSeconds,
          },
          requiredStatusChecks
        )
      );
      if (waitForChecksError) {
        errorHandler(
          `Error while waiting on status checks on temporary branch ${temporaryBranch}. Aborting.`,
          waitForChecksError
        );
        return;
      }
      coreDebug(`> Status checks on temporary branch: ${statusOnTemp}`);
      const passedOnTemp = statusOnTemp.every(
        (status) => status.conclusion === "success"
      );
      if (!passedOnTemp) {
        setFailed(
          `> The status checks did not pass on the temporary branch. Aborting.`
        );
        return;
      }
      coreInfo(`> The status checks passed!`);
      endGroup();

      startGroup("Pushing to the target branch");
      coreInfo(`> Pushing ${temporaryBranch} --> origin/${branchToPushTo} ...`);
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
      endGroup();
    } finally {
      coreInfo(`> Deleting ${temporaryBranch} ...`);
      await deleteRemoteBranch(temporaryBranchInformation);
    }
    coreInfo("> Task completed.");
  } catch (error) {
    if (error instanceof Error) setFailed(error.message);
  }
}

run();
