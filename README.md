# WaConnect📞

Aplikasi penghubung Whatsapp dengan chatbot

## Setup
1. ``` npm install ```
2. ``` npx prisma init```
- membuat prismanya dan memunculkan .env
3. sesuaikan env dengan db Anda

4. ```npx prisma migrate dev -nama_migrate```
- migrate schema

### Cara pemakaian WaConnect

Ada 2 cara pemakaian nya WaConnect
1. Bisa langsung scan Qr code
2. bisa menggunakan session lalu scan Qr code dengan menggunakan Authentikasi

=============================================

#### Cara pemakaian 1

cara memakainya :

1. ```npm run start```
- menjalankan WhatsApp
2. Scan QR code di terminal/ di dalam folder sessions/qrcodes/ mySessions.png dengan aplikasi Whatsapp Anda

3. Berhasil tertautkan dengan Whatsapp Anda

#### Cara pemakaian 2

1. ```npm run start```
- menjalankan WhatsApp
2. login
```
username: fadliAsyp 
sender: 08123456789
```
maka akan menghasilkan Token

3. create sessions
- memasukan dengan ```sessionsName: fadliSession``` beserta tokennya > maka akan muncul qr code di folder session/qrcodes namaSession.png
4. Scan QR code

5. Berhasil tertautkan dengan Whatsapp Anda

### cara memutuskan tautan

1. buka whatsapp Anda
2. titik tiga diatas > perangkat tautan > putuskan tautan


```rm -rf tokens/mySession```
menghapus token/merefresh token

catatan :

6281234567890@c.us 
- untuk perorang/induvidu

- Di bagian tautan undangan grup, Anda akan melihat tautan seperti https://chat.whatsapp.com/ABCDEFGHIJKL.​
- Kode unik setelah https://chat.whatsapp.com/ adalah ID grup.
