let setPrLabels: (
  deps: unknown,
  input: { labels: string[] },
) => Promise<{ error?: { code: string; message: string }; applied?: string[] }>;

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../scripts/lib/operations.mjs');
  setPrLabels = mod.setPrLabels;
});

describe('setPrLabels', () => {
  it('rejects an empty labels array without calling GitHub', async () => {
    const result = await setPrLabels({ autoDescribe: true }, { labels: [] });
    expect(result).toEqual({
      error: { code: 'INVALID_ARGS', message: 'labels must be a non-empty array' },
    });
  });

  it('rejects when auto-describe is not enabled', async () => {
    const result = await setPrLabels({ autoDescribe: false }, { labels: ['bug'] });
    expect(result).toEqual({
      error: {
        code: 'DESCRIBE_DISABLED',
        message: 'set_pr_labels is only available during the auto-describe pass',
      },
    });
  });
});
