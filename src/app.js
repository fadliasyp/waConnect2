import express from 'express';
import authRouter from './service/routes/auth.js';
// import authRouter from './service/routes/auth2.js';
import chatbotRouter from './service/routes/chatbot.js';
import { authenticateToken } from '../src/middleware/auth-middleware.js';
import sendReplyRouter from './service/routes/webhok.js'

const app = express();

// Middleware untuk parsing JSON
app.use(express.json());

app.use(sendReplyRouter);

// Route tanpa autentikasi
app.use('/auth', authRouter);

// Route dengan autentikasi token
app.use('/api', authenticateToken, chatbotRouter);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Terjadi kesalahan internal' });
});

export default app;