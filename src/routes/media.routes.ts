import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/prisma.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import { deleteCoverImage } from '../services/storage.service.js'

const router = Router()

const MediaSchema = z.object({
  category: z.string().trim().min(1, 'Category is required'),
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(80, 'Title must not exceed 80 characters'),
  year: z.number().int().min(1900).max(2100),
  rating: z.number().min(1).max(10).transform(v => Math.round(v)).nullable().optional(),
  status: z.enum(['watching', 'watched', 'stalled', 'dropped']).default('watching'),
  studio: z.string().max(80, 'Studio must not exceed 80 characters').optional(),
  cover: z.string().default('').transform(v => v.includes('photo-1578632767115-351597cf2477') ? '' : v.trim()),
  seasonsFinished: z.number().int().min(0).default(0),
  parts: z.number().int().min(0).optional().nullable(),
  moviesCount: z.number().int().min(0).optional().nullable(),
  notes: z.string().max(1000, 'Notes must not exceed 1000 characters').optional().nullable(),
  topRank: z.number().int().min(1).max(10).nullable().optional(),
})

// All media routes require authentication
router.use(authenticateToken)

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { category, status, search, sort = 'rating', order = 'desc' } = req.query

    const where: any = {
      userId: req.user!.userId,
    }

    if (category && typeof category === 'string' && category !== 'all') {
      where.category = category
    }

    if (status && typeof status === 'string' && status !== 'all') {
      where.status = status
    }

    if (search && typeof search === 'string' && search.trim().length > 0) {
      where.title = {
        contains: search.trim(),
        mode: 'insensitive',
      }
    }

    let orderBy: any = { rating: 'desc' }
    const direction = order === 'asc' ? 'asc' : 'desc'

    if (sort === 'year') {
      orderBy = { year: direction }
    } else if (sort === 'title') {
      orderBy = { title: direction }
    } else if (sort === 'topRank') {
      orderBy = [
        { topRank: { sort: 'asc', nulls: 'last' } },
        { rating: 'desc' },
      ]
    } else {
      orderBy = { rating: direction }
    }

    const items = await prisma.mediaItem.findMany({
      where,
      orderBy,
    })

    res.json({ items })
  } catch (error) {
    console.error('Error fetching media items:', error)
    res.status(500).json({ error: 'Failed to fetch media items' })
  }
})

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    const id = parseInt(rawId, 10)
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid ID' })
      return
    }

    const item = await prisma.mediaItem.findFirst({
      where: { id, userId: req.user!.userId },
    })

    if (!item) {
      res.status(404).json({ error: 'Media item not found' })
      return
    }

    res.json({ item })
  } catch (error) {
    console.error('Error fetching media item:', error)
    res.status(500).json({ error: 'Failed to fetch media item' })
  }
})

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parseResult = MediaSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({ error: 'Validation failed', details: parseResult.error.flatten() })
      return
    }

    const data = parseResult.data

    if (data.topRank !== undefined && data.topRank !== null) {
      await prisma.mediaItem.updateMany({
        where: {
          userId: req.user!.userId,
          topRank: data.topRank,
        },
        data: { topRank: null },
      })
    }

    const item = await prisma.mediaItem.create({
      data: {
        ...data,
        rating: data.rating ?? null,
        parts: data.parts ?? null,
        moviesCount: data.moviesCount ?? null,
        notes: data.notes ?? null,
        topRank: data.topRank ?? null,
        userId: req.user!.userId,
      },
    })

    res.status(201).json({ item })
  } catch (error) {
    console.error('Error creating media item:', error)
    res.status(500).json({ error: 'Failed to create media item' })
  }
})

router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    const id = parseInt(rawId, 10)
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid ID' })
      return
    }

    const parseResult = MediaSchema.partial().safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({ error: 'Validation failed', details: parseResult.error.flatten() })
      return
    }

    const existing = await prisma.mediaItem.findFirst({
      where: { id, userId: req.user!.userId },
    })

    if (!existing) {
      res.status(404).json({ error: 'Media item not found' })
      return
    }

    if (parseResult.data.topRank !== undefined && parseResult.data.topRank !== null) {
      await prisma.mediaItem.updateMany({
        where: {
          userId: req.user!.userId,
          topRank: parseResult.data.topRank,
          NOT: { id },
        },
        data: { topRank: null },
      })
    }

    // If cover is changing or being cleared, delete previous cover from storage to save space
    if (
      parseResult.data.cover !== undefined &&
      existing.cover &&
      existing.cover !== parseResult.data.cover
    ) {
      await deleteCoverImage(existing.cover)
    }

    const item = await prisma.mediaItem.update({
      where: { id },
      data: parseResult.data,
    })

    res.json({ item })
  } catch (error) {
    console.error('Error updating media item:', error)
    res.status(500).json({ error: 'Failed to update media item' })
  }
})

router.patch('/:id/stepper', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    const id = parseInt(rawId, 10)
    const { delta, field = 'seasonsFinished' } = req.body

    if (isNaN(id) || typeof delta !== 'number') {
      res.status(400).json({ error: 'Invalid request' })
      return
    }

    const existing = await prisma.mediaItem.findFirst({
      where: { id, userId: req.user!.userId },
    })

    if (!existing) {
      res.status(404).json({ error: 'Media item not found' })
      return
    }

    const currentVal = (existing as any)[field] ?? 0
    const newVal = Math.max(0, currentVal + delta)

    const updated = await prisma.mediaItem.update({
      where: { id },
      data: { [field]: newVal },
    })

    res.json({ item: updated })
  } catch (error) {
    console.error('Error in stepper update:', error)
    res.status(500).json({ error: 'Failed to update count' })
  }
})

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    const id = parseInt(rawId, 10)
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid ID' })
      return
    }

    const existing = await prisma.mediaItem.findFirst({
      where: { id, userId: req.user!.userId },
    })

    if (!existing) {
      res.status(404).json({ error: 'Media item not found' })
      return
    }

    if (existing.cover) {
      await deleteCoverImage(existing.cover)
    }

    await prisma.mediaItem.delete({
      where: { id },
    })

    res.json({ message: 'Item deleted successfully' })
  } catch (error) {
    console.error('Error deleting media item:', error)
    res.status(500).json({ error: 'Failed to delete media item' })
  }
})

export default router
