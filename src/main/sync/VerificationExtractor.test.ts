import { describe, it, expect } from 'vitest'
import {
  extractVerification,
  extractCode,
  isVerificationEmail,
  detectServiceName,
} from './VerificationExtractor'

describe('extractVerification', () => {
  it('extracts context-labelled codes with high confidence', () => {
    const r = extractVerification('Your Discord verification code', 'Your code is: 482913')
    expect(r?.code).toBe('482913')
    expect(r!.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('extracts codes from the subject line', () => {
    const r = extractVerification('483920 is your Instagram code', 'Enter it to continue')
    expect(r?.code).toBe('483920')
    expect(r!.confidence).toBeGreaterThanOrEqual(0.85)
  })

  it('extracts spaced and hyphenated 6-digit codes', () => {
    expect(extractVerification('Security code', 'Use code 123 456 to sign in')?.code).toBe('123456')
    expect(extractVerification('Security code', 'Your code: 123-456')?.code).toBe('123456')
  })

  it('extracts alphanumeric codes only with context', () => {
    expect(
      extractVerification('Steam Guard code', 'Your Steam Guard code is: H7K2P9')?.code
    ).toBe('H7K2P9')
    expect(extractVerification('Newsletter', 'Meeting room B4C7X2 is booked')).toBeNull()
  })

  it('extracts 7 and 8 digit codes', () => {
    expect(extractVerification('Verification code', 'Your code is 48291375')?.code).toBe('48291375')
  })

  it('rejects standalone years', () => {
    expect(
      extractVerification('Verify your account', 'Founded in 2024, we secure logins.')
    ).toBeNull()
  })

  it('rejects order and tracking numbers', () => {
    expect(
      extractVerification('Order confirmation code inside', 'Your order 583920 has shipped')
    ).toBeNull()
    expect(
      extractVerification('Delivery verification', 'Tracking 483920 out for delivery')
    ).toBeNull()
  })

  it('rejects currency amounts', () => {
    expect(extractVerification('Payment verification', 'You paid $4829.13 today')).toBeNull()
  })

  it('rejects phone numbers', () => {
    expect(
      extractVerification('Verify your phone', 'Call us at +1 (482) 913-4829 for help')
    ).toBeNull()
  })

  it('gives bare 4-digit codes lower confidence and requires body keywords', () => {
    const r = extractVerification('Your PIN reminder', 'Your one-time code 4829 expires soon')
    expect(r?.code).toBe('4829')
    expect(r!.confidence).toBeLessThan(0.95)
    expect(extractVerification('Hello', 'Meet at 1430 tomorrow')).toBeNull()
  })

  it('returns null when no code exists', () => {
    expect(extractVerification('Verification needed', 'Please verify your email address.')).toBeNull()
  })
})

describe('extractCode (backward-compatible wrapper)', () => {
  it('returns the code string or null', () => {
    expect(extractCode('Your code', 'Your code is: 482913')).toBe('482913')
    expect(extractCode('Hello', 'No numbers here')).toBeNull()
  })
})

describe('isVerificationEmail (unchanged behavior)', () => {
  it('detects keyword subjects and bodies', () => {
    expect(isVerificationEmail('Your verification code', '')).toBe(true)
    expect(isVerificationEmail('Hello', 'use this code to sign in: 123456')).toBe(true)
    expect(isVerificationEmail('Lunch plans', 'See you at noon')).toBe(false)
  })
})

describe('detectServiceName (unchanged behavior)', () => {
  it('maps known domains and falls back to sender name / domain', () => {
    expect(detectServiceName('noreply@discord.com', null)).toBe('Discord')
    expect(detectServiceName('verify@mail.vrchat.com', null)).toBe('VRChat')
    expect(detectServiceName('no-reply@unknownservice.io', 'UnknownService Support')).toBe(
      'UnknownService'
    )
  })
})
