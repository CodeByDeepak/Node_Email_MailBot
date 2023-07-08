const { google } = require('googleapis');
const fs = require('fs');
const readline = require('readline');

const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';

const processedEmails = []; // Array to store processed email IDs

function authorize(credentials, callback) {
    const { client_secret, client_id, redirect_uris } = credentials.web;
    const oAuth2Client = new google.auth.OAuth2(
        client_id, client_secret, redirect_uris[0]
    );

    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) return getAccessToken(oAuth2Client, callback);
        oAuth2Client.setCredentials(JSON.parse(token));
        callback(oAuth2Client);
    });
}

function getAccessToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES
    });

    console.log('Authorize this app by visiting this URL:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error retrieving access token', err);
            oAuth2Client.setCredentials(token);
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                if (err) console.error(err);
                console.log('Token stored to', TOKEN_PATH);
            });
            callback(oAuth2Client);
        });
    });
}
//This method will help to get the lebel id 
async function getLabelId(auth, labelName) {
    const gmail = google.gmail({ version: 'v1', auth });

    const res = await gmail.users.labels.list({ auth, userId: 'me' });
    const labels = res.data.labels;
    const label = labels.find(l => l.name === labelName);

    if (label) {
        return label.id;
    } else {
        throw new Error(`Label "${labelName}" not found.`);
    }
}

function watchEmails(auth) {
    const gmail = google.gmail({ version: 'v1', auth });

    const watchMailbox = () => {
        gmail.users.watch({
            userId: 'me',
            resource: {
                topicName: 'projects/assignment-392120/topics/email-watcher'
            }
        }, (err, res) => {
            if (err) return console.error('Error watching mailbox', err);
            console.log('Mailbox watch started');
        });
        processEmails();
        const delay = Math.floor(Math.random() * (120000 - 45000 + 1)) + 45000;
        setTimeout(watchMailbox, delay);
    };

    const processEmails = () => {
        gmail.users.messages.list({
            userId: 'me',
            labelIds: ['INBOX'],
            q: 'is:unread' // Only fetch unread emails with the INBOX label
        }, (err, res) => {
            if (err) return console.error('Error listing emails', err);

            const emails = res.data.messages;

            if (emails && emails.length > 0) {
                for (let i = 0; i < emails.length; i++) {
                    const emailId = emails[i].id;

                    if (!processedEmails.includes(emailId)) {
                        processedEmails.push(emailId);
                        gmail.users.messages.get({
                            userId: 'me',
                            id: emailId
                        }, (err, res) => {
                            if (err) return console.error('Error retrieving email', err);

                            const email = res.data;
                            processEmail(auth, email);
                        });
                    }
                }
            }
        });
    };

    // Start the initial mailbox watch
    watchMailbox();
}

function processEmail(auth, email) {
    const headers = email.payload.headers;
    let senderEmail;

    for (let i = 0; i < headers.length; i++) {
        if (headers[i].name === 'From') {
            senderEmail = headers[i].value;
            break;
        }
    }

    if (senderEmail) {
        console.log('Sender:', senderEmail);

        // Call the sendReply function to send an automatic reply
        const threadId = email.threadId;
        sendReply(auth, threadId, senderEmail);
    } else {
        console.log('Sender email not found.');
    }
}

async function updateLabel(gmail, auth, response) {
    const labelId = await getLabelId(auth, "Google’s APIs");

    // Apply label to the replied email
    console.log("Response: " + response);
    if (response && response.data !== undefined) {
        gmail.users.messages.modify({
            auth,
            userId: 'me',
            id: response.data.id,
            resource: { addLabelIds: [labelId], removeLabelIds: [] },
        });
        console.log('Label applied successfully.');
    }
}

async function sendReply(auth, threadId, email) {
    const gmail = google.gmail({ version: 'v1', auth });
    const subject = 'Automatic Reply';
    const message = 'Thank you for your email. I am on Vacation. i will contact you after my vaction .';

    gmail.users.threads.modify({
        userId: 'me',
        id: threadId,
        resource: {
            addLabelIds: ['INBOX'],
            removeLabelIds: []
        }
    }, async (err) => {
        if (err) return console.error('Error modifying thread', err);

        const raw = [
            'Content-Type: text/plain;charset=utf-8',
            'MIME-Version: 1.0',
            `Subject: ${subject}`,
            `To: ${email}`,
            '',
            message
        ].join('\n').trim();

        const encodedMessage = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

        try {
            const response = await gmail.users.messages.send({
                auth,
                userId: 'me',
                resource: { raw: encodedMessage }
            });
            if (response) {
                console.log('Auto-reply sent successfully:', response.data);
                updateLabel(gmail, auth, response);
            }
        } catch (err) {
            console.error('Error while sending the auto-reply:', err);
            return;
        }
    });
}

fs.readFile(CREDENTIALS_PATH, (err, content) => {
    if (err) return console.error('Error loading credentials', err);
    authorize(JSON.parse(content), (auth) => {
        watchEmails(auth);
    });
});
