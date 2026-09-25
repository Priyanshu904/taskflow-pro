# TaskFlow Pro Test Report

See [README.md](README.md) for setup and [DESIGN.md](DESIGN.md) for architecture, algorithm details, and known failure cases.

## Automated Dependency Engine Tests

Run from `backend`:

```powershell
pytest -q -p no:cacheprovider --ignore-glob='pytest-cache-files-*'
```

The ignore pattern excludes inaccessible temporary directories left by an earlier pytest invocation in this workspace; it does not exclude project tests. Result: **5 passed**.

| Test | Expected | Actual |
|---|---|---|
| `test_cycle_detection` | Reject C → A when A → B → C already exists, leave the in-memory edge list unchanged, and accept non-cycling edges. | Passed; cycle detected and original edge list unchanged. |
| `test_diamond_propagates_max_not_sum` | A +3 sends B, C, and reconverging D +3, not +6. | Passed; map was `{A: 3, B: 3, C: 3, D: 3}`. |
| `test_multilevel_chain` | A -2 propagates through B and C. | Passed; each returned delta was -2. |
| `test_ready_and_blocked` | B is Blocked when A is unfinished and Ready when A is Done. | Passed. |
| `test_regression_reports_reblocked_dependents` | Regressing A from Done to In Progress reports its affected dependents. | Passed; returned B and C. |

## Manual API Checks

The following checks ran against a live Uvicorn server and the SQLite database. The database already contained nine seeded tasks. Temporary checks used tasks 10–15.

| Check | Request and expected behavior | Actual response |
|---|---|---|
| Diamond schedule propagation | `POST /tasks` created A, B, C, D; edges A → B, A → C, B → D, C → D. `PATCH /tasks/10` changed A's end date from 2026-10-02 to 2026-10-05. Expect +3 days on B, C, D, with D shifted once. | PATCH returned HTTP 200 and A end date `2026-10-05`. `GET /tasks` showed B and C dates `2026-10-06`–`2026-10-07`; D dates `2026-10-08`–`2026-10-09`. D depended on IDs 11 and 12 and shifted by exactly +3 days. |
| Cycle rejection | `POST /dependencies` with `{ "upstream_task_id": 13, "downstream_task_id": 10 }` would close a cycle. Expect HTTP 400 and no edge write. | HTTP 400, `{"detail":"Dependency would create a cycle"}`. A subsequent `GET /tasks` showed task 10 still had `dependencies: []`; its edge list was unchanged. |
| Status regression | Created Done task 14 and Backlog dependent 15, linked 14 → 15, then `PATCH /tasks/14` with status `In Progress`. Expect dependent to change Ready → Blocked. | Before: task 15 response had `computed_status: "Ready"`. After: `computed_status: "Blocked"`. |
| SQLite persistence | Restarted Uvicorn, then called `GET /tasks`. Expect task fields, graph edges, and computed statuses to survive. | After restart, task 10 remained dated through 2026-10-05; tasks 11–13 retained shifted dates and edges; task 15 remained Blocked with prerequisite 14. |
| AI suggestions | With a real key, expect suggestions restricted to existing titles and fields for confidence/rationale, with no edges written. | **Not verified with Groq:** no `GROQ_API_KEY` was present in the environment. The live request returned HTTP 503, `{"detail":"Set GROQ_API_KEY to enable suggestions"}`. GET `/tasks` before and after showed identical dependency relations (14 edges). A successful model response and approval flow remain unverified. |

## Additional Failure Probes

- Posting a task with `start_date: "not-a-date"` returned HTTP 422 with Pydantic date-validation details; no task was created.
- Two tasks with identical titles were accepted with distinct IDs (16 and 17), confirming titles are not unique. The successful AI matching behavior for duplicate titles remains unverified without a Groq key.
- Running plain `pytest -q` encountered `PermissionError` while collecting old `pytest-cache-files-*` temp directories. The full suite passed with the command shown above.
