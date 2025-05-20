import fs from 'fs';
import wppconnect from '@wppconnect-team/wppconnect';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import moment from 'moment-timezone';
import ffmpeg from 'ffmpeg-static';
import { execSync } from 'child_process';
import axios from 'axios';
import path from 'path';
import { v4 as uuid } from 'uuid';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { SESSION_PATH, QR_FOLDER_PATH } from '../config/paths.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const prisma = new PrismaClient();
// Simpan sesi yang aktif dalam objek sessions
// const sessions = new Map();

export const sessions = new Map();

// === 1) helper membuat folder jika belum ada ===
function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Folder dibuat: ${dirPath}`);
  }
}

export async function createWhatsAppSession(
  sessionName,
  sender = '08123456789',
  username = null,
  email = null,
) {
  try {
    ensureDirExists(QR_FOLDER_PATH);
    for (const sub of ['images', 'videos', 'documents', 'voice_notes/ogg', 'voice_notes/mp3']) {
      ensureDirExists(`./media/${sub}`);
    }

    const qrPath = path.join(QR_FOLDER_PATH, `${sessionName}.png`);

    if (!fs.existsSync(QR_FOLDER_PATH)) {
      fs.mkdirSync(QR_FOLDER_PATH, { recursive: true });
    }

    // ✅ Jika client sudah ada, kembalikan yang sudah ada (hindari duplikasi)
    if (sessions.has(sessionName)) {
      return sessions.get(sessionName);
    }

    // ✅ Cari user berdasarkan sender (nomor WA)
    let user = await prisma.user.findFirst({ where: { sender } });

    // ❌ Jika belum ada, buat user baru
    if (!user) {
      user = await prisma.user.create({
        data: {
          id: uuid().toString(),
          sender,
          username: username || `user_${Date.now()}`, // default username
          email: email || null,
        },
      });
    }

    const client = await wppconnect.create({
      session: sessionName,
      sessionPath: SESSION_PATH,
      autoClose: false,
      catchQR: async (base64Qr) => {
        try {
          const matches = base64Qr.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
          if (!matches) return;

          const imageBuffer = Buffer.from(matches[2], 'base64');
          await sharp(imageBuffer)
            .extend({ top: 20, bottom: 20, left: 20, right: 20, background: 'white' })
            .toFile(qrPath);

          await prisma.session.upsert({
            where: { sessionName },
            update: {
              qrPath,
              status: 'QR_CODE_GENERATED',
              updatedAt: new Date(),
            },
            create: {
              sessionName,
              qrPath,
              status: 'QR_CODE_GENERATED',
              createdAt: new Date(),
              updatedAt: new Date(),
              user: {
                connect: { id: user.id },
              },
            },
          });
        } catch (err) {
          console.error('Error saat memproses QR:', err);
        }
      },
      autoClose: false,
      puppeteerOptions: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
        ],
        executablePath: process.env.CHROME_PATH || undefined,
      },
    });

    client.onStateChange(async (state) => {
      const statusMap = {
        CONNECTED: 'AUTHENTICATED',
        TIMEOUT: 'DISCONNECTED',
        CONFLICT: 'DISCONNECTED',
      };

      await prisma.session.upsert({
        where: { sessionName },
        update: {
          status: statusMap[state] || state,
          updatedAt: new Date(),
        },
        create: {
          sessionName,
          status: statusMap[state] || state,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: {
            connect: { id: user.id },
          },
        },
      });
    });

    // Jalankan sinkronisasi pesan yang belum dibaca
    await syncUnreadMessages(client);

    // Event listener untuk pesan baru
    client.onMessage(async (message) => {
      try {
        await processMessage(client, message);
      } catch (err) {
        console.error('Error processing message:', err);
      }

      if (forwardMessageToAdonis == true) {
        try {
          await forwardMessageToAdonis(message);
        } catch (err) {
          console.error('Error forwarding message to Adonis:', err);
        }
      }
    });

    sessions.set(sessionName, client);
    return client;
  } catch (error) {
    console.error('Error dalam membuat sesi WhatsApp:', error);

    try {
      const session = await prisma.session.findUnique({ where: { sessionName } });
      if (session) {
        await prisma.message.deleteMany({ where: { sessionId: session.id } });
        await prisma.session.delete({ where: { sessionName } });
      }
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError);
    }

    throw error;
  }
}

// Fungsi untuk memproses pesan masuk - Fungsi utama, hanya ada satu
async function processMessage(client, message) {
  if (message.isStatus || message.isStory || isChannelMessage(message)) {
    console.log('Pesan status/story/saluran diabaikan.');
    return;
  }

  if (
    !message.body &&
    !message.caption &&
    !message.isLocation &&
    !message.mimetype &&
    !message.isVoiceMessage
  ) {
    console.log('Pesan tanpa konten diabaikan.');
    return;
  }

  if (message.isGroupMsg) {
    console.log('Pesan dari grup diabaikan.');
    return;
  }

  const now = dayjs().tz('Asia/Jakarta');
  const timestamp = dayjs().tz('Asia/Jakarta').toDate(); // toDate() agar bisa masuk ke Prisma
  console.log(`[${now.format('YYYY-MM-DD HH:mm:ss')}] Pesan diterima dari ${message.from}`);

  let mediaUrl = null;
  let messageType = 'text';
  // let content = (message.body || message.caption || '').slice(0, 10000);
  let content = '';

  const sessionName = client.session;

  const waId = message.from; // contoh: "6283849312534@c.us"
  const phoneNumber = waId.split('@')[0]; // hasil: "6283849312534"

  try {
    // Proses voice note
    if (message.isVoiceMessage) {
      messageType = 'voice_note';
      const buffer = await client.downloadMedia(message);
      const voiceOggPath = `./media/voice_notes/ogg/vn_${now.valueOf()}.ogg`;
      const voiceMp3Path = `./media/voice_notes/mp3/vn_${now.valueOf()}.mp3`;

      ensureDirExists('./media/voice_notes/ogg');
      ensureDirExists('./media/voice_notes/mp3');

      fs.writeFileSync(voiceOggPath, buffer);

      try {
        execSync(
          `"${ffmpeg}" -i "${voiceOggPath}" -codec:a libmp3lame -qscale:a 2 "${voiceMp3Path}"`,
          { timeout: 10000 },
        );
        if (fs.existsSync(voiceMp3Path)) {
          mediaUrl = voiceMp3Path;
          content = 'Voice note (MP3)';
          console.log(`✅ [${now.format('HH:mm:ss')}] MP3 ready: ${voiceMp3Path}`);
        } else {
          throw new Error('File MP3 tidak terbuat');
        }
      } catch (err) {
        console.error(`❌ Konversi VN gagal:`, err.message);
        mediaUrl = voiceOggPath;
        content = 'Voice note (OGG)';
      }

      console.log(
        `Tipe: ${messageType} | Durasi: ${message.duration}s | Ukuran: ${(
          buffer.length / 1024
        ).toFixed(1)}KB`,
      );
      console.log(`Lokasi: ${mediaUrl}`);

      // Proses lokasi
    } else if (message.type === 'location' || message.isLocation) {
      messageType = 'location';
      mediaUrl = `https://maps.google.com/?q=${message.lat},${message.lng}`;
      content = `Lokasi: ${message.description || 'Tanpa deskripsi'} (${message.lat}, ${
        message.lng
      })`;
      console.log(`[${now.format('YYYY-MM-DD HH:mm:ss')}] Lokasi diterima: ${content}`);

      // Proses media (gambar, video, dll)
    } else if (message.mimetype) {
      const buffer = await client.decryptFile(message);
      const extension = message.mimetype.split('/')[1] || 'bin';
      const folderConfig = getMediaFolder(message.mimetype);
      ensureDirExists(folderConfig.folder);

      // Gunakan nama file asli (jika ada)
      const originalFileName = message.filename || `${now.valueOf()}`;
      const filePath = `${folderConfig.folder}/${originalFileName}.${extension}`;
      fs.writeFileSync(filePath, buffer);

      mediaUrl = filePath;
      messageType = folderConfig.type;

      if (message.caption) {
        content = message.caption;
      }

      console.log(
        `[${now.format('YYYY-MM-DD HH:mm:ss')}] File ${folderConfig.type} disimpan: ${filePath}`,
      );
    }

    if (message.body && message.type === 'chat') {
      content = message.body;
      const result = await sendToChatbot(message.body);
      try {
        // Kirim webhook ke AdonisJS dan tunggu respons sukses
        const adonisResponse = await axios.post(
          `${process.env.ADONIS_SERVER_URL}/api/whatsapp/webhook/whatsapp`,
          // 'http://localhost:3333/api/webhook/whatsapp',
          {
            from: message.from,
            pushname: message.sender.pushname,
            sessionName: sessionName,
            message: {
              body: message.body,
              caption: message.caption,
              type: message.type,
              mimetype: message.mimetype,
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
              // 'Authorization': `Bearer ${process.env.ADONIS_API_KEY}` // Tambahkan ini jika perlu autentikasi
            },
            timeout: 30000, // 10 detik timeout
          },
        );

        // -----------fadli----------
        // if (result.success) {
        //   console.log(`Mengirim jawaban (${result.fullReply.length} chars, ${result.responseTime}s)`);
        //   await sendWithTimeout(client, message.from, result.fullReply);
        // } else {
        //   await sendWithTimeout(client, message.from, result.error || 'Terjadi kesalahan.');
        // }

        let user = await prisma.user.findFirst({
          where: { sender: phoneNumber },
        });

        if (!user) {
          // console.error(`❌ User dengan sender ${message.from} tidak ditemukan`);
          // await sendWithTimeout(client, message.from, 'Akun Anda tidak dikenali di sistem. Silakan hubungi admin.');
          user = await prisma.user.create({
            data: {
              sender: phoneNumber,
              // tambahkan field lain seperti email, username jika diperlukan
            },
          });
        }

        const session = await prisma.session.findUnique({
          where: { sessionName },
        });

        if (!session) {
          console.error(
            `❌ Session ${sessionName} tidak ditemukan di DB, maka dibuatkan session baru.`,
          );
          session = await prisma.session.create({
            data: {
              sessionName: `session-${phoneNumber}`,
              status: 'INITIALIZING',
              user: {
                connect: { id: user.id },
              },
            },
          });
        }

        await prisma.message.create({
          data: {
            id: uuid().toString(),
            sessionId: session.id,
            sender: phoneNumber,
            content: content || null,
            reply: result.fullReply,
            mediaUrl: mediaUrl,
            type: messageType,
            timestamp: now.format('YYYY-MM-DD HH:mm:ss.SSS'),
          },
        });
        console.log(
          `[${now.format('YYYY-MM-DD HH:mm:ss')}] Pesan ${messageType} disimpan ke database.`,
        );

        console.log(`✅ Pesan berhasil dikirim ke AdonisJS: ${adonisResponse.data.success}`);

        // Tidak perlu menunggu respons dari chatbot - AdonisJS akan menangani itu
        // dan akan mengirim respons ke pengguna secara asinkron
      } catch (error) {
        console.error('❌ Gagal mengirim pesan ke AdonisJS:', error.message);

        // Fallback: Proses seperti biasa jika AdonisJS tidak tersedia
        const result = await sendToChatbot(message.body);

        if (result.success) {
          console.log(
            `Mengirim jawaban (${result.fullReply.length} chars, ${result.responseTime}s)`,
          );
          await sendWithTimeout(client, message.from, result.fullReply);
        } else {
          await sendWithTimeout(client, message.from, result.error || 'Terjadi kesalahan.');
        }
      }
    } else {
      content = message.body;
      // Untuk pesan non-teks, simpan ke database tanpa reply
      try {
        // Kirim webhook ke AdonisJS dan tunggu respons sukses
        const adonisResponse = await axios.post(
          `${process.env.ADONIS_SERVER_URL}/api/whatsapp/webhook/whatsapp`,
          // 'http://localhost:3333/api/webhook/whatsapp',
          {
            from: message.from,
            pushname: message.sender.pushname,
            sessionName: sessionName,
            message: {
              body: message.body,
              caption: message.caption,
              type: message.type,
              mimetype: message.mimetype,
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
              // 'Authorization': `Bearer ${process.env.ADONIS_API_KEY}` // Tambahkan ini jika perlu autentikasi
            },
            timeout: 30000, // 10 detik timeout
          },
        );

        let session = await prisma.session.findUnique({
          where: { sessionName },
        });

        if (!session) {
          session = await prisma.session.create({
            data: {
              sessionName: `session-${phoneNumber}`,
              status: 'INITIALIZING',
              user: {
                connect: { id: user.id },
              },
            },
          });
        }
        await prisma.message.create({
          data: {
            id: uuid().toString(),
            sessionId: session.id,
            sender: phoneNumber,
            content: content || null,
            reply: null,
            mediaUrl: mediaUrl,
            type: messageType,
            timestamp: now.format('YYYY-MM-DD HH:mm:ss.SSS'),
          },
        });
        console.log(
          `[${now.format('YYYY-MM-DD HH:mm:ss')}] Pesan ${messageType} disimpan ke database.`,
        );
        console.log(`✅ Pesan berhasil dikirim ke AdonisJS: ${adonisResponse.data.success}`);
      } catch (error) {
        console.error('❌ Gagal mengirim pesan ke AdonisJS:', error.message);

        const result = await sendToChatbot(message.body);

        if (result.success) {
          console.log(
            `Mengirim jawaban (${result.fullReply.length} chars, ${result.responseTime}s)`,
          );
          await sendWithTimeout(client, message.from, result.fullReply);
        } else {
          await sendWithTimeout(client, message.from, result.error || 'Terjadi kesalahan.');
        }
      }
    }

    // Handle perintah logout
    if (content && content.toLowerCase() === 'logout') {
      await client.logout();
      await client.restartService();
      console.log('✅ Berhasil logout dan restart layanan.');
      await client.sendText(
        message.from,
        '✅ Anda telah logout. Silakan scan QR code baru untuk login kembali.',
      );
    }
  } catch (err) {
    console.error('ProcessMessage Error:', err.message);
    await sendWithTimeout(client, message.from, 'Maaf, terjadi kesalahan saat memproses pesan.');
  }
}

