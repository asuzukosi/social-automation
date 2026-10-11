// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Streaming — barrel export
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

export {
  createStream,
  stopStream,
  stopAllStreams,
  pauseStream,
  resumeStream,
  updateStream,
  listStreams,
  getStreamHistory,
  getStreamStatus,
  getStreamStats,
  isHealthy,
  setIO,
  shutdown,
  attachLiveTransport,
  detachLiveTransport,
  STREAM_TYPES,
  TRANSPORTS,
  getPoolStatus,
} from './streamManager.js';

export {
  createLivePipeline,
  computeBackoffDelay,
  normalizeFrame,
  parseTopic,
  Topic,
  LivePipeline,
  LivePipelineError,
  LivePipelineAuthError,
  LIVE_EVENT_TYPES,
  LIVE_PIPELINE_EVENTS_URL,
  LIVE_PIPELINE_SUBSCRIPTIONS_URL,
  DEFAULT_RECONNECT,
} from './livePipeline.js';

export { pollTweets } from './tweetStream.js';
export { pollFollowers } from './followerStream.js';
export { pollMentions } from './mentionStream.js';

export {
  acquireBrowser,
  releaseBrowser,
  acquirePage,
  releasePage,
  closeAll as closeAllBrowsers,
  getPoolStatus as getBrowserPoolStatus,
  isHealthy as isBrowserPoolHealthy,
} from './browserPool.js';
