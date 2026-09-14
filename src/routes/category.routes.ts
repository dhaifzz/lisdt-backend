import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/prisma.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'

const router = Router()

const CategorySchema = z.object({
  slug: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  tag: z.string().min(1).max(50),
  headline: z.string().default('Your collection'),
  subhead: z.string().default('media diary.'),
  description: z.string().default(''),
  type: z.enum(['series', 'movies']),
  unitLabel: z.string().optional(),
})

// All category routes require authentication
router.use(authenticateToken)

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const categories = await prisma.category.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: 'asc' },
    })
    res.json({ categories })
  } catch (error) {
    console.error('Error fetching categories:', error)
    res.status(500).json({ error: 'Failed to fetch categories' })
  }
})

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parseResult = CategorySchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({ error: 'Validation failed', details: parseResult.error.flatten() })
      return
    }

    const { slug, label, tag, headline, subhead, description, type, unitLabel } = parseResult.data

    const existing = await prisma.category.findFirst({
      where: {
        userId: req.user!.userId,
        slug,
      },
    })

    if (existing) {
      res.status(409).json({ error: 'Category with this slug already exists' })
      return
    }

    const category = await prisma.category.create({
      data: {
        slug,
        label,
        tag,
        headline,
        subhead,
        description,
        type,
        unitLabel,
        userId: req.user!.userId,
      },
    })

    res.status(201).json({ category })
  } catch (error) {
    console.error('Error creating category:', error)
    res.status(500).json({ error: 'Failed to create category' })
  }
})

router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    const parseResult = CategorySchema.partial().safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({ error: 'Validation failed', details: parseResult.error.flatten() })
      return
    }

    const existing = await prisma.category.findFirst({
      where: { id, userId: req.user!.userId },
    })

    if (!existing) {
      res.status(404).json({ error: 'Category not found' })
      return
    }

    const updated = await prisma.category.update({
      where: { id },
      data: parseResult.data,
    })

    res.json({ category: updated })
  } catch (error) {
    console.error('Error updating category:', error)
    res.status(500).json({ error: 'Failed to update category' })
  }
})

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id

    const existing = await prisma.category.findFirst({
      where: { id, userId: req.user!.userId },
    })

    if (!existing) {
      res.status(404).json({ error: 'Category not found' })
      return
    }

    // Delete all media items in this library collection
    await prisma.mediaItem.deleteMany({
      where: {
        userId: req.user!.userId,
        category: existing.slug,
      },
    })

    // Delete the library category itself
    await prisma.category.delete({
      where: { id },
    })

    // If the user deleted all libraries, ensure there is always 1 empty default library
    const remainingCount = await prisma.category.count({
      where: { userId: req.user!.userId },
    })

    let defaultCategory = null
    if (remainingCount === 0) {
      defaultCategory = await prisma.category.create({
        data: {
          slug: 'my_list',
          label: 'MY LIST',
          tag: 'COLLECTION',
          headline: 'Your personal',
          subhead: 'media diary.',
          description: 'Track, rate & log everything you watch. Your collection, your rules.',
          type: 'series',
          unitLabel: 'ENTRIES',
          userId: req.user!.userId,
        },
      })
    }

    res.json({
      message: 'Category deleted successfully',
      defaultCategory,
      remainingCount: defaultCategory ? 1 : remainingCount,
    })
  } catch (error) {
    console.error('Error deleting category:', error)
    res.status(500).json({ error: 'Failed to delete category' })
  }
})

export default router
