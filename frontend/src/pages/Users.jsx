import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Users() {
  const [list, setList] = useState([]);
  const [err, setErr] = useState('');
  const load = () => api('/users').then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const add = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    setErr('');
    try { await api('/users', { method: 'POST', body: f }); e.target.reset(); load(); }
    catch (x) { setErr(x.message); }
  };
  return (
    <>
      <h2>Users</h2>
      {err && <p className="error">{err}</p>}
      <form className="card" onSubmit={add}>
        <input name="name" placeholder="Name" required />
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" placeholder="Password" required />
        <select name="role" defaultValue="USER">
          <option>USER</option><option>AUDITOR</option><option>ADMIN</option>
        </select>
        <button className="primary">Add user</button>
      </form>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
        <tbody>{list.map((u) => <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td></tr>)}</tbody>
      </table>
    </>
  );
}
