import { Router, Response } from 'express'
import multer from 'multer'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import { uploadCoverImage } from '../services/storage.service.js'

const router = Router()

// Configure multer for memory storage (max 5MB, images only)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Invalid file format. Only JPG, PNG, WEBP, and GIF images are permitted.'))
    }
  },
})

// All upload routes require authentication
router.use(authenticateToken)

/**
 * POST /api/upload/cover
 * Uploads media poster or cover image
 */
router.post('/cover', (req: AuthRequest, res: Response): void => {
  upload.single('image')(req, res, async (err: any) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'File size exceeds maximum limit of 5MB' })
        return
      }
      res.status(400).json({ error: `Upload error: ${err.message}` })
      return
    } else if (err) {
      res.status(400).json({ error: err.message || 'File upload failed' })
      return
    }

    if (!req.file) {
      res.status(400).json({ error: 'No image file provided' })
      return
    }

    try {
      const publicUrl = await uploadCoverImage(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      )

      res.status(200).json({
        url: publicUrl,
        message: 'Image uploaded successfully',
      })
    } catch (uploadError: any) {
      console.error('[UploadRoute] Error processing upload:', uploadError)
      res.status(500).json({ error: 'Failed to process and store image' })
    }
  })
})

export default router
