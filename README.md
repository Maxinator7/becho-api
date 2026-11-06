# `becho-api`

Becho API Backend — Node.js + TypeScript Modular Monolith with PostgreSQL.

## Architecture

This repository follows a **modular monolith** design pattern:

```text
src/
├── config/             # Environment validation & constants
├── common/             # Middleware, error handling, base utilities
└── routes/             # Modular domain routes (v1 API)
```

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Setup environment variables:
   ```bash
   cp .env.example .env
   ```

3. Ensure PostgreSQL is running (e.g. via parent `docker-compose.yml`):
   ```bash
   docker compose up -d
   ```

4. Run Prisma schema generation:
   ```bash
   npm run prisma:generate
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

## Available Scripts

- `npm run dev`: Starts development server with auto-reload
- `npm run build`: Compiles TypeScript to `dist/`
- `npm run typecheck`: Runs TypeScript compiler without output
- `npm run test`: Runs test suite
