import React, { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      onLogin(await api('/auth/login', { method: 'POST', body: { email, password } }));
    } catch (x) {
      setErr(x.message);
    }
  };
  return (
    <form className="card login" onSubmit={submit}>
      <h1>5S Practice</h1>
      {err && <p className="error">{err}</p>}
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <button className="primary">Sign in</button>
      <p className="muted">Demo: admin@5s.local / admin123, auditor@5s.local / auditor123, user1@5s.local / user123</p>
    </form>
  );
}
