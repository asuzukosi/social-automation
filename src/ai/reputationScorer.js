// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions AI - Reputation Scorer
 *
 * Scores a post against configurable risk dimensions with one LLM call per
 * post, then rolls the results into a report: an overall score, a letter
 * grade, and the posts worth a second look. This is the engine behind
 * `scripts/reputationAudit.js` (the browser scan and shareable report card),
 * `POST /api/ai/reputation/score`, and `xactions reputation`.
 *
 * It reuses the provider resolution and chat-completion plumbing from
 * commentGenerator.js rather than re-implementing it: any OpenAI-compatible
 * endpoint works (OpenRouter, OpenAI, xAI, Ollama, a custom URL), plus
 * Anthropic natively.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import { resolveProvider, chatCompletion } from './commentGenerator.js';

/**
 * Built-in risk dimensions. Each is scored 0 (no risk) to 100 (high risk) by
 * the model in a single call, so a five-dimension scan costs the same one
 * request per post as a one-dimension scan.
 */
export const DIMENSIONS = Object.freeze({
  professional: {
    label: 'Professional',
    emoji: '💼',
    question: 'Would this embarrass the author in front of a current or future employer, client, or business partner?',
  },
  hostile: {
    label: 'Hostile',
    emoji: '⚔️',
    question: 'Is this hostile, harassing, or likely to read as a personal attack on someone named or clearly identifiable in it?',
  },
  legal: {
    label: 'Legal exposure',
    emoji: '⚖️',
    question: 'Could this create legal exposure: defamation, doxxing, a threat, leaked confidential information, or a promise the author cannot keep?',
  },
  spam: {
    label: 'Low value',
    emoji: '🗑️',
    question: 'Is this low-effort spam, an engagement-bait template, or filler that adds nothing and flatters no one either?',
  },
});

/** Overall score at or above this is worth removing outright. */
export const FLAG_THRESHOLD = 70;
/** Overall score at or above this, below FLAG_THRESHOLD, is worth a human look. */
export const REVIEW_THRESHOLD = 40;

const clampScore = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

/**
 * The dimensions to score for a given config: the built-ins the caller asked
 * for (default: all of them), plus one optional custom question.
 *
 * @param {{ dimensions?: string[], customQuestion?: string }} [opts]
 * @returns {Array<{ key: string, label: string, question: string }>}
 */
export function resolveDimensions({ dimensions, customQuestion } = {}) {
  const keys = Array.isArray(dimensions) && dimensions.length ? dimensions : Object.keys(DIMENSIONS);
  const resolved = keys
    .filter((k) => DIMENSIONS[k])
    .map((k) => ({ key: k, label: DIMENSIONS[k].label, question: DIMENSIONS[k].question }));
  if (customQuestion && customQuestion.trim()) {
    resolved.push({ key: 'custom', label: 'Custom', question: customQuestion.trim() });
  }
  if (resolved.length === 0) {
    throw new Error('resolveDimensions: no valid dimensions. Use one of: ' + Object.keys(DIMENSIONS).join(', '));
  }
  return resolved;
}

/**
 * Build the system prompt: the rubric, and a strict JSON output contract so
 * the response parses without a second round trip.
 *
 * @param {{ dimensions?: string[], customQuestion?: string }} [opts]
 * @returns {string}
 */
export function buildRiskSystemPrompt(opts = {}) {
  const dims = resolveDimensions(opts);
  const schema = dims.map((d) => `    "${d.key}": { "score": <0-100 integer>, "reason": "<one short clause, under 15 words>" }`).join(',\n');
  return [
    'You are a careful, unsentimental reviewer scoring a single social media post for risk before its author decides whether to keep it public.',
    '',
    'Score each dimension below from 0 (no risk at all) to 100 (severe, obvious risk). Judge the post as written, not the author\'s intent. A post with no signal for a dimension scores near 0 on it, not a defensive middle value.',
    '',
    'Dimensions:',
    ...dims.map((d) => `- ${d.key}: ${d.question}`),
    '',
    'Respond with ONLY a single JSON object, no markdown fences, no commentary, in exactly this shape:',
    '{',
    schema,
    '}',
    '',
    'Every dimension key above must appear. Scores are integers. Reasons are short and specific to this post, never generic ("could be seen negatively" is not acceptable, name what is actually risky).',
  ].join('\n');
}

