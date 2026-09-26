import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import './style.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const columns = ['Backlog', 'In Progress', 'Review', 'Done'];

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  const value = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(value.detail || 'Request failed');
  return value;
}

function statusLabel(status) {
  if (status === 'Ready') return '✓ Ready';
  if (status === 'Blocked') return '◷ Blocked';
  if (status === 'Done') return '✓ Done';
  return status;
}

function Card({ task, onEdit }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = {
    transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined,
    opacity: isDragging ? 0.45 : 1,
  };
  return (
    <article className="card" ref={setNodeRef} style={style} {...listeners} {...attributes} onDoubleClick={() => onEdit(task)}>
      <div className="card-heading">
        <h3>{task.title}</h3>
        <button className="icon-button" aria-label={`Edit ${task.title}`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onEdit(task); }}>•••</button>
      </div>
      <span className={`badge badge-${task.computed_status.toLowerCase().replace(' ', '-')}`}>{statusLabel(task.computed_status)}</span>
      {task.dependency_titles?.length > 0 && <div className="card-meta dependency-meta"><span className="meta-icon">↳</span><span>Depends on: {task.dependency_titles.join(', ')}</span></div>}
      {(task.start_date || task.end_date) && <div className="card-meta date-meta">{task.start_date || 'No start'} <span>→</span> {task.end_date || 'No due date'}</div>}
    </article>
  );
}

function Column({ status, tasks, onEdit }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section className={`column column-${status.toLowerCase().replace(' ', '-')} ${isOver ? 'is-over' : ''}`} ref={setNodeRef} aria-label={`${status} tasks`}>
      <header className="column-header">
        <div className="column-title"><span className="column-dot" /><h2>{status}</h2></div>
        <span className="column-count">{tasks.length}</span>
      </header>
      <div className="cards">
        {tasks.map(task => <Card key={task.id} task={task} onEdit={onEdit} />)}
        {tasks.length === 0 && <div className="empty-column"><span>All clear</span><small>Tasks moved here will appear in this column.</small></div>}
      </div>
    </section>
  );
}

function DependencyGraph({ tasks }) {
  const layout = useMemo(() => {
    const byId = new Map(tasks.map(task => [task.id, task]));
    const depths = new Map(tasks.map(task => [task.id, 0]));
    const indegree = new Map(tasks.map(task => [task.id, 0]));
    const children = new Map(tasks.map(task => [task.id, []]));
    tasks.forEach(task => task.dependencies.forEach(upstream => {
      if (!byId.has(upstream)) return;
      indegree.set(task.id, indegree.get(task.id) + 1);
      children.get(upstream).push(task.id);
    }));
    const queue = tasks.filter(task => indegree.get(task.id) === 0).map(task => task.id);
    const processed = new Set();
    while (queue.length) {
      const upstream = queue.shift();
      processed.add(upstream);
      children.get(upstream).forEach(downstream => {
        depths.set(downstream, Math.max(depths.get(downstream), depths.get(upstream) + 1));
        indegree.set(downstream, indegree.get(downstream) - 1);
        if (indegree.get(downstream) === 0) queue.push(downstream);
      });
    }
    const maxDepth = Math.max(0, ...depths.values());
    tasks.filter(task => !processed.has(task.id)).forEach(task => depths.set(task.id, maxDepth + 1));
    const groups = new Map();
    tasks.forEach(task => {
      const depth = depths.get(task.id);
      if (!groups.has(depth)) groups.set(depth, []);
      groups.get(depth).push(task);
    });
    const nodeWidth = 224;
    const nodeHeight = 76;
    const left = 28;
    const top = 34;
    const gapX = 92;
    const gapY = 24;
    const positions = new Map();
    [...groups.entries()].sort(([leftDepth], [rightDepth]) => leftDepth - rightDepth).forEach(([depth, group]) => {
      group.forEach((task, index) => positions.set(task.id, {
        x: left + depth * (nodeWidth + gapX),
        y: top + index * (nodeHeight + gapY),
        task,
      }));
    });
    const maxRows = Math.max(1, ...[...groups.values()].map(group => group.length));
    return {
      positions,
      width: left * 2 + (maxDepth + 1) * nodeWidth + maxDepth * gapX,
      height: top * 2 + maxRows * (nodeHeight + gapY),
      nodeWidth,
      nodeHeight,
    };
  }, [tasks]);

  if (!tasks.length) return <div className="graph-empty">Create a task to start building your dependency map.</div>;
  const edges = tasks.flatMap(task => task.dependencies.map(upstream => ({ upstream, downstream: task.id }))).filter(edge => layout.positions.has(edge.upstream) && layout.positions.has(edge.downstream));
  return (
    <div className="graph-scroll">
      <svg className="dependency-graph" viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="Task dependency graph">
        <defs><marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#9aa9bb" /></marker></defs>
        {edges.map(edge => {
          const from = layout.positions.get(edge.upstream);
          const to = layout.positions.get(edge.downstream);
          const startX = from.x + layout.nodeWidth;
          const startY = from.y + layout.nodeHeight / 2;
          const endX = to.x;
          const endY = to.y + layout.nodeHeight / 2;
          const bend = Math.max(34, (endX - startX) * 0.48);
          return <path key={`${edge.upstream}-${edge.downstream}`} className="graph-edge" d={`M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`} markerEnd="url(#graph-arrow)" />;
        })}
        {[...layout.positions.values()].map(({ x, y, task }) => (
          <g key={task.id} className={`graph-node graph-node-${task.computed_status.toLowerCase().replace(' ', '-')}`}>
            <title>{task.title} · {task.computed_status}</title>
            <rect x={x} y={y} width={layout.nodeWidth} height={layout.nodeHeight} rx="12" />
            <text className="graph-node-title" x={x + 14} y={y + 29}>{task.title.length > 27 ? `${task.title.slice(0, 26)}…` : task.title}</text>
            <text className="graph-node-status" x={x + 14} y={y + 53}>{statusLabel(task.computed_status)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function App() {
  const [tasks, setTasks] = useState([]);
  const [modal, setModal] = useState(null);
  const [message, setMessage] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [selectedDependencies, setSelectedDependencies] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);

  const refresh = async () => setTasks(await request('/tasks'));
  useEffect(() => { refresh().catch(error => setMessage(error.message)); }, []);

  const openTask = task => {
    setModal(task || {});
    setSelectedDependencies(task?.dependencies || []);
    setSuggestions([]);
    setMessage('');
  };

  const save = async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = Object.fromEntries(['title', 'description', 'status', 'start_date', 'end_date'].map(key => [key, form.get(key) || null]));
    body.board_position = modal?.board_position || 0;
    setSaveLoading(true);
    try {
      const saved = modal?.id
        ? await request(`/tasks/${modal.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await request('/tasks', { method: 'POST', body: JSON.stringify(body) });
      setModal(saved);
      const existing = modal?.dependency_edges || [];
      for (const edge of existing) {
        if (!selectedDependencies.includes(edge.upstream_task_id)) await request(`/dependencies/${edge.id}`, { method: 'DELETE' });
      }
      for (const upstream_task_id of selectedDependencies) {
        if (!existing.some(edge => edge.upstream_task_id === upstream_task_id)) {
          await request('/dependencies', { method: 'POST', body: JSON.stringify({ upstream_task_id, downstream_task_id: saved.id }) });
        }
      }
      await refresh();
      setModal(null);
      setSuggestions([]);
    } catch (error) {
      setMessage(error.message);
      await refresh();
    } finally {
      setSaveLoading(false);
    }
  };

  const suggest = async event => {
    const form = new FormData(event.currentTarget.form);
    setAiLoading(true);
    setSuggestions([]);
    try {
      const data = await request('/ai/suggest-dependencies', {
        method: 'POST',
        body: JSON.stringify({ title: form.get('title'), description: form.get('description') || '' }),
      });
      setSuggestions(data.suggestions.map((suggestion, index) => ({ ...suggestion, key: `${suggestion.title}-${index}`, decision: 'pending' })));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setAiLoading(false);
    }
  };

  const decideSuggestion = (suggestion, decision) => {
    const upstream = tasks.find(task => task.title === suggestion.title);
    if (decision === 'approved' && upstream) {
      setSelectedDependencies(current => current.includes(upstream.id) ? current : [...current, upstream.id]);
    }
    if (decision === 'rejected' && upstream) {
      setSelectedDependencies(current => current.filter(id => id !== upstream.id));
    }
    setSuggestions(current => current.map(item => item.key === suggestion.key ? { ...item, decision } : item));
  };

  const toggleDependency = taskId => setSelectedDependencies(current => current.includes(taskId)
    ? current.filter(id => id !== taskId)
    : [...current, taskId]);

  const showHistory = async task => {
    try {
      const history = await request(`/tasks/${task.id}/schedule-history`);
      setMessage(`Schedule history for ${task.title}: ${history.length ? history.map(row => `${row.delta_days}d ${row.reason}`).join('; ') : 'No events yet'}`);
    } catch (error) {
      setMessage(error.message);
    }
  };

  const drop = async ({ active, over }) => {
    if (!over || !columns.includes(over.id)) return;
    const task = tasks.find(item => item.id === Number(active.id));
    if (task && task.status !== over.id) {
      try {
        await request(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: over.id }) });
        await refresh();
      } catch (error) {
        setMessage(error.message);
      }
    }
  };

  const readyCount = tasks.filter(task => task.computed_status === 'Ready').length;
  const blockedCount = tasks.filter(task => task.computed_status === 'Blocked').length;
  const doneCount = tasks.filter(task => task.status === 'Done').length;
  const confirmedTasks = selectedDependencies.map(id => tasks.find(task => task.id === id)).filter(Boolean);
  const persistedIds = new Set((modal?.dependency_edges || []).map(edge => edge.upstream_task_id));

  return (
    <main className="app-shell">
      <nav className="topbar">
        <a className="brand" href="#top" aria-label="TaskFlow Pro home"><span className="brand-mark">T</span><span>TaskFlow <strong>Pro</strong></span></a>
        <div className="nav-right"><span className="live-indicator"><i /> Workspace live</span><button className="primary-button" onClick={() => openTask(null)}>＋ New task</button><span className="avatar" aria-label="Workspace member">JD</span></div>
      </nav>

      <section className="page-heading" id="top">
        <div><div className="eyebrow">WORKSPACE <span>/</span> PROJECT ALPHA</div><h1>Project Board</h1><p>Plan the work. See what’s moving and what’s waiting.</p></div>
        <div className="heading-actions"><button className="secondary-button" onClick={() => tasks[0] && showHistory(tasks[0])}>◷ <span>Schedule history</span></button><button className="secondary-button" onClick={() => refresh().catch(error => setMessage(error.message))}>↻ <span>Refresh</span></button></div>
      </section>

      {message && <div className="toast" role="status"><span>{message}</span><button aria-label="Dismiss message" onClick={() => setMessage('')}>×</button></div>}

      <section className="summary" aria-label="Board summary">
        <div className="summary-intro"><span className="summary-caption">PROJECT HEALTH</span><strong>At a glance</strong></div>
        <div className="summary-stat"><span className="stat-icon total-icon">▦</span><span><small>Total tasks</small><strong>{tasks.length}</strong></span></div>
        <div className="summary-stat"><span className="stat-icon ready-icon">✓</span><span><small>Ready</small><strong>{readyCount}</strong></span></div>
        <div className="summary-stat"><span className="stat-icon blocked-icon">◷</span><span><small>Blocked</small><strong>{blockedCount}</strong></span></div>
        <div className="summary-stat"><span className="stat-icon done-icon">✓</span><span><small>Done</small><strong>{doneCount}</strong></span></div>
      </section>

      <div className="board-toolbar"><div><h2>Workflow</h2><span>Drag a card to update its status</span></div><button className={`graph-toggle ${graphOpen ? 'active' : ''}`} onClick={() => setGraphOpen(open => !open)} aria-expanded={graphOpen}><span>⑂</span>{graphOpen ? 'Hide dependency map' : 'View dependency map'}</button></div>

      {graphOpen && <section className="graph-panel"><div className="graph-panel-heading"><div><span className="eyebrow">DEPENDENCY MAP</span><h2>How the work connects</h2></div><span className="graph-legend"><i /> Prerequisite flow</span></div><DependencyGraph tasks={tasks} /></section>}

      <DndContext onDragEnd={drop}>
        <div className="board">{columns.map(status => <Column key={status} status={status} tasks={tasks.filter(task => task.status === status)} onEdit={openTask} />)}</div>
      </DndContext>

      <footer className="page-footer"><span>Showing {tasks.length} tasks</span><span>Finish-to-start dependencies · Readiness updates automatically</span></footer>

      {modal && <div className="modal-backdrop" onClick={() => !saveLoading && setModal(null)}>
        <form className="task-modal" onSubmit={save} onClick={event => event.stopPropagation()}>
          <div className="modal-heading"><div><span className="eyebrow">TASK DETAILS</span><h2>{modal.id ? 'Edit task' : 'Create a task'}</h2></div><button type="button" className="icon-button modal-close" aria-label="Close dialog" onClick={() => setModal(null)}>×</button></div>
          <label className="field-label">Task name<input name="title" required defaultValue={modal.title} placeholder="e.g. Build authentication flow" /></label>
          <label className="field-label">Description<textarea name="description" defaultValue={modal.description} rows="3" placeholder="What needs to be done?" /></label>
          <div className="form-row"><label className="field-label">Status<select name="status" defaultValue={modal.status || 'Backlog'}>{columns.map(value => <option key={value}>{value}</option>)}</select></label><label className="field-label">Starts<input type="date" name="start_date" defaultValue={modal.start_date} /></label><label className="field-label">Due date<input type="date" name="end_date" defaultValue={modal.end_date} /></label></div>

          <section className="dependency-picker"><div className="section-heading"><div><h3>Prerequisites</h3><p>Choose tasks that need to finish first.</p></div><span>{selectedDependencies.length} selected</span></div>
            <div className="dependency-options">{tasks.filter(task => task.id !== modal.id).map(task => <label className="dependency-option" key={task.id}><input type="checkbox" checked={selectedDependencies.includes(task.id)} onChange={() => toggleDependency(task.id)} /><span>{task.title}</span><small>{task.computed_status}</small></label>)}</div>
          </section>

          <section className="confirmed-panel"><div className="section-heading"><div><h3>Confirmed dependencies</h3><p>{modal.id ? 'Saved links and approved choices for this task.' : 'Approved links will be created when you save this task.'}</p></div><span className="confirmed-count">{confirmedTasks.length}</span></div>
            {confirmedTasks.length ? <ul>{confirmedTasks.map(task => <li key={task.id}><span className="confirmed-check">✓</span><span>{task.title}</span><small>{persistedIds.has(task.id) ? 'Saved' : 'Approved · pending save'}</small><button type="button" onClick={() => toggleDependency(task.id)}>Remove</button></li>)}</ul> : <div className="confirmed-empty">No prerequisite links selected yet.</div>}
          </section>

          {!modal.id && <section className="ai-panel"><div className="ai-intro"><span className="ai-spark">✦</span><div><h3>Need a starting point?</h3><p>AI can suggest prerequisites from tasks already on this board. Suggestions stay unlinked until you approve and save.</p></div></div><button type="button" className="ai-button" onClick={suggest} disabled={aiLoading}><span>{aiLoading ? '◌' : '✦'}</span>{aiLoading ? 'Finding relevant tasks…' : 'Suggest dependencies with AI'}</button>
            {suggestions.length > 0 && <div className="suggested-list"><div className="suggested-heading"><h4>Suggested prerequisites</h4><span>Not linked yet</span></div>{suggestions.map(item => <article className={`suggestion-card decision-${item.decision}`} key={item.key}><div className="suggestion-copy"><div className="suggestion-title"><strong>{item.title}</strong><span className="confidence">{Math.round(Number(item.confidence) * 100)}% confidence</span></div><p>{item.rationale}</p>{item.decision === 'approved' && <small className="decision-note">Approved · will link when task is saved</small>}{item.decision === 'rejected' && <small className="decision-note rejected-note">Rejected · no link will be created</small>}</div><div className="suggestion-actions">{item.decision === 'pending' ? <><button type="button" className="approve-button" onClick={() => decideSuggestion(item, 'approved')}>Approve</button><button type="button" className="reject-button" onClick={() => decideSuggestion(item, 'rejected')}>Reject</button></> : <button type="button" className="undo-button" onClick={() => decideSuggestion(item, 'pending')}>Undo</button>}</div></article>)}</div>}
          </section>}

          <div className="modal-actions">{modal.id && <button type="button" className="delete-button" onClick={async () => { if (confirm('Delete this task?')) { await request(`/tasks/${modal.id}`, { method: 'DELETE' }); setModal(null); await refresh(); } }}>Delete task</button>}<button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button" disabled={saveLoading}>{saveLoading ? 'Saving…' : modal.id ? 'Save changes' : 'Create task'}</button></div>
        </form>
      </div>}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
