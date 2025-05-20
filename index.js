// import { createWhatsAppSession } from './src/service/client.js';
// import { createWhatsAppSession, start} from './src/service/cadangan.js';
import { createWhatsAppSession, start} from './src/service/chatbot_api.js';
// import app from './src/service/server.js';
const PORT = 21465;
import app from './src/app.js';
import dotenv from 'dotenv';

dotenv.config();


(async () => {
  try {
    const client = await createWhatsAppSession('mySession');
    start(client); 
  } catch (error) {
    console.error('Terjadi kesalahan saat menjalankan bot:', error);
  }
})();

app.listen(PORT, () => {
  console.log(` Server berjalan di http://localhost:${PORT}`);
});