/**
 * Build the per-post user message.
 *
 * @param {{ text: string, author?: string, authorName?: string, quotedText?: string, hasMedia?: boolean, isReply?: boolean }} post
 * @returns {string}
 */
export function buildRiskUserPrompt(post) {
  if (!post || !post.text) throw new Error('buildRiskUserPrompt: post.text is required');
  const parts = [`Post${post.isReply ? ' (a reply)' : ''} by @${post.author || 'the account owner'}:`, `"""${post.text.trim()}"""`];
  if (post.quotedText) parts.push('', 'It quotes:', `"""${post.quotedText.trim()}"""`);
  if (post.hasMedia) parts.push('', '(It also has an image or video attached that you cannot see. Score the text only.)');
  parts.push('', 'Score it now, as JSON only.');
  return parts.join('\n');
}

/**
 * Extract the JSON object from a completion. Models occasionally wrap the
 * object in a code fence or add a stray sentence before or after it; this
 * takes the first balanced `{...}` block rather than assuming the whole
 * response is clean JSON.
 *
 * @param {string} raw
 * @returns {object}
 */
function extractJsonObject(raw) {
  const text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`No JSON object found in the model's response: "${text.slice(0, 120)}"`);
    }
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

/**
 * Parse a raw completion into a validated per-dimension score, clamp every
 * number into 0..100, and compute the overall verdict.
 *
 * The overall score is the MAX across dimensions, not the average: one
 * dimension at 95 and three at 0 is still a post worth flagging, and
 * averaging would wash that out to 24.
 *
 * @param {string} raw
 * @param {Array<{ key: string, label: string }>} dims
 * @returns {{ dimensions: Record<string, {score:number, reason:string}>, overall: number, verdict: 'clean'|'review'|'flagged', worstDimension: string }}
 */
