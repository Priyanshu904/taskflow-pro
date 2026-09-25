from dependency_engine import (
    compute_status,
    propagate_schedule_change,
    recompute_after_regression,
    would_create_cycle,
)


def tasks(*statuses):
    return {name: {"id": name, "status": status} for name, status in statuses}


def test_cycle_detection():
    edges = [("A", "B"), ("B", "C")]
    original_edges = edges.copy()
    assert would_create_cycle(edges, "C", "A")
    assert edges == original_edges
    assert not would_create_cycle(edges, "C", "D")
    assert not would_create_cycle(edges, "A", "C")


def test_diamond_propagates_max_not_sum():
    graph = tasks(("A", "In Progress"), ("B", "Backlog"), ("C", "Backlog"), ("D", "Backlog"))
    shifts = propagate_schedule_change("A", 3, graph, [("A", "B"), ("A", "C"), ("B", "D"), ("C", "D")])
    assert shifts == {"A": 3, "B": 3, "C": 3, "D": 3}


def test_multilevel_chain():
    graph = tasks(("A", "Backlog"), ("B", "Backlog"), ("C", "Backlog"))
    assert propagate_schedule_change("A", -2, graph, [("A", "B"), ("B", "C")]) == {"A": -2, "B": -2, "C": -2}


def test_ready_and_blocked():
    graph = tasks(("A", "In Progress"), ("B", "Backlog"))
    edges = [("A", "B")]
    assert compute_status(graph["B"], graph, edges) == "Blocked"
    graph["A"]["status"] = "Done"
    assert compute_status(graph["B"], graph, edges) == "Ready"


def test_regression_reports_reblocked_dependents():
    graph = tasks(("A", "In Progress"), ("B", "Backlog"), ("C", "Backlog"))
    graph["A"]["status"] = "Done"
    graph["B"]["computed_status"] = "Ready"
    graph["C"]["computed_status"] = "Ready"
    edges = [("A", "B"), ("A", "C")]
    graph["A"]["status"] = "In Progress"
    assert recompute_after_regression("A", graph, edges) == ["B", "C"]
