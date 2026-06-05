import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';

import apiRouter from './routes/api.js';

const app = express();

app.use(cors());
app.use(express.json());

// API routes
app.use('/api', apiRouter);

// basic health
app.get('/', (req, res) => res.json({ ok: true, env: process.env.NODE_ENV || 'development' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API server listening on port ${PORT}`);
});

export default app;
