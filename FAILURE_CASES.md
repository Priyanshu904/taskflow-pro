# Known Failure Cases

These are observed current behaviors, not claims that every edge case has a friendly UI treatment. See [DESIGN.md](DESIGN.md) for architecture and limitations, and [TESTING.md](TESTING.md) for the full API test report.

- **Missing Groq key:** A valid suggestion request without `GROQ_API_KEY` returned HTTP 503 with `{"detail":"Set GROQ_API_KEY to enable suggestions"}`. The dependency relations from `GET /tasks` were identical before and after.
- **Malformed date:** Posting a task with `start_date: "not-a-date"` returned HTTP 422 with Pydantic date-validation details. No task was created.
- **Duplicate titles:** Two tasks with the same title were accepted with distinct IDs (16 and 17). The storage model identifies tasks by ID, but the suggestion approval UI resolves a suggested title to the first matching task. The successful Groq behavior with duplicate titles could not be checked without a key.
- **Cycle attempt:** Posting an edge that closed the tested diamond back to its root returned HTTP 400 with `{"detail":"Dependency would create a cycle"}`. A subsequent `GET /tasks` showed the root still had an empty prerequisite list, so the edge was not stored.
- **Plain pytest discovery in this workspace:** `pytest -q` encountered `PermissionError` collecting old `pytest-cache-files-*` temp directories. The full test suite passes when those generated directories are ignored; see the command in [TESTING.md](TESTING.md).
