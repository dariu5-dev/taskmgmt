from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import RecurrencePattern, Task
from schemas import TaskCreate, TaskResponse, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _period(pattern: RecurrencePattern) -> timedelta:
    return {
        RecurrencePattern.daily: timedelta(days=1),
        RecurrencePattern.weekly: timedelta(weeks=1),
        RecurrencePattern.monthly: timedelta(days=30),
    }[pattern]


def _next_due(pattern: RecurrencePattern, from_dt: datetime) -> datetime:
    return from_dt + _period(pattern)


@router.get("/", response_model=List[TaskResponse])
def get_tasks(
    completed: Optional[bool] = None,
    energy_level: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Task)
    if completed is not None:
        q = q.filter(Task.completed == completed)
    if energy_level:
        q = q.filter(Task.energy_level == energy_level)
    return q.order_by(Task.created_at.desc()).all()


@router.post("/", response_model=TaskResponse)
def create_task(task: TaskCreate, db: Session = Depends(get_db)):
    data = task.model_dump()
    db_task = Task(**data)
    if db_task.is_recurring and db_task.recurrence_pattern:
        db_task.next_due_at = _next_due(db_task.recurrence_pattern, datetime.now(timezone.utc))
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task


@router.put("/{task_id}", response_model=TaskResponse)
def update_task(task_id: int, update: TaskUpdate, db: Session = Depends(get_db)):
    db_task = db.query(Task).filter(Task.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")
    changes = update.model_dump(exclude_unset=True)
    if "due_date" in changes:
        db_task.reminder_sent = False  # new due date means the reminder should re-fire
    for field, value in changes.items():
        setattr(db_task, field, value)
    db.commit()
    db.refresh(db_task)
    return db_task


@router.delete("/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    db_task = db.query(Task).filter(Task.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(db_task)
    db.commit()
    return {"ok": True}


@router.post("/{task_id}/complete", response_model=TaskResponse)
def complete_task(task_id: int, db: Session = Depends(get_db)):
    db_task = db.query(Task).filter(Task.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    now = datetime.now(timezone.utc)

    if db_task.is_recurring and db_task.recurrence_pattern:
        if db_task.last_completed_at:
            last = db_task.last_completed_at.replace(tzinfo=timezone.utc)
            grace = _period(db_task.recurrence_pattern) * 2
            if (now - last) <= grace:
                db_task.current_streak += 1
            else:
                db_task.current_streak = 1
        else:
            db_task.current_streak = 1

        if db_task.current_streak > db_task.longest_streak:
            db_task.longest_streak = db_task.current_streak

        db_task.last_completed_at = now
        db_task.next_due_at = _next_due(db_task.recurrence_pattern, now)
        db_task.reminder_sent = False  # reset so reminder fires for the next occurrence
        # recurring tasks stay "active" — don't flip completed permanently
        db_task.completed = False
        db_task.completed_at = now
    else:
        db_task.completed = True
        db_task.completed_at = now

    db.commit()
    db.refresh(db_task)
    return db_task
