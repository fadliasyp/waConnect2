import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { v4 as uuid } from "uuid";

const prisma = new PrismaClient();
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || '123456';
const SALT_ROUNDS = 10;

async function createInitialAdmin() {
  const adminExists = await prisma.user.findUnique({
    where: { username: 'admin' }
  });

  if (!adminExists) {
    await prisma.user.create({
      data: {
        username: 'admin',
        sender: "085975313930",
      }
    });
    console.log('User admin berhasil dibuat');
  }
}

// Panggil fungsi ini saat server start
createInitialAdmin().catch(e => console.error('Error creating admin:', e));

router.post('/register', async (req, res) => {
  const { username, sender, email } = req.body;

  if (!username || !sender) {
    return res.status(400).json({ error: 'Username dan sender wajib diisi' });
  }

  try {
    // Cek apakah user sudah ada
    const existingUser = await prisma.user.findFirst({
      where: { sender }
    });

    if (existingUser) {
      return res.status(409).json({ error: 'Username sudah terdaftar' });
    }

    // Simpan user baru
    const newUser = await prisma.user.create({
      data: {
        id: uuid().toString(),
        username,
        sender,
        email: email || null
      }
    });

    res.status(201).json({
      success: true,
      message: 'Registrasi berhasil',
      user: {
        id: newUser.id,
        username: newUser.username,
        sender: newUser.sender,
        email: newUser.email
      }
    });

  } catch (error) {
    console.error('❌ Error registrasi:', error);
    res.status(500).json({ error: 'Gagal melakukan registrasi' });
  }
});


router.post('/login', async (req, res) => {
  const { username, sender } = req.body;

  try {
    // Cari user
    const user = await prisma.user.findFirst({
      where: { sender }
    });

    if (!user || !user.sender || user.sender !== sender) {
      return res.status(401).json({ error: 'Username atau nomor telepon salah' });
    }

    // Generate JWT Token
    const token = jwt.sign(
      { userId: user.id },
      JWT_SECRET,
      { expiresIn: '1h' } // 1 jam
    );

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // expire 1 jam dari sekarang

    // Simpan token ke tabel ApiKey
    await prisma.apiKey.create({
      data: {
        name: `Login Key for ${user.username}`,
        key: token, // simpan token JWT
        userId: user.id,
        expiresAt: expiresAt,
        isActive: true
      }
    });

    // Balikin token ke client
    res.json({ 
      success: true,
      token,
      expiresIn: 3600 // detik
    });

  } catch (error) {
    console.error('❌ Error login:', error);
    res.status(500).json({ error: 'Gagal melakukan login' });
  }
});

// ================ BUAT API KEY MANUAL ================

router.post('/api-keys', async (req, res) => {
  const { name, expiresInDays = 30 } = req.body;

  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: Token diperlukan' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    // Ambil userId dari JWT
    const userId = decoded.userId;

    // Generate API key baru (pakai UUID misalnya)
    const apiKeyRaw = crypto.randomBytes(32).toString('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(expiresInDays));

    const apiKey = await prisma.apiKey.create({
      data: {
        name,
        key: apiKeyRaw,
        userId,
        expiresAt,
        isActive: true
      }
    });

    res.json({
      success: true,
      apiKey: {
        id: apiKey.id,
        name: apiKey.name,
        key: apiKeyRaw,
        expiresAt: apiKey.expiresAt
      }
    });

  } catch (error) {
    console.error('❌ Error membuat API key:', error);
    res.status(500).json({ error: 'Gagal membuat API key' });
  }
});


export default router;