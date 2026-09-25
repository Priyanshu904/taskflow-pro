# TaskFlow Pro

TaskFlow Pro is a single workspace Kanban board with dependency-aware readiness and date propagation.

See [DESIGN.md](DESIGN.md) for the architecture, full data model, and propagation details; [TESTING.md](TESTING.md) contains the test report and [FAILURE_CASES.md](FAILURE_CASES.md) records observed edge cases.

## Run locally

Requirements: Python 3.10+ and Node.js 18+.

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item ..\.env.example ..\.env
python seed.py
uvicorn main:app --reload
```

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

The API listens on `http://localhost:8000`; the Vite app listens on `http://localhost:5173`. Set `GROQ_API_KEY` in the root `.env` to enable AI suggestions. The backend reads environment variables directly; if using `.env`, export its value in your shell or run through a dotenv loader.

## Architecture

- React and `@dnd-kit` provide the four-column Kanban UI and human-reviewed AI suggestions.
- FastAPI exposes task, dependency, schedule-history, and AI endpoints.
- `backend/dependency_engine.py` contains pure in-memory graph functions with no database or web framework coupling.
- SQLAlchemy persists tasks, dependencies, and schedule events in SQLite (`backend/taskflow.db`).

## Data model

Tasks store title, description, workflow status, optional start/end dates, board position, and timestamps. A dependency edge from task A to task B means B depends on A. Schedule events record the task, delta in days, timestamp, and reason. Blocked/Ready is computed at request time, never persisted. Backlog and In Progress tasks are Ready when every direct prerequisite is Done; otherwise they are Blocked. Review and Done keep their workflow status.

## Schedule propagation

The engine propagates a change through the DAG in topological order. At each converging node it takes the maximum accumulated shift from changed incoming paths, so the same originating delay is not added once per path. For a diamond A→B→D and A→C→D, shifting A by three days shifts B, C, and D by three days; D does not move six days. The function only returns calculated deltas; the API applies dates and writes audit events.

## AI suggestions

The AI endpoint sends the new task's title and description plus only the existing task titles as its candidate set. The system prompt requires suggestions to use titles from that closed set, and the API filters any invented titles. Suggestions include confidence and rationale but are never persisted as dependencies automatically. A user approves suggestions in the UI, which then calls the same cycle-checked dependency endpoint used for manual edges. AI requires `GROQ_API_KEY` and uses Groq's OpenAI-compatible API.

## Key Assumptions and Limitations

- The app is a single-user workspace and has no authentication or multi-tenant access controls.
- Dependencies are finish-to-start and have no lag, resource, or calendar semantics.
- Date propagation treats each task shift as an integer number of calendar days; weekends and holidays are not excluded.
- SQLite is intended for local/demo use, not concurrent production workloads.
- The critical-path endpoint is not implemented.

## Tests

```powershell
cd backend
pytest -q
```

Tests cover cycle prevention, ready/blocked status, regression, multilevel propagation, and max-not-sum propagation at a diamond.
