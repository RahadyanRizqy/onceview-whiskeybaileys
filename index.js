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

    const repliedMessages = new Set();

    sock.ev.on('messages.upsert', async m => {
        const message = m.messages[0];
        try {
            
            const viewonce = message.message?.viewOnceMessage;
            if (viewonce) {
                console.log(viewonce);
                const mediaBuffer = await downloadMediaMessage(message, 'buffer');
                
                // Obtain media
                let mediaContent;

                if (viewonce.message?.imageMessage) {
                    console.log("ONCE IMAGE");
                    mediaContent = { image: mediaBuffer };
                }

                else if (viewonce.message?.videoMessage) {
                    console.log("ONCE VIDEO");
                    mediaContent = { video: mediaBuffer };
                }

                // Check what chat is the message coming from
                let isGroup;

                const chat = await sock.groupMetadata(message.key.remoteJid);
                const groupChatName = chat.subject;

                if (groupChatName) {
                    isGroup = true;
                }
                else {
                    isGroup = false;
                }
                
                // Check if caption exists in imageMessage or videoMessage
                let receivedCaptionDetails;

                if (viewonce.message?.imageMessage?.caption) {
                    receivedCaptionDetails = viewonce.message.imageMessage.caption;

                } else if (viewonce.message?.videoMessage?.caption) {
                    receivedCaptionDetails = viewonce.message.videoMessage.caption;

                } else {
                    receivedCaptionDetails = null;
                }

                // Make caption
                let captionDetails;

                if (isGroup && receivedCaptionDetails) {
                    captionDetails = `Group: *${groupChatName}*
Sender: *${message.pushName}*
Phone: *${message.key.participant.match(/\d+/g).join('')}*
Caption: ${receivedCaptionDetails}`;
                }
                else if (isGroup && !receivedCaptionDetails) {
                    captionDetails = `Group: *${groupChatName}*
Sender: *${message.pushName}*
Phone: ${message.key.participant.match(/\d+/g).join('')}`;
                }
                else if (!isGroup && receivedCaptionDetails) {
                    captionDetails = `Sender: *${message.pushName}*
Phone: *${message.key.remoteJid.match(/\d+/g).join('')}*
Caption: ${receivedCaptionDetails}`;
                }
                else if (!isGroup && !receivedCaptionDetails) {
                    captionDetails = `Sender: *${message.pushName}*
Phone: ${message.key.remoteJid.match(/\d+/g).join('')}`;
                }
                
                if (mediaContent) {
                    await sock.sendMessage('120363262638672611@g.us', {
                        ...mediaContent,
                        caption: captionDetails ?? '',
                    })
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