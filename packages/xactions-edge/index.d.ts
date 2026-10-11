// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Type definitions for xactions-edge.
 * @author nichxbt
 */

export declare const DEFAULT_ENDPOINT: string;
export declare const PROTOCOL_VERSION: string;
export declare const CLIENT_NAME: string;
export declare const CLIENT_VERSION: string;

export interface ClientOptions {
  /** MCP endpoint. Defaults to https://xactions.app/mcp */
  endpoint?: string;
  /** Custom fetch implementation, for tests, proxies, or a runtime without a global. */
  fetch?: typeof fetch;
  /** Per-request timeout in milliseconds. Default 20000. */
  timeout?: number;
  /** Retries for timeouts, rate limits and 5xx. Default 2. */
  retries?: number;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
}

export interface CallOptions {
  signal?: AbortSignal;
  /** Return the full MCP result instead of just the structured output. */
  raw?: boolean;
}

export interface Author {
  id: string | null;
  username: string | null;
  name: string | null;
  avatar: string | null;
  verified: boolean;
  verifiedType: string | null;
}

export interface PostMetrics {
  likes: number;
  reposts: number;
  replies: number;
  quotes: number;
  bookmarks: number;
  views: number;
}

export interface VideoVariant {
  url: string;
  quality: string;
  width: number;
  height: number;
  bitrate: number;
  /** A link that streams the file through xactions.app with a real filename. */
  downloadUrl?: string;
}

export interface Media {
  type: 'photo' | 'video' | 'gif';
  url: string | null;
  width: number;
  height: number;
  altText: string | null;
  thumbnail?: string | null;
  durationMs?: number | null;
  variants?: VideoVariant[];
}

export interface PostEntities {
  hashtags: string[];
  symbols: string[];
  mentions: string[];
  urls: Array<{ url: string; expanded: string; display: string }>;
}

export interface Post {
  id: string;
  url: string;
  createdAt: string | null;
  lang: string | null;
  text: string;
  author: Author;
  metrics: PostMetrics;
  media: Media[];
  entities: PostEntities;
  conversationId: string | null;
  replyTo: { id: string; username: string | null } | null;
  quoted: Post | null;
  possiblySensitive: boolean;
  source: 'graphql' | 'syndication';
}

export interface TimelinePost {
  id: string;
  url: string;
  createdAt: string | null;
  text: string;
  metrics: Pick<PostMetrics, 'likes' | 'reposts' | 'replies' | 'views'>;
  isReply: boolean;
  media: Media[];
}

export interface Profile {
  id: string;
  username: string;
  name: string;
  description?: string;
  location?: string;
  website?: string;
  followers: number;
  following: number;
  tweets: number;
  createdAt?: string;
  verified?: boolean;
  avatar?: string;
  banner?: string;
  pinnedTweetId?: string | null;
}

export interface Thread {
  focal: Post;
  posts: Post[];
  author: Author;
  /** True when the thread continues past what the public timeline exposes. */
  truncated: boolean;
}

export interface VideoResult {
  videos: VideoVariant[];
  thumbnail: string | null;
  duration: number | null;
  author: string;
  username: string;
  tweetId: string;
  text: string | null;
  source: string;
}

export interface DocResult {
  title: string;
  url: string;
  text: string;
}

export interface ToolDescriptor {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
}

export interface PromptDescriptor {
  name: string;
  title: string;
  description: string;
  arguments: Array<{ name: string; description: string; required?: boolean }>;
}

export interface ResourceDescriptor {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
}

export interface ServerInfo {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: { name: string; title?: string; version: string };
  instructions?: string;
}

export declare class XActionsError extends Error {
  readonly name: 'XActionsError';
  /** JSON-RPC error code, or null when the tool itself reported the failure. */
  readonly code: number | null;
  readonly tool: string | null;
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(
    message: string,
    details?: { code?: number | null; tool?: string | null; status?: number | null; retryable?: boolean },
  );
}

export interface PaymentTerms {
  scheme: string;
  network: string;
  amount?: string;
  maxAmountRequired?: string;
  asset: string;
  payTo: string;
  resource: string;
  description?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

/**
 * Thrown by a tool that costs money. Everything needed to settle over x402 is
 * on the error.
 */
export declare class PaymentRequiredError extends XActionsError {
  readonly name: 'PaymentRequiredError';
  /** Display price, e.g. `"$0.001"`. */
  readonly price: string;
  /** Price as a number, in `currency` units. */
  readonly amount: number;
  readonly currency: 'USDC';
  /** CAIP-2 network identifiers the server accepts. */
  readonly networks: string[];
  /** Human names for those networks, e.g. `["Solana", "Base"]`. */
  readonly chains: string[];
  /** The raw x402 `accepts` array, for a payment client to sign against. */
  readonly accepts: PaymentTerms[];
  readonly resource: string | null;
  constructor(tool: string, payload: Record<string, unknown>);
}

export declare class McpClient {
  constructor(options?: ClientOptions);
  readonly endpoint: string;
  serverInfo: ServerInfo | null;
  request<T = unknown>(method: string, params?: Record<string, unknown>, options?: CallOptions): Promise<T>;
  notify(method: string, params?: Record<string, unknown>): Promise<void>;
  initialize(): Promise<ServerInfo>;
  listTools(options?: CallOptions): Promise<ToolDescriptor[]>;
  call<T = unknown>(name: string, args?: Record<string, unknown>, options?: CallOptions): Promise<T>;
  listPrompts(options?: CallOptions): Promise<PromptDescriptor[]>;
  getPrompt(
    name: string,
    args?: Record<string, string>,
    options?: CallOptions,
  ): Promise<{ description: string; messages: Array<{ role: string; content: { type: string; text: string } }> }>;
  listResources(options?: CallOptions): Promise<ResourceDescriptor[]>;
  readResource(uri: string, options?: CallOptions): Promise<string>;
}

export declare class XActions {
  constructor(options?: ClientOptions);
  readonly mcp: McpClient;
  profile(handle: string, options?: CallOptions): Promise<Profile>;
  posts(handle: string, params?: { limit?: number }, options?: CallOptions): Promise<TimelinePost[]>;
  post(post: string, options?: CallOptions): Promise<Post>;
  thread(post: string, params?: { limit?: number }, options?: CallOptions): Promise<Thread>;
  video(post: string, options?: CallOptions): Promise<VideoResult>;
  videoUrl(post: string, options?: CallOptions): Promise<string>;
  docs(query: string, params?: { limit?: number }, options?: CallOptions): Promise<DocResult[]>;
  tools(options?: CallOptions): Promise<ToolDescriptor[]>;
  info(): Promise<ServerInfo>;
  /** What each tool costs. Free tools report `null`. */
  prices(): Promise<Record<string, string | null>>;
}

export declare function createClient(options?: ClientOptions): XActions;
export default createClient;
