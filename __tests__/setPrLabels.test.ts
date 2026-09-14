let setPrLabels: (
  deps: unknown,
  input: { labels: string[] },
) => Promise<{ error?: { code: string; message: string }; applied?: string[] }>;
let resolvePrLabels: (
  deps: { describeLabels?: string[] },
  agentLabels: unknown,
) => string[];

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../scripts/lib/operations.mjs');
  setPrLabels = mod.setPrLabels;
  resolvePrLabels = mod.resolvePrLabels;
});

describe('resolvePrLabels', () => {
  it('keeps catalog type and review-effort labels and drops arbitrary names', () => {
    expect(
      resolvePrLabels({}, ['feature', 'Review effort 3/5', 'automerge', 'security-reviewed']),
    ).toEqual(['feature', 'Review effort 3/5']);
  });

  it('always unions workflow describe-labels even if the agent omits them', () => {
    expect(resolvePrLabels({ describeLabels: ['needs-docs'] }, ['feature'])).toEqual([
      'feature',
      'needs-docs',
    ]);
    expect(resolvePrLabels({ describeLabels: ['needs-docs'] }, [])).toEqual(['needs-docs']);
  });
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
