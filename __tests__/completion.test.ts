import { requireToolCall } from '../src/agent/completion';

describe('requireToolCall', () => {
  it('is done only after one of the required tools ran, and passes results through', async () => {
    const tools = {
      get_diff: { execute: jest.fn(async () => ({ files: [] })) },
      post_review: { execute: jest.fn(async () => ({ posted: [] })) },
    };
    const { tools: wrapped, completion } = requireToolCall(tools, ['post_review'], 'finish');

    await wrapped.get_diff.execute();
    expect(completion.done()).toBe(false);

    await expect(wrapped.post_review.execute()).resolves.toEqual({ posted: [] });
    expect(completion.done()).toBe(true);
    expect(completion).toMatchObject({ missing: 'a post_review call', nudge: 'finish' });
  });

  it('does not count a call that threw', async () => {
    const { tools, completion } = requireToolCall(
      { post_review: { execute: async () => Promise.reject(new Error('422')) } },
      ['post_review'],
      'finish',
    );
    await expect(tools.post_review.execute()).rejects.toThrow('422');
    expect(completion.done()).toBe(false);
  });
});
