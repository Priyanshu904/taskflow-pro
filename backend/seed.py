from main import Dependency, Session, Task

with Session() as db:
    if db.query(Task).count() == 0:
        items = [
            ("Define product requirements", "Agree on MVP scope", "Done"),
            ("Design database schema", "Model core entities", "In Progress"),
            ("Create UI wireframes", "Plan key screens", "Backlog"),
            ("Build backend API", "Implement task and dependency APIs", "Backlog"),
            ("Build frontend UI", "Implement Kanban board", "Backlog"),
            ("Write integration tests", "Exercise UI and API together", "Backlog"),
            ("Security review", "Review API and data handling", "Backlog"),
            ("Deploy to staging", "Publish and smoke test", "Backlog"),
            ("Prepare release notes", "Document user-facing changes", "Backlog"),
        ]
        tasks = [Task(title=title, description=description, status=status, board_position=index) for index, (title, description, status) in enumerate(items)]
        db.add_all(tasks)
        db.flush()
        dependencies = [(0, 1), (0, 2), (1, 3), (2, 4), (3, 5), (4, 5), (5, 6), (6, 7), (7, 8)]
        db.add_all(Dependency(upstream_task_id=tasks[a].id, downstream_task_id=tasks[b].id) for a, b in dependencies)
        db.commit()
