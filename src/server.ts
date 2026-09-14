import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

import authRoutes from './routes/auth.routes.js'
import categoryRoutes from './routes/category.routes.js'
import mediaRoutes from './routes/media.routes.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'

// Enable ETags for client conditional caching (304 Not Modified)
app.set('etag', 'strong')

const allowedOrigins = [
  CLIENT_URL,
  'https://lisdt.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

// Middlewares
app.use(
  cors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (curl, mobile, health checks, server-to-server)
      if (!origin) return callback(null, true)
      if (
        allowedOrigins.includes(origin) ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.endsWith('.vercel.app')
      ) {
        return callback(null, true)
      }
      return callback(null, true)
    },
    credentials: true,
  })
)
app.use(express.json())

// HTTP Cache-Control headers for API responses
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.method === 'GET') {
    // Allows client/browser to cache and validate efficiently using ETags
    res.setHeader('Cache-Control', 'private, no-cache')
  } else {
    // Mutations must never be cached
    res.setHeader('Cache-Control', 'no-store')
  }
  next()
})

// Health check
app.get('/api/health', (_req: express.Request, res: express.Response) => {
  res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'lisdt-backend',
  })
})

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/media', mediaRoutes)

// 404 Handler
app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: 'Route not found' })
})

// Error Handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled server error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(` Lisdt backend running on http://0.0.0.0:${PORT}`)
  console.log(` Health check: http://0.0.0.0:${PORT}/api/health`)
})
