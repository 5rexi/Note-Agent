/**
 * stripSignatureBlocks — 剥离邮件签名、PGP签名等无用内容
 * 参考设计文档第06章：节省上下文空间
 */

const SIGNATURE_PATTERNS = [
  // Email signatures
  /^--\s*$/m,
  /^--\s*\n/m,
  /^-+\s*Original message\s*-+$/im,
  /^On .+ wrote:$/im,
  /^Sent from my .+$/im,
  // PGP signatures
  /^-----BEGIN PGP SIGNED MESSAGE-----$/m,
  /^-----BEGIN PGP SIGNATURE-----$/m,
  /^-----END PGP SIGNATURE-----$/m,
  // Common separators
  /^_{10,}$/m,
  /^={10,}$/m,
  // AI-generated markers
  /^\[This (message|email|response) was (generated|created|composed) by .+\]$/im,
  // Disclaimer patterns
  /^CONFIDENTIALITY NOTICE:/im,
  /^DISCLAIMER:/im,
  /^LEGAL NOTICE:/im,
  // Git diff markers in messages
  /^\+{3}\s/m,
  /^-{3}\s/m,
]

/**
 * 剥离签名块
 */
export function stripSignatureBlocks(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []

  for (const line of lines) {
    let isSignature = false
    for (const pattern of SIGNATURE_PATTERNS) {
      if (pattern.test(line)) {
        isSignature = true
        break
      }
    }
    if (isSignature) {
      // Stop including lines after signature separator
      if (/^--\s*$/.test(line) || /^_{10,}$/.test(line) || /^={10,}$/.test(line)) {
        break
      }
      continue
    }
    result.push(line)
  }

  return result.join('\n').trim()
}
