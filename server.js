const path = require('path');

// Wannan layin zai sa Express ta gane fayilolin da ke babban babban folda
app.use(express.static(path.join(__dirname)));

// Wannan kuma zai nuna index.html idan an shigo babban link
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});



// 1. HAƊAWA DA MONGODB
// Lokacin da za ka tafi live akan Render, za ka canza wannan URL ɗin zuwa na MongoDB Atlas
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

        // Kula da lokacin da lambar ta gama haɗuwa da WhatsApp cikin nasara
        sock.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                console.log(`Lamba ${cleanNumber} ta haɗu dakat!`);
                
                // Jefa lambar kai tsaye cikin MongoDB kamar yadda kake so
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
                    
                    // Cire kowane irin haruffa idan da rago, mu bar zallan lambobi 8 kacal
                    let cleanCode = code?.replace(/[^0-9]/g, '') || code;

                    // DABARA: Raba lambar guda 8 ta zama hudu na farko da hudu na karshe (misali: 1234 - 5678)
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
            // Idan riga ta haɗu, mu tabbatar tana cikin Database kuma
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
