# TASKMGMT

A focused task manager with cognitive load tracking, recurring streak monitoring, and daily planning — built with FastAPI + PostgreSQL on the backend and vanilla HTML/CSS/JS on the frontend.

---

## Backend

### Stack

| Layer      | Tech                                      |
|------------|-------------------------------------------|
| Framework  | [FastAPI](https://fastapi.tiangolo.com/)  |
| ORM        | SQLAlchemy 2.x                            |
| Database   | PostgreSQL                                |
| Scheduler  | APScheduler (email reminders)             |
| Validation | Pydantic v2                               |

### Structure

```
backend/
├── main.py          # App entry point, CORS, lifespan, scheduler, migrations
├── database.py      # SQLAlchemy engine, session, Base
├── models.py        # ORM models: Task, DailyPlan
├── schemas.py       # Pydantic request/response schemas
├── routers/
│   ├── tasks.py     # Task CRUD + /complete (streak logic)
│   └── plans.py     # Daily plan endpoints
└── requirements.txt
```

### API Endpoints

#### Tasks

| Method | Path                   | Description                                     |
|--------|------------------------|-------------------------------------------------|
| GET    | `/tasks/`              | List all tasks (filter: `completed`, `energy_level`) |
| POST   | `/tasks/`              | Create a task                                   |
| PUT    | `/tasks/{id}`          | Update a task                                   |
| DELETE | `/tasks/{id}`          | Delete a task                                   |
| POST   | `/tasks/{id}/complete` | Complete a task (handles streak logic)          |

#### Plans

| Method | Path                      | Description                            |
|--------|---------------------------|----------------------------------------|
| GET    | `/plans/today`            | Get or create today's daily plan       |
| PUT    | `/plans/today/must-dos`   | Set the 3 must-do task IDs for today   |
| GET    | `/plans/date/{YYYY-MM-DD}`| Fetch any past day's plan              |

### Data Model

#### Task

| Field                    | Type     | Notes                                          |
|--------------------------|----------|------------------------------------------------|
| `title`                  | string   | Required                                       |
| `description`            | text     | Optional                                       |
| `energy_level`           | enum     | `deep_focus` / `medium` / `quick_win` / `mindless` |
| `dread_score`            | int 1–5  | How much you're avoiding it                    |
| `due_date`               | datetime | Optional, timezone-aware                       |
| `completed`              | bool     | False for recurring tasks (they never "stay done") |
| `is_recurring`           | bool     |                                                |
| `recurrence_pattern`     | enum     | `daily` / `weekly` / `monthly`                 |
| `current_streak`         | int      | Consecutive completions within grace period    |
| `longest_streak`         | int      | Personal best                                  |
| `last_completed_at`      | datetime | Used to compute heat decay client-side         |
| `next_due_at`            | datetime | Set automatically on each completion           |
| `reminder_enabled`       | bool     | Triggers email reminder                        |
| `reminder_minutes_before`| int      | Default 30                                     |
| `reminder_email`         | string   | Falls back to `DEFAULT_REMINDER_EMAIL` env var |
| `reminder_sent`          | bool     | Reset when due date changes or task recurs     |

#### DailyPlan

| Field               | Type       | Notes                         |
|---------------------|------------|-------------------------------|
| `plan_date`         | string     | `YYYY-MM-DD`, unique per day  |
| `must_do_task_ids`  | int[]      | Max 3 task IDs                |

### Streak Logic

When `POST /tasks/{id}/complete` is called on a recurring task:

- If `now - last_completed_at <= period × 2` → streak continues (`+1`)
- Otherwise → streak resets to `1`
- `longest_streak` is updated if the current streak exceeds it
- `next_due_at` is set to `now + period`
- `reminder_sent` is reset to `false` so the reminder fires for the next cycle
- `completed` stays `false` — recurring tasks are never permanently done

### Email Reminders

The scheduler runs every minute and checks for tasks where:
- `reminder_enabled = true`
- `reminder_sent = false`
- `completed = false`
- `now >= due_date - reminder_minutes_before`

On match it sends a plain-text email via SMTP and sets `reminder_sent = true`. Configure via environment variables (see `.env.example`).

### Database Migrations

The app uses `Base.metadata.create_all()` on startup for fresh installs. For existing databases, `main.py` also runs non-destructive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements so new columns are added safely without dropping data.

---

## Setup

### Prerequisites

- Python 3.11+
- PostgreSQL running locally (or a remote connection string)

### Install & Run

```bash
# 1. Create the database
createdb taskmgmt

# 2. Install dependencies
cd backend
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL and SMTP settings

# 4. Start the server
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`.  
Interactive docs: `http://localhost:8000/docs`

### Environment Variables

See `.env.example` for all available variables. The only required one for basic usage is `DATABASE_URL`. SMTP variables are only needed if you enable email reminders on tasks.

---

## Frontend

Vanilla HTML/CSS/JS — no build step. Open `frontend/index.html` with a local server:

```bash
cd frontend
python -m http.server 3000
# visit http://localhost:3000
```

Or use VS Code Live Server. The frontend connects to the backend at `http://localhost:8000` by default (configurable via `API_BASE` in `app.js`).

---

## Features

- **Cognitive load tagging** — energy level + dread score per task, sorted by most-avoided first
- **Recurring streaks with heat decay** — visual 20-char bar that cools from green → red as the deadline approaches
- **Daily planning mode** — overdue + due-today sections, pin 3 must-dos that persist per day with drag-to-reorder
- **Focus mode** — fullscreen Pomodoro-style timer with configurable duration, session tracking, and one-click task completion
- **Yesterday's rollover** — prompts to carry forward any must-dos left unfinished the day before
- **Email + browser reminders** — SMTP email scheduled server-side; browser notifications fired client-side 30 min before due
- **Light / dark mode** — respects system preference, manually toggleable, persisted to localStorage
