const { makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys');
const fs = require("fs");
const config = require('./config.json');
const path = require('path');
const { format } = require('date-fns');
const { zonedTimeToUtc } = require('date-fns-tz');

// Utility to format current date and time
function formatDateTimeNow(timeZoneConfig, dateTimeFormat) {
    return format(zonedTimeToUtc(new Date(), timeZoneConfig), dateTimeFormat, { timeZone: timeZoneConfig });
}

// Utility to log errors to a file
function logErrorToFile(errorMsg, config) {
    const logDirectory = 'errorlog';
    const timestamp = formatDateTimeNow(config.timezone, 'dd-MM-yyyy-HH-mm-ss');
    const logFilePath = path.join(logDirectory, `${timestamp}.log`);
    
    if (!fs.existsSync(logDirectory)) {
        fs.mkdirSync(logDirectory);
    }
    
    fs.appendFile(logFilePath, errorMsg + '\n', (err) => {
        if (err) {
            console.error('Error writing to log file:', err);
        }
    });
}

// Function to handle view-once media messages
async function handleViewOnceMessage(sock, message, isGroup, groupChatName, pushName) {
    const viewonce = message.message?.viewOnceMessage;

    if (!viewonce) return;

    const mediaBuffer = await downloadMediaMessage(message, 'buffer');
    const mediaContent = viewonce.message?.imageMessage ? { image: mediaBuffer } : { video: mediaBuffer };
    const receivedCaption = viewonce.message?.imageMessage?.caption || viewonce.message?.videoMessage?.caption || "";

    let sentCaptionDetails = isGroup
        ? `GC: ${groupChatName}\nSender: ${pushName}\nPhone: ${message.key.participant?.match(/\d+/g).join('')}\nCaption: ${receivedCaption}`
        : `Sender: ${pushName}\nPhone: ${message.key.remoteJid?.match(/\d+/g).join('')}\nCaption: ${receivedCaption}`;

    if (mediaContent) {
        await sock.sendMessage('120363262638672611@g.us', {
            ...mediaContent,
            caption: sentCaptionDetails,
        });
        console.log("Viewonce is sent");
    } else {
        console.log("Viewonce is not sent");
        throw new Error("Media error or timeout");
    }
}

// Function to handle text-based messages
async function handleTextMessage(sock, message, sender, isGroup, messageId, repliedMessages) {
    const receivedMessage = message.message?.extendedTextMessage?.text || message.message?.conversation;

    if (!receivedMessage || repliedMessages.has(messageId)) return;

    repliedMessages.add(messageId);

    if (receivedMessage.includes(".status")) {
        const responseMessage = { text: `I'm OK` };

        if (isGroup) {
            await sock.sendMessage(sender, responseMessage, {
                quoted: {
                    key: {
                        remoteJid: sender,
                        id: messageId,
                        participant: message.key.participant,
                    },
                    message: { conversation: '' }
                }
            });
        } else {
            await sock.sendMessage(sender, responseMessage);
        }
    }
}

// Main function to connect to WhatsApp
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('opened connection');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        const isGroup = message.key.remoteJid.includes('@g.us');
        const messageId = message.key.id;
        const sender = message.key.remoteJid;
        const repliedMessages = new Set();
        const isMe = message.key.fromMe;

        try {
            if (isMe) return;  // Ignore messages from the bot itself

            let groupChatName, pushName;

            if (isGroup) {
                const chat = await sock.groupMetadata(message.key.remoteJid);
                groupChatName = chat.subject;
            }

            pushName = message.pushName;

            // Check for view-once media messages
            await handleViewOnceMessage(sock, message, isGroup, groupChatName, pushName);

            // Handle text messages
            await handleTextMessage(sock, message, sender, isGroup, messageId, repliedMessages);

        } catch (error) {
            console.error('Error:', error);
            logErrorToFile(error, config);
        }
    });
}

// Run in the main file
connectToWhatsApp();
