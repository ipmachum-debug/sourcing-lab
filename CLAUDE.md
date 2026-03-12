# CLAUDE.md — Sourcing Lab

## Project Overview

Sourcing Lab is a Korean e-commerce sourcing and sales management platform for Coupang sellers. It combines a web dashboard (React + Express/tRPC) with a Chrome extension for market analysis, AI-powered sourcing insights, and Coupang OPEN API integration for sales tracking.

**Production URL**: https://lumiriz.kr (port 3003 behind Nginx)

## Tech Stack

- **Runtime**: Node.js v22, TypeScript 5.9 (strict mode)
- **Backend**: Express 4.21 + tRPC 11.6 (type-safe RPC)
- **Frontend**: React 19, Vite 7.1, Tailwind CSS 4.1, shadcn/ui (Radix primitives)
- **Database**: MySQL 8.x via Drizzle ORM 0.44
- **Auth**: JWT (jose) in httpOnly cookies, bcrypt password hashing
- **Routing**: wouter 3.7.1 (patched via pnpm patches)
- **State**: TanStack Query (React Query) + tRPC client with superjson
- **AI**: OpenAI API integration for sourcing coach
- **Package Manager**: pnpm 10.4.1

## Project Structure

```
client/                  # React frontend
  src/
    components/          # React components + shadcn/ui in components/ui/
    pages/               # 19 page components
    hooks/               # Custom React hooks (use* prefix)
    lib/                 # tRPC client, utilities
    contexts/            # Theme context (dark mode)
server/                  # Express + tRPC backend
  _core/                 # Core infra: server setup, auth, JWT, LLM, env
    index.ts             # Main Express server (~10K lines)
  routers/               # 11 domain routers (tRPC procedures)
  db.ts                  # MySQL/Drizzle connection
  routers.ts             # Router composition
drizzle/                 # Database schema & SQL migrations
  schema.ts              # 22 Drizzle table definitions
shared/                  # Code shared between server & client
  types.ts               # Exported types from Drizzle schema
  const.ts               # COOKIE_NAME, error messages
  categories.ts          # Product categories
  _core/errors.ts        # Typed error definitions
coupang-helper-extension/ # Chrome Extension (Manifest V3)
```

## Commands

```bash
pnpm dev                 # Start dev server (tsx watch, hot reload)
pnpm build               # Build extension zip + Vite frontend + esbuild server
pnpm start               # Run production server (dist/index.js)
pnpm check               # TypeScript type-check (tsc --noEmit)
pnpm format              # Prettier format all files
pnpm db:push             # Generate + run Drizzle migrations
pnpm build:extension     # Zip Chrome extension to client/public/
```

## Code Conventions

### Formatting (Prettier)
- Double quotes, semicolons required
- 2-space indentation, 80-char line width, LF line endings
- Trailing commas in ES5 positions
- Arrow parens: avoid when possible (`x =>` not `(x) =>`)

### Naming
- **Files**: PascalCase for React components (`ProductDetail.tsx`), camelCase for utilities (`trpc.ts`)
- **Variables/functions**: camelCase
- **URL routes**: kebab-case (`/daily-profit`, `/settings/accounts`)
- **DB columns/tables**: snake_case (`product_name`, `created_at`)
- **Constants**: UPPER_SNAKE_CASE (`COOKIE_NAME`, `ONE_YEAR_MS`)

### TypeScript
- Strict mode enabled
- Path aliases: `@/*` → `client/src/*`, `@shared/*` → `shared/*`
- Shared types live in `shared/types.ts` (exported from Drizzle schema)
- Zod 4.1 for runtime validation

### React Patterns
- Functional components with hooks only
- shadcn/ui components in `client/src/components/ui/`
- Page components in `client/src/pages/`
- tRPC hooks for data fetching (no raw fetch/axios)
- sonner for toast notifications

### Backend Patterns
- tRPC procedures with three auth levels:
  - `publicProcedure` — no auth
  - `protectedProcedure` — requires login + admin approval
  - `adminProcedure` — superadmin only
- One router file per business domain in `server/routers/`
- Drizzle ORM for all DB queries (no raw SQL outside migrations)

## Database

- 22 tables defined in `drizzle/schema.ts`
- Migrations in `drizzle/` (SQL files 0000–0011)
- Key domains: users, products, sourcing, sales tracking, extension data, Coupang API accounts
- Run `pnpm db:push` to generate and apply migrations

## Environment Variables

Required in `.env`:
```
DATABASE_URL=mysql://...
JWT_SECRET=...
NODE_ENV=development|production
BUILT_IN_FORGE_API_URL=   # OpenAI-compatible API endpoint
BUILT_IN_FORGE_API_KEY=   # API key for LLM
VITE_APP_ID=sourcing-lab
```

## Chrome Extension

Located in `coupang-helper-extension/` (Manifest V3):
- `background.js` — Service Worker for message routing
- `content*.js` — Content scripts injected into Coupang/AliExpress pages
- `sidepanel.js/html/css` — Extension side panel UI
- `api-client.js` — Communicates with the server at lumiriz.kr
- `hybrid-parser.js` — Advanced DOM parsing logic
- Built via `pnpm build:extension` (zipped to `client/public/`)

## Deployment

Manual deployment via `deploy.sh` or webhook:
1. `git pull` on production server (49.50.130.101)
2. `pnpm install --frozen-lockfile`
3. Run pending DB migrations
4. `pnpm build`
5. `pm2 restart sourcing-lab --update-env`

## Testing

- Vitest configured (`vitest.config.ts`) for `server/**/*.test.ts`
- Type-checking: `pnpm check`
- No active test suite yet — infrastructure is ready

## Documentation

- `PROJECT_MANUAL.md` — Detailed technical architecture docs (Korean)
- `USER_GUIDE.md` — End-user manual (Korean)
