import { readdirSync, statSync, readFileSync } from 'fs'
import { join, extname, basename } from 'path'
import type { Database } from './db'

const SUPPORTED_EXTS = new Set([
  '.txt', '.md', '.mdx', '.js', '.ts', '.jsx', '.tsx', '.py', '.rs', '.go',
  '.java', '.kt', '.swift', '.rb', '.php', '.c', '.cpp', '.h', '.hpp',
  '.json', '.yaml', '.yml', '.xml', '.html', '.css', '.scss', '.sql',
  '.sh', '.bash', '.zsh', '.dockerfile', '.tex', '.bib',
])

const CHUNK_SIZE = 800   // characters per chunk
const CHUNK_OVERLAP = 200 // overlap between chunks

function isSupportedFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  if (SUPPORTED_EXTS.has(ext)) return true
  const base = basename(filePath).toLowerCase()
  if (base === 'dockerfile' || base.endsWith('.dockerfile')) return true
  return false
}

function* walkDir(dir: string): Generator<string> {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      // Skip common non-source directories
      const skipDirs = new Set([
        'node_modules', '.git', 'dist', 'build', '.next', 'out',
        'coverage', '__pycache__', '.venv', 'venv', 'target', '.idea',
        '.vscode', '.cache', 'tmp', 'temp',
      ])
      if (!skipDirs.has(entry.name)) {
        yield* walkDir(fullPath)
      }
    } else if (entry.isFile() && isSupportedFile(fullPath)) {
      yield fullPath
    }
  }
}

function chunkText(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    const end = Math.min(i + size, text.length)
    chunks.push(text.slice(i, end))
    if (end >= text.length) break
    i += size - overlap
  }
  return chunks
}

/**
 * Generate embedding vector via the user's configured LLM provider.
 * Falls back to null if the provider doesn't support embeddings.
 */
async function generateEmbedding(text: string, db: Database): Promise<number[] | null> {
  try {
    const providersStr = db.getSetting('llmProviders')
    if (!providersStr) return null
    const providers = JSON.parse(providersStr)
    const active = providers.find((p: any) => p.active)
    if (!active) return null

    const provider = active.provider || 'openai'
    const apiKey = active.apiKey
    const baseUrl = active.baseUrl || (provider === 'openai' ? 'https://api.openai.com/v1' : '')
    if (!apiKey || !baseUrl) return null

    const embedUrl = `${baseUrl.replace(/\/$/, '')}/embeddings`
    const embedModel = active.embedModel || 'text-embedding-3-small'

    const res = await fetch(embedUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: embedModel,
        input: text.slice(0, 8000), // truncate to avoid token limits
      }),
    })

    if (!res.ok) {
      console.warn(`[KnowledgeBase] Embedding API error: ${res.status} ${await res.text()}`)
      return null
    }

    const data = await res.json()
    const embedding = data?.data?.[0]?.embedding
    if (!Array.isArray(embedding)) return null
    return embedding
  } catch (err: any) {
    console.warn('[KnowledgeBase] Embedding generation failed:', err.message)
    return null
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// ── Indexing ──

export async function indexKnowledgeFolder(folderId: number, db: Database): Promise<{ success: boolean; indexed: number; error?: string }> {
  try {
    const folder = db.listKnowledgeFolders().find((f: any) => f.id === folderId)
    if (!folder) return { success: false, indexed: 0, error: 'Folder not found' }

    // Clear existing chunks
    db.clearKnowledgeChunks(folderId)

    let totalIndexed = 0
    for (const filePath of walkDir(folder.path)) {
      try {
        const text = readFileSync(filePath, 'utf-8')
        const chunks = chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP)
        for (let i = 0; i < chunks.length; i++) {
          const embedding = await generateEmbedding(chunks[i], db)
          db.addKnowledgeChunk(folderId, filePath, chunks[i], i, embedding || undefined)
          totalIndexed++
        }
      } catch (err: any) {
        console.warn(`[KnowledgeBase] Failed to index ${filePath}:`, err.message)
      }
    }

    db.updateKnowledgeFolderIndexedAt(folderId)
    console.log(`[KnowledgeBase] Indexed ${totalIndexed} chunks from ${folder.path}`)
    return { success: true, indexed: totalIndexed }
  } catch (err: any) {
    return { success: false, indexed: 0, error: err.message }
  }
}

// ── Search ──

export interface KnowledgeSearchResult {
  id: number
  folderId: number
  filePath: string
  content: string
  chunkIndex: number
  score: number
}

export async function searchKnowledgeBase(
  query: string,
  db: Database,
  options?: { folderIds?: number[]; topK?: number; useEmbedding?: boolean }
): Promise<KnowledgeSearchResult[]> {
  const { folderIds, topK = 5, useEmbedding = true } = options || {}

  // 1. FTS5 keyword search
  const keywordResults = db.searchKnowledgeBaseKeyword(query, folderIds, topK * 3)

  const results: KnowledgeSearchResult[] = keywordResults.map((r: any) => ({
    id: r.id,
    folderId: r.folder_id,
    filePath: r.file_path,
    content: r.content,
    chunkIndex: r.chunk_index,
    score: r.score ?? 0,
  }))

  // 2. Embedding semantic search (if enabled and provider is available)
  if (useEmbedding) {
    const queryEmbedding = await generateEmbedding(query, db)
    if (queryEmbedding) {
      const allChunks = db.getAllKnowledgeChunks(folderIds)
      const scored: KnowledgeSearchResult[] = []
      for (const chunk of allChunks) {
        if (!chunk.embedding) continue
        try {
          const emb = JSON.parse(chunk.embedding) as number[]
          const sim = cosineSimilarity(queryEmbedding, emb)
          scored.push({
            id: chunk.id,
            folderId: chunk.folder_id,
            filePath: chunk.file_path,
            content: chunk.content,
            chunkIndex: chunk.chunk_index,
            score: sim,
          })
        } catch {
          // ignore malformed embedding
        }
      }
      scored.sort((a, b) => b.score - a.score)
      const topSemantic = scored.slice(0, topK)

      // Merge keyword and semantic results, deduplicate by id
      const seen = new Set(results.map((r) => r.id))
      for (const r of topSemantic) {
        if (!seen.has(r.id)) {
          results.push(r)
          seen.add(r.id)
        }
      }
    }
  }

  // Sort by relevance (lower FTS5 rank = better; higher cosine = better)
  // Normalize: FTS5 rank is typically negative, so invert it
  results.sort((a, b) => {
    const scoreA = a.score > 1 ? a.score : 1 / (1 + Math.abs(a.score))
    const scoreB = b.score > 1 ? b.score : 1 / (1 + Math.abs(b.score))
    return scoreB - scoreA
  })

  return results.slice(0, topK)
}
