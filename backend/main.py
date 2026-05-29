import os
import smtplib
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from database import Base, SessionLocal, engine
from routers import plans, tasks

scheduler = AsyncIOScheduler()


def run_migrations():
    """Non-destructively add any new columns introduced after initial create_all."""
    with engine.connect() as conn:
        for stmt in [
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN DEFAULT FALSE",
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_minutes_before INTEGER DEFAULT 30",
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_email VARCHAR(255)",
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE",
        ]:
            conn.execute(text(stmt))
        conn.commit()


def send_reminder_email(to_email: str, task) -> None:
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASS", "")

    if not smtp_user or not smtp_pass:
        print(f"[REMINDER] SMTP not configured — skipping email to {to_email} for: {task.title}")
        return

    due_ref = task.due_date or task.next_due_at
    due_str = due_ref.strftime("%a %b %d at %I:%M %p") if due_ref else "soon"
    dread_str = ("■" * (task.dread_score or 0)) + ("□" * (5 - (task.dread_score or 0)))
    energy_str = (task.energy_level or "—").replace("_", " ").upper()

    body = f"""TASKMGMT REMINDER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Task:    {task.title}
  Due:     {due_str}
  Dread:   {dread_str} {task.dread_score or "—"}/5
  Energy:  {energy_str}

Open TaskMgmt to stay on track.
"""
    msg = MIMEText(body, "plain")
    msg["Subject"] = f"[TASKMGMT] ⏰ {task.title}"
    msg["From"] = smtp_user
    msg["To"] = to_email

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.ehlo()
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.send_message(msg)
    print(f"[REMINDER] Sent email to {to_email} for task: {task.title}")


def check_and_send_reminders() -> None:
    from models import Task  # local import to avoid circular deps at module load

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        due_tasks = (
            db.query(Task)
            .filter(
                Task.reminder_enabled.is_(True),
                Task.reminder_sent.is_(False),
                Task.completed.is_(False),
            )
            .all()
        )
        for task in due_tasks:
            due_ref = task.due_date or task.next_due_at
            if not due_ref:
                continue
            due_aware = due_ref.replace(tzinfo=timezone.utc) if due_ref.tzinfo is None else due_ref
            remind_at = due_aware - timedelta(minutes=task.reminder_minutes_before or 30)
            if now >= remind_at:
                email = task.reminder_email or os.getenv("DEFAULT_REMINDER_EMAIL", "")
                if email:
                    try:
                        send_reminder_email(email, task)
                    except Exception as exc:
                        print(f"[REMINDER] Email failed for task {task.id}: {exc}")
                task.reminder_sent = True
                db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    run_migrations()
    scheduler.add_job(check_and_send_reminders, "interval", minutes=1, id="reminders")
    scheduler.start()
    yield
    scheduler.shutdown()


app = FastAPI(title="TaskMgmt API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tasks.router)
app.include_router(plans.router)


@app.get("/health")
def health():
    return {"status": "ok"}
