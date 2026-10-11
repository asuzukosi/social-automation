// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

import { EventEmitter } from 'events'
import type { Page } from 'puppeteer'
import type { AuthConfig, BrowserConfig } from '../types'
import { BrowserManager } from './launcher'
import { login } from './auth'
import * as spaceUI from './space-ui'
import type { SpaceUIOptions } from './space-ui'
import { injectAudioHooks } from '../audio/bridge'
import { SelectorEngine } from './selector-engine'
import { DOMObserver } from './observer'
import { SELECTOR_DEFINITIONS } from './selectors'
import { BrowserConnectionError } from '../errors'
import { getLogger } from '../logger'

export interface BrowserLifecycleEvents {
  status: (status: string) => void
  error: (error: Error) => void
}

export class BrowserLifecycle {
  private browserManager: BrowserManager | null = null
  private page: Page | null = null
  private readonly browserConfig?: BrowserConfig
  private readonly authConfig: AuthConfig
  private readonly emitter = new EventEmitter()

  private selectorEngine: SelectorEngine
  private observer: DOMObserver | null = null

  constructor(browserConfig: BrowserConfig | undefined, authConfig: AuthConfig) {
    this.browserConfig = browserConfig
    this.authConfig = authConfig
    this.selectorEngine = new SelectorEngine(SELECTOR_DEFINITIONS)
  }

  get isConnectMode(): boolean {
    return this.browserManager?.isConnectMode ?? false
  }

  async launch(onAudioData: (pcmBase64: string, sampleRate: number) => void): Promise<Page> {
    if (this.browserManager) {
      throw new BrowserConnectionError(
        this.browserConfig?.mode ?? 'managed',
        'Browser already launched. Call cleanup() first.',
      )
    }

    this.browserManager = new BrowserManager(this.browserConfig)
    const { page } = await this.browserManager.launch()
    this.page = page

    await injectAudioHooks(page, onAudioData, this.browserConfig?.mode)

    // Initialize CDP-based DOM observer
    this.observer = new DOMObserver(page, this.selectorEngine)
    await this.observer.start()

    return page
  }

  async authenticate(): Promise<void> {
    if (!this.page) throw new Error('Browser not launched')

    // Skip authentication in connect mode — already logged in via Chrome
    if (this.isConnectMode) {
      return
    }

    const internalEmitter = new EventEmitter()
    internalEmitter.on('status', (s: string) => {
      this.emitter.emit('status', s)
    })
    internalEmitter.on('2fa-required', () => {
      this.emitter.emit('error', new Error('2FA required — provide auth token instead of username/password'))
    })

    await login(this.page, this.authConfig, internalEmitter, {
      selectorEngine: this.selectorEngine,
    })
  }

  async joinSpace(spaceUrl: string): Promise<void> {
    if (!this.page) throw new Error('Browser not launched')

    const internalEmitter = new EventEmitter()
    internalEmitter.on('status', (s: string) => {
      this.emitter.emit('status', s)
    })

    const opts = this.getSpaceUIOptions()

    await spaceUI.joinSpace(this.page, spaceUrl, internalEmitter, opts)

    // Wait for post-join Space UI to stabilise — the dock or any control button
    const postJoinSelector = [
      '[data-testid="SpaceDockExpanded"]',
      '[data-testid="SpaceDockCollapsed"]',
      'button[aria-label="Request to speak"]',
      'button[aria-label*="Request"]',
      'button[aria-label="Unmute"]',
      'button[aria-label="Mute"]',
      'button[aria-label*="microphone"]',
      '[data-testid="SpaceMuteButton"]',
      '[data-testid="SpaceUnmuteButton"]',
    ].join(', ')
    try {
      await this.page.waitForSelector(postJoinSelector, { timeout: 20000 })
      // Extra delay for any animation to settle
      await new Promise(r => setTimeout(r, 2000))
    } catch {
      getLogger().warn('[X-Spaces] Post-join UI controls did not appear within 20s, proceeding anyway')
      await new Promise(r => setTimeout(r, 3000))
    }

    // requestSpeaker() now polls internally for up to 20s
    const speakerResult = await spaceUI.requestSpeaker(this.page, internalEmitter, opts)
    if (speakerResult === 'requested') {
      await spaceUI.waitForSpeakerAccess(this.page, internalEmitter, 300000, opts)
    } else if (speakerResult === 'granted') {
      await spaceUI.unmute(this.page, internalEmitter, opts)
    } else {
      // Could not find request-to-speak — may already be a speaker/host,
      // or the UI hasn't loaded. Try unmute as a last resort.
      getLogger().warn('[X-Spaces] Request-to-speak button not found, attempting unmute anyway')
      await spaceUI.unmute(this.page, internalEmitter, opts)
    }
  }

