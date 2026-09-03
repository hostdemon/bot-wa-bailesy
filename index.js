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
        browser: ['Chrome', 'Ubuntu', '22.04.1'] // biar gak kebaca bot
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
    
    sock.ev.on('connection.update', (update)
