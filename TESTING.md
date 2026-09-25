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
| AI suggestions | With a real key, expect suggestions restricted to existing titles and fields for confidence/rationale, with no edges written. | **Verified live with the configured Groq key.** `POST /ai/suggest-dependencies` for “Prepare production deployment” returned HTTP 200. Suggestions were `Deploy to staging` (0.95), `Security review` (0.95), `Write integration tests` (0.95), and `Prepare release notes` (0.85), each with a rationale. All four titles matched `GET /tasks`; edge count was 9 before and after. |
| Human approval and cycle validation | Approving a suggestion should create its edge through `POST /dependencies`; a reverse edge forming a cycle should be rejected. | Created temporary downstream task 10. `POST /dependencies` for upstream 8 (`Deploy to staging`) → downstream 10 returned HTTP 200 with `{"id":10,"upstream_task_id":8,"downstream_task_id":10}`; `GET /tasks` showed dependency `[8]`. The reverse 10 → 8 returned HTTP 400 with `{"detail":"Dependency would create a cycle"}` and did not add an edge. The temporary task was then deleted. |
| Missing-key fallback | With the process key blank, the endpoint should return the documented 503 without changing `.env`. | Started a separate API process with `GROQ_API_KEY` blank in that process. The request returned HTTP 503 with `{"detail":"Set GROQ_API_KEY to enable suggestions"}`. The real key remained present in the root `.env`. |

## Additional Failure Probes

- Posting a task with `start_date: "not-a-date"` returned HTTP 422 with Pydantic date-validation details; no task was created.
- Two tasks with identical titles were accepted with distinct IDs (16 and 17), confirming titles are not unique. This AI verification did not use duplicate-title candidates, so that ambiguity remains untested.
- Running plain `pytest -q` encountered `PermissionError` while collecting old `pytest-cache-files-*` temp directories. The full suite passed with the command shown above.
