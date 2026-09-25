from collections import defaultdict, deque


def would_create_cycle(edges, new_upstream_id, new_downstream_id):
    if new_upstream_id == new_downstream_id:
        return True
    graph = defaultdict(list)
    for upstream, downstream in edges:
        graph[upstream].append(downstream)
    pending = [new_downstream_id]
    visited = set()
    while pending:
        node = pending.pop()
        if node == new_upstream_id:
            return True
        if node not in visited:
            visited.add(node)
            pending.extend(graph[node])
    return False


def compute_status(task, all_tasks, all_edges):
    status = task["status"]
    if status not in {"Backlog", "In Progress"}:
        return status
    task_id = task["id"]
    prerequisites = [upstream for upstream, downstream in all_edges if downstream == task_id]
    if all(all_tasks[upstream]["status"] == "Done" for upstream in prerequisites):
        return "Ready"
    return "Blocked"


def propagate_schedule_change(task_id, delta_days, all_tasks, all_edges):
    graph = defaultdict(list)
    indegree = {key: 0 for key in all_tasks}
    for upstream, downstream in all_edges:
        graph[upstream].append(downstream)
        indegree[downstream] = indegree.get(downstream, 0) + 1
        indegree.setdefault(upstream, 0)
    queue = deque(node for node, degree in indegree.items() if degree == 0)
    order = []
    while queue:
        node = queue.popleft()
        order.append(node)
        for downstream in graph[node]:
            indegree[downstream] -= 1
            if indegree[downstream] == 0:
                queue.append(downstream)
    shifts = {task_id: delta_days}
    for node in order:
        if node not in shifts:
            continue
        for downstream in graph[node]:
            shifts[downstream] = max(shifts.get(downstream, shifts[node]), shifts[node])
    return shifts


def recompute_after_regression(task_id, all_tasks, all_edges):
    downstream = defaultdict(list)
    for upstream, child in all_edges:
        downstream[upstream].append(child)
    affected = set()
    pending = list(downstream[task_id])
    while pending:
        node = pending.pop()
        if node not in affected:
            affected.add(node)
            pending.extend(downstream[node])
    changed = []
    before_tasks = {key: dict(value) for key, value in all_tasks.items()}
    before_tasks[task_id]["status"] = "Done"
    for node in affected:
        task = all_tasks[node]
        current = compute_status(before_tasks[node], before_tasks, all_edges)
        updated = compute_status(task, all_tasks, all_edges)
        if current != updated:
            changed.append(node)
    return sorted(changed)
