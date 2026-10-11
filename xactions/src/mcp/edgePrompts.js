// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Prompts the hosted MCP server offers.
 *
 * An MCP prompt is a user-invoked template: in Claude Code it shows up as a
 * slash command, in other clients as a menu entry. These exist so the tools do
 * not have to be discovered one at a time. Each one names the tools to call and
 * the shape of the answer, which is the difference between "here is some data"
 * and a finished piece of work.
 *
 * @module src/mcp/edgePrompts
 * @author nichxbt
 */

/**
 * @typedef {object} EdgePrompt
 * @property {string} name
 * @property {string} title
 * @property {string} description
 * @property {Array<{name: string, description: string, required?: boolean}>} arguments
 * @property {(args: Record<string, string>) => string} build
 */

/** @type {EdgePrompt[]} */
export const EDGE_PROMPTS = [
  {
    name: 'audit_account',
    title: 'Audit an X account',
    description: 'Profile, recent posting patterns, what lands and what does not, and three concrete changes.',
    arguments: [
      { name: 'handle', description: 'The account to audit, with or without the @.', required: true },
      { name: 'goal', description: 'What the account is trying to achieve. Optional but sharpens the advice.', required: false },
    ],
    build: ({ handle, goal }) => [
      `Audit the X account @${handle}.`,
      '',
      'Steps:',
      `1. Call x_profile for @${handle}.`,
      `2. Call x_posts for @${handle} with limit 50.`,
      '3. Work out the posting cadence, the median engagement, and which posts beat it by 3x or more.',
      '4. Name what the outliers have in common: format, hook, length, media, time of day.',
      '',
      goal ? `The account\'s goal: ${goal}. Judge everything against it.` : 'Infer the account\'s goal from the bio and the posts, and say what you inferred.',
      '',
      'Answer with: a two-line summary, a table of the five best posts and why they worked, and exactly three changes to make next week. Be specific enough to act on today. No generic advice.',
    ].join('\n'),
  },

  {
    name: 'read_thread',
    title: 'Read and summarise a thread',
    description: 'Pull a whole thread and turn it into a summary with the argument intact.',
    arguments: [
      { name: 'post', description: 'Any post URL or ID from the thread.', required: true },
    ],
    build: ({ post }) => [
      `Read the X thread containing ${post}.`,
      '',
      '1. Call x_thread with that post.',
      '2. If it reports truncation, say so in your answer rather than implying the thread ended.',
      '',
      'Then write: the thread\'s claim in one sentence, the supporting points in order, anything the author asserts without evidence, and a link to the root post. Keep the author\'s reasoning, drop the throat-clearing.',
    ].join('\n'),
  },

  {
    name: 'competitor_scan',
    title: 'Compare accounts',
    description: 'Put two or more accounts side by side on cadence, format and what actually performs.',
    arguments: [
      { name: 'handles', description: 'Comma-separated handles to compare.', required: true },
      { name: 'angle', description: 'What to compare them on. Defaults to content strategy.', required: false },
    ],
    build: ({ handles, angle }) => [
      `Compare these X accounts: ${handles}.`,
      '',
      'For each one, call x_profile, then x_posts with limit 30.',
      '',
      `Compare them on: ${angle || 'posting cadence, post formats, hook style, media use, and engagement per follower'}.`,
      '',
      'Answer with one table (a row per account), then the single sharpest difference between them, then what the weakest account should copy from the strongest. Use engagement per follower, not raw counts, so a bigger account does not win by default.',
    ].join('\n'),
  },

  {
    name: 'save_video',
    title: 'Get a video out of a post',
    description: 'Find every downloadable quality for a post that has a video or GIF.',
    arguments: [
      { name: 'post', description: 'The post URL or ID that contains the video.', required: true },
    ],
    build: ({ post }) => [
      `Get the downloadable video from ${post}.`,
      '',
      'Call x_video with that post. Report the available qualities with their resolutions, and give the download link for the best one. If the post has no video, say so plainly and call x_post to describe what it does contain.',
    ].join('\n'),
  },

  {
    name: 'automate_this',
    title: 'Build an XActions automation',
    description: 'Turn "I want to automate X" into working XActions code, grounded in the real docs.',
    arguments: [
      { name: 'task', description: 'What you want to automate on X.', required: true },
    ],
    build: ({ task }) => [
      `I want to automate this on X: ${task}`,
      '',
      '1. Call xactions_docs with that task to find the surface that already does it. XActions ships a CLI, a Node library, an MCP server, browser console scripts, and agent skills, so check before writing anything new.',
      '2. If more than one surface fits, say which to use and why, in one line.',
      '3. Give the exact command or code, copy-pasteable, with the real flag names from the docs.',
      '4. Name the rate limits and the failure mode, and how to resume after one.',
      '',
      'Cite the doc URLs the search returned. Do not invent a flag or a function that the docs did not show you.',
    ].join('\n'),
  },
];

/** @type {Map<string, EdgePrompt>} */
export const PROMPTS_BY_NAME = new Map(EDGE_PROMPTS.map((prompt) => [prompt.name, prompt]));

/**
 * Render a prompt into the message list `prompts/get` returns.
 * @param {EdgePrompt} prompt
 * @param {Record<string, string>} args
 * @returns {{ description: string, messages: Array<object> }}
 */
export function renderPrompt(prompt, args) {
  for (const argument of prompt.arguments) {
    if (argument.required && !String(args?.[argument.name] || '').trim()) {
      throw new Error(`Missing required argument: ${argument.name}`);
    }
  }
  return {
    description: prompt.description,
    messages: [{ role: 'user', content: { type: 'text', text: prompt.build(args || {}) } }],
  };
}