export function parseRiskResponse(raw, dims) {
  const parsed = extractJsonObject(raw);
  const dimensions = {};
  for (const { key, label } of dims) {
    const entry = parsed[key];
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Model response is missing dimension "${key}" (${label})`);
    }
    dimensions[key] = {
      score: clampScore(entry.score),
      reason: String(entry.reason || '').trim().slice(0, 200),
    };
  }
  let worstDimension = dims[0].key;
  let overall = 0;
  for (const [key, { score }] of Object.entries(dimensions)) {
    if (score > overall) { overall = score; worstDimension = key; }
  }
  const verdict = overall >= FLAG_THRESHOLD ? 'flagged' : overall >= REVIEW_THRESHOLD ? 'review' : 'clean';
  return { dimensions, overall, verdict, worstDimension };
}

/**
 * Score one post.
 *
 * @param {{ id?: string, text: string, author?: string, authorName?: string, quotedText?: string, hasMedia?: boolean, isReply?: boolean }} post
 * @param {object} [config] - Same shape as commentGenerator's provider config (provider, apiKey, baseUrl, model, fetchImpl, retries), plus:
 * @param {string[]} [config.dimensions] - Subset of DIMENSIONS keys. Default: all.
 * @param {string} [config.customQuestion] - An extra rubric line specific to this scan.
 * @returns {Promise<{ postId: string, dimensions: object, overall: number, verdict: string, worstDimension: string, model: string }>}
 */
export async function scorePost(post, config = {}) {
  const target = resolveProvider(config);
  const dims = resolveDimensions(config);
  const messages = [
    { role: 'system', content: buildRiskSystemPrompt(config) },
    { role: 'user', content: buildRiskUserPrompt(post) },
  ];
  const { text, model } = await chatCompletion(target, messages, {
    temperature: 0,
    maxTokens: 60 * dims.length + 80,
    fetchImpl: config.fetchImpl,
    retries: config.retries,
  });
  const result = parseRiskResponse(text, dims);
  return { postId: post.id ?? null, ...result, model };
}

/**
 * Score many posts with bounded concurrency. A failure on one post never
 * aborts the batch; it comes back as `{ postId, error }` so the caller can
 * report it against that one post instead of losing the whole scan.
 *
 * @param {Array<object>} posts - Same shape scorePost takes, one per post.
 * @param {object} [config] - Same as scorePost, plus:
 * @param {number} [config.concurrency=4] - Parallel requests in flight, capped at 8.
 * @param {(done: number, total: number, result: object) => void} [config.onProgress]
 * @returns {Promise<Array<object>>} One result per post, same order as input.
 */
export async function scorePosts(posts, config = {}) {
  if (!Array.isArray(posts) || posts.length === 0) return [];
  const concurrency = Math.max(1, Math.min(config.concurrency || 4, 8, posts.length));
  const results = new Array(posts.length);
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < posts.length) {
      const i = cursor++;
      try {
        results[i] = await scorePost(posts[i], config);
      } catch (err) {
        results[i] = { postId: posts[i]?.id ?? null, error: err.message };
      }
      done++;
      if (config.onProgress) config.onProgress(done, posts.length, results[i]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

/**
 * Convert a 0..100 risk score (where 0 is safest) to a reputation grade
 * letter. The reputation score shown to the user is the inverse (100 -
 * risk), so a clean account reads as a high, encouraging number.
 *
 * @param {number} reputationScore - 0..100, higher is better
 * @returns {string} One of A+, A, B, C, D, F
 */
export function scoreToGrade(reputationScore) {
  const s = clampScore(reputationScore);
  if (s >= 97) return 'A+';
  if (s >= 90) return 'A';
  if (s >= 80) return 'B';
  if (s >= 65) return 'C';
  if (s >= 45) return 'D';
  return 'F';
}

/**
 * Roll a batch of scored posts into a report: an overall reputation score,
 * a letter grade, per-dimension averages, and the posts most worth acting on.
 *
 * @param {Array<object>} posts - The original posts, same order as `scores`.
 * @param {Array<object>} scores - scorePosts() output, same order as `posts`.
 * @param {number} [topN=10] - How many flagged/review posts to surface.
 * @returns {{
 *   scanned: number, scoredOk: number, errors: number,
 *   reputationScore: number, grade: string,
 *   verdictCounts: { clean: number, review: number, flagged: number },
 *   dimensionAverages: Record<string, number>,
 *   dimensionPeaks: Record<string, number>,
 *   worstPosts: Array<{ post: object, score: object }>,
 * }}
 */
export function summarizeReport(posts, scores, topN = 10) {
  const paired = posts.map((post, i) => ({ post, score: scores[i] })).filter((p) => p.score && !p.score.error);
  const errors = scores.filter((s) => s && s.error).length;

  if (paired.length === 0) {
    return {
      scanned: posts.length, scoredOk: 0, errors,
      reputationScore: 100, grade: 'A+',
      verdictCounts: { clean: 0, review: 0, flagged: 0 },
      dimensionAverages: {},
      dimensionPeaks: {},
      worstPosts: [],
    };
  }

  const verdictCounts = { clean: 0, review: 0, flagged: 0 };
  const dimensionTotals = {};
  const dimensionCounts = {};
  const dimensionPeaks = {};
  let riskTotal = 0;

  for (const { score } of paired) {
    verdictCounts[score.verdict] = (verdictCounts[score.verdict] || 0) + 1;
    riskTotal += score.overall;
    for (const [key, { score: dScore }] of Object.entries(score.dimensions)) {
      dimensionTotals[key] = (dimensionTotals[key] || 0) + dScore;
      dimensionCounts[key] = (dimensionCounts[key] || 0) + 1;
      dimensionPeaks[key] = Math.max(dimensionPeaks[key] || 0, dScore);
    }
  }

  // Averages alone hide the thing the report exists to surface: one post at 92
  // among four clean ones averages to 18, which reads green next to an F grade.
  // Peaks are reported alongside so a caller can colour by the worst case.
  const dimensionAverages = {};
  for (const key of Object.keys(dimensionTotals)) {
    dimensionAverages[key] = Math.round(dimensionTotals[key] / dimensionCounts[key]);
  }

  // Reputation score weights the average risk (typical post) against the
  // worst single post, so one severe outlier still pulls the grade down even
  // when everything else the account posted is clean.
  const avgRisk = riskTotal / paired.length;
  const worstRisk = Math.max(...paired.map((p) => p.score.overall));
  const blendedRisk = avgRisk * 0.6 + worstRisk * 0.4;
  const reputationScore = clampScore(100 - blendedRisk);

  const worstPosts = [...paired]
    .sort((a, b) => b.score.overall - a.score.overall)
    .filter((p) => p.score.overall >= REVIEW_THRESHOLD)
    .slice(0, topN);

  return {
    scanned: posts.length,
    scoredOk: paired.length,
    errors,
    reputationScore,
    grade: scoreToGrade(reputationScore),
    verdictCounts,
    dimensionAverages,
    dimensionPeaks,
    worstPosts,
  };
}
