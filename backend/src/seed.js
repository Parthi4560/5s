const bcrypt = require('bcryptjs');
const pool = require('./db');
const migrate = require('./migrate');

const USERS = [
  ['Admin', 'admin@5s.local', 'admin123', 'ADMIN'],
  ['Alice Auditor', 'auditor@5s.local', 'auditor123', 'AUDITOR'],
  ['Uma User', 'user1@5s.local', 'user123', 'USER'],
  ['Ravi User', 'user2@5s.local', 'user123', 'USER'],
];

async function seed() {
  await migrate();
  for (const [name, email, pw, role] of USERS) {
    await pool.query(
      `INSERT INTO users(name,email,password_hash,role) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO NOTHING`,
      [name, email, bcrypt.hashSync(pw, 10), role]
    );
  }
  const admin = await pool.query("SELECT id FROM users WHERE email='admin@5s.local'");
  await pool.query(
    `INSERT INTO projects(name,quarter,year,created_by) VALUES ('Q1 2026',1,2026,$1)
     ON CONFLICT DO NOTHING`,
    [admin.rows[0].id]
  );
  console.log('seeded');
}

module.exports = seed;

if (require.main === module) {
  seed()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
