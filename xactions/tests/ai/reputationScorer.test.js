// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — Reputation scorer tests
// by nichxbt

import { describe, it, expect } from 'vitest';
import {
  DIMENSIONS,
  resolveDimensions,
  buildRiskSystemPrompt,
  buildRiskUserPrompt,
  parseRiskResponse,
  scorePost,
  scorePosts,
  scoreToGrade,
  summarizeReport,
  FLAG_THRESHOLD,
  REVIEW_THRESHOLD,
} from '../../src/ai/reputationScorer.js';

/** A fetch stand-in that answers with a fixed JSON verdict per call. */
function fakeScoringEndpoint(replies) {
  const calls = [];
  let i = 0;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const content = replies[Math.min(i, replies.length - 1)];
    i++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ model: body.model, choices: [{ message: { content } }] }),
      text: async () => content,
    };
  };
  return { fetchImpl, calls };
}

const CLEAN_JSON = JSON.stringify({
  professional: { score: 5, reason: 'ordinary work update' },
  hostile: { score: 0, reason: 'no targets' },
  legal: { score: 0, reason: 'no claims made' },
  spam: { score: 10, reason: 'plain announcement' },
});

const FLAGGED_JSON = JSON.stringify({
  professional: { score: 92, reason: 'insults a named coworker by title' },
  hostile: { score: 88, reason: 'direct personal attack' },
  legal: { score: 20, reason: 'no explicit threat' },
  spam: { score: 0, reason: 'not spam' },
});

