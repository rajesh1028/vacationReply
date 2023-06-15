const express = require('express');
const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');
const fs = require("fs").promises;
const path = require("path");

const app = express();
const port = 8000;

// Configuration
const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://mail.google.com/'
];  // <- level of access from the users 


const LABEL_NAME = 'Vacation Replies';

app.get('/', async (req, res) => {
    // Load credentials from the downloaded JSON file
    const credentials = await fs.readFile('credentials.json');

    // Authorize a client with credentials.
    const auth = await authenticate({
        keyfilePath: path.join(__dirname, 'credentials.json'),
        scopes: SCOPES
    });

    console.log("Authentication URL:", auth);

    const gmail = google.gmail({ version: 'v1', auth });

    const response = await gmail.users.labels.list({
        userId: 'me'
    });

    // Get credentials from the file.
    async function getCredentials() {
        const filePath = path.join(process.cwd(), 'credentials.json');
        const content = await fs.readFile(filePath, { encoding: 'utf8' });
        return JSON.parse(content);
    }

    // Get messages with no prior replies
    async function getMessages(auth) {
        const gmail = google.gmail({ version: 'v1', auth });
        const response = await gmail.users.messages.list({
            userId: 'me',
            q: '-in:chats -from:me -has:userlabels'
        });
        return response.data.messages || [];
    }

    // Send reply to the messages
    async function sendMessages(auth, message) {
        const gmail = google.gmail({ version: 'v1', auth });
        const res = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From']
        });

        const subject = res.data.payload.headers.find((header) => header.name === 'Subject').value;
        const from = res.data.payload.headers.find((header) => header.name === 'From').value;

        const replyTo = from.match(/<(.*)>/)[1];
        const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`; // Re: assigned a new work.
        const replyBody = `Thank you for your email! \n\nI'm currently on vacation and will get back to you soon.`;
        const rawMessage = [
            `From: me`,
            `To: ${replyTo}`,
            `Subject: ${replySubject}`,
            `In-Reply-To: ${message.id}`,
            `References: ${message.id}`,
            '',
            replyBody
        ].join('\n');
        const encodedMessage = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage
            }
        });
    }

    // Create a label to add the messages accordingly
    async function createLabel(auth) {
        const gmail = google.gmail({ version: 'v1', auth });
        try {
            const res = await gmail.users.labels.create({
                userId: 'me',
                requestBody: {
                    name: LABEL_NAME,
                    labelListVisibility: 'labelshow',
                    messageListVisibility: 'show'
                }
            });
            return res.data.id;
        } catch (error) {
            if (error.code === 409) {
                // If label already exists
                const res = await gmail.users.labels.list({
                    userId: 'me'
                });
                const label = res.data.labels.find((label) => label.name === LABEL_NAME);
                return label.id;
            } else {
                throw error;
            }
        }
    }

    // Add label to a message and move it to the label folder
    async function addLabel(auth, message, labelId) {
        const gmail = google.gmail({ version: 'v1', auth });
        await gmail.users.messages.modify({
            userId: 'me',
            id: message.id,
            requestBody: {
                addLabelIds: [labelId],
                removeLabelIds: ['INBOX']
            }
        });
    }

    // Main function to be performed
    async function main() {
        // create a label for the app
        const labelId = await createLabel(auth);
        console.log(`Created or found label with id ${labelId}`);

        // Repeat the following steps in random intervals
        setInterval(async () => {
            // Get messages that have no prior replies to the person
            const messages = await getMessages(auth);
            console.log(`Found ${messages.length} unreplied messages`);

            // For each messages sending the reply
            for (const message of messages) {
                await sendMessages(auth, message);
                console.log(`Sent reply to message with id ${message.id}`);

                // Add label to the message and move it to the label folder
                await addLabel(auth, message, labelId);
                console.log(`Added label to the message with id ${message.id}`);
            }
        }, Math.floor(Math.random() * (120 - 45 + 1) + 45) * 1000); // Generate a random interval between 45 and 120 seconds
    }

    main().catch(console.error);

    const labels = response.data.labels;
    res.send("Subscribed to our service");


})


app.listen(port, () => {
    console.log('Listening on port', port);
})