  /**
   * Join a Space as a listener only — does NOT request to speak or unmute.
   * Use `requestToSpeak()`, `waitForSpeakerAccess()`, and `unmuteInSpace()`
   * separately for granular control.
   */
  async joinAsListener(spaceUrl: string): Promise<void> {
    if (!this.page) throw new Error('Browser not launched')

    const internalEmitter = new EventEmitter()
    internalEmitter.on('status', (s: string) => {
      this.emitter.emit('status', s)
    })

    const opts = this.getSpaceUIOptions()
    await spaceUI.joinSpace(this.page, spaceUrl, internalEmitter, opts)

    // Wait for Space dock to confirm we've joined
    try {
      await this.page.waitForSelector(
        '[data-testid="SpaceDockExpanded"], [data-testid="SpaceDockCollapsed"], button[aria-label="Request to speak"], button[aria-label*="Request"], button[aria-label*="microphone"]',
        { timeout: 20000 },
      )
      await new Promise(r => setTimeout(r, 2000))
    } catch {
      getLogger().warn('[X-Spaces] Post-join UI did not appear within 20s, proceeding anyway')
      await new Promise(r => setTimeout(r, 3000))
    }

    getLogger().info('[X-Spaces] Joined as listener')
  }

  /**
   * Request to speak in the current Space.
   * @returns `"granted"` if already a speaker, `"requested"` if the request
   *          was sent, or `false` if the button wasn't found.
   */
  async requestToSpeak(): Promise<'granted' | 'requested' | false> {
    if (!this.page) throw new Error('Browser not launched')

    const internalEmitter = new EventEmitter()
    internalEmitter.on('status', (s: string) => {
      this.emitter.emit('status', s)
    })

    return spaceUI.requestSpeaker(this.page, internalEmitter, this.getSpaceUIOptions())
  }

  /**
   * Wait for the host to grant speaker access.
   * Resolves `true` when access is granted, throws on timeout or Space end.
   */
  async waitForSpeakerAccess(timeoutMs: number = 300000): Promise<boolean> {
    if (!this.page) throw new Error('Browser not launched')

    const internalEmitter = new EventEmitter()
    internalEmitter.on('status', (s: string) => {
      this.emitter.emit('status', s)
    })

    return spaceUI.waitForSpeakerAccess(this.page, internalEmitter, timeoutMs, this.getSpaceUIOptions())
  }

  /**
   * Click the unmute button in the Space UI.
   */
  async unmuteInSpace(): Promise<boolean> {
    if (!this.page) throw new Error('Browser not launched')

    const internalEmitter = new EventEmitter()
    internalEmitter.on('status', (s: string) => {
      this.emitter.emit('status', s)
    })

    return spaceUI.unmute(this.page, internalEmitter, this.getSpaceUIOptions())
  }

  /**
   * Click the mute button in the Space UI.
   */
  async muteInSpace(): Promise<boolean> {
    if (!this.page) throw new Error('Browser not launched')

    const internalEmitter = new EventEmitter()
    internalEmitter.on('status', (s: string) => {
      this.emitter.emit('status', s)
    })

    return spaceUI.muteSpace(this.page, internalEmitter, this.getSpaceUIOptions())
  }

  async leaveSpace(): Promise<void> {
    if (!this.page) return

    const internalEmitter = new EventEmitter()
    await spaceUI.leaveSpace(this.page, internalEmitter, this.getSpaceUIOptions())
  }

  async cleanup(): Promise<void> {
    if (this.observer) {
      await this.observer.stop()
      this.observer = null
    }
    if (this.browserManager) {
      await this.browserManager.close()
      this.browserManager = null
      this.page = null
    }
  }

  getPage(): Page | null {
    return this.page
  }

  getSelectorEngine(): SelectorEngine {
    return this.selectorEngine
  }

  getObserver(): DOMObserver | null {
    return this.observer
  }

  getSpaceUIOptions(): SpaceUIOptions {
    return {
      selectorEngine: this.selectorEngine,
      observer: this.observer ?? undefined,
    }
  }

  on<K extends keyof BrowserLifecycleEvents>(event: K, listener: BrowserLifecycleEvents[K]): void {
    this.emitter.on(event, listener)
  }
}
