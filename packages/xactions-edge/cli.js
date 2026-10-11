#!/usr/bin/env node
// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * xactions-edge CLI: public X reads in one command, no install, no key.
 *
 *   npx xactions-edge profile nasa
 *   npx xactions-edge posts nasa --limit 5
 *   npx xactions-edge post https://x.com/SpaceX/status/123
 *   npx xactions-edge thread https://x.com/SpaceX/status/123
 *   npx xactions-edge video https://x.com/SpaceX/status/123 --save clip.mp4
 *   npx xactions-edge docs "how do I unfollow everyone"
 *   npx xactions-edge tools
 *
 * Add --json to any command for the raw object.
 *
 * @author nichxbt
 */

import { createClient, XActionsError } from './index.js';

const COMMANDS = ['profile', 'posts', 'post', 'thread', 'video', 'docs', 'tools'];

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      const next = argv[i + 1];
      if (inline !== undefined) flags[key] = inline;
      else if (next && !next.startsWith('--')) { flags[key] = next; i += 1; }
      else flags[key] = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function usage() {
  console.log(`xactions-edge - public X/Twitter reads, no API key

Usage:
  npx xactions-edge <command> <target> [options]

Commands:
  profile <handle>          Public profile
  posts   <handle>          Recent posts        [--limit 20]
  post    <url|id>          One post in full
  thread  <url|id>          The whole thread    [--limit 25]
  video   <url|id>          Downloadable MP4s   [--save <file>]
  docs    <question>        Search the XActions docs [--limit 6]
  tools                     List the server's MCP tools

Options:
  --json                    Print raw JSON
  --endpoint <url>          Point at another XActions edge (default https://xactions.app/mcp)

Every command reads public data only. Nothing here posts, follows, or logs in.`);
}

function compact(n) {
  const value = Number(n) || 0;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;
  const target = rest.join(' ');

  if (!command || flags.help || !COMMANDS.includes(command)) {
    usage();
    process.exit(command && !COMMANDS.includes(command) ? 1 : 0);
  }

  const client = createClient(flags.endpoint ? { endpoint: flags.endpoint } : {});
  const limit = flags.limit ? Number(flags.limit) : undefined;
  const print = (value) => console.log(JSON.stringify(value, null, 2));

  switch (command) {
    case 'profile': {
      const profile = await client.profile(target);
      if (flags.json) return print(profile);
      console.log(`@${profile.username} - ${profile.name}`);
      if (profile.description) console.log(profile.description);
      console.log(`${compact(profile.followers)} followers | ${compact(profile.following)} following | ${compact(profile.tweets)} posts`);
      return console.log(`https://x.com/${profile.username}`);
    }
    case 'posts': {
      const posts = await client.posts(target, { limit });
      if (flags.json) return print(posts);
      for (const post of posts) {
        console.log(`\n${post.createdAt?.slice(0, 10) || ''}  ${compact(post.metrics.likes)} likes`);
        console.log(post.text.replace(/\s+/g, ' ').trim());
        console.log(post.url);
      }
      return;
    }
    case 'post': {
      const post = await client.post(target);
      if (flags.json) return print(post);
      console.log(`@${post.author.username} (${post.author.name})  ${post.createdAt?.slice(0, 10) || ''}\n`);
      console.log(post.text);
      console.log(`\n${compact(post.metrics.likes)} likes | ${compact(post.metrics.reposts)} reposts | ${compact(post.metrics.replies)} replies | ${compact(post.metrics.views)} views`);
      return console.log(post.url);
    }
    case 'thread': {
      const thread = await client.thread(target, { limit });
      if (flags.json) return print(thread);
      console.log(`Thread by @${thread.author.username}, ${thread.posts.length} posts\n`);
      thread.posts.forEach((post, index) => {
        console.log(`${index + 1}/${thread.posts.length}  ${post.text.replace(/\s+/g, ' ').trim()}`);
      });
      if (thread.truncated) console.log('\n(truncated: the thread continues past the public timeline)');
      return;
    }
    case 'video': {
      const result = await client.video(target);
      if (flags.json && !flags.save) return print(result);
      for (const video of result.videos) {
        console.log(`${video.quality.padEnd(6)} ${video.width}x${video.height}  ${video.downloadUrl || video.url}`);
      }
      if (flags.save) {
        const url = result.videos[0].downloadUrl || result.videos[0].url;
        const response = await fetch(url);
        if (!response.ok) throw new XActionsError(`download failed: HTTP ${response.status}`);
        const { writeFile } = await import('node:fs/promises');
        await writeFile(flags.save, Buffer.from(await response.arrayBuffer()));
        console.log(`\n✅ saved ${flags.save}`);
      }
      return;
    }
    case 'docs': {
      const results = await client.docs(target, { limit });
      if (flags.json) return print(results);
      for (const source of results) {
        console.log(`\n${source.title}\n${source.url}\n${source.text.trim()}`);
      }
      return;
    }
    case 'tools': {
      const tools = await client.tools();
      if (flags.json) return print(tools);
      for (const tool of tools) {
        console.log(`${tool.name.padEnd(16)} ${tool.title}`);
      }
      return;
    }
    default:
      usage();
  }
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
