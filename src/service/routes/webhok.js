// Contoh pakai Express
import express from 'express';
import fs from 'fs';
import path from 'path';
import { sessions } from '../chatbot_api.js';
import { QR_FOLDER_PATH } from '../../config/paths.js';

const router = express.Router();

/**
 * Endpoint untuk menerima pesan dari AdonisJS dan meneruskannya ke WA
 */
router.post('/wppconnect/send-reply', async (req, res) => {
  const { sessionName, to, message } = req.body;

  if (!sessionName || !to || !message) {
    return res
      .status(400)
      .json({ success: false, error: 'sessionName, to, and message are required' });
  }

  try {
    const client = sessions.get(sessionName);

    if (!client) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    await client.sendText(`${to}@c.us`, message);
    return res.status(200).json({ success: true, message: 'Message sent to WhatsApp' });
  } catch (err) {
    console.error('Error sending message from Adonis:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/whatsapp/:channel/message/:idMessage', async (req, res) => {
  const { channel, idMessage } = req.params;
  const { content, sender_type } = req.body;

  console.log('🔔 Incoming WhatsApp message request');
  console.log('Channel:', channel);
  console.log('Message ID:', idMessage);
  console.log('Content:', content);
  console.log('Sender Type:', sender_type);

  try {
    // Simulasikan pengiriman pesan ke pengguna WhatsApp
    // Misal: Gunakan wppconnect atau pustaka lainnya

    // Contoh logging
    console.log(`📤 Sending message to WhatsApp from ${sender_type || 'system'}: ${content}`);

    // Kirim respons sukses
    res.status(200).json({
      success: true,
      message: 'Message received by Waconnect',
      data: {
        channel,
        idMessage,
        content,
        sender_type,
      },
    });
  } catch (error) {
    console.error('❌ Failed to process WhatsApp message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to handle WhatsApp message',
      error: error.message,
    });
  }
});

router.get('/sessions/:sessionName/qr', async (req, res) => {
  try {
    const { sessionName } = req.params;
    const qrPath = path.join(QR_FOLDER_PATH, `${sessionName}.png`);

    if (!fs.existsSync(qrPath)) {
      return res.status(404).json({ error: 'QR code tidak ditemukan untuk session ini.' });
    }

    res.setHeader('Content-Type', 'image/png');
    const stream = fs.createReadStream(qrPath);
    stream.pipe(res);
  } catch (error) {
    console.error('Gagal mengambil QR code:', error);
    res.status(500).json({ error: 'Terjadi kesalahan saat mengambil QR code.' });
  }
});

export default router;
