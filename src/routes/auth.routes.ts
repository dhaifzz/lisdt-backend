import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import prisma from '../config/prisma.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import crypto from 'crypto'
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/email.service.js'

const router = Router()

// Rate limiters
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes window
  max: 5, // Max 5 failed attempts per 15 minutes
  skipSuccessfulRequests: true, // Do not count successful logins
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many failed login attempts. Please try again after 15 minutes.',
  },
  statusCode: 429,
})

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: 10, // Max 10 account creations per hour per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many accounts created from this network. Please try again in an hour.',
  },
  statusCode: 429,
})

export const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes window
  max: 5, // Max 5 reset requests per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many password reset requests from this network. Please try again after 15 minutes.',
  },
  statusCode: 429,
})

const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/

const RegisterSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must not exceed 30 characters')
    .regex(USERNAME_REGEX, 'Username can only contain letters, numbers, underscores, and hyphens with no spaces'),
  email: z
    .string()
    .email('Please enter a valid email address')
    .max(254, 'Email must not exceed 254 characters'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must not exceed 128 characters'),
})

const LoginSchema = z.object({
  login: z
    .string()
    .min(3, 'Username or email must be at least 3 characters')
    .max(254, 'Username or email must not exceed 254 characters'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must not exceed 128 characters'),
})

const ForgotPasswordSchema = z.object({
  email: z
    .string()
    .email('Please enter a valid email address')
    .max(254, 'Email must not exceed 254 characters'),
})

const ResetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must not exceed 128 characters'),
})

const DEFAULT_LIBRARY = {
  slug: 'my_list',
  label: 'MY LIST',
  tag: 'COLLECTION',
  headline: 'Your personal',
  subhead: 'media diary.',
  description: 'Track, rate & log everything you watch. Your collection, your rules.',
  type: 'series',
  unitLabel: 'ENTRIES',
}
router.post('/register', registerLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = RegisterSchema.safeParse(req.body)
    if (!parseResult.success) {
      const msg = parseResult.error.issues[0]?.message || 'Validation failed'
      res.status(400).json({ error: msg })
      return
    }

    const { username, email, password } = parseResult.data

    const existingUser = await prisma.user.findFirst({
      where: { username },
      select: { id: true },
    })
    if (existingUser) {
      res.status(409).json({ error: 'Username is already taken' })
      return
    }

    const existingEmail = await prisma.user.findFirst({
      where: { email },
      select: { id: true },
    })
    if (existingEmail) {
      res.status(409).json({ error: 'Email is already registered' })
      return
    }

    const salt = await bcrypt.genSalt(10)
    const passwordHash = await bcrypt.hash(password, salt)

    const verifyToken = crypto.randomBytes(32).toString('hex')
    const verifyTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: { username, email, passwordHash, verifyToken, verifyTokenExpiry, emailVerified: false },
        select: { id: true, username: true, email: true, avatar: true },
      })
      await tx.category.create({
        data: { ...DEFAULT_LIBRARY, userId: newUser.id },
      })
      return newUser
    })

    try {
      await sendVerificationEmail(email, verifyToken)
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError)
      // We don't fail the registration if email fails, but we might want to log it
    }

    res.status(201).json({
      message: 'VERIFY_EMAIL_SENT',
      pendingEmail: email
    })
  } catch (error) {
    console.error('Registration error:', error)
    res.status(500).json({ error: 'Failed to register user' })
  }
})

router.post('/resend-verification', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body
    if (!email) {
      res.status(400).json({ error: 'Email is required' })
      return
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerified: true }
    })

    if (!user) {
      // Don't leak if user exists
      res.json({ message: 'If an account exists, a verification email was sent.' })
      return
    }

    if (user.emailVerified) {
      res.status(400).json({ error: 'Email is already verified.' })
      return
    }

    const verifyToken = crypto.randomBytes(32).toString('hex')
    const verifyTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    await prisma.user.update({
      where: { id: user.id },
      data: { verifyToken, verifyTokenExpiry }
    })

    await sendVerificationEmail(email, verifyToken)

    res.json({ message: 'Verification email resent.' })
  } catch (error) {
    console.error('Resend verification error:', error)
    res.status(500).json({ error: 'Failed to resend verification email' })
  }
})

