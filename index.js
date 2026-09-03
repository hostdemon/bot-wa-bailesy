import { useMultiFileAuthState, makeWASocket, DisconnectReason } from '@whiskeysockets/baileys'
import pino from 'pino'
import { GoogleGenerativeAI } from '@google/generative-ai'
import dotenv from 'dotenv'
dotenv.config()

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session')
    
    const sock = makeWASocket({
        logger: pino({ level: 'info' }),
        printQRInTerminal: false, // MATIIN QR
        auth: state
    })

    // MINTA PAIRING CODE KALO BELUM LOGIN
    if (!sock.authState.creds.registered) {
        const phoneNumber = process.env.PHONE_NUMBER
        if (!phoneNumber) {
            console.log('ERROR: PHONE_NUMBER belum diset di Variables Railway')
            process.exit(1)
        }
        await new Promise(resolve => setTimeout(resolve, 3000))
        const code = await sock.requestPairingCode(phoneNumber)
        console.log(`\n====================================`)
        console.log(`PAIRING CODE: ${code}`)
        console.log(`====================================\n`)
    }

    sock.ev.on('creds.update', saveCreds)
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'open') console.log('Bot Connected ✅')
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode!== DisconnectReason.loggedOut
            console.log('Connection closed. Reconnecting...', shouldReconnect)
            if(shouldReconnect) startBot()
        }
    })

    // CONTOH BALAS GEMINI
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0]
        if (!msg.message || msg.key.fromMe) return
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text
        if (!text) return

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })
        const result = await model.generateContent(text)
        const reply = result.response.text()
        await sock.sendMessage(msg.key.remoteJid, { text: reply })
    })
}
startBot()
