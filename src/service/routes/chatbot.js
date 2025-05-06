import express from 'express';
import { sendToChatbot, createWhatsAppSession, sessions } from '../chatbot_api.js';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const prisma = new PrismaClient();
const router = express.Router();
const now = dayjs().tz('Asia/Jakarta');


// Endpoint chatbot yang diproteksi
router.post('/chatbot', async (req, res) => {
  const userId = req.user?.userId;
  
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Pertanyaan diperlukan' });
    }

    const result = await sendToChatbot(question);

    if (result.success) {
      // Cari session aktif berdasarkan user
      let session = await prisma.session.findFirst({
        where: {
          userId: req.user.id
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      // Jika tidak ada session, buat baru
      if (!session) {
        session = await prisma.session.create({
          data: {
            userId: req.user.id
          }
        });
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });

      // Simpan ke tabel Message
      await prisma.message.create({
        data: {
          sender: user.sender,
          content: question,
          reply: result.fullReply,
          type: result.messageType,
          sessionId: session.id,
          timestamp: now.format('YYYY-MM-DD HH:mm:ss.SSS')
        }
      });

      return res.json({
        success: true,
        response: result.fullReply,
        responseTime: result.responseTime
      });
    } else {
      return res.status(500).json({
        error: result.error || 'Gagal memproses pertanyaan'
      });
    }
  } catch (error) {
    console.error('Error chatbot endpoint:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan internal' });
  }
});


router.post('/create-session', async (req, res) => {
  const { sessionName } = req.body;
  const userId = req.user?.userId;

  if (!sessionName) {
    return res.status(400).json({ 
      error: 'sessionName diperlukan',
      contoh: { sessionName: "customer-support-session" }
    });
  }

  try {
    const existingSession = await prisma.session.findUnique({
      where: { sessionName }
    });

    if (existingSession) {
      return res.status(409).json({
        error: 'Session sudah ada',
        solusi: [
          "Gunakan nama session berbeda",
          `Hapus session lama: DELETE /sessions/${sessionName}`
        ]
      });
    }

     // Pastikan user dari token benar-benar ada di DB
     const user = await prisma.user.findUnique({ where: { id: userId } });
     if (!user) {
       return res.status(401).json({ error: 'User dari token tidak ditemukan di database' });
     }

    await prisma.session.create({
      data: {
        sessionName,
        status: 'INITIALIZING',
        user: {
          connect: { id: user.id }
        }
      }
    });

    const client = await createWhatsAppSession(sessionName);

    sessions.set(sessionName, client); // <<<=== sekarang sessions sudah dikenali

    return res.json({
      success: true,
      sessionName,
      qrCodeUrl: `/qrcodes/${sessionName}.png`,
      statusCheckUrl: `/session-status/${sessionName}`,
      petunjuk: 'Scan QR code dalam 60 detik'
    });

  } catch (error) {
    console.error('Error membuat session:', error);
    try {
      await prisma.session.deleteMany({ where: { sessionName } });
      if (SESSION_PATH) {
        const sessionFile = path.join(SESSION_PATH, `${sessionName}.json`);
        if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
      }
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError);
    }

    return res.status(500).json({
      error: 'Gagal membuat session',
      detail: error.message
    });
  }
});

router.get('/messages-sender/:sender', async (req, res) => {
  const { sender } = req.params;

  try {
    const session = await prisma.message.findFirst({
      where: { sender },
    });

    if (!session) {
      return res.status(404).json({
        error: 'pengirim tidak ditemukan',
        solusi: 'Pastikan pengirim benar dan sudah aktif',
      });
    }


    const messages = await prisma.message.findMany({
      where: {
        sender
      },
      include: {
        session:{
          select: {
            sessionName: true,
          }
        }
      }

        }) 

    return res.json({
      success: true,
      total: messages.length,
      messages,
    });

  } catch (error) {
    console.error('Error mengambil pesan:', error);
    return res.status(500).json({
      error: 'Gagal mengambil pesan',
      detail: error.message,
    });
  }
});

router.get('/messages/:sessionName', async (req, res) => {
  const { sessionName } = req.params;

  try {
    const session = await prisma.session.findUnique({
      where: { sessionName },
    });

    if (!session) {
      return res.status(404).json({
        error: 'Session tidak ditemukan',
        solusi: 'Pastikan sessionName benar dan sudah aktif',
      });
    }


    const messages = await prisma.message.findMany({
      where: {
        sessionId: session.id
      },
      include: {
        session: {
          select: {
            sessionName: true
          }
        }
      }
    });
    

    return res.json({
      success: true,
      sessionName,
      total: messages.length,
      messages,
    });

  } catch (error) {
    console.error('Error mengambil pesan:', error);
    return res.status(500).json({
      error: 'Gagal mengambil pesan',
      detail: error.message,
    });
  }
});

router.post('/logout/:sessionName', async (req, res) => {
  const { sessionName } = req.params;

  try {
    const session = await prisma.session.findUnique({
      where: { sessionName },
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session tidak ditemukan',
      });
    }

    const clientInstance = sessions.get(sessionName); // ✅ gunakan Map yang benar

    if (clientInstance) {
      await clientInstance.logout(); // cukup logout
      sessions.delete(sessionName); // hapus dari Map

      // opsional: hapus file QR dan session json
      const qrPath = path.join(__dirname, '..', '..', 'qrcodes', `${sessionName}.png`);
      if (fs.existsSync(qrPath)) fs.unlinkSync(qrPath);

      console.log(`✅ Session ${sessionName} berhasil logout dari WhatsApp`);
    } else {
      console.warn(`⚠️ Client instance untuk session ${sessionName} tidak ditemukan`);
    }

    await prisma.session.update({
      where: { sessionName },
      data: { status: 'DISCONNECTED' },
    });

    console.log('🔥 Mencoba logout untuk session:', sessionName);
    console.log('📦 Client tersedia:', !!clientInstance);

    return res.json({
      success: true,
      message: `Session ${sessionName} berhasil logout`,
    });

  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal logout session',
      detail: error.message,
    });
  }
});

router.get('/contacts/', async (req, res) => {

  try {
    const user = await prisma.user.findMany({
      include: {
        session: {
          select: {
            sessionName: true
          }
        }
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Pengirim tidak ditemukan',
        solusi: 'Pastikan nomor pengirim benar dan sudah aktif',
      });
    }
  
    return res.json({
      success: true,
      user,
      total: user.length,
    });

  } catch (error) {
    console.error('Error mengambil kontak:', error);
    return res.status(500).json({
      error: 'Gagal mengambil kontak',
      detail: error.message,
    });
  }
});


export default router;