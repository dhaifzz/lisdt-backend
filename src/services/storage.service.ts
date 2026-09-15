import { createClient, SupabaseClient } from '@supabase/supabase-js'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zhsrrwmcakmepikkbwok.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || ''
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'covers'

let supabase: SupabaseClient | null = null

if (SUPABASE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
    console.log('[StorageService] Supabase Storage client initialized for bucket:', STORAGE_BUCKET)
  } catch (err) {
    console.error('[StorageService] Failed to initialize Supabase client:', err)
  }
} else {
  console.log('[StorageService] No SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY found. Using local disk storage fallback (/uploads).')
}

// Ensure local fallback uploads directory exists
const LOCAL_UPLOADS_DIR = path.resolve(__dirname, '../../uploads/covers')
if (!fs.existsSync(LOCAL_UPLOADS_DIR)) {
  fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true })
}

/**
 * Upload an image buffer to Supabase Storage, with fallback to local disk storage.
 */
export async function uploadCoverImage(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string
): Promise<string> {
  const ext = (path.extname(originalFilename) || (mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg')).toLowerCase()
  const cleanBase = path.basename(originalFilename, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30)
  const uniqueName = `${cleanBase}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`

  // 1. Try Supabase Storage if configured
  if (supabase) {
    try {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(uniqueName, buffer, {
          contentType: mimeType,
          upsert: true,
        })

      if (error) {
        console.error('[StorageService] Supabase upload error:', error.message)
        // If upload failed, fallback to local disk
      } else if (data) {
        const { data: publicUrlData } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(uniqueName)

        if (publicUrlData?.publicUrl) {
          console.log('[StorageService] Successfully uploaded to Supabase Storage:', publicUrlData.publicUrl)
          return publicUrlData.publicUrl
        }
      }
    } catch (supabaseErr) {
      console.error('[StorageService] Supabase storage exception:', supabaseErr)
    }
  }

  // 2. Local disk fallback
  const localFilePath = path.join(LOCAL_UPLOADS_DIR, uniqueName)
  await fs.promises.writeFile(localFilePath, buffer)

  const isProduction = process.env.NODE_ENV === 'production'
  const serverBase = process.env.SERVER_URL?.replace(/\/+$/, '')

  if (serverBase) {
    const publicUrl = `${serverBase}/uploads/covers/${uniqueName}`
    console.log('[StorageService] Saved locally to SERVER_URL:', publicUrl)
    return publicUrl
  }

  if (isProduction) {
    console.error('[StorageService] CRITICAL: Supabase upload failed/unconfigured, and SERVER_URL is not set in production!')
    throw new Error(
      'Image upload failed: Supabase Storage is not configured on the production server (missing SUPABASE_SERVICE_ROLE_KEY). Please configure Supabase environment variables.'
    )
  }

  const localUrl = `http://localhost:${process.env.PORT || 5000}/uploads/covers/${uniqueName}`
  console.log('[StorageService] Saved locally to dev server:', localUrl)
  return localUrl
}

/**
 * Delete a cover image from Supabase Storage or local disk storage.
 * Only deletes self-hosted images (Supabase or /uploads/), safely ignoring external URLs.
 */
export async function deleteCoverImage(coverUrl?: string | null): Promise<boolean> {
  if (!coverUrl || typeof coverUrl !== 'string') return false

  const isSupabaseUrl = coverUrl.includes('.supabase.co') && coverUrl.includes(`/${STORAGE_BUCKET}/`)
  const isLocalUrl = coverUrl.includes('/uploads/covers/')

  if (!isSupabaseUrl && !isLocalUrl) {
    // External URL (e.g. MAL, AniList, TMDB) - nothing to delete from our storage
    return false
  }

  try {
    // 1. Delete from Supabase Storage
    if (isSupabaseUrl) {
      const parts = coverUrl.split(`/${STORAGE_BUCKET}/`)
      if (parts.length > 1) {
        const filePath = decodeURIComponent(parts[1].split('?')[0])
        if (filePath && supabase) {
          const { error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .remove([filePath])

          if (error) {
            console.error(`[StorageService] Failed to delete Supabase file "${filePath}":`, error.message)
            return false
          }
          console.log(`[StorageService] Successfully deleted previous file from Supabase Storage:`, filePath)
          return true
        }
      }
    }

    // 2. Delete from Local Fallback Storage
    if (isLocalUrl) {
      const parts = coverUrl.split('/uploads/covers/')
      if (parts.length > 1) {
        const filename = decodeURIComponent(parts[1].split('?')[0])
        const diskPath = path.join(LOCAL_UPLOADS_DIR, path.basename(filename))
        if (fs.existsSync(diskPath)) {
          await fs.promises.unlink(diskPath)
          console.log(`[StorageService] Successfully deleted previous local file:`, diskPath)
          return true
        }
      }
    }
  } catch (err) {
    console.error(`[StorageService] Exception while deleting cover "${coverUrl}":`, err)
  }

  return false
}
