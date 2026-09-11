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
    const result = await setPrLabels({}, { labels: [] });
    expect(result).toEqual({
      error: { code: 'INVALID_ARGS', message: 'labels must be a non-empty array' },
    });
  });
});
