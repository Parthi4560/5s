import React, { useState } from 'react';
import { Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { getAuth, setAuth } from './api.js';
import Login from './pages/Login.jsx';
import Projects from './pages/Projects.jsx';
import Project from './pages/Project.jsx';
import Task from './pages/Task.jsx';
import Report from './pages/Report.jsx';
import Users from './pages/Users.jsx';

export default function App() {
  const [auth, setAuthState] = useState(getAuth());
  const nav = useNavigate();
  const onLogin = (a) => {
    setAuth(a);
    setAuthState(a);
    nav('/');
  };
  const logout = () => {
    setAuth(null);
    setAuthState(null);
    nav('/login');
  };
  if (!auth)
    return (
      <Routes>
        <Route path="*" element={<Login onLogin={onLogin} />} />
      </Routes>
    );
  const me = auth.user;
  return (
    <>
      <header className="nav">
        <Link to="/" className="brand">5S Practice</Link>
        {me.role === 'ADMIN' && <Link to="/users">Users</Link>}
        <span className="grow" />
        <span className="who">{me.name} ({me.role})</span>
        <button onClick={logout}>Logout</button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Projects me={me} />} />
          <Route path="/projects/:id" element={<Project me={me} />} />
          <Route path="/projects/:id/report" element={<Report />} />
          <Route path="/tasks/:id" element={<Task me={me} />} />
          <Route path="/users" element={me.role === 'ADMIN' ? <Users /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </>
  );
}
