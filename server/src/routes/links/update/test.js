import update from './';

import sinon from 'sinon';
import assert from 'assert';

// Helper for mounting routes in an express app and querying them.
// import db from '../../test-helpers/create-database-model-instances';
import issueRequest from '../../../test-helpers/issue-request';
import MockModel from '../../../test-helpers/mock-model';

const User = new MockModel(),
      Repository = new MockModel(),
      Link = new MockModel([], {upstream: Repository, owner: User, fork: Repository});

Link.methods.display = function() { return this; }

describe('link update', () => {
  let userData, linkData, upstreamData, forkData;

  beforeEach(function() {
    return Promise.all([
      User.create({username: 'ryan'}),
      Repository.create({type: 'repo'}), // Upstream
      Repository.create({type: 'repo'}), // Fork
    ]).then(([user, upstream, fork]) => {
      userData = user;
      upstreamData = upstream;
      forkData = fork;
      return Link.create({
        name: 'My Link',
        enabled: true,
        hookId: ['123456'],
        owner: user.id,
        upstream: upstream.id,
        fork: fork.id,
      });
    }).then(link => {
      linkData = link;
    });
  });

  it('should update a link for a user', () => {
    const addWebhooksForLink = sinon.stub().resolves(['98765']);
    const removeOldWebhooksForLink = sinon.stub().resolves();

    return issueRequest(
      update, [Link, Repository, addWebhooksForLink, removeOldWebhooksForLink],
      '/:linkId', userData, {
        method: 'PUT',
        url: `/${linkData.id}`,
        json: true,
        body: {
          link: {
            name: 'Another name for my link!',
            upstream: upstreamData.id,
            fork: forkData.id,
          },
        },
      }
    ).then(res => {
      const body = res.body;
      assert.equal(body.id, linkData.id);
      assert.equal(body.upstreamId, upstreamData.id);
      assert.equal(body.forkId, forkData.id);
      assert.equal(body.forkId, forkData.id);
      assert.equal(body.name, 'Another name for my link!');

      return Link.findOne({where: {id: linkData.id}});
    }).then(link => {
      assert.equal(link.name, 'Another name for my link!');
    });
  });
  it('should update a link with a new upstream', () => {
    const addWebhooksForLink = sinon.stub().resolves(['98765']);
    const removeOldWebhooksForLink = sinon.stub().resolves();

    // First, remove the upstream id from the link to test against.
    return linkData.updateAttribute('upstreamId', null).then(() => {
      return issueRequest(
        update, [Link, Repository, addWebhooksForLink, removeOldWebhooksForLink],
        '/:linkId', userData, {
          method: 'PUT',
          url: `/${linkData.id}`,
          json: true,
          body: {
            link: {
              name: 'Another name for my link!',
              upstream: {
                type: 'repo',
                owner: 'foo',
                repo: 'bar',
                branches: ['master'],
                branch: 'master',
              },
              fork: forkData.id,
            },
          },
        }
      );
    }).then(res => {
      const body = res.body;
      assert.equal(body.id, linkData.id);
      assert.equal(body.forkId, forkData.id);
      assert.equal(body.name, 'Another name for my link!');

      return Link.findOne({where: {id: linkData.id}});
    }).then(link => {
      assert.equal(link.name, 'Another name for my link!');
      assert.notEqual(link.upstreamId, upstreamData.id); // Make sure a new upstream was created
    });
  });
  it(`should try to update a link with a bad id.`, () => {
    const addWebhooksForLink = sinon.stub().resolves();
    const removeOldWebhooksForLink = sinon.stub().resolves();

    // First, remove the upstream id from the link to test against.
    return linkData.updateAttribute('upstreamId', null).then(() => {
      return issueRequest(
        update, [Link, Repository, addWebhooksForLink, removeOldWebhooksForLink],
        '/:linkId', userData, {
          method: 'PUT',
          url: `/BOGUS-ID-HERE`,
          json: true,
          body: {
            link: {
              name: 'Another name for my link!',
              upstream: {
                type: 'repo',
                owner: 'foo',
                repo: 'bar',
                branches: ['master'],
                branch: 'master',
              },
              fork: forkData.id,
            },
          },
        }
      );
    }).then(res => {
      const body = res.body;
      assert.equal(body.error, `No such link with that id.`);
    });
  });
  it(`should try to update a link but adding the webhook ultimately fails causing the whole thing to fail.`, () => {
    const link = {
      name: 'Another name for my link!',
      upstream: {
        type: 'repo',
        owner: 'foo',
        repo: 'bar',
        branches: ['master'],
        branch: 'master',
      },
      fork: forkData.id,
    };

    const addWebhooksForLink = sinon.stub()
    addWebhooksForLink.onFirstCall().rejects(new Error(`Can't add webhook`));
    addWebhooksForLink.onSecondCall().resolves();
    const removeOldWebhooksForLink = sinon.stub().resolves();

    // First, remove the upstream id from the link to test against.
    return linkData.updateAttribute('upstreamId', null).then(() => {
      return issueRequest(
        update, [Link, Repository, addWebhooksForLink, removeOldWebhooksForLink],
        '/:linkId', userData, {
          method: 'PUT',
          url: `/${linkData.id}`,
          json: true,
          body: { link },
        }
      );
    }).then(res => {
      const body = res.body;
      assert.equal(body.error, `Can't add webhook`);
      return Link.findOne({where: {id: linkData.id}});
    }).then(link => {
      assert.equal(link.name, 'Another name for my link!');
      assert.notEqual(link.upstreamId, upstreamData.id); // Make sure a new upstream was created
    });
  });
  it(`should try to update a link with a malformed body`, () => {
    const addWebhooksForLink = sinon.stub().resolves();
    const removeOldWebhooksForLink = sinon.stub().resolves();

    // First, remove the upstream id from the link to test against.
    return linkData.updateAttribute('upstreamId', null).then(() => {
      return issueRequest(
        update, [Link, Repository, addWebhooksForLink, removeOldWebhooksForLink],
        '/:linkId', userData, {
          method: 'PUT',
          url: `/${linkData.id}`,
          json: true,
          body: {
            bad: 'body',
            no: 'link key here!',
          },
        }
      );
    }).then(res => {
      const body = res.body;
      assert.equal(body.error, `No link field in json body.`);
    });
  });
  it(`should try to update a link with a valid body but no upstream`, () => {
    const addWebhooksForLink = sinon.stub().resolves();
    const removeOldWebhooksForLink = sinon.stub().resolves();

    // First, remove the upstream id from the link to test against.
    return linkData.updateAttribute('upstreamId', null).then(() => {
      return issueRequest(
        update, [Link, Repository, addWebhooksForLink, removeOldWebhooksForLink],
        '/:linkId', userData, {
          method: 'PUT',
          url: `/${linkData.id}`,
          json: true,
          body: {
            link: {
              name: 'Another name for my link!',
              /* NO UPSTREAM */
              fork: forkData.id,
            },
          },
        }
      );
    }).then(res => {
      const body = res.body;
      assert.equal(body.error, `Please specify an upstream and fork.`);
    });
  });
  it(`should try to update a link with a valid body but no fork`, () => {
    const addWebhooksForLink = sinon.stub().resolves();
    const removeOldWebhooksForLink = sinon.stub().resolves();

    // First, remove the upstream id from the link to test against.
    return linkData.updateAttribute('upstreamId', null).then(() => {
      return issueRequest(
        update, [Link, Repository, addWebhooksForLink, removeOldWebhooksForLink],
        '/:linkId', userData, {
          method: 'PUT',
          url: `/${linkData.id}`,
          json: true,
          body: {
            link: {
              name: 'Another name for my link!',
              upstream: {
                type: 'repo',
                owner: 'foo',
                repo: 'bar',
                branches: ['master'],
                branch: 'master',
              },
              /* NO FORK */
            },
          },
        }
      );
    }).then(res => {
      const body = res.body;
      assert.equal(body.error, `Please specify an upstream and fork.`);
    });
  });
  it(`should try to update a link with a valid body but an upstream that isn't a repo`, () => {
    const addWebhooksForLink = sinon.stub().resolves();
    const removeOldWebhooksForLink = sinon.stub().resolves();

    // First, remove the upstream id from the link to test against.
    return linkData.updateAttribute('upstreamId', null).then(() => {
      return issueRequest(
        update, [Link, Repository, addWebhooksForLink, removeOldWebhooksForLink],
        '/:linkId', userData, {
          method: 'PUT',
          url: `/${linkData.id}`,
          json: true,
          body: {
            link: {
              name: 'Another name for my link!',
              upstream: {
                type: 'fork-all', // <= An upstream must be a repo, so this should fail.
              },
              fork: forkData.id,
            },
          },
        }
      );
    }).then(res => {
      const body = res.body;
      assert.equal(body.error, `The 'upstream' repo must be a repo, not a bunch of forks.`);
    });
  });

});