async function forwardMessageToAdonis(message) {
  try {
    // Format data yang akan dikirim
    const payload = {
      from: message.from, // e.g. "6281234567890@c.us"
      pushname: message.sender?.pushname || '',
      message: {
        body: message.body || message.caption || '',
        type: message.type,
        mimetype: message.mimetype,
      },
    };

    // Ganti 'whatsapp' dengan nama channel sesuai kebutuhan
    const response = await axios.post(
      `${process.env.ADONIS_SERVER_URL}/whatsapp/conversation`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    console.log('✅ Pesan berhasil diteruskan ke Adonis:', response.data);
  } catch (error) {
    console.error('❌ Gagal mengirim ke Adonis:', error.response?.data || error.message);
  }
}

// Helper functions
function getMediaFolder(mimetype) {
  if (mimetype.startsWith('image/')) {
    return { folder: './media/images', type: 'image' };
  }
  if (mimetype.startsWith('video/')) {
    return { folder: './media/videos', type: 'video' };
  }
  if (mimetype.startsWith('audio/')) {
    return { folder: './media/audios', type: 'audio' };
  }
  return { folder: './media/documents', type: 'document' };
}

async function syncUnreadMessages(client) {
  try {
    const chats = await client.getAllUnreadMessages();
    for (const chat of chats) {
      for (const message of chat.messages) {
        await processMessage(client, message);
      }
    }
    console.log('✅ Pesan yang belum dibaca berhasil disinkronkan.');
  } catch (error) {
    console.error('❌ Gagal menyinkronkan pesan yang belum dibaca:', error);
  }
}

export async function sendToChatbot(question) {
  const data = JSON.stringify({ question });

  const config = {
    method: 'post',
    url: 'https://api.majadigidev.jatimprov.go.id/api/external/chatbot/send-message',
    headers: {
      'Content-Type': 'application/json',
      Cookie:
        'adonis-session=s%3AeyJtZXNzYWdlIjoiY204c2Z1eWl4MDc4azAxbnVld2FqMnY0aiIsInB1cnBvc2UiOiJhZG9uaXMtc2Vzc2lvbiJ9.AcThXp7bikyoST3mnyromozkXvIItQRaPWTbmh0vfxs; cm8sfuyix078k01nuewaj2v4j=e%3AEGkeKzKuF2lOF2zE80Eorr5Xa_PVq3ZhsW6RiB1Yq7noSo9YlbbwTU3Lj_jMYYUFa1YGBkbRMGyYrqvsNBZp2w.V2p3NWxXcjQzSzI5eW1nRA.H0xpbbSqQIL4m9DGksFfU6NGz7qrBkv4iz5udBbKEpM', // cookie lengkap
    },
    data: data,
    timeout: 40000,
  };

  try {
    // Tambahkan log untuk tracking
    console.log('Mengirim pertanyaan ke chatbot:', question.substring(0, 50) + '...');
    const startTime = Date.now();

    const response = await axios.request(config);

    const processingTime = (Date.now() - startTime) / 1000;
    console.log(`Chatbot merespons dalam ${processingTime} detik`);

    if (!response.data?.data?.message?.[0]?.text) {
      throw new Error('Struktur respons tidak valid');
    }

    const chatbotMessage = response.data.data.message[0];
    let fullReply = chatbotMessage.text;

    // Formatting
    fullReply = fullReply
      .replace(/\*\*/g, '') // Hapus markdown bold
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1: $2') // Konversi markdown links
      .replace(/\\n/g, '\n'); // Konversi newline

    // Tambahkan link terkait
    if (chatbotMessage.suggest_links?.length > 0) {
      fullReply += '\n\n Link Terkait:';
      chatbotMessage.suggest_links.forEach((link) => {
        fullReply += `\n- ${link.title}: ${link.link}`;
      });
    }

    return {
      success: true,
      fullReply: fullReply,
      responseTime: processingTime,
      messageType: 'text',
    };
  } catch (error) {
    console.error('Error details:', {
      config: {
        url: config.url,
        data: config.data.length > 100 ? config.data.substring(0, 100) + '...' : config.data,
      },
      error: error.message,
      stack: error.stack,
    });

    // Retry mechanism untuk timeout
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      console.log('Mencoba kembali...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return sendToChatbot(question);
    }

    return {
      success: false,
      error: 'Chatbot sedang sibuk, silakan coba lagi nanti',
    };
  }
}

async function sendWithTimeout(client, to, message, timeout = 30000) {
  return Promise.race([
    client.sendText(to, message),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout pengiriman pesan')), timeout),
    ),
  ]);
}

export async function start(client) {
  console.log('✅ Bot WhatsApp berhasil terhubung!');

  client.isConnected().then((connected) => {
    console.log('Status koneksi:', connected ? 'Terhubung' : 'Terputus');
  });

  client.getHostDevice().then((info) => {
    console.log('Info Perangkat:', info);
  });

  // Pastikan folder media tersedia
  ensureDirExists('./media/images');
  ensureDirExists('./media/videos');
  ensureDirExists('./media/documents');
  ensureDirExists('./media/voice_notes/ogg');
  ensureDirExists('./media/voice_notes/mp3');

  // Jalankan sinkronisasi pesan yang belum dibaca
  await syncUnreadMessages(client);

  console.log('✅ Bot WhatsApp siap menerima pesan!');
}

// Fungsi untuk memeriksa apakah pesan berasal dari saluran/channel
function isChannelMessage(message) {
  const from = message.from.toLowerCase();
  return (
    from.includes('@broadcast') ||
    from.includes('status@') ||
    (from.includes('@c.us') && message.isStatus)
  );
}
