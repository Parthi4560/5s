import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, imgUrl } from '../api.js';

export default function Project({ me }) {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [summary, setSummary] = useState(null);
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [p, t, s] = await Promise.all([
        api(`/projects/${id}`),
        api(`/projects/${id}/tasks`),
        api(`/projects/${id}/summary`),
      ]);
      setProject(p); setTasks(t); setSummary(s);
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); api('/users').then(setUsers).catch(() => {}); }, [id]);

  const addTask = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    const form = new FormData(e.target);
    if (!form.get('owner_id')) form.delete('owner_id');
    try {
      await api(`/projects/${id}/tasks`, { method: 'POST', form });
      e.target.reset();
      await load();
    } catch (x) { setErr(x.message); }
    setBusy(false);
  };

  const close = async () => {
    setErr('');
    try { setProject(await api(`/projects/${id}/close`, { method: 'POST' })); }
    catch (x) { setErr(x.message); }
  };

  if (!project) return <p>{err || 'Loading...'}</p>;
  const open = project.status === 'OPEN';
  const canAssign = ['ADMIN', 'AUDITOR'].includes(me.role);
  const canClose = ['ADMIN', 'AUDITOR'].includes(me.role);

  return (
    <>
      <h2>{project.name} <span className={`badge ${project.status}`}>{project.status}</span></h2>
      <div className="row">
        <Link to={`/projects/${id}/report`}>Report (before / after)</Link>
        {open && canClose && <button onClick={close}>Close project</button>}
      </div>
      {err && <p className="error">{err}</p>}

      {summary && (
        <div className="card">
          <h3>Summary - overall {summary.overall_pct}% ({summary.approved_tasks}/{summary.total_tasks})</h3>
          <table>
            <thead><tr><th>User</th><th>Assigned</th><th>Approved</th><th>Completed %</th></tr></thead>
            <tbody>
              {summary.users.map((u) => (
                <tr key={u.user_id}>
                  <td>{u.name}</td><td>{u.assigned}</td><td>{u.approved}</td>
                  <td><div className="bar"><div style={{ width: `${u.completed_pct}%` }} /></div> {u.completed_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.unassigned > 0 && <p className="muted">{summary.unassigned} unassigned task(s)</p>}
        </div>
      )}

      {open && (
        <form className="card" onSubmit={addTask}>
          <h3>New task (upload Before photo)</h3>
          <input name="title" placeholder="Title" required />
          <input name="area" placeholder="Area (e.g. Store room)" />
          <textarea name="notes" placeholder="Notes" />
          {canAssign && (
            <select name="owner_id" defaultValue="">
              <option value="">Owner: me</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <input type="file" name="before" accept="image/jpeg,image/png" capture="environment" required />
          <button className="primary" disabled={busy}>{busy ? 'Uploading...' : 'Create task'}</button>
        </form>
      )}

      <h3>Tasks</h3>
      <div className="grid">
        {tasks.map((t) => (
          <Link key={t.id} to={`/tasks/${t.id}`} className="card">
            <img src={imgUrl(t.before_image)} alt="before" />
            <b>{t.title}</b>
            <div><span className={`badge ${t.status}`}>{t.status}</span></div>
            <span className="muted">{t.area} - {t.owner_name || 'Unassigned'}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