router.get('/verify-email', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.query
    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'Invalid or missing token' })
      return
    }

    const user = await prisma.user.findUnique({
      where: { verifyToken: token },
    })

    if (!user) {
      res.status(400).json({ error: 'Invalid or expired token' })
      return
    }

    if (user.verifyTokenExpiry && user.verifyTokenExpiry < new Date()) {
      res.status(400).json({ error: 'Token has expired. Please request a new one.' })
      return
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verifyToken: null,
        verifyTokenExpiry: null,
      },
    })

    const jwtToken = jwt.sign(
      { userId: user.id, username: user.username, email: user.email },
      process.env.JWT_SECRET || 'lisdt_secret_key',
      { expiresIn: '7d' }
    )

    res.json({
      message: 'Email verified successfully',
      token: jwtToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
      }
    })
  } catch (error) {
    console.error('Verify email error:', error)
    res.status(500).json({ error: 'Failed to verify email' })
  }
})

router.post('/forgot-password', forgotPasswordLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = ForgotPasswordSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Invalid email address' })
      return
    }

    const { email } = parseResult.data

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerified: true },
    })

    if (!user) {
      // Generic success to prevent account enumeration
      res.json({ message: 'If an account exists with that email, a password reset link has been transmitted.' })
      return
    }

    const resetToken = crypto.randomBytes(32).toString('hex')
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpiry },
    })

    try {
      await sendPasswordResetEmail(email, resetToken)
    } catch (emailError) {
      console.error('Failed to send password reset email:', emailError)
    }

    res.json({ message: 'If an account exists with that email, a password reset link has been transmitted.' })
  } catch (error) {
    console.error('Forgot password error:', error)
    res.status(500).json({ error: 'Failed to process password reset request' })
  }
})

router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = ResetPasswordSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Invalid input' })
      return
    }

    const { token, password } = parseResult.data

    const user = await prisma.user.findUnique({
      where: { resetToken: token },
    })

    if (!user) {
      res.status(400).json({ error: 'Invalid or expired password reset link' })
      return
    }

    if (user.resetTokenExpiry && user.resetTokenExpiry < new Date()) {
      res.status(400).json({ error: 'Password reset link has expired. Please request a new one.' })
      return
    }

    const salt = await bcrypt.genSalt(10)
    const passwordHash = await bcrypt.hash(password, salt)

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiry: null,
      },
    })

    res.json({ message: 'Password has been reset successfully. You can now log in.' })
  } catch (error) {
    console.error('Reset password error:', error)
    res.status(500).json({ error: 'Failed to reset password' })
  }
})

router.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = LoginSchema.safeParse(req.body)
    if (!parseResult.success) {
      const msg = parseResult.error.issues[0]?.message || 'Invalid input'
      res.status(400).json({ error: msg })
      return
    }

    const { login, password } = parseResult.data

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: login }, { username: login }],
      },
      select: {
        id: true,
        username: true,
        email: true,
        passwordHash: true,
        avatar: true,
        emailVerified: true,
      },
    })

    if (!user) {
      res.status(401).json({ error: 'Invalid username/email or password' })
      return
    }

    if (!user.emailVerified) {
      res.status(403).json({ error: 'Email not yet verified. Please check your inbox.' })
      return
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash)
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid username/email or password' })
      return
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, email: user.email },
      process.env.JWT_SECRET || 'lisdt_secret_key',
      { expiresIn: '7d' }
    )

    res.json({
      message: 'Logged in successfully',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
      },
    })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ error: 'Failed to log in' })
  }
})

router.get('/me', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        createdAt: true,
        _count: {
          select: {
            categories: true,
            mediaItems: true,
          },
        },
      },
    })

    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.json({ user })
  } catch (error) {
    console.error('Fetch me error:', error)
    res.status(500).json({ error: 'Failed to fetch user data' })
  }
})

const AvatarSchema = z.object({
  avatar: z
    .string()
    .regex(
      /^data:image\/(png|jpeg|gif);base64,/,
      'Only PNG, JPEG, or GIF images are allowed'
    ),
})

