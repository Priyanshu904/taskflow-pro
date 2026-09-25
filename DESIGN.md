# TaskFlow Pro Design

For setup and a quick start, see [README.md](README.md). Live and automated verification results are in [TESTING.md](TESTING.md), and observed edge cases are in [FAILURE_CASES.md](FAILURE_CASES.md).

## Architecture

The React frontend renders the Kanban board, collects edits, and displays computed task readiness. Drag-and-drop status changes and task/dependency edits use the FastAPI JSON API. The API validates requests, applies business rules from the pure dependency engine, and persists changes using SQLAlchemy. SQLite stores the task graph and schedule audit history.

```text
React UI (@dnd-kit)
        │ HTTP / JSON
        ▼
FastAPI routes ───────────► SQLite (SQLAlchemy)
        │                   tasks, dependencies,
        ▼                   schedule events
Dependency Engine
(pure in-memory graph functions)
```

The dependency engine operates on graph structures passed by the API; it has no FastAPI or database coupling. Readiness is computed from task statuses and dependency edges for each response, so it cannot drift from the persisted graph. The AI endpoint sends existing task titles and a proposed task to Groq, filters suggestions to known titles, and returns them for user review. Only explicit frontend approval calls the dependency creation endpoint, which always performs cycle validation.

The live AI flow has been verified against Groq using the configured key and the `qwen/qwen3.8-27b` model. The “Prepare production deployment” example returned four suggestions, all matched existing task titles, and the task edge count did not change until one suggestion was explicitly approved through `POST /dependencies`. The approved edge appeared in `GET /tasks`; a reverse edge was rejected as a cycle. The process-level missing-key fallback also returned the documented HTTP 503 without modifying the root `.env`.

## Data Model

| Table | Field | Type | Meaning |
|---|---|---|---|
| Task | `id` | integer, primary key | Task identifier |
| Task | `title` | string (up to 250 characters) | Task name |
| Task | `description` | text | Task details; defaults to empty text |
| Task | `status` | string enum | `Backlog`, `In Progress`, `Review`, or `Done` |
| Task | `start_date` | nullable date | Planned start |
| Task | `end_date` | nullable date | Planned finish |
| Task | `board_position` | integer | Ordering position |
| Task | `created_at` | datetime | Creation timestamp |
| Task | `updated_at` | datetime | Last update timestamp |
| Dependency | `id` | integer, primary key | Edge identifier |
| Dependency | `upstream_task_id` | integer, FK to Task | Prerequisite task |
| Dependency | `downstream_task_id` | integer, FK to Task | Task that depends on the prerequisite |
| ScheduleEvent | `id` | integer, primary key | Audit event identifier |
| ScheduleEvent | `task_id` | integer, FK to Task | Task whose schedule shifted |
| ScheduleEvent | `delta_days` | integer | Calendar-day shift applied |
| ScheduleEvent | `timestamp` | datetime | Event time |
| ScheduleEvent | `reason` | text | Manual edit or propagation source |

An edge A → B means B cannot be Ready until A is Done. Blocked/Ready is not a stored column. Backlog and In Progress tasks are Ready only when all direct prerequisites are Done; Review and Done retain their workflow status.

## Schedule Propagation

The API calculates the edited task's date delta and asks the engine to propagate it through the directed acyclic graph. The engine processes nodes topologically, so every affected predecessor is handled before its descendants. It carries a shift along each reachable path and records the maximum arriving shift at a node. The return value is a task-to-delta mapping; the API applies the dates and adds schedule audit events.

At a reconverging task, summing incoming shifts would count one originating schedule edit multiple times. The paths represent alternate prerequisite routes by which the same schedule change reaches a task, not independent changes to add together. Taking the maximum preserves the full shift while avoiding that double count.

For A → B → D and A → C → D, when A moves by +3 days:

1. A starts with delta +3.
2. B receives +3 from A; C independently receives +3 from A.
3. D receives +3 from B and +3 from C.
4. D takes `max(+3, +3) = +3`; it moves three days, not six.

For a negative shift or unequal path shifts, the same maximum rule is applied to the arriving signed deltas. Only nodes reachable from the edited task are returned.

## Known Limitations

- The workspace is single-user and has no authentication or multi-tenant access control.
- Dependencies support finish-to-start relationships only, with no lag or resource constraints.
- Dates use calendar days; weekends, holidays, and working calendars are not modeled.
- SQLite is intended for local demos and does not target concurrent production workloads.
- Critical-path analysis is optional and not implemented.
- Duplicate task titles are allowed; AI suggestions identify tasks by title, so duplicate titles can be ambiguous in the approval UI.
- AI suggestions require a configured `GROQ_API_KEY`; without one the endpoint returns HTTP 503.
- Date parsing is validated by Pydantic and invalid dates return HTTP 422; validation errors are not presented with custom field-level UI messaging.
