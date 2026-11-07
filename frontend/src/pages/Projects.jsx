import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function Projects({ me }) {
  const [list, setList] = useState([]);
  const [quarter, setQuarter] = useState(1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [err, setErr] = useState('');
  const load = () => api('/projects').then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const create = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api('/projects', { method: 'POST', body: { quarter, year } });
      load();
    } catch (x) {
      setErr(x.message);
    }
  };
  return (
    <>
      <h2>Quarterly 5S Projects</h2>
      {err && <p className="error">{err}</p>}
      {['ADMIN', 'AUDITOR'].includes(me.role) && (
        <form className="card row" onSubmit={create}>
          <select value={quarter} onChange={(e) => setQuarter(+e.target.value)}>
            {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
          </select>
          <input type="number" value={year} onChange={(e) => setYear(+e.target.value)} />
          <button className="primary">New project</button>
        </form>
      )}
      {list.map((p) => (
        <Link key={p.id} to={`/projects/${p.id}`} className="card item">
          <b>{p.name}</b>
          <span className={`badge ${p.status}`}>{p.status}</span>
          <span className="muted">{p.approved_count}/{p.task_count} tasks approved</span>
        </Link>
      ))}
    </>
  );
}
