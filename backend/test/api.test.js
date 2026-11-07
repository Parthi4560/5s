const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), '5s-test-'));
process.env.JWT_SECRET = 'test-secret';

const pool = require('../src/db');
const migrate = require('../src/migrate');
const seed = require('../src/seed');
const { createApp } = require('../src/app');

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let app;
const tokens = {};
const ids = {};

const login = async (email, password) => {
  const r = await request(app).post('/api/auth/login').send({ email, password });
  assert.equal(r.status, 200);
  ids[email] = r.body.user.id;
  return r.body.token;
};
const auth = (t) => ({ Authorization: `Bearer ${t}` });

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  await seed();
  app = createApp();
  tokens.admin = await login('admin@5s.local', 'admin123');
  tokens.auditor = await login('auditor@5s.local', 'auditor123');
  tokens.u1 = await login('user1@5s.local', 'user123');
  tokens.u2 = await login('user2@5s.local', 'user123');
});

after(async () => {
  await pool.end();
});

const addTask = (token, projectId, fields) => {
  const r = request(app).post(`/api/projects/${projectId}/tasks`).set(auth(token));
  for (const [k, v] of Object.entries(fields)) r.field(k, String(v));
  return r.attach('before', PNG, { filename: 'b.png', contentType: 'image/png' });
};

test('auth: rejects bad login and unauthenticated access', async () => {
  const bad = await request(app).post('/api/auth/login').send({ email: 'admin@5s.local', password: 'x' });
  assert.equal(bad.status, 401);
  assert.equal((await request(app).get('/api/projects')).status, 401);
});

test('roles: only admin can create users; only admin/auditor create projects', async () => {
  const body = { name: 'N', email: 'n@5s.local', password: 'pw', role: 'USER' };
  assert.equal((await request(app).post('/api/users').set(auth(tokens.u1)).send(body)).status, 403);
  assert.equal((await request(app).post('/api/users').set(auth(tokens.admin)).send(body)).status, 201);
  const p = { quarter: 2, year: 2026 };
  assert.equal((await request(app).post('/api/projects').set(auth(tokens.u1)).send(p)).status, 403);
  assert.equal((await request(app).post('/api/projects').set(auth(tokens.auditor)).send(p)).status, 201);
});

test('full 5S workflow: task creation, after, review, rework, close, summary, report', async () => {
  const projects = (await request(app).get('/api/projects').set(auth(tokens.u1))).body;
  const pid = projects.find((p) => p.name === 'Q1 2026').id;

  // before photo creates task; user cannot assign others
  const denied = await addTask(tokens.u1, pid, { title: 'Bench', owner_id: ids['user2@5s.local'] });
  assert.equal(denied.status, 403);
  const noPhoto = await request(app).post(`/api/projects/${pid}/tasks`).set(auth(tokens.u1)).field('title', 'x');
  assert.equal(noPhoto.status, 400);

  const t1 = await addTask(tokens.auditor, pid, { title: 'Shelf', area: 'Store', owner_id: ids['user1@5s.local'] });
  assert.equal(t1.status, 201);
  assert.equal(t1.body.status, 'OPEN');
  assert.equal(t1.body.owner_name, 'Uma User');
  const t2 = await addTask(tokens.u2, pid, { title: 'Floor' });
  assert.equal(t2.body.owner_id, ids['user2@5s.local']);

  // reassign owner
  const re = await request(app).patch(`/api/tasks/${t2.body.id}`).set(auth(tokens.auditor)).send({ owner_id: ids['user1@5s.local'] });
  assert.equal(re.body.owner_id, ids['user1@5s.local']);

  // cannot review before submission; non-owner cannot upload after
  const early = await request(app).post(`/api/tasks/${t1.body.id}/review`).set(auth(tokens.auditor)).send({ decision: 'APPROVED' });
  assert.equal(early.status, 409);
  const wrongUser = await request(app).post(`/api/tasks/${t1.body.id}/after`).set(auth(tokens.u2)).attach('after', PNG, { filename: 'a.png', contentType: 'image/png' });
  assert.equal(wrongUser.status, 403);

  const sub = (id) => request(app).post(`/api/tasks/${id}/after`).set(auth(tokens.u1)).attach('after', PNG, { filename: 'a.png', contentType: 'image/png' });
  const s1 = await sub(t1.body.id);
  assert.equal(s1.body.status, 'SUBMITTED');
  await sub(t2.body.id);

  // only auditor reviews; reject needs remarks
  assert.equal((await request(app).post(`/api/tasks/${t1.body.id}/review`).set(auth(tokens.u1)).send({ decision: 'APPROVED' })).status, 403);
  assert.equal((await request(app).post(`/api/tasks/${t1.body.id}/review`).set(auth(tokens.auditor)).send({ decision: 'REJECTED' })).status, 400);
  const rej = await request(app).post(`/api/tasks/${t1.body.id}/review`).set(auth(tokens.auditor)).send({ decision: 'REJECTED', remarks: 'Redo' });
  assert.equal(rej.body.status, 'REJECTED');
  assert.equal(rej.body.auditor_remarks, 'Redo');
  assert.equal((await request(app).post(`/api/tasks/${t2.body.id}/review`).set(auth(tokens.auditor)).send({ decision: 'APPROVED' })).body.status, 'APPROVED');

  // cannot close while a task is not approved
  const blocked = await request(app).post(`/api/projects/${pid}/close`).set(auth(tokens.auditor));
  assert.equal(blocked.status, 409);

  // rework: resubmit and approve
  assert.equal((await sub(t1.body.id)).body.status, 'SUBMITTED');
  assert.equal((await request(app).post(`/api/tasks/${t1.body.id}/review`).set(auth(tokens.auditor)).send({ decision: 'APPROVED' })).body.status, 'APPROVED');

  // summary
  const sum = (await request(app).get(`/api/projects/${pid}/summary`).set(auth(tokens.u1))).body;
  const uma = sum.users.find((u) => u.name === 'Uma User');
  assert.equal(uma.assigned, 2);
  assert.equal(uma.completed_pct, 100);

  // report
  const rep = (await request(app).get(`/api/projects/${pid}/report`).set(auth(tokens.u1))).body;
  assert.equal(rep.items.length, 2);
  assert.ok(rep.items.every((i) => i.label === 'Completed by Uma User'));
  const pdf = await request(app).get(`/api/projects/${pid}/report.pdf`).query({ token: tokens.u1 }).buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');

  // images require auth, and are served with token
  const img = rep.items[0].before_image;
  assert.equal((await request(app).get(`/uploads/${img}`)).status, 401);
  assert.equal((await request(app).get(`/uploads/${img}`).query({ token: tokens.u1 })).status, 200);

  // close
  assert.equal((await request(app).post(`/api/projects/${pid}/close`).set(auth(tokens.u1))).status, 403);
  const closed = await request(app).post(`/api/projects/${pid}/close`).set(auth(tokens.auditor));
  assert.equal(closed.body.status, 'CLOSED');
  assert.equal((await addTask(tokens.u1, pid, { title: 'Late' })).status, 409);
});

test('cannot close an empty project', async () => {
  const projects = (await request(app).get('/api/projects').set(auth(tokens.u1))).body;
  const pid = projects.find((p) => p.name === 'Q2 2026').id;
  assert.equal((await request(app).post(`/api/projects/${pid}/close`).set(auth(tokens.auditor))).status, 409);
});
