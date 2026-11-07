import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, imgUrl, pdfUrl } from '../api.js';

export default function Report() {
  const { id } = useParams();
  const [r, setR] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api(`/projects/${id}/report`).then(setR).catch((e) => setErr(e.message)); }, [id]);
  if (!r) return <p>{err || 'Loading...'}</p>;
  return (
    <>
      <Link to={`/projects/${id}`}>&larr; Project</Link>
      <h2>5S Report - {r.project.name} <span className={`badge ${r.project.status}`}>{r.project.status}</span></h2>
      <div className="row">
        <a href={pdfUrl(id)} className="btn">Download PDF</a>
        <button onClick={() => window.print()}>Print</button>
      </div>
      <table>
        <thead><tr><th>User</th><th>Approved / Assigned</th><th>Completed %</th></tr></thead>
        <tbody>
          {r.summary.users.map((u) => (
            <tr key={u.user_id}><td>{u.name}</td><td>{u.approved}/{u.assigned}</td><td>{u.completed_pct}%</td></tr>
          ))}
        </tbody>
      </table>
      {r.items.length === 0 && <p className="muted">No approved tasks yet.</p>}
      {r.items.map((t) => (
        <section key={t.id} className="card report-item">
          <h3>#{t.id} {t.title} {t.area && <span className="muted">- {t.area}</span>}</h3>
          <div className="sbs">
            <figure><figcaption>Before</figcaption><img src={imgUrl(t.before_image)} alt="before" /></figure>
            <figure><figcaption>After</figcaption><img src={imgUrl(t.after_image)} alt="after" /></figure>
          </div>
          <p className="label">{t.label}</p>
          <p className="muted">Approved by {t.auditor_name} on {new Date(t.reviewed_at).toLocaleDateString()}</p>
        </section>
      ))}
    </>
  );
}
