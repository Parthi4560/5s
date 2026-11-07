require('dotenv').config();
const migrate = require('./migrate');
const { createApp } = require('./app');

const port = process.env.PORT || 4000;
migrate()
  .then(() => createApp().listen(port, () => console.log(`5S API on :${port}`)))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
