import enum
from sqlalchemy import Boolean, Column, DateTime, Enum as SAEnum, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.sql import func
from database import Base


class EnergyLevel(str, enum.Enum):
    deep_focus = "deep_focus"
    medium = "medium"
    quick_win = "quick_win"
    mindless = "mindless"


class RecurrencePattern(str, enum.Enum):
    daily = "daily"
    weekly = "weekly"
    monthly = "monthly"


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    energy_level = Column(SAEnum(EnergyLevel), nullable=True)
    dread_score = Column(Integer, nullable=True)  # 1–5
    due_date = Column(DateTime(timezone=True), nullable=True)
    completed = Column(Boolean, default=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    is_recurring = Column(Boolean, default=False)
    recurrence_pattern = Column(SAEnum(RecurrencePattern), nullable=True)
    current_streak = Column(Integer, default=0)
    longest_streak = Column(Integer, default=0)
    last_completed_at = Column(DateTime(timezone=True), nullable=True)
    next_due_at = Column(DateTime(timezone=True), nullable=True)
    reminder_enabled = Column(Boolean, default=False)
    reminder_minutes_before = Column(Integer, default=30)
    reminder_email = Column(String(255), nullable=True)
    reminder_sent = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DailyPlan(Base):
    __tablename__ = "daily_plans"

    id = Column(Integer, primary_key=True, index=True)
    plan_date = Column(String(10), nullable=False, unique=True)  # YYYY-MM-DD
    must_do_task_ids = Column(ARRAY(Integer), default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
