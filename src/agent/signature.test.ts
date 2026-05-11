/**
 * Signature Block 剥离器测试
 */
import { describe, it, expect } from 'bun:test'
import { stripSignatureBlocks } from './signature'

describe('stripSignatureBlocks', () => {
  it('should strip email signature separator', () => {
    const text = 'Hello world\n\n--\nJohn Doe\nDeveloper'
    expect(stripSignatureBlocks(text)).toBe('Hello world')
  })

  it('should strip PGP signature block', () => {
    const text = 'Hello\n\n-----BEGIN PGP SIGNATURE-----\nabc\n-----END PGP SIGNATURE-----'
    expect(stripSignatureBlocks(text)).toBe('Hello')
  })

  it('should strip "Best regards"', () => {
    const text = 'Thanks for your help.\n\nBest regards,\nAlice'
    expect(stripSignatureBlocks(text)).toBe('Thanks for your help.')
  })

  it('should not modify text without signatures', () => {
    const text = 'Just a normal message.\nNo signatures here.'
    expect(stripSignatureBlocks(text)).toBe(text)
  })

  it('should strip "Sent from my iPhone"', () => {
    const text = 'See you tomorrow.\n\nSent from my iPhone'
    expect(stripSignatureBlocks(text)).toBe('See you tomorrow.')
  })
})
