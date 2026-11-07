# 5S Practice

Web app for the 5S practice workflow: users photograph **Before** / **After** states, an **Auditor** approves, and the quarterly project is closed once every task is approved.

Stack: React (Vite) · Node.js/Express · PostgreSQL. Images are stored on disk (`backend/uploads`).

## Workflow

1. Admin/Auditor creates a quarterly project (e.g. Q1 2026, status **Open**).
2. Anyone uploads a **Before** photo (camera capture on mobile) → this creates a **Task** (title, area, notes). Admin/Auditor can assign any owner; users own their own tasks by default. The owner can be changed later.
3. The owner uploads the **After** photo → status **Submitted**.
4. The Auditor **Approves** or **Rejects** (remarks required on reject). Rejected tasks go back to the owner for rework (new After photo → Submitted again).
5. When **all** tasks are Approved the Auditor (or Admin) can **Close** the project. Closing is refused otherwise (or if there are no tasks).
6. **Summary**: per-user completed % = approved ÷ assigned tasks.
7. **Report** page and **PDF export**: Before/After side by side per approved task with a label `Completed by <user>` plus the approving auditor and date.

Roles: `ADMIN` (manage users, projects, assign, close), `AUDITOR` (review, create projects, assign, close), `USER` (create tasks, upload After on own tasks).

## Setup

Prerequisites: Node 18+ and Docker (or any PostgreSQL 14+).

```bash
cp .env.example backend/.env        # adjust JWT_SECRET etc.
docker compose up -d                # PostgreSQL on :5432 (db/user/password: fives)

cd backend
npm install
npm run migrate                     # apply DB migrations
npm run seed                        # demo users + Q1 2026 project
npm run dev                         # API on http://localhost:4000

# in another terminal
cd frontend
npm install
npm run dev                         # UI on http://localhost:5173 (proxies /api and /uploads)
```

Migrations also run automatically when the API starts.

Demo accounts (from seed):

| Role    | Email              | Password   |
|---------|--------------------|------------|
| Admin   | admin@5s.local     | admin123   |
| Auditor | auditor@5s.local   | auditor123 |
| User    | user1@5s.local     | user123    |
| User    | user2@5s.local     | user123    |

Change these (and `JWT_SECRET`) outside local development.

Mobile: open `http://<your-computer-ip>:5173` on a phone on the same network; the file inputs use `capture="environment"` to open the camera.

## Production build

```bash
cd frontend && npm run build        # outputs frontend/dist
```
Serve `dist` with any static server and reverse-proxy `/api` and `/uploads` to the API (`API_URL` env configures the dev proxy target).

## Tests

API tests (Node test runner + supertest) run against a real PostgreSQL. **They drop and recreate the `public` schema** of the database in `DATABASE_URL`, so point them at a throwaway DB:

```bash
cd backend
DATABASE_URL=postgres://fives:fives@localhost:5432/fives_test npm test
```
(create it first: `docker compose exec db createdb -U fives fives_test`)

## API overview

All routes except login require `Authorization: Bearer <jwt>`. Images and the PDF also accept `?token=<jwt>` so `<img>` and download links work.

- `POST /api/auth/login`, `GET /api/auth/me`
- `GET/POST /api/users` (create: Admin)
- `GET/POST /api/projects`, `GET /api/projects/:id`, `POST /api/projects/:id/close`
- `GET /api/projects/:id/tasks`, `POST /api/projects/:id/tasks` (multipart: `before`, `title`, `area`, `notes`, `owner_id`)
- `GET/PATCH /api/tasks/:id`, `POST /api/tasks/:id/after` (multipart `after`), `POST /api/tasks/:id/review` (`decision`, `remarks`)
- `GET /api/projects/:id/summary`, `/report`, `/report.pdf`

JPEG and PNG uploads only (max 10 MB).
