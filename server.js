const express = require('express');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();

// 1. SAITA MIDDLEWARES
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// 2. HAƊAWA DA MONGODB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/whatsapp_gateway')
  .then(() => console.log('Masha Allah, MongoDB ya haɗu lafiya!'))
  .catch(err => console.error('Kuskure wajen haɗawa da MongoDB:', err));

// Tsarin yadda za a adana lambobin a Database ba tare da register ko password ba
const NumberSchema = new mongoose.Schema({
    phoneNumber: String,
    status: { type: String, default: 'Active' },
    connectedAt: { type: Date, default: Date.now }
});
const WhatsAppNumber = mongoose.model('WhatsAppNumber', NumberSchema);

// 3. NUNA SHAFIN FRONTEND (INDEX.HTML TARE DA BUBBAN 'I')
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Index.html'));
});

let sessions = {}; 

// 4. API CODES FOR WHATSAPP PAIRING
app.post('/api/connect', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Saka lambar waya da lambar kasa!' });

    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    const sessionId = `session_${cleanNumber}`;
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth_info', sessionId));
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false
        });

        sessions[sessionId] = sock;
        sock.ev.on('creds.update', saveCreds);

        // Kula da lokacin da lambar ta gama haɗuwa da WhatsApp cikin nasara
        sock.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                console.log(`Lamba ${cleanNumber} ta haɗu dakat!`);
                
                await WhatsAppNumber.findOneAndUpdate(
                    { phoneNumber: cleanNumber },
                    { status: 'Active', connectedAt: new Date() },
                    { upsert: true, new: true }
                );
            }
        });

        if (!sock.authState.creds.registered) {
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(cleanNumber);
                    let cleanCode = code?.replace(/[^0-9]/g, '') || code;
                    let formattedCode = cleanCode.substring(0, 4) + " - " + cleanCode.substring(4, 8);

                    if (!res.headersSent) {
                        return res.json({ success: true, pairingCode: formattedCode });
                    }
                } catch (err) {
                    if (!res.headersSent) {
                        return res.status(500).json({ error: 'An samu matsala wajen samar da Pairing Code. Sake jarrabawa.' });
                    }
                }
            }, 1500);
        } else {
            await WhatsAppNumber.findOneAndUpdate(
                { phoneNumber: cleanNumber },
                { status: 'Active' },
                { upsert: true }
            );
            return res.json({ success: true, message: 'Wannan lambar riga ta haɗu!' });
        }

    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// 5. API FOR SENDING BULK MESSAGES
app.post('/api/send-message', async (req, res) => {
    const { senderNumber, receiverNumber, message } = req.body;
    const cleanSender = senderNumber.replace(/[^0-9]/g, '');
    const cleanReceiver = receiverNumber.replace(/[^0-9]/g, '');
    
    const sessionId = `session_${cleanSender}`;
    const sock = sessions[sessionId];

    if (!sock) return res.status(404).json({ error: 'Wannan lambar ba ta riga ta haɗu ba!' });

    try {
        const jid = `${cleanReceiver}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true, message: `An tura saƙo zuwa ${cleanReceiver}` });
    } catch (error) {
        res.status(500).json({ error: 'Gaza tura saƙo: ' + error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Inji yana tafi a port ${PORT}`));
                                      
