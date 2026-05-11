/**
 * Signature Block 剥离器
 * 参考 design.md "stripSignatureBlocks"
 * 移除邮件签名、PGP签名等
 */

const SIGNATURE_PATTERNS = [
  /^--\s*$/,                          // email sig separator
  /^-----BEGIN PGP SIGNATURE-----/,   // PGP sig start
  /^-----END PGP SIGNATURE-----/,     // PGP sig end
  /^Best regards,.*$/i,
  /^Regards,.*$/i,
  /^Cheers,.*$/i,
  /^Thanks,.*$/i,
  /^Sent from my.*$/i,
]

/**
 * 剥离签名块
 */
export function stripSignatureBlocks(text: string): string {
  const lines = text.split('\n')
  let cutIndex = lines.length

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    for (const pattern of SIGNATURE_PATTERNS) {
      if (pattern.test(line)) {
        cutIndex = Math.min(cutIndex, i)
        break
      }
    }
  }

  return lines.slice(0, cutIndex).join('\n').trimEnd()
}
