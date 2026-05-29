from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, field_validator
from models import EnergyLevel, RecurrencePattern


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    energy_level: Optional[EnergyLevel] = None
    dread_score: Optional[int] = None
    due_date: Optional[datetime] = None
    is_recurring: bool = False
    recurrence_pattern: Optional[RecurrencePattern] = None
    reminder_enabled: bool = False
    reminder_minutes_before: int = 30
    reminder_email: Optional[str] = None

    @field_validator("dread_score")
    @classmethod
    def validate_dread(cls, v):
        if v is not None and not (1 <= v <= 5):
            raise ValueError("dread_score must be between 1 and 5")
        return v


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    energy_level: Optional[EnergyLevel] = None
    dread_score: Optional[int] = None
    due_date: Optional[datetime] = None
    completed: Optional[bool] = None
    is_recurring: Optional[bool] = None
    recurrence_pattern: Optional[RecurrencePattern] = None
    reminder_enabled: Optional[bool] = None
    reminder_minutes_before: Optional[int] = None
    reminder_email: Optional[str] = None

    @field_validator("dread_score")
    @classmethod
    def validate_dread(cls, v):
        if v is not None and not (1 <= v <= 5):
            raise ValueError("dread_score must be between 1 and 5")
        return v


class TaskResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    energy_level: Optional[EnergyLevel]
    dread_score: Optional[int]
    due_date: Optional[datetime]
    completed: bool
    completed_at: Optional[datetime]
    is_recurring: bool
    recurrence_pattern: Optional[RecurrencePattern]
    current_streak: int
    longest_streak: int
    last_completed_at: Optional[datetime]
    next_due_at: Optional[datetime]
    reminder_enabled: bool
    reminder_minutes_before: int
    reminder_email: Optional[str]
    reminder_sent: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class DailyPlanResponse(BaseModel):
    id: int
    plan_date: str
    must_do_task_ids: List[int]
    must_do_tasks: List[TaskResponse] = []

    model_config = {"from_attributes": True}


class SetMustDos(BaseModel):
    task_ids: List[int]