describe('reputationScorer', () => {
  describe('resolveDimensions', () => {
    it('defaults to every built-in dimension', () => {
      const dims = resolveDimensions();
      expect(dims.map((d) => d.key).sort()).toEqual(Object.keys(DIMENSIONS).sort());
    });

    it('filters to the requested subset and appends a custom question', () => {
      const dims = resolveDimensions({ dimensions: ['hostile'], customQuestion: 'Does this reveal a home address?' });
      expect(dims.map((d) => d.key)).toEqual(['hostile', 'custom']);
      expect(dims[1].question).toContain('home address');
    });

    it('throws when nothing valid is left', () => {
      expect(() => resolveDimensions({ dimensions: ['not-a-real-one'] })).toThrow(/no valid dimensions/i);
    });
  });

  describe('buildRiskSystemPrompt', () => {
    it('lists every requested dimension and demands strict JSON', () => {
      const prompt = buildRiskSystemPrompt({ dimensions: ['professional', 'spam'] });
      expect(prompt).toContain('professional:');
      expect(prompt).toContain('spam:');
      expect(prompt).not.toContain('hostile:');
      expect(prompt).toContain('"professional": { "score"');
      expect(prompt).toContain('ONLY a single JSON object');
    });
  });

  describe('buildRiskUserPrompt', () => {
    it('requires text and includes author, quote, and media notes', () => {
      expect(() => buildRiskUserPrompt({})).toThrow(/text is required/);
      const prompt = buildRiskUserPrompt({
        text: 'Ship it', author: 'nasa', quotedText: 'v1 was slow', hasMedia: true, isReply: true,
      });
      expect(prompt).toContain('(a reply)');
      expect(prompt).toContain('@nasa');
      expect(prompt).toContain('Ship it');
      expect(prompt).toContain('v1 was slow');
      expect(prompt).toContain('cannot see');
    });
  });

  describe('parseRiskResponse', () => {
    const dims = resolveDimensions();

    it('parses a clean JSON verdict and computes overall/verdict from the worst dimension', () => {
      const result = parseRiskResponse(FLAGGED_JSON, dims);
      expect(result.overall).toBe(92);
      expect(result.worstDimension).toBe('professional');
      expect(result.verdict).toBe('flagged');
      expect(result.dimensions.hostile.score).toBe(88);
    });

    it('classifies below FLAG_THRESHOLD but above REVIEW_THRESHOLD as review', () => {
      const midJson = JSON.stringify({
        professional: { score: 50, reason: 'borderline' },
        hostile: { score: 0, reason: '' },
        legal: { score: 0, reason: '' },
        spam: { score: 0, reason: '' },
      });
      expect(parseRiskResponse(midJson, dims).verdict).toBe('review');
      expect(REVIEW_THRESHOLD).toBeLessThan(FLAG_THRESHOLD);
    });

    it('classifies a clean post as clean', () => {
      expect(parseRiskResponse(CLEAN_JSON, dims).verdict).toBe('clean');
    });

    it('unwraps a markdown code fence around the JSON', () => {
      const fenced = '```json\n' + CLEAN_JSON + '\n```';
      expect(parseRiskResponse(fenced, dims).verdict).toBe('clean');
    });

    it('extracts the JSON object even with stray commentary around it', () => {
      const noisy = `Here is my analysis:\n${CLEAN_JSON}\nHope that helps!`;
      expect(parseRiskResponse(noisy, dims).verdict).toBe('clean');
    });

    it('clamps out-of-range scores into 0..100', () => {
      const wild = JSON.stringify({
        professional: { score: 500, reason: 'x' },
        hostile: { score: -20, reason: 'x' },
        legal: { score: 0, reason: 'x' },
        spam: { score: 0, reason: 'x' },
      });
      const result = parseRiskResponse(wild, dims);
      expect(result.dimensions.professional.score).toBe(100);
      expect(result.dimensions.hostile.score).toBe(0);
    });

    it('throws a clear error when a dimension is missing from the response', () => {
      const incomplete = JSON.stringify({ professional: { score: 5, reason: 'x' } });
      expect(() => parseRiskResponse(incomplete, dims)).toThrow(/missing dimension/i);
    });

    it('throws a clear error when nothing resembling JSON is returned', () => {
      expect(() => parseRiskResponse('I refuse to answer that.', dims)).toThrow(/No JSON object found/i);
    });
  });

  describe('scoreToGrade', () => {
    it.each([[100, 'A+'], [97, 'A+'], [90, 'A'], [80, 'B'], [65, 'C'], [45, 'D'], [0, 'F']])(
      'maps %i to %s',
      (score, grade) => expect(scoreToGrade(score)).toBe(grade),
    );
  });

  describe('scorePost', () => {
    it('scores one post against xAI and returns a full verdict', async () => {
      const { fetchImpl, calls } = fakeScoringEndpoint([FLAGGED_JSON]);
      const result = await scorePost(
        { id: '123', text: 'Fire that idiot from accounting, they ruined the launch' },
        { provider: 'xai', apiKey: 'test-key', fetchImpl },
      );
      expect(result.postId).toBe('123');
      expect(result.verdict).toBe('flagged');
      expect(result.overall).toBe(92);
      expect(calls[0].url).toContain('api.x.ai');
      expect(calls[0].body.temperature).toBe(0);
    });
  });

  describe('scorePosts', () => {
    it('scores a batch, preserves input order, and reports one error without losing the rest', async () => {
      let call = 0;
      const fetchImpl = async (url, init) => {
        call++;
        const body = JSON.parse(init.body);
        if (call === 2) return { ok: false, status: 500, text: async () => 'boom' };
        const content = call === 1 ? CLEAN_JSON : FLAGGED_JSON;
        return { ok: true, status: 200, json: async () => ({ model: body.model, choices: [{ message: { content } }] }) };
      };
      const posts = [
        { id: 'a', text: 'Had a great time at the conference today' },
        { id: 'b', text: 'This one will fail' },
        { id: 'c', text: 'Fire that idiot from accounting' },
      ];
      const progress = [];
      const results = await scorePosts(posts, {
        provider: 'xai', apiKey: 'k', fetchImpl, concurrency: 1, retries: 0,
        onProgress: (done, total) => progress.push([done, total]),
      });
      expect(results).toHaveLength(3);
      expect(results[0].postId).toBe('a');
      expect(results[0].verdict).toBe('clean');
      expect(results[1].error).toBeTruthy();
      expect(results[2].verdict).toBe('flagged');
      expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    });

    it('returns an empty array for an empty input without making a request', async () => {
      const { fetchImpl, calls } = fakeScoringEndpoint([CLEAN_JSON]);
      expect(await scorePosts([], { provider: 'xai', apiKey: 'k', fetchImpl })).toEqual([]);
      expect(calls).toHaveLength(0);
    });
  });

  describe('summarizeReport', () => {
    it('builds a full report: grade, verdict counts, dimension averages, and worst posts', () => {
      const posts = [
        { id: 'a', text: 'clean post' },
        { id: 'b', text: 'flagged post' },
      ];
      const scores = [
        { postId: 'a', ...parseRiskResponse(CLEAN_JSON, resolveDimensions()) },
        { postId: 'b', ...parseRiskResponse(FLAGGED_JSON, resolveDimensions()) },
      ];
      const report = summarizeReport(posts, scores);
      expect(report.scanned).toBe(2);
      expect(report.scoredOk).toBe(2);
      expect(report.errors).toBe(0);
      expect(report.verdictCounts).toEqual({ clean: 1, review: 0, flagged: 1 });
      expect(report.worstPosts).toHaveLength(1);
      expect(report.worstPosts[0].post.id).toBe('b');
      // One severe outlier should pull the grade down even though the average is moderate.
      expect(report.reputationScore).toBeLessThan(80);
      expect(['B', 'C', 'D', 'F']).toContain(report.grade);
    });

    it('reports the peak per dimension, not only the average, so one bad post cannot hide', () => {
      const posts = [{ id: 'a', text: 'clean' }, { id: 'b', text: 'flagged' }];
      const scores = [
        { postId: 'a', ...parseRiskResponse(CLEAN_JSON, resolveDimensions()) },
        { postId: 'b', ...parseRiskResponse(FLAGGED_JSON, resolveDimensions()) },
      ];
      const report = summarizeReport(posts, scores);
      // professional: 5 and 92. The average alone reads as a low-risk green bar.
      expect(report.dimensionAverages.professional).toBe(49);
      expect(report.dimensionPeaks.professional).toBe(92);
      expect(report.dimensionPeaks.hostile).toBe(88);
      expect(report.dimensionPeaks.spam).toBe(10);
      // Every averaged dimension has a peak, and no peak is below its average.
      for (const [key, avg] of Object.entries(report.dimensionAverages)) {
        expect(report.dimensionPeaks[key]).toBeGreaterThanOrEqual(avg);
      }
    });

    it('excludes errored posts from the averages but still counts them', () => {
      const posts = [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }];
      const scores = [
        { postId: 'a', ...parseRiskResponse(CLEAN_JSON, resolveDimensions()) },
        { postId: 'b', error: 'provider timed out' },
      ];
      const report = summarizeReport(posts, scores);
      expect(report.scanned).toBe(2);
      expect(report.scoredOk).toBe(1);
      expect(report.errors).toBe(1);
      expect(report.reputationScore).toBeGreaterThan(80);
    });

    it('defaults to a perfect score when nothing scored successfully', () => {
      const report = summarizeReport([{ id: 'a', text: 'x' }], [{ postId: 'a', error: 'down' }]);
      expect(report.reputationScore).toBe(100);
      expect(report.grade).toBe('A+');
      expect(report.worstPosts).toEqual([]);
      expect(report.dimensionPeaks).toEqual({});
    });
  });
});
