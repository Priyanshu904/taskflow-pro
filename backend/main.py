import os
from datetime import date, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel
from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy import event
from dotenv import load_dotenv

from dependency_engine import compute_status, propagate_schedule_change, recompute_after_regression, would_create_cycle

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./taskflow.db")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(connection, record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
Session = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(250))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="Backlog")
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    board_position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Dependency(Base):
    __tablename__ = "dependencies"
    id: Mapped[int] = mapped_column(primary_key=True)
    upstream_task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    downstream_task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))


class ScheduleEvent(Base):
    __tablename__ = "schedule_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    delta_days: Mapped[int] = mapped_column(Integer)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    reason: Mapped[str] = mapped_column(Text)


Base.metadata.create_all(engine)
app = FastAPI(title="TaskFlow Pro")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])
STATUSES = {"Backlog", "In Progress", "Review", "Done"}


class TaskInput(BaseModel):
    title: str
    description: str = ""
    status: str = "Backlog"
    start_date: date | None = None
    end_date: date | None = None
    board_position: int = 0


class TaskPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    board_position: int | None = None


class DependencyInput(BaseModel):
    upstream_task_id: int
    downstream_task_id: int


def graph_data(db):
    tasks = {task.id: {"id": task.id, "status": task.status, "title": task.title} for task in db.query(Task).all()}
    edges = [(edge.upstream_task_id, edge.downstream_task_id) for edge in db.query(Dependency).all()]
    return tasks, edges


def serialize_task(task, db, graph):
    tasks, edges = graph
    result = {key: getattr(task, key) for key in ("id", "title", "description", "status", "start_date", "end_date", "board_position", "created_at", "updated_at")}
    result["computed_status"] = compute_status(tasks[task.id], tasks, edges)
    result["dependencies"] = [upstream for upstream, downstream in edges if downstream == task.id]
    result["dependency_titles"] = [tasks[upstream]["title"] for upstream, downstream in edges if downstream == task.id]
    result["dependency_edges"] = [{"id": edge.id, "upstream_task_id": edge.upstream_task_id} for edge in db.query(Dependency).filter_by(downstream_task_id=task.id).all()]
    return result


@app.get("/tasks")
def list_tasks():
    with Session() as db:
        graph = graph_data(db)
        return [serialize_task(task, db, graph) for task in db.query(Task).order_by(Task.board_position, Task.id).all()]


@app.post("/tasks")
def create_task(body: TaskInput):
    if body.status not in STATUSES:
        raise HTTPException(400, "Invalid task status")
    with Session() as db:
        task = Task(**body.model_dump())
        db.add(task)
        db.commit()
        db.refresh(task)
        return serialize_task(task, db, graph_data(db))


@app.patch("/tasks/{task_id}")
def update_task(task_id: int, patch: TaskPatch):
    body = patch.model_dump(exclude_unset=True)
    allowed = {"title", "description", "status", "start_date", "end_date", "board_position"}
    if set(body) - allowed:
        raise HTTPException(400, "Unsupported task fields")
    if "status" in body and body["status"] not in STATUSES:
        raise HTTPException(400, "Invalid task status")
    with Session() as db:
        task = db.get(Task, task_id)
        if not task:
            raise HTTPException(404, "Task not found")
        old_status = task.status
        old_start, old_end = task.start_date, task.end_date
        for key, value in body.items():
            setattr(task, key, value)
        db.flush()
        delta = None
        if "start_date" in body and task.start_date and old_start:
            delta = (task.start_date - old_start).days
        elif "end_date" in body and task.end_date and old_end:
            delta = (task.end_date - old_end).days
        if delta:
            tasks, edges = graph_data(db)
            shifts = propagate_schedule_change(task_id, delta, tasks, edges)
            for affected_id, shift in shifts.items():
                if affected_id == task_id or not shift:
                    continue
                affected = db.get(Task, affected_id)
                if affected.start_date:
                    affected.start_date = date.fromordinal(affected.start_date.toordinal() + shift)
                if affected.end_date:
                    affected.end_date = date.fromordinal(affected.end_date.toordinal() + shift)
                db.add(ScheduleEvent(task_id=affected_id, delta_days=shift, reason=f"propagated from Task {task_id}"))
        if old_status == "Done" and task.status != "Done":
            tasks, edges = graph_data(db)
            recompute_after_regression(task_id, tasks, edges)
        db.add(ScheduleEvent(task_id=task_id, delta_days=delta or 0, reason="manual edit"))
        db.commit()
        return serialize_task(task, db, graph_data(db))


@app.delete("/tasks/{task_id}")
def delete_task(task_id: int):
    with Session() as db:
        task = db.get(Task, task_id)
        if not task:
            raise HTTPException(404, "Task not found")
        db.delete(task)
        db.commit()
        return {"ok": True}


@app.post("/dependencies")
def create_dependency(body: DependencyInput):
    with Session() as db:
        if not db.get(Task, body.upstream_task_id) or not db.get(Task, body.downstream_task_id):
            raise HTTPException(404, "Both tasks must exist")
        edges = [(edge.upstream_task_id, edge.downstream_task_id) for edge in db.query(Dependency).all()]
        if would_create_cycle(edges, body.upstream_task_id, body.downstream_task_id):
            raise HTTPException(400, "Dependency would create a cycle")
        if (body.upstream_task_id, body.downstream_task_id) in edges:
            raise HTTPException(409, "Dependency already exists")
        edge = Dependency(**body.model_dump())
        db.add(edge)
        db.commit()
        db.refresh(edge)
        return {"id": edge.id, **body.model_dump()}


@app.delete("/dependencies/{dependency_id}")
def delete_dependency(dependency_id: int):
    with Session() as db:
        edge = db.get(Dependency, dependency_id)
        if not edge:
            raise HTTPException(404, "Dependency not found")
        db.delete(edge)
        db.commit()
        return {"ok": True}


@app.get("/tasks/{task_id}/schedule-history")
def schedule_history(task_id: int):
    with Session() as db:
        if not db.get(Task, task_id):
            raise HTTPException(404, "Task not found")
        return [{"id": row.id, "task_id": row.task_id, "delta_days": row.delta_days, "timestamp": row.timestamp, "reason": row.reason} for row in db.query(ScheduleEvent).filter_by(task_id=task_id).order_by(ScheduleEvent.timestamp).all()]


class SuggestInput(BaseModel):
    title: str
    description: str = ""


@app.post("/ai/suggest-dependencies")
def suggest_dependencies(body: SuggestInput):
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise HTTPException(503, "Set GROQ_API_KEY to enable suggestions")
    with Session() as db:
        titles = [task.title for task in db.query(Task).all()]
    client = OpenAI(api_key=key, base_url="https://api.groq.com/openai/v1")
    response = client.chat.completions.create(model="qwen/qwen3.8-27b", response_format={"type": "json_object"}, messages=[{"role": "system", "content": "Suggest prerequisite task titles only from the supplied list. Return JSON: {suggestions:[{title,confidence,rationale}]}. Do not invent titles."}, {"role": "user", "content": f"Existing task titles: {titles}\nNew task title: {body.title}\nNew task description: {body.description}"}])
    import json
    try:
        suggestions = json.loads(response.choices[0].message.content)["suggestions"]
        allowed = set(titles)
        return {"suggestions": [item for item in suggestions if item.get("title") in allowed]}
    except (ValueError, KeyError, TypeError):
        raise HTTPException(502, "AI returned an invalid suggestion response")
