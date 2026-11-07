import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, imgUrl } from '../api.js';

export default function Task({ me }) {
  const { id } = useParams();
  const [t, setT] = useState(null);
  const [users, setUsers] = useState([]);
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api(`/tasks/${id}`).then(setT).catch((e) => setErr(e.message));
  useEffect(() => { load(); api('/users').then(setUsers).catch(() => {}); }, [id]);

  const run = async (fn) => {
    setErr(''); setBusy(true);
    try { setT(await fn()); } catch (x) { setErr(x.message); }
    setBusy(false);
  };

  const uploadAfter = (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    run(() => api(`/tasks/${id}/after`, { method: 'POST', form }));
  };
  const review = (decision) =>
    run(() => api(`/tasks/${id}/review`, { method: 'POST', body: { decision, remarks } }));
  const assign = (owner_id) =>
    run(() => api(`/tasks/${id}`, { method: 'PATCH', body: { owner_id } }));

  if (!t) return <p>{err || 'Loading...'}</p>;
  const open = t.project_status === 'OPEN';
  const canAssign = open && (['ADMIN', 'AUDITOR'].includes(me.role) || t.created_by === me.id) && t.status !== 'APPROVED';
  const canAfter = open && (t.owner_id === me.id || me.role === 'ADMIN') && ['OPEN', 'REJECTED'].includes(t.status);
  const canReview = open && me.role === 'AUDITOR' && t.status === 'SUBMITTED';

  return (
    <>
      <Link to={`/projects/${t.project_id}`}>&larr; Project</Link>
      <h2>{t.title} <span className={`badge ${t.status}`}>{t.status}</span></h2>
      <p className="muted">{t.area} {t.notes && `- ${t.notes}`}</p>
      {err && <p className="error">{err}</p>}

      <div className="sbs">
        <figure><figcaption>Before</figcaption><img src={imgUrl(t.before_image)} alt="before" /></figure>
        <figure>
          <figcaption>After</figcaption>
          {t.after_image ? <img src={imgUrl(t.after_image)} alt="after" /> : <div className="ph">No After photo yet</div>}
        </figure>
      </div>

      <p>
        Owner:{' '}
        {canAssign ? (
          <select value={t.owner_id || ''} onChange={(e) => assign(e.target.value || null)} disabled={busy}>
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        ) : <b>{t.owner_name || 'Unassigned'}</b>}
      </p>

      {t.auditor_remarks && <p className="card">Auditor remarks ({t.auditor_name}): {t.auditor_remarks}</p>}
      {t.status === 'APPROVED' && <p className="label">Completed by {t.owner_name}</p>}

      {canAfter && (
        <form className="card" onSubmit={uploadAfter}>
          <h3>{t.status === 'REJECTED' ? 'Rework: upload new After photo' : 'Upload After photo'}</h3>
          <input type="file" name="after" accept="image/jpeg,image/png" capture="environment" required />
          <button className="primary" disabled={busy}>Submit for review</button>
        </form>
      )}

      {canReview && (
        <div className="card">
          <h3>Audit</h3>
          <textarea placeholder="Remarks (required to reject)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => review('APPROVED')}>Approve</button>
            <button className="danger" disabled={busy} onClick={() => review('REJECTED')}>Reject</button>
          </div>
        </div>
      )}
    </>
  );
}
