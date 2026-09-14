# Lisdt Backend API (with Supabase PostgreSQL)

Node.js + Express + TypeScript + Prisma ORM connected to **Supabase PostgreSQL**.

---

## ?? Supabase Setup Guide

### 1. Retrieve Connection Strings from Supabase
1. Go to your [Supabase Dashboard](https://supabase.com/dashboard).
2. Select your project and navigate to **Project Settings** (gear icon) ? **Database**.
3. Scroll down to **Connection string** and select the **URI** or **Prisma** tab:
   - **Transaction Pooler** (Port `6543`) ? Copy this into `DATABASE_URL` in `.env` (append `?pgbouncer=true` if not present).
   - **Session / Direct Connection** (Port `5432`) ? Copy this into `DIRECT_URL` in `.env`.
4. Make sure to replace `[YOUR-PASSWORD]` with the database password you set when creating the Supabase project.

### 2. Configure `backend/.env`
```env
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:5173

DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"

JWT_SECRET="lisdt_super_secret_jwt_key_2026"
```

### 3. Push the Schema to Supabase
Once your credentials are in `.env`, sync your tables to Supabase:
```powershell
npm run prisma:migrate
```
*(Or run `npx prisma db push` to push the schema directly)*

### 4. Start the Development Server
```powershell
npm run dev
```
Server runs on `http://localhost:5000`.

---

## ?? API Endpoints

### ?? Health
- `GET /api/health`

### ?? Authentication
- `POST /api/auth/register` (seeds default categories: Anime, Movies, Live Action)
- `POST /api/auth/login`
- `GET /api/auth/me`

### ??? Categories
- `GET /api/categories`
- `POST /api/categories`
- `PUT /api/categories/:id`
- `DELETE /api/categories/:id`

### ?? Media Items
- `GET /api/media` (supports `?category=`, `?status=`, `?search=`, `?sort=`, `?order=`)
- `POST /api/media`
- `GET /api/media/:id`
- `PUT /api/media/:id`
- `PATCH /api/media/:id/stepper` (`{ delta: 1, field: "seasonsFinished" }`)
- `DELETE /api/media/:id`
