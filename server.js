const express = require('express'); 
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose'); 

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(__dirname));

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/whatsapp_gateway')
  .then(() => console.log('Masha Allah, MongoDB ya haɗu lafiya!'))
  .catch(err => console.error('Kuskure wajen haɗawa da MongoDB:', err));

const NumberSchema = new mongoose.Schema({
    phoneNumber: String,
    status: { type: String, default: 'Active' },
    connectedAt: { type: Date, default: Date.now }
});
const WhatsAppNumber = mongoose.model('WhatsAppNumber', NumberSchema);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let sessions = {}; 

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
                    
                    if (!code) {
                        return res.status(500).json({ error: 'Sabar WhatsApp ba ta ba da code ba, sake gwada nan kusa.' });
                    }

                    // GYARA: Mun cire tsohon replace ɗin, domin mu bar lambobin da alphabet ɗin kamar yadda WhatsApp ke buƙata 
                    let cleanCode = code.trim();

                    // Idan akwai baka-gizo (-) a tsakiya tun farko, mu cire shi kafin mu sake tsara shi da kanmu
                    cleanCode = cleanCode.replace(/-/g, '');

                    // Tabbatar tsawon code ɗin ya kai guda 8 cif gaba ɗaya
                    if (cleanCode.length < 8) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        code = await sock.requestPairingCode(cleanNumber);
                        cleanCode = code.trim().replace(/-/g, '');
                    }

                    // Raba code ɗin guda 8 (tare da alphabet da lambobinsa) ya dawo hudu na farko da hudu na karshe
                    let formattedCode = cleanCode.substring(0, 4) + " - " + cleanCode.substring(4, 8);

                    if (!res.headersSent) {
                        return res.json({ success: true, pairingCode: formattedCode });
                    }
                } catch (err) {
                    if (!res.headersSent) {
                        return res.status(500).json({ error: 'An samu matsala wajen samar da Pairing Code. Sake jarrabawa.' });
                    }
                }
            }, 10000); 
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
                          
