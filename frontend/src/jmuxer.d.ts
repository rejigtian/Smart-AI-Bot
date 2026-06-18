declare module 'jmuxer' {
  interface JMuxerOptions {
    node: HTMLVideoElement | string
    mode?: 'both' | 'video' | 'audio'
    flushingTime?: number
    maxDelay?: number
    clearBuffer?: boolean
    fps?: number
    debug?: boolean
    onReady?: () => void
    onError?: (data: unknown) => void
  }
  interface FeedData {
    video?: Uint8Array
    audio?: Uint8Array
    duration?: number
  }
  export default class JMuxer {
    constructor(options: JMuxerOptions)
    feed(data: FeedData): void
    reset(): void
    destroy(): void
  }
}
