import { useMultiFileAuthState, makeWASocket, DisconnectReason } from '@whiskeysockets/baileys/lib/index.js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import dotenv from 'dotenv'
dotenv.config()

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session')
    
    const sock = makeWASocket({
        printQRInTerminal: false,
        auth: state,
        browser: ['Chrome', 'Ubuntu', '22.04.1']
    })

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
    
    sock.ev.on('connection.update', (update) => { // <-- INI UDAH DIBENERIN
        const { connection, lastDisconnect } = update
        if (connection === 'open') console.log('Bot Connected ✅')
        if (connection === 'close') {
            const statusCode = lastDisconnect.error?.output?.statusCode
            const shouldReconnect = statusCode!== DisconnectReason.loggedOut
            console.log('Connection closed. Reconnect:', shouldReconnect)
            if(shouldReconnect) startBot()
        }
    })

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0]
        if (!msg.message || msg.key.fromMe) return
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text
        if (!text) return

        console.log('Pesan masuk:', text)
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })
            const result = await model.generateContent(text)
            const reply = result.response.text()
            await sock.sendMessage(msg.key.remoteJid, { text: reply })
        } catch (e) {
            console.log('Error Gemini:', e)
        }
    })
}
startBot()
