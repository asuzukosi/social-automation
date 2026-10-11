// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — Comment generator tests
// by nichxbt

import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  buildUserPrompt,
  sanitizeComment,
  isGenericComment,
  resolveProvider,
  chatCompletion,
  createCommentGenerator,
  PROVIDER_URLS,
  DEFAULT_MODELS,
} from '../../src/ai/commentGenerator.js';

/**
 * A fetch stand-in that answers like an OpenAI-compatible endpoint, so the
 * generator's loop can be exercised without a network or an API key. Each
 * call records the request it received.
 */
function fakeChatEndpoint(replies, { status = 200 } = {}) {
  const calls = [];
  let i = 0;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    const content = replies[Math.min(i, replies.length - 1)];
    i++;
    if (url.includes('anthropic')) {
      return { ok: status < 300, status, json: async () => ({ model: body.model, content: [{ type: 'text', text: content }] }), text: async () => content };
    }
    return { ok: status < 300, status, json: async () => ({ model: body.model, choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), text: async () => content };
  };
  return { fetchImpl, calls };
}

describe('commentGenerator', () => {
  describe('buildSystemPrompt', () => {
    it('embeds the brief and the hard rules', () => {
      const prompt = buildSystemPrompt({ prompt: 'be skeptical, ask one question' });
      expect(prompt).toContain('be skeptical, ask one question');
      expect(prompt).toContain('Under 280 characters');
      expect(prompt).toContain('Never open with "Great post"');
      expect(prompt).toContain('No hashtags.');
    });

    it('uses the persona line when given and relaxes hashtags when allowed', () => {
      const prompt = buildSystemPrompt({ prompt: 'x', persona: 'You are @nichxbt, a founder.', allowHashtags: true, allowEmoji: false });
      expect(prompt.startsWith('You are @nichxbt, a founder.')).toBe(true);
      expect(prompt).toContain('No hashtags unless the brief asks for them.');
      expect(prompt).toContain('- No emoji.');
    });
  });

  describe('buildUserPrompt', () => {
    it('includes author, text, quoted post, media note, and recent replies', () => {
      const text = buildUserPrompt(
        { text: 'Shipping v2 today', author: 'nasa', authorName: 'NASA', quotedText: 'v1 was slow', hasMedia: true },
        ['Nice ship.', 'Congrats on v1.'],
      );
      expect(text).toContain('Post by @nasa (NASA)');
      expect(text).toContain('Shipping v2 today');
      expect(text).toContain('It quotes this post:');
      expect(text).toContain('v1 was slow');
      expect(text).toContain('image or video attached');
      expect(text).toContain('- Nice ship.');
      expect(text).toContain('- Congrats on v1.');
    });

    it('only carries the last five recent replies', () => {
      const recent = Array.from({ length: 8 }, (_, i) => `reply ${i}`);
      const text = buildUserPrompt({ text: 'hi' }, recent);
      expect(text).not.toContain('reply 2');
      expect(text).toContain('reply 3');
      expect(text).toContain('reply 7');
    });
  });

  describe('sanitizeComment', () => {
    it('strips fences, labels, and wrapping quotes', () => {
      expect(sanitizeComment('```\n"Reply: This is the one."\n```')).toBe('This is the one.');
      expect(sanitizeComment('Reply: “Nice detail on the latency numbers.”')).toBe('Nice detail on the latency numbers.');
    });

    it('takes the first item when the model lists several', () => {
      expect(sanitizeComment('1. First option here\n2. Second option here')).toBe('First option here');
    });

    it('drops hashtags unless allowed', () => {
      expect(sanitizeComment('Solid launch #buildinpublic #ai')).toBe('Solid launch');
      expect(sanitizeComment('Solid launch #buildinpublic', { allowHashtags: true })).toBe('Solid launch #buildinpublic');
    });

    it('cuts at a sentence boundary when over the limit', () => {
      const long = `${'A sentence that is long enough to matter. '.repeat(10)}Tail`;
      const out = sanitizeComment(long);
      expect([...out].length).toBeLessThanOrEqual(280);
      expect(out.endsWith('.')).toBe(true);
    });

    it('returns empty for non-strings', () => {
      expect(sanitizeComment(null)).toBe('');
      expect(sanitizeComment(42)).toBe('');
    });
  });

  describe('isGenericComment', () => {
    it('flags boilerplate openers and empties', () => {
      expect(isGenericComment('Great post! Loved it.')).toBe(true);
      expect(isGenericComment('🔥 Love this')).toBe(true);
      expect(isGenericComment("Couldn't agree more.")).toBe(true);
      expect(isGenericComment('')).toBe(true);
    });

    it('passes specific replies', () => {
      expect(isGenericComment('The 40ms p99 number is the part I would lead with.')).toBe(false);
    });
  });

  describe('resolveProvider', () => {
    it('reads keys from the environment by provider', () => {
      const target = resolveProvider({ provider: 'xai' }, { XAI_API_KEY: 'xai-1' });
      expect(target).toEqual({ provider: 'xai', url: PROVIDER_URLS.xai, apiKey: 'xai-1', model: DEFAULT_MODELS.xai });
    });

    it('does not require a key for ollama', () => {
      const target = resolveProvider({ provider: 'ollama' }, {});
      expect(target.apiKey).toBe('');
      expect(target.url).toBe(PROVIDER_URLS.ollama);
    });

    it('throws a readable error when the key is missing', () => {
      expect(() => resolveProvider({ provider: 'anthropic' }, {})).toThrow(/ANTHROPIC_API_KEY/);
    });

    it('requires baseUrl and model for custom', () => {
      expect(() => resolveProvider({ provider: 'custom' }, {})).toThrow(/baseUrl/);
      expect(() => resolveProvider({ provider: 'custom', baseUrl: 'http://h/v1/chat/completions' }, {})).toThrow(/model/);
      const ok = resolveProvider({ provider: 'custom', baseUrl: 'http://h/v1/chat/completions', model: 'm' }, {});
      expect(ok.model).toBe('m');
    });

    it('rejects unknown providers', () => {
      expect(() => resolveProvider({ provider: 'bard' }, {})).toThrow(/Unknown LLM provider/);
    });
  });

  describe('chatCompletion', () => {
    it('sends OpenAI-shaped bodies with a bearer token', async () => {
      const { fetchImpl, calls } = fakeChatEndpoint(['hello']);
      const target = resolveProvider({ provider: 'openrouter', apiKey: 'k' }, {});
      const out = await chatCompletion(target, [{ role: 'user', content: 'hi' }], { fetchImpl });
      expect(out.text).toBe('hello');
      expect(calls[0].headers.Authorization).toBe('Bearer k');
      expect(calls[0].headers['HTTP-Referer']).toBe('https://xactions.app');
      expect(calls[0].body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('translates to the Anthropic Messages API', async () => {
      const { fetchImpl, calls } = fakeChatEndpoint(['from claude']);
      const target = resolveProvider({ provider: 'anthropic', apiKey: 'a' }, {});
      const out = await chatCompletion(target, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], { fetchImpl });
      expect(out.text).toBe('from claude');
      expect(calls[0].headers['x-api-key']).toBe('a');
      expect(calls[0].body.system).toBe('sys');
      expect(calls[0].body.messages).toEqual([{ role: 'user', content: 'hi' }]);
      expect(calls[0].body.max_tokens).toBe(160);
    });

    it('surfaces non-retryable HTTP errors with the body', async () => {
      const { fetchImpl } = fakeChatEndpoint(['bad key'], { status: 401 });
      const target = resolveProvider({ provider: 'openai', apiKey: 'k' }, {});
      await expect(chatCompletion(target, [{ role: 'user', content: 'hi' }], { fetchImpl, retries: 0 })).rejects.toThrow(/openai error 401: bad key/);
    });
  });

  describe('createCommentGenerator', () => {
    it('requires a prompt', () => {
      expect(() => createCommentGenerator({ provider: 'ollama' })).toThrow(/prompt/);
    });

    it('returns a sanitized reply and remembers it', async () => {
      const { fetchImpl, calls } = fakeChatEndpoint(['"The p99 drop from 900ms to 40ms is the headline. What changed in the hot path?"']);
      const gen = createCommentGenerator({ prompt: 'engineer, curious', provider: 'ollama', fetchImpl });
      const out = await gen.generate({ text: 'We cut p99 from 900ms to 40ms', author: 'nasa' });
      expect(out.text).toBe('The p99 drop from 900ms to 40ms is the headline. What changed in the hot path?');
      expect(out.attempts).toBe(1);
      expect(gen.history).toEqual([out.text]);
      expect(calls[0].body.messages[0].content).toContain('engineer, curious');
      expect(calls[0].body.messages[1].content).toContain('We cut p99 from 900ms to 40ms');
    });

    it('regenerates once when the first attempt is generic', async () => {
      const { fetchImpl, calls } = fakeChatEndpoint(['Great post! So true.', 'Cutting the cold start to 40ms changes what you can put behind a click.']);
      const gen = createCommentGenerator({ prompt: 'specific', provider: 'ollama', fetchImpl });
      const out = await gen.generate({ text: 'Cold start now 40ms' });
      expect(out.attempts).toBe(2);
      expect(out.text).toMatch(/^Cutting the cold start/);
      expect(calls[1].body.messages.at(-1).content).toMatch(/reads as generic/);
    });

    it('keeps a generic reply after two tries rather than skipping the post', async () => {
      const { fetchImpl } = fakeChatEndpoint(['Great post!', 'Love this.']);
      const gen = createCommentGenerator({ prompt: 'x', provider: 'ollama', fetchImpl });
      const out = await gen.generate({ text: 'hello' });
      expect(out.text).toBe('Love this.');
      expect(out.attempts).toBe(2);
    });

    it('feeds earlier replies back so phrasing varies', async () => {
      const { fetchImpl, calls } = fakeChatEndpoint(['The retry budget detail is the useful bit here.', 'Idempotency keys are doing the heavy lifting in this design.']);
      const gen = createCommentGenerator({ prompt: 'x', provider: 'ollama', fetchImpl });
      await gen.generate({ text: 'first post about retries' });
      await gen.generate({ text: 'second post about idempotency' });
      expect(calls[1].body.messages[1].content).toContain('- The retry budget detail is the useful bit here.');
    });
  });
});
