const { makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys')
const fs = require("fs")
const config = require('./config.json');
const path = require('path');
const { format } = require('date-fns');
const { zonedTimeToUtc } = require('date-fns-tz');

function formatDateTimeNow(timeZoneConfig, dateTimeFormat) {
    return format(zonedTimeToUtc(new Date(), timeZoneConfig), dateTimeFormat, { timeZone: timeZoneConfig });
}

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

async function connectToWhatsApp () {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
    const sock = makeWASocket({
        // can provide additional config here
        auth: state,
        printQRInTerminal: true
    })

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if(connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut
            // console.log('connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect)
            // reconnect if not logged out
            if(shouldReconnect) {
                connectToWhatsApp()
            }
        } else if(connection === 'open') {
            console.log('opened connection')
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const message = m.messages[0];

        try {
            let isGroup = message.key.remoteJid.includes('@g.us') 
                            ? true 
                            : false;

            let groupChatName;
            let pushName;

            const viewonce = message.message?.viewOnceMessage;

            if (viewonce) {
                const mediaBuffer = await downloadMediaMessage(message, 'buffer');
                
                // Obtain media
                let mediaContent = viewonce.message?.imageMessage 
                                    ? { image: mediaBuffer } 
                                    : { video: mediaBuffer };

                let receivedCaptionDetails = (viewonce.message?.imageMessage
                                    ? viewonce.message?.imageMessage.caption
                                    : viewonce.message?.videoMessage.caption);
                
                let sentCaptionDetails;

                if (isGroup) {
                    const chat = await sock.groupMetadata(message.key.remoteJid);
                    groupChatName = chat.subject;
                    pushName = message.pushName;
                    sentCaptionDetails = `GC: ${groupChatName}\nSender: ${pushName}\nPhone: ${message.key.participant?.match(/\d+/g).join('')}` 
                    + 
                    (receivedCaptionDetails == "" || receivedCaptionDetails == undefined 
                        ? "" 
                        : `\nCaption: ${receivedCaptionDetails}`);
                }
                else {
                    pushName = message.pushName;
                    sentCaptionDetails = `Sender: ${pushName}\nPhone: ${message.key.remoteJid?.match(/\d+/g).join('')}`
                    + 
                    (receivedCaptionDetails == "" || receivedCaptionDetails == undefined 
                        ? "" 
                        : `\nCaption: ${receivedCaptionDetails}`);
                }

                if (mediaContent) {
                    await sock.sendMessage('120363262638672611@g.us', {
                        ...mediaContent,
                        caption: sentCaptionDetails,
                    });
                    console.log("Viewonce is sent");
                }
                else {
                    console.log("Viewonce is not sent");
                    throw new Error("Media error or time out");
                }
            }
            else {
                const repliedMessages = new Set();
                const messageId = message.key.id;
                const sender = message.key.remoteJid;
                const isMe = message.key.fromMe;  // Check if the message is from the bot itself
        
                if (messageId && !repliedMessages.has(messageId)) {
                    const receivedMessage = message.message?.extendedTextMessage?.text || message.message?.conversation;
                    
                    if (isMe || repliedMessages.has(messageId)) {
                        return;
                    }

                    repliedMessages.add(messageId);

                    if (receivedMessage.includes(".status")) {
                        if (isGroup) {
                            await sock.sendMessage(sender, { text: `I'm OK` }, {
                                quoted: {
                                    key: {
                                      remoteJid: sender,
                                      id: messageId,
                                      participant: message.key.participant
                                    },
                                    message: {
                                        conversation: ''
                                    }
                                  }
                                }
                            );
                        }
                        else {
                            await sock.sendMessage(sender, { text: `I'm OK`});
                        }
                    }
                }
            }

        }
        catch (error) {
            console.error('Error', error);
            logErrorToFile(error, config);
        }
    })
}
// run in main file
connectToWhatsApp()