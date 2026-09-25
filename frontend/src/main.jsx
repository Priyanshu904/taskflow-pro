import React, { useEffect, useState } from 'react';
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

function Card({ task, onEdit }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = { transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined, opacity: isDragging ? .45 : 1 };
  return <article className="card" ref={setNodeRef} style={style} {...listeners} {...attributes} onDoubleClick={() => onEdit(task)}>
    <div className="card-title">{task.title}<button className="dots" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onEdit(task); }}>•••</button></div>
    <span className={`badge ${task.computed_status.toLowerCase().replace(' ', '-')}`}>{task.computed_status}</span>
    {task.dependencies.length > 0 && <div className="deps">Depends on {task.dependencies.map(id => `#${id}`).join(', ')}</div>}
    {(task.start_date || task.end_date) && <div className="dates">{task.start_date || '—'} → {task.end_date || '—'}</div>}
  </article>;
}

function Column({ status, tasks, onEdit }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return <section className={`column ${isOver ? 'over' : ''}`} ref={setNodeRef}>
    <header><h2>{status}</h2><span>{tasks.length}</span></header>
    <div className="cards">{tasks.map(task => <Card key={task.id} task={task} onEdit={onEdit} />)}</div>
  </section>;
}

function App() {
  const [tasks, setTasks] = useState([]), [modal, setModal] = useState(null), [message, setMessage] = useState(''), [suggestions, setSuggestions] = useState([]), [history, setHistory] = useState([]);
  const refresh = async () => setTasks(await request('/tasks'));
  useEffect(() => { refresh().catch(error => setMessage(error.message)); }, []);
  const save = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(['title','description','status','start_date','end_date'].map(key => [key, form.get(key) || null]));
    body.board_position = modal?.board_position || 0;
    try {
      const saved = modal?.id ? await request(`/tasks/${modal.id}`, { method: 'PATCH', body: JSON.stringify(body) }) : await request('/tasks', { method: 'POST', body: JSON.stringify(body) });
      const selected = [...event.currentTarget.querySelector('[name="dependencies"]').selectedOptions].map(option => Number(option.value));
      if (!modal?.id) for (const upstream_task_id of selected) await request('/dependencies', { method: 'POST', body: JSON.stringify({ upstream_task_id, downstream_task_id: saved.id }) });
      setModal(null); setSuggestions([]); await refresh();
    } catch (error) { setMessage(error.message); }
  };
  const suggest = async () => {
    const form = document.querySelector('#task-form');
    try { const data = await request('/ai/suggest-dependencies', { method: 'POST', body: JSON.stringify({ title: form.title.value, description: form.description.value }) }); setSuggestions(data.suggestions); }
    catch (error) { setMessage(error.message); }
  };
  const showHistory = async task => { try { setHistory(await request(`/tasks/${task.id}/schedule-history`)); setMessage(`Schedule history for ${task.title}: ` + (history.length ? history.map(row => `${row.delta_days}d ${row.reason}`).join('; ') : 'No events yet')); } catch (error) { setMessage(error.message); } };
  const drop = async ({ active, over }) => {
    if (!over || !columns.includes(over.id)) return;
    const task = tasks.find(item => item.id === Number(active.id));
    if (task && task.status !== over.id) try { await request(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: over.id }) }); await refresh(); } catch (error) { setMessage(error.message); }
  };
  return <main className="app">
    <nav><div className="brand"><span className="mark">T</span><span>TaskFlow <b>Pro</b></span></div><div className="nav-right"><span className="live"><i/> All systems operational</span><button className="primary" onClick={() => { setModal({}); setSuggestions([]); }}>＋ New task</button><span className="avatar">JD</span></div></nav>
    <div className="hero"><div><div className="eyebrow">WORKSPACE / PROJECT ALPHA</div><h1>Project Board</h1><p>Plan, track, and ship work together.</p></div><div className="hero-tools"><button className="filter" onClick={() => tasks[0] && showHistory(tasks[0])}>◷ Schedule history</button><button className="filter" onClick={refresh}>↻ Refresh</button></div></div>
    {message && <div className="toast" onClick={() => setMessage('')}>{message}<button>×</button></div>}
    <DndContext onDragEnd={drop}><div className="board">{columns.map(status => <Column key={status} status={status} tasks={tasks.filter(task => task.status === status)} onEdit={task => setModal(task)} />)}</div></DndContext>
    {modal && <div className="scrim" onClick={() => setModal(null)}><form id="task-form" className="modal" onSubmit={save} onClick={event => event.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">TASK DETAILS</div><h2>{modal.id ? 'Edit task' : 'Create a task'}</h2></div><button type="button" className="close" onClick={() => setModal(null)}>×</button></div>
      <label>Task name<input name="title" required defaultValue={modal.title} placeholder="e.g. Build authentication flow" /></label>
      <label>Description<textarea name="description" defaultValue={modal.description} rows="3" placeholder="What needs to be done?" /></label>
      <div className="form-row"><label>Status<select name="status" defaultValue={modal.status || 'Backlog'}>{columns.map(value => <option key={value}>{value}</option>)}</select></label><label>Starts<input type="date" name="start_date" defaultValue={modal.start_date} /></label><label>Due date<input type="date" name="end_date" defaultValue={modal.end_date} /></label></div>
      {!modal.id && <label>Prerequisites<select name="dependencies" multiple size="4">{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select><small>Use Ctrl/Cmd to select multiple tasks.</small></label>}
      {!modal.id && <button type="button" className="ai-button" onClick={suggest}>✦ Suggest dependencies with AI</button>}
      {suggestions.length > 0 && <div className="suggestions"><b>Review suggestions</b>{suggestions.map(item => <label className="suggestion" key={item.title}><input type="checkbox" data-title={item.title} /><span><strong>{item.title}</strong><small>{item.confidence} confidence · {item.rationale}</small></span></label>)}<button type="button" className="filter" onClick={async () => { const form = document.querySelector('#task-form'); const selected = [...form.querySelectorAll('.suggestion input:checked')]; try { const title = form.title.value, description = form.description.value; const created = await request('/tasks', { method:'POST', body:JSON.stringify({title,description,status:form.status.value,start_date:form.start_date.value || null,end_date:form.end_date.value || null}) }); for (const box of selected) { const task = tasks.find(item => item.title === box.dataset.title); if (task) await request('/dependencies',{method:'POST',body:JSON.stringify({upstream_task_id:task.id,downstream_task_id:created.id})}); } setModal(null); await refresh(); } catch(error) { setMessage(error.message); } }}>Approve selected & create</button></div>}
      <div className="modal-actions">{modal.id && <button type="button" className="filter" onClick={async () => { if (confirm('Delete this task?')) { await request(`/tasks/${modal.id}`, { method:'DELETE' }); setModal(null); await refresh(); } }}>Delete</button>}<button type="button" className="filter" onClick={() => setModal(null)}>Cancel</button><button className="primary">{modal.id ? 'Save changes' : 'Create task'}</button></div>
    </form></div>}
    <footer>Showing {tasks.length} tasks <span>Dependencies are finish-to-start</span></footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
