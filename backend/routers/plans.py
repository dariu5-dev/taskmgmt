from datetime import date
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import DailyPlan, Task
from schemas import DailyPlanResponse, SetMustDos, TaskResponse

router = APIRouter(prefix="/plans", tags=["plans"])


def _build_response(plan: DailyPlan, db: Session) -> DailyPlanResponse:
    must_do_tasks: List[TaskResponse] = []
    ids = plan.must_do_task_ids or []
    if ids:
        tasks = db.query(Task).filter(Task.id.in_(ids)).all()
        task_map = {t.id: t for t in tasks}
        must_do_tasks = [task_map[tid] for tid in ids if tid in task_map]
    return DailyPlanResponse(
        id=plan.id,
        plan_date=plan.plan_date,
        must_do_task_ids=ids,
        must_do_tasks=must_do_tasks,
    )


@router.get("/today", response_model=DailyPlanResponse)
def get_today_plan(db: Session = Depends(get_db)):
    today = date.today().isoformat()
    plan = db.query(DailyPlan).filter(DailyPlan.plan_date == today).first()
    if not plan:
        plan = DailyPlan(plan_date=today, must_do_task_ids=[])
        db.add(plan)
        db.commit()
        db.refresh(plan)
    return _build_response(plan, db)


@router.get("/date/{plan_date}", response_model=DailyPlanResponse)
def get_plan_by_date(plan_date: str, db: Session = Depends(get_db)):
    plan = db.query(DailyPlan).filter(DailyPlan.plan_date == plan_date).first()
    if not plan:
        return DailyPlanResponse(id=0, plan_date=plan_date, must_do_task_ids=[], must_do_tasks=[])
    return _build_response(plan, db)


@router.put("/today/must-dos", response_model=DailyPlanResponse)
def set_must_dos(body: SetMustDos, db: Session = Depends(get_db)):
    if len(body.task_ids) > 3:
        raise HTTPException(status_code=400, detail="Maximum 3 must-do tasks allowed")

    today = date.today().isoformat()
    plan = db.query(DailyPlan).filter(DailyPlan.plan_date == today).first()
    if not plan:
        plan = DailyPlan(plan_date=today, must_do_task_ids=body.task_ids)
        db.add(plan)
    else:
        plan.must_do_task_ids = body.task_ids

    db.commit()
    db.refresh(plan)
    return _build_response(plan, db)
