import Promise from 'bluebird';
import getRepoName from 'helpers/getRepoName';
import createGithubInstance from '../createGithubInstance';
import createTemporaryRepo from 'helpers/createTemporaryRepo';

export default function webhook(gh, link, pageSize=100, botInstance=false) {
  let backstrokeBotInstance = botInstance || createGithubInstance({accessToken: process.env.GITHUB_TOKEN});

  function actOnRepo(from, to) {
    return didRepoOptOut(gh, to.provider, to).then(didOptOut => {
      // Do we have permission to make a pull request on the child?
      if (didOptOut) {
        return {msg: "This repo opted out of backstroke pull requests"};
      } else {
        // create a temporary repo with the new changes
        return createTemporaryRepo(gh, backstrokeBotInstance, to).then(tempRepo => {
          // Make the pull request
          console.log('temp repo', tempRepo)
          return createPullRequest(backstrokeBotInstance, to.provider, from, to, tempRepo);
        }).catch(err => {
          if (err.code === 422) {
            // The pull request already existed
            return {msg: "There's already a pull request for this repo, no need to create another."};
          } else {
            // Still reject anything else
            return Promise.reject(err);
          }
        });
      }
    });
  }

  // if disabled, or to/from is null, return so
  if (!link.enabled) {
    return Promise.resolve({error: 'not-enabled', isEnabled: false});
  } else if (!link.to || !link.from) {
    return Promise.resolve({
      error: 'to-or-from-false',
      isEnabled: true,
      msg: 'Please set both a "to" and "from" on this link.',
    });
  }

  // step 1: are we dealing with a repo to merge into or all the forks of a repo?
  if (link.to.type === 'repo') {
    return actOnRepo(link.from, link.to).then(response => {
      return {
        status: 'ok',
        pullRequest: response,
        isEnabled: true,
        many: false,
        forkCount: 1, // just one repo
      };
    });
  } else if (link.to.type === 'fork-all') {
    let [user, repo] = getRepoName(link.from);

    // Fetch each fork, then try to make a pull request.
    function getForks(page) {
      let allForks = [];
      return gh.reposGetForks({
        user, repo, page,
        per_page: pageSize,
      }).then(forks => {
        // Act on each fork, and add each's response to `forkGroup`.
        let forkGroup = [];
        forks.forEach(fork => {
          forkGroup.push(
            actOnRepo(link.from, { // to
              type: 'repo',
              provider: link.to.provider,
              name: fork.full_name,
              private: fork.private,
              fork: true,
              branch: link.from.branch, // same branch as the upstream. TODO: make this configurable.
              branches: [],
            })
          );
        });

        // add a conglomeration of the previous promises to the group of all forks
        allForks.push(Promise.all(forkGroup));

        // if required, go to the next page of forks
        if (forks.length === pageSize) {
          return getForks(++page);
        } else {
          return Promise.all(allForks).then(success => {
            return {
              status: 'ok',
              many: true,
              forkCount: (page * pageSize) + forks.length, // total amount of forks handled
              isEnabled: true,
            };
          });
        }
      });
    }

    return getForks(0);
  } else {
    throw new Error(`No such 'to' type: ${link.to.type}`);
  }
}

// Given a repository `user/repo` and a provider that the repo is located on (ex: `github`),
// determine if the repo opted out.
export function didRepoOptOut(inst, provider, repoData) {
  let [user, repo] = getRepoName(repoData);
  switch (provider) {
    case 'github':
      return inst.searchIssues({
        q: `repo:${user}/${repo} is:pr label:optout`,
      }).then(issues => {
        return issues.total_count > 0;
      });

    default:
      throw new Error(`No such provider ${provider}`);
  }
}

// Get the head commit of a branch.
export function getBranchHEAD(inst, provider, upstreamRepoModel) {
  let [user, repo] = getRepoName(upstreamRepoModel);
  switch (provider) {
    case 'github':
      return inst.reposGetBranch({
        user, repo,
        branch: upstreamRepoModel.branch,
      }).then(branch => {
        return branch.commit.sha;
      });
    default:
      throw new Error(`No such provider ${provider}`);
  }
}

export function generatePullRequestTitle(user, repo) {
  return `Update from upstream repo ${user}/${repo}`;
}

export function generatePullRequestBody(user, repo, forkName) {
  return `Hello!
  The remote \`${user}/${repo}\` has some new changes that aren't in this fork.
  So, here they are, ready to be merged! :tada:

  If this pull request can be merged without conflict, you can publish your software
  with these new changes.

  Otherwise, if you have merge conflicts, we've taken the liberty of creating a fork at
  [backstroke-bot/${forkName}](https://github.com/backstroke-bot/${forkName}) that
  \`${user}\` has push access to. After fixing any conflicts, merge below to update
  your code to the latest.

  Have fun!
  --------
  Created by [Backstroke](http://backstroke.us). Oh yea, I'm a bot.
  `.replace('\n', '');
}

// Create a new pull request from the upstream to the child.
export function createPullRequest(inst, provider, upstreamRepoModel, childRepoModel, tempUpstreamRepoModel) {
  let [realUpstreamUser, realUpstreamRepo] = getRepoName(upstreamRepoModel);
  let [upstreamUser, upstreamRepo] = getRepoName(tempUpstreamRepoModel);
  let [childUser, childRepo] = getRepoName(childRepoModel);

  switch (provider) {
    case 'github':
      // console.log("Create pull request on", childUser, childRepo);
      // console.log("  base:", childRepoModel.branch);
      // console.log("  head:", upstreamUser, upstreamRepoModel.branch);
      // break;
      return inst.pullRequestsCreate({
        user: childUser, repo: childRepo,
        title: generatePullRequestTitle(realUpstreamUser, realUpstreamRepo),
        head: `${upstreamUser}:${upstreamRepoModel.branch}`,
        base: childRepoModel.branch,
        body: generatePullRequestBody(realUpstreamUser, realUpstreamRepo, upstreamRepo),
      });
    default:
      throw new Error(`No such provider ${provider}`);
  }
}