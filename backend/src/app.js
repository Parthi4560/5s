const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const pool = require('./db');
const { sign, authenticate, requireRole } = require('./auth');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(null, crypto.randomBytes(16).toString('hex') + (EXT[file.mimetype] || '')),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    EXT[file.mimetype] ? cb(null, true) : cb(new Error('Only JPEG or PNG images are allowed')),
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const removeFile = (f) => f && fs.unlink(path.join(UPLOAD_DIR, f), () => {});

const TASK_SELECT = `
  SELECT t.*, o.name AS owner_name, c.name AS creator_name, a.name AS auditor_name,
         p.status AS project_status
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  JOIN users c ON c.id = t.created_by
  LEFT JOIN users o ON o.id = t.owner_id
  LEFT JOIN users a ON a.id = t.auditor_id`;

async function getTask(id) {
  const { rows } = await pool.query(`${TASK_SELECT} WHERE t.id=$1`, [id]);
  return rows[0];
}

async function validOwner(id) {
  if (id === undefined || id === null || id === '') return null;
  const { rows } = await pool.query('SELECT id FROM users WHERE id=$1', [Number(id) || 0]);
  return rows[0] ? rows[0].id : false;
}

async function summaryFor(projectId) {
  const { rows } = await pool.query(
    `SELECT u.id AS user_id, u.name,
            COUNT(t.id)::int AS assigned,
            COUNT(*) FILTER (WHERE t.status='APPROVED')::int AS approved,
            COUNT(*) FILTER (WHERE t.status='SUBMITTED')::int AS submitted,
            COUNT(*) FILTER (WHERE t.status='REJECTED')::int AS rejected,
            COUNT(*) FILTER (WHERE t.status='OPEN')::int AS open
     FROM users u JOIN tasks t ON t.owner_id=u.id AND t.project_id=$1
     GROUP BY u.id, u.name ORDER BY u.name`,
    [projectId]
  );
  const users = rows.map((r) => ({
    ...r,
    completed_pct: r.assigned ? Math.round((r.approved / r.assigned) * 1000) / 10 : 0,
  }));
  const total = users.reduce((s, r) => s + r.assigned, 0);
  const done = users.reduce((s, r) => s + r.approved, 0);
  const { rows: un } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM tasks WHERE project_id=$1 AND owner_id IS NULL',
    [projectId]
  );
  return {
    users,
    unassigned: un[0].n,
    total_tasks: total + un[0].n,
    approved_tasks: done,
    overall_pct: total + un[0].n ? Math.round((done / (total + un[0].n)) * 1000) / 10 : 0,
  };
}

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // ---- auth
  app.post(
    '/api/auth/login',
    wrap(async (req, res) => {
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
      const { rows } = await pool.query('SELECT * FROM users WHERE lower(email)=lower($1)', [email]);
      const u = rows[0];
      if (!u || !bcrypt.compareSync(password, u.password_hash))
        return res.status(401).json({ error: 'Invalid credentials' });
      res.json({
        token: sign(u),
        user: { id: u.id, name: u.name, email: u.email, role: u.role },
      });
    })
  );

  // uploaded images (token via header or ?token= so <img> works)
  app.use('/uploads', authenticate, express.static(UPLOAD_DIR));

  app.use('/api', authenticate);

  app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));

  // ---- users
  app.get(
    '/api/users',
    wrap(async (req, res) => {
      const { rows } = await pool.query('SELECT id,name,email,role FROM users ORDER BY name');
      res.json(rows);
    })
  );

  app.post(
    '/api/users',
    requireRole('ADMIN'),
    wrap(async (req, res) => {
      const { name, email, password, role } = req.body || {};
      if (!name || !email || !password || !['ADMIN', 'AUDITOR', 'USER'].includes(role))
        return res.status(400).json({ error: 'name, email, password and valid role required' });
      try {
        const { rows } = await pool.query(
          'INSERT INTO users(name,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id,name,email,role',
          [name, email, bcrypt.hashSync(password, 10), role]
        );
        res.status(201).json(rows[0]);
      } catch (e) {
        if (e.code === '23505') return res.status(409).json({ error: 'Email already exists' });
        throw e;
      }
    })
  );

  // ---- projects
  app.get(
    '/api/projects',
    wrap(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT p.*, (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id=p.id) AS task_count,
                (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id=p.id AND t.status='APPROVED') AS approved_count
         FROM projects p ORDER BY year DESC, quarter DESC`
      );
      res.json(rows);
    })
  );

  app.post(
    '/api/projects',
    requireRole('ADMIN', 'AUDITOR'),
    wrap(async (req, res) => {
      const quarter = Number(req.body.quarter);
      const year = Number(req.body.year);
      if (!(quarter >= 1 && quarter <= 4) || !Number.isInteger(year))
        return res.status(400).json({ error: 'quarter (1-4) and year required' });
      const name = req.body.name || `Q${quarter} ${year}`;
      try {
        const { rows } = await pool.query(
          'INSERT INTO projects(name,quarter,year,created_by) VALUES ($1,$2,$3,$4) RETURNING *',
          [name, quarter, year, req.user.id]
        );
        res.status(201).json(rows[0]);
      } catch (e) {
        if (e.code === '23505')
          return res.status(409).json({ error: 'Project for this quarter already exists' });
        throw e;
      }
    })
  );

  app.get(
    '/api/projects/:id',
    wrap(async (req, res) => {
      const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [Number(req.params.id) || 0]);
      if (!rows[0]) return res.status(404).json({ error: 'Project not found' });
      res.json(rows[0]);
    })
  );

  app.post(
    '/api/projects/:id/close',
    requireRole('AUDITOR', 'ADMIN'),
    wrap(async (req, res) => {
      const id = Number(req.params.id) || 0;
      const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [id]);
      if (!rows[0]) return res.status(404).json({ error: 'Project not found' });
      if (rows[0].status === 'CLOSED') return res.status(409).json({ error: 'Project already closed' });
      const c = await pool.query(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status<>'APPROVED')::int AS pending
         FROM tasks WHERE project_id=$1`,
        [id]
      );
      if (c.rows[0].total === 0)
        return res.status(409).json({ error: 'Cannot close a project with no tasks' });
      if (c.rows[0].pending > 0)
        return res.status(409).json({
          error: `Cannot close: ${c.rows[0].pending} task(s) are not Approved`,
        });
      const upd = await pool.query(
        `UPDATE projects SET status='CLOSED', closed_by=$2, closed_at=now() WHERE id=$1 AND status='OPEN' RETURNING *`,
        [id, req.user.id]
      );
      if (!upd.rows[0]) return res.status(409).json({ error: 'Project already closed' });
      res.json(upd.rows[0]);
    })
  );

  app.get(
    '/api/projects/:id/tasks',
    wrap(async (req, res) => {
      const params = [Number(req.params.id) || 0];
      let where = 't.project_id=$1';
      if (req.query.status) {
        params.push(req.query.status);
        where += ` AND t.status=$${params.length}`;
      }
      if (req.query.owner_id) {
        params.push(Number(req.query.owner_id) || 0);
        where += ` AND t.owner_id=$${params.length}`;
      }
      const { rows } = await pool.query(`${TASK_SELECT} WHERE ${where} ORDER BY t.id`, params);
      res.json(rows);
    })
  );

  // Uploading a Before photo creates a task
  app.post(
    '/api/projects/:id/tasks',
    upload.single('before'),
    wrap(async (req, res) => {
      const file = req.file;
      try {
        if (!file) return res.status(400).json({ error: 'Before photo (field "before") required' });
        const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [Number(req.params.id) || 0]);
        const project = rows[0];
        if (!project) return (removeFile(file.filename), res.status(404).json({ error: 'Project not found' }));
        if (project.status !== 'OPEN')
          return (removeFile(file.filename), res.status(409).json({ error: 'Project is closed' }));
        const title = (req.body.title || '').trim();
        if (!title) return (removeFile(file.filename), res.status(400).json({ error: 'title required' }));
        let owner = await validOwner(req.body.owner_id);
        if (owner === false)
          return (removeFile(file.filename), res.status(400).json({ error: 'Invalid owner' }));
        if (owner === null) owner = req.user.id;
        if (owner !== req.user.id && req.user.role === 'USER')
          return (removeFile(file.filename), res.status(403).json({ error: 'Only Admin/Auditor can assign other owners' }));
        const ins = await pool.query(
          `INSERT INTO tasks(project_id,title,area,notes,before_image,created_by,owner_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [project.id, title, req.body.area || null, req.body.notes || null, file.filename, req.user.id, owner]
        );
        res.status(201).json(await getTask(ins.rows[0].id));
      } catch (e) {
        if (file) removeFile(file.filename);
        throw e;
      }
    })
  );

  // ---- tasks
  app.get(
    '/api/tasks/:id',
    wrap(async (req, res) => {
      const t = await getTask(Number(req.params.id) || 0);
      if (!t) return res.status(404).json({ error: 'Task not found' });
      res.json(t);
    })
  );

  app.patch(
    '/api/tasks/:id',
    wrap(async (req, res) => {
      const t = await getTask(Number(req.params.id) || 0);
      if (!t) return res.status(404).json({ error: 'Task not found' });
      if (t.project_status !== 'OPEN') return res.status(409).json({ error: 'Project is closed' });
      const privileged = ['ADMIN', 'AUDITOR'].includes(req.user.role);
      if (!privileged && t.created_by !== req.user.id && t.owner_id !== req.user.id)
        return res.status(403).json({ error: 'Forbidden' });
      let owner = t.owner_id;
      if (req.body.owner_id !== undefined) {
        if (!privileged && t.created_by !== req.user.id)
          return res.status(403).json({ error: 'Only Admin/Auditor/creator can assign owner' });
        const o = await validOwner(req.body.owner_id);
        if (o === false) return res.status(400).json({ error: 'Invalid owner' });
        owner = o;
      }
      if (t.status === 'APPROVED' && owner !== t.owner_id)
        return res.status(409).json({ error: 'Approved task cannot be reassigned' });
      const title = req.body.title !== undefined ? String(req.body.title).trim() : t.title;
      if (!title) return res.status(400).json({ error: 'title required' });
      await pool.query('UPDATE tasks SET title=$2, area=$3, notes=$4, owner_id=$5 WHERE id=$1', [
        t.id,
        title,
        req.body.area !== undefined ? req.body.area : t.area,
        req.body.notes !== undefined ? req.body.notes : t.notes,
        owner,
      ]);
      res.json(await getTask(t.id));
    })
  );

  // Owner uploads After photo -> SUBMITTED
  app.post(
    '/api/tasks/:id/after',
    upload.single('after'),
    wrap(async (req, res) => {
      const file = req.file;
      try {
        if (!file) return res.status(400).json({ error: 'After photo (field "after") required' });
        const t = await getTask(Number(req.params.id) || 0);
        if (!t) return (removeFile(file.filename), res.status(404).json({ error: 'Task not found' }));
        if (t.owner_id !== req.user.id && req.user.role !== 'ADMIN')
          return (removeFile(file.filename), res.status(403).json({ error: 'Only the task owner can upload the After photo' }));
        if (t.project_status !== 'OPEN')
          return (removeFile(file.filename), res.status(409).json({ error: 'Project is closed' }));
        if (!['OPEN', 'REJECTED'].includes(t.status))
          return (removeFile(file.filename), res.status(409).json({ error: `Cannot upload After photo when task is ${t.status}` }));
        const old = t.after_image;
        await pool.query(
          `UPDATE tasks SET after_image=$2, status='SUBMITTED', submitted_at=now(),
             auditor_id=NULL, reviewed_at=NULL WHERE id=$1`,
          [t.id, file.filename]
        );
        removeFile(old);
        res.json(await getTask(t.id));
      } catch (e) {
        if (file) removeFile(file.filename);
        throw e;
      }
    })
  );

  // Auditor approve / reject
  app.post(
    '/api/tasks/:id/review',
    requireRole('AUDITOR'),
    wrap(async (req, res) => {
      const { decision, remarks } = req.body || {};
      if (!['APPROVED', 'REJECTED'].includes(decision))
        return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });
      if (decision === 'REJECTED' && !(remarks || '').trim())
        return res.status(400).json({ error: 'remarks required when rejecting' });
      const t = await getTask(Number(req.params.id) || 0);
      if (!t) return res.status(404).json({ error: 'Task not found' });
      if (t.project_status !== 'OPEN') return res.status(409).json({ error: 'Project is closed' });
      if (t.status !== 'SUBMITTED')
        return res.status(409).json({ error: 'Only Submitted tasks can be reviewed' });
      await pool.query(
        `UPDATE tasks SET status=$2, auditor_id=$3, auditor_remarks=$4, reviewed_at=now() WHERE id=$1`,
        [t.id, decision, req.user.id, remarks || null]
      );
      res.json(await getTask(t.id));
    })
  );

  // ---- summary & report
  app.get(
    '/api/projects/:id/summary',
    wrap(async (req, res) => {
      const id = Number(req.params.id) || 0;
      const p = await pool.query('SELECT * FROM projects WHERE id=$1', [id]);
      if (!p.rows[0]) return res.status(404).json({ error: 'Project not found' });
      res.json({ project: p.rows[0], ...(await summaryFor(id)) });
    })
  );

  async function reportData(id) {
    const p = await pool.query('SELECT * FROM projects WHERE id=$1', [id]);
    if (!p.rows[0]) return null;
    const { rows } = await pool.query(
      `${TASK_SELECT} WHERE t.project_id=$1 AND t.status='APPROVED' ORDER BY t.id`,
      [id]
    );
    return {
      project: p.rows[0],
      items: rows.map((t) => ({ ...t, label: `Completed by ${t.owner_name || 'Unassigned'}` })),
      summary: await summaryFor(id),
    };
  }

  app.get(
    '/api/projects/:id/report',
    wrap(async (req, res) => {
      const data = await reportData(Number(req.params.id) || 0);
      if (!data) return res.status(404).json({ error: 'Project not found' });
      res.json(data);
    })
  );

  app.get(
    '/api/projects/:id/report.pdf',
    wrap(async (req, res) => {
      const data = await reportData(Number(req.params.id) || 0);
      if (!data) return res.status(404).json({ error: 'Project not found' });
      const doc = new PDFDocument({ size: 'A4', margin: 36 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="5S-report-${data.project.name.replace(/[^\w-]+/g, '_')}.pdf"`
      );
      doc.pipe(res);
      doc.fontSize(20).text(`5S Report - ${data.project.name}`);
      doc.fontSize(11).fillColor('#555').text(`Status: ${data.project.status}`);
      doc.moveDown().fillColor('#000').fontSize(14).text('Summary by user');
      doc.fontSize(10);
      for (const u of data.summary.users)
        doc.text(`${u.name}: ${u.approved}/${u.assigned} approved (${u.completed_pct}%)`);
      doc.text(
        `Overall: ${data.summary.approved_tasks}/${data.summary.total_tasks} (${data.summary.overall_pct}%)`
      );

      const colW = (doc.page.width - 72 - 12) / 2;
      const imgH = 180;
      const drawImg = (file, x, y) => {
        try {
          doc.image(path.join(UPLOAD_DIR, file), x, y, { fit: [colW, imgH], align: 'center', valign: 'center' });
        } catch {
          doc.fontSize(9).text('(image unavailable)', x, y);
        }
      };
      for (const t of data.items) {
        doc.addPage();
        doc.fontSize(14).fillColor('#000').text(`#${t.id} ${t.title}${t.area ? ' - ' + t.area : ''}`, 36, 36);
        doc.fontSize(10).fillColor('#555');
        doc.text('BEFORE', 36, 66, { lineBreak: false });
        doc.text('AFTER', 36 + colW + 12, 66, { lineBreak: false });
        const y = 82;
        drawImg(t.before_image, 36, y);
        drawImg(t.after_image, 36 + colW + 12, y);
        doc.rect(36, y + imgH + 12, colW * 2 + 12, 44).fill('#e6f4ea');
        doc
          .fillColor('#137333')
          .fontSize(13)
          .text(t.label, 46, y + imgH + 18, { lineBreak: false });
        doc
          .fillColor('#333')
          .fontSize(9)
          .text(
            `Approved by ${t.auditor_name || '-'} on ${t.reviewed_at ? new Date(t.reviewed_at).toISOString().slice(0, 10) : '-'}`,
            46,
            y + imgH + 36
          );
        if (t.notes) doc.fillColor('#333').fontSize(9).text(`Notes: ${t.notes}`, 36, y + imgH + 66, { width: colW * 2 });
      }
      doc.end();
    })
  );

  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || /Only JPEG/.test(err.message))
      return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
