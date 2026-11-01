export const MODEL = '@cf/cloudflare/clef-omni' as const
export const MAX_ATTEMPTS = 10
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 16_000_000

export interface ChallengeConfig {
  challenge: string
  minScore: number
  maxScore: number
  maxAttempts: number
  saveImages: boolean
}

export const DEFAULT_CHALLENGE: ChallengeConfig = {
  challenge: '这张图片里有一只猫',
  minScore: 70,
  maxScore: 100,
  maxAttempts: 3,
  saveImages: true,
}

export interface PublicConfig {
  model: string
  ownerConfigured: boolean
  maxImageBytes: number
  maxImagePixels: number
  maxAttempts: number
  storage: 'r2'
  hbSite: string
}

export interface UploadResult {
  id: string
  score: number
  challenge: string
  attempt: number
  remaining: number
  saved: boolean
}

export interface ApiError {
  error: string
  code?: string
}