const MAX_AVATAR_BYTES = 3 * 1024 * 1024 // 3 MB

router.put('/avatar', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parseResult = AvatarSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message ?? 'Invalid image format' })
      return
    }

    const { avatar } = parseResult.data

    // Estimate decoded byte size from base64 string length
    const base64Data = avatar.split(',')[1] ?? ''
    const byteSize = Math.ceil((base64Data.length * 3) / 4)
    if (byteSize > MAX_AVATAR_BYTES) {
      res.status(413).json({ error: 'Image must be 3 MB or smaller' })
      return
    }

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: { avatar },
      select: { id: true, username: true, email: true, avatar: true },
    })

    res.json({ user })
  } catch (error) {
    console.error('Avatar upload error:', error)
    res.status(500).json({ error: 'Failed to update avatar' })
  }
})

const UpdateProfileSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must not exceed 30 characters')
    .regex(USERNAME_REGEX, 'Username can only contain letters, numbers, underscores, and hyphens with no spaces')
    .optional(),
})

router.put('/profile', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parseResult = UpdateProfileSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message ?? 'Invalid profile data' })
      return
    }

    const { username } = parseResult.data

    if (username) {
      const cleanUsername = username.replace(/^@/, '').trim()
      if (cleanUsername.length < 3 || cleanUsername.length > 30 || !USERNAME_REGEX.test(cleanUsername)) {
        res.status(400).json({ error: 'Username must be 3-30 characters and can only contain letters, numbers, underscores, and hyphens' })
        return
      }

      const existing = await prisma.user.findFirst({
        where: {
          username: cleanUsername,
          NOT: { id: req.user!.userId },
        },
        select: { id: true },
      })
      if (existing) {
        res.status(409).json({ error: 'Username is already taken' })
        return
      }

      const updated = await prisma.user.update({
        where: { id: req.user!.userId },
        data: {
          username: cleanUsername,
        },
        select: { id: true, username: true, email: true, avatar: true },
      })

      const token = jwt.sign(
        { userId: updated.id, username: updated.username, email: updated.email },
        process.env.JWT_SECRET || 'lisdt_secret_key',
        { expiresIn: '7d' }
      )

      res.json({ message: 'Profile updated successfully', user: updated, token })
      return
    }

    res.status(400).json({ error: 'No profile fields provided to update' })
  } catch (error) {
    console.error('Update profile error:', error)
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(128, 'New password must not exceed 128 characters'),
})

router.put('/password', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parseResult = ChangePasswordSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message ?? 'Invalid password format' })
      return
    }

    const { currentPassword, newPassword } = parseResult.data
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, passwordHash: true },
    })

    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!isValid) {
      res.status(400).json({ error: 'Incorrect current password' })
      return
    }

    const salt = await bcrypt.genSalt(10)
    const newHash = await bcrypt.hash(newPassword, salt)

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    })

    res.json({ message: 'Password updated successfully' })
  } catch (error) {
    console.error('Change password error:', error)
    res.status(500).json({ error: 'Failed to update password' })
  }
})

const DeleteAccountSchema = z.object({
  password: z.string().min(1, 'Password is required to delete account'),
})

router.delete('/account', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parseResult = DeleteAccountSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message ?? 'Password is required' })
      return
    }

    const { password } = parseResult.data
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, passwordHash: true },
    })

    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const isValid = await bcrypt.compare(password, user.passwordHash)
    if (!isValid) {
      res.status(400).json({ error: 'Incorrect password. Account deletion aborted.' })
      return
    }

    // Permanently purge all user data: media items, custom categories, and user account
    await prisma.$transaction([
      prisma.mediaItem.deleteMany({ where: { userId: user.id } }),
      prisma.category.deleteMany({ where: { userId: user.id } }),
      prisma.user.delete({ where: { id: user.id } }),
    ])

    res.json({ message: 'Account and all associated records deleted permanently' })
  } catch (error) {
    console.error('Delete account error:', error)
    res.status(500).json({ error: 'Failed to delete account' })
  }
})

export default router


