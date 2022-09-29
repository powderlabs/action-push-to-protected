[![works badge](https://cdn.jsdelivr.net/gh/nikku/works-on-my-machine@v0.2.0/badge.svg)](https://github.com/nikku/works-on-my-machine)

# Commit & Push To Protected Branches

Use this action to commit and push changes to a branch that [_**require status checks to pass before merging**_](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/defining-the-mergeability-of-pull-requests/about-protected-branches#require-status-checks-before-merging). This GitHub Action can commit changes made in the workflow runs and push them to a protected branch. It can be used to bump versions/builds, lint code, update documentation, commit updated builds, etc.

The action can push commit(s) to a branch protected by [required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/defining-the-mergeability-of-pull-requests/about-protected-branches#require-status-checks-before-merging) by creating a temporary branch, where status checks are run, before fast-forward merging it into the protected branch. [Read more about how it works](#how-the-action-works).

This action is based on the ideas of [Push Protected](https://github.com/marketplace/actions/push-to-status-check-protected-branches) (but written in javascript so it can run on Macos and Windows runners) and [Add & Commit](https://github.com/marketplace/actions/add-commit). **NOTE:** This action is nowhere as mature as their actions and is missing much of their functionality or stability.

The only system requirement is having Git 2.18 or higher in your PATH (afaik).

## Setup

### Updating your workflow

All required status checks on the protected branch must be run on the temporary branch for the action to be successful.

The simplest way to do this is to add a branch filter for the push trigger for each of the required checks. Since all the temporary branches have the same prefix: `push-action/` a wildcard will suffice.

The complete name is `push-action/${GITHUB_RUN_ID}/${Date.now()}`.

Ex:

```yml
on:
  push:
    branches:
      - "push-action/**"
```

_The workflows in this repo (`action-push-to-protected/.github/workflows`) use this action to update the dist so look there for examples_

### Using a token with proper permissions

> When you use the repository's GITHUB_TOKEN to perform tasks, events triggered by the GITHUB_TOKEN, with the exception of workflow_dispatch and repository_dispatch, will not create a new workflow run. This prevents you from accidentally creating recursive workflow runs. For example, if a workflow run pushes code using the repository's GITHUB_TOKEN, a new workflow will not run even when the repository contains a workflow configured to run when push events occur.

[GitHub Actions: Triggering a workflow from a workflow](https://docs.github.com/en/actions/using-workflows/triggering-a-workflow#triggering-a-workflow-from-a-workflow)

This means for the status checks on the temporary branch, we can't use the default `GITHUB_TOKEN`.

**Alternatives:**

- Use a `repo` scoped [Personal Access Token (PAT)](https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token) created on an account that has write access to the repository that action is being run on. This is the standard workaround and [recommended by GitHub](https://docs.github.com/en/actions/reference/events-that-trigger-workflows#triggering-new-workflows-using-a-personal-access-token). However, the PAT cannot be scoped to a specific repository so the token becomes a very sensitive secret. If this is a concern, the PAT can instead be created for a dedicated [machine account](https://docs.github.com/en/github/site-policy/github-terms-of-service#3-account-requirements) that has collaborator access to the repository. Also note that because the account that owns the PAT will be the one that triggers of the checks, commits, pushes, etc.

- **Recommended**: Use a [GitHub App to generate a token](#authenticating-with-github-app-generated-tokens) that can be used with this action. GitHub App generated tokens are more secure than using a PAT because GitHub App access permissions can be set with finer granularity and are scoped to only repositories where the App is installed. This method will trigger both `on: push` and `on: pull_request` workflows. In addition each action, checks, commits, pushes are triggered by the App.

Read more about required permissions here: [Authenticating with GitHub Apps](#authenticating-with-github-app-generated-tokens)

### Checking out the repo

You **MUST** use the [`actions/checkout`](https://github.com/marketplace/actions/checkout) action to checkout your local repository [**with a token with proper permissions**](#using-a-token-with-proper-permissions) if you wish to make changes to it before pushing these changes to the target branch.

ex:

```yml
steps:
  - name: Get Admin Bot Token
    uses: tibdex/github-app-token@v1
    id: generate_token
    with:
      app_id: ${{ secrets.APP_ID }}
      private_key: ${{ secrets.APP_PRIVATE_KEY }}

  - uses: actions/checkout@v2
    with:
      token: ${{ steps.generate_token.outputs.token }}
```

## Usage

1. Checkout the repo with actions/checkout with the token
2. Make changes in the repo
3. Run this action (if you didn't commit the changes before running this action, set `shouldCommit: true` and it will commit them for you)

Example workflow are in the [`.github/workflows`](./.github/workflows) directory.

**IMPORTANT**: If you're running this action on push and don't have a conditional trigger you could end up in an infinite loop. To prevent recursive workflows, you can use a known bot email for the commit and conditionally NOT trigger the workflow on that email. Look at the [`.github/workflows/build-dist-and-push.yml`](./.github/workflows/build-dist-and-push.yml) directory for an examples.

```yml
- uses: shahaed-labs/action-push-to-protected
  with:
    # The token mentioned above. Must have read&write access to the repo and read access to checks and actions. Required!
    token: ""

    # The branch to push to. Defaults to master if not specified.
    branchToPushTo: ""

    # The amount of time (in seconds) this action will wait for the status checks to complete before timing out. Defaults to 300 seconds (5 minutes).
    timeoutSeconds: ""

    # The amount of time (in seconds) this action will wait between each check of the status checks. Defaults to 30 seconds.
    intervalSeconds: ""

    # Whether or not this action should commit the local changes before pushing. Defaults to false. All following inputs are not used when this is false.
    shouldCommit: ""

    # The commit message to use when committing changes. Defaults to 'Automated commit from GitHub Actions'
    commitMessage: ""

    # Additional arguments to pass to the commit command. Recommend adding '-a' if the changes are on tracked
    # files and not staged, --no-verify to avoid running any pre-commit hooks.
    commitArgs: ""

    # The name to use for the author of the commit. Defaults to the name of the user that triggered the workflow.
    authorName: ""

    # The email to use for the author of the commit. Defaults to the email of the user that triggered the workflow.
    authorEmail: ""

    # The name to use for the committer of the commit. Defaults to the name of the user that triggered the workflow.
    committerName: ""

    # The email to use for the committer of the commit. Defaults to the email of the user that triggered the workflow.
    committerEmail: ""
```

## Authenticating with GitHub App generated tokens

A GitHub App can be created for the sole purpose of generating tokens for use with GitHub actions.
These tokens can be used in place of `GITHUB_TOKEN` or a [Personal Access Token (PAT)](https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token).
GitHub App generated tokens are more secure than using a PAT because GitHub App access permissions can be set with finer granularity and are scoped to only repositories where the App is installed.

1. Create a minimal [GitHub App](https://docs.github.com/en/developers/apps/creating-a-github-app), setting the following fields:

   - Set `GitHub App name`.
   - Set `Homepage URL` to anything you like, such as your GitHub profile page.
   - Uncheck `Active` under `Webhook`. You do not need to enter a `Webhook URL`.
   - Under `Repository permissions: Actions` select `Access: Read-only`.
   - Under `Repository permissions: Checks` select `Access: Read-only`.
   - Under `Repository permissions: Contents` select `Access: Read & write`.
   - Under `Repository permissions: Administration` select `Access: Read & write`.

     - **NOTE**: Not recommended and most likely not needed. This really depends on your what kind of protections you have on the branch, but you can specify certain actors (like the app you're creating) to bypass pull requests: ![PR bypass](https://docs.github.com/assets/cb-40143/images/help/repository/PR-bypass-requirements-with-apps.png) and bypass other protections
       ![repo](https://docs.github.com/assets/cb-11194/images/help/repository/restrict-branch.png).

     However these options are only available for organizations. On personal repos, you might need the Administrator permission.

2. Create a Private key from the App settings page and store it securely.

3. Install the App on any repository where workflows will run requiring tokens.

4. Set secrets on your repository containing the GitHub App ID, and the private key you created in step 2. e.g. `APP_ID`, `APP_PRIVATE_KEY`.

5. The following example workflow shows how to use [tibdex/github-app-token](https://github.com/tibdex/github-app-token) to generate a token for use with this action.

```yaml
steps:
  - uses: tibdex/github-app-token@v1
    id: generate-token
    with:
      app_id: ${{ secrets.APP_ID }}
      private_key: ${{ secrets.APP_PRIVATE_KEY }}

  - uses: actions/checkout@v3
    with:
      token: ${{ steps.generate-token.outputs.token }}

  # Make changes here

  - name: Push changes to main
    uses: shahaed-labs/action-push-to-protected
    with:
      token: ${{ steps.generate-token.outputs.token }}
      ...
```

## How the action works

This action will push commit(s) to a branch protected by [required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/defining-the-mergeability-of-pull-requests/about-protected-branches#require-status-checks-before-merging) by creating a temporary branch, where status checks are run, before fast-forward merging it into the protected branch.

### Steps

1. Gives you the option to commit any changes that's happened in the workflow already
2. Verify the target branch exists, requires status checks, and the current commits are (strictly) ahead of the target branch.
   - Since we're trying to fast forward merge we need to strictly be ahead of the target branch.
3. Create a temporary branch from the current ref (i.e with the commit(s)) where the [status checks](https://docs.github.com/en/github/collaborating-with-issues-and-pull-requests/about-status-checks) are run
   - There is some setup for this. Read more below.
4. Wait for the status checks to pass
   - There are `timeout` and `interval` (check every ${interval} seconds if the checks are done) options
5. Fast-forward merge the branch onto the protected branch.
   - Github allows this since the ref has passed status checks. Need an token with proper permissions if the branch has other protections (e.g. pull requests, etc). Read more below.
6. Delete the temporary branch

### What this action doesn't do

Some features are easy to add. Some aren't. I don't have a need for any of these right now so I haven't implemented them.

- Have any of the advanced git add and commit options [Add & Commit](https://github.com/marketplace/actions/add-commit) has. The cleanest move might be to remove this functionality altogether and encourage people to use actions like [Add & Commit](https://github.com/marketplace/actions/add-commit) to commit changes before running this action. Or we can use more mature committing actions in this actions as a composite if people only want to use one action.
- Does not force push
- Does not push tags
- Give an option to unprotect reviews before pushing -- however if you use the Github App for a token, this isn't a problem
- Push to branches that are NOT protected
