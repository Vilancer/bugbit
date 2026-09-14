let listPullRequestFiles: (
  octokit: {
    paginate: jest.Mock;
    rest: { pulls: { listFiles: unknown } };
  },
  owner: string,
  repo: string,
  pullNumber: number,
) => Promise<unknown[]>;

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../scripts/lib/list-pr-files.mjs');
  listPullRequestFiles = mod.listPullRequestFiles;
});

describe('listPullRequestFiles', () => {
  it('uses octokit.paginate so every page of PR files is returned', async () => {
    const listFiles = Symbol('listFiles');
    const page = Array.from({ length: 35 }, (_, i) => ({
      filename: `file-${i}.ts`,
      patch: `@@ -1,1 +1,1 @@\n-old\n+new`,
    }));
    const paginate = jest.fn(async () => page);
    const octokit = {
      paginate,
      rest: { pulls: { listFiles } },
    };

    const files = await listPullRequestFiles(octokit, 'acme', 'app', 42);

    expect(paginate).toHaveBeenCalledTimes(1);
    expect(paginate).toHaveBeenCalledWith(listFiles, {
      owner: 'acme',
      repo: 'app',
      pull_number: 42,
      per_page: 100,
    });
    expect(files).toHaveLength(35);
    expect(files[34]).toEqual(expect.objectContaining({ filename: 'file-34.ts' }));
  });
});
