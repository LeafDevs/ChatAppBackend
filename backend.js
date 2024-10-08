const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: ['http://localhost:3000', 'http://172.20.10.8:3000'], methods: ["GET", "POST"], allowedHeaders: ["my-custom-header"], credentials: true } });
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto');
const ipAnonymize = require('ip-anonymize');

app.use(cors({
    origin: ['http://localhost:3000', 'http://172.20.10.8:3000'], // Allow both localhost and IP address
    credentials: true
}));

const sessionMiddleware = session({
    secret: 'your_secret_key', resave: false, saveUninitialized: true, cookie: { secure: false },
    store: new FileStore({ path: './sessions', ttl: 86400, reapInterval: 3600 }),
});

app.use(sessionMiddleware, express.urlencoded({ extended: true }), express.json(), express.static(__dirname + '/build'));

const users = new Set();

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, './userdata/'),
    filename: (req, file, cb) => {
        const date = new Date();
        const formattedDate = `${date.getDate().toString().padStart(2, '0')}::${(date.getMonth() + 1).toString().padStart(2, '0')}::${date.getFullYear()}::${date.getHours().toString().padStart(2, '0')}::${date.getMinutes().toString().padStart(2, '0')}`;
        cb(null, `${req.session.username}-${formattedDate}${path.extname(file.originalname)}`);
    }
});

app.post('/api/v1/upload', multer({ storage }).single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const fileBuffer = await fs.promises.readFile(req.file.path);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Read the files.json
    const filesJson = JSON.parse(await fs.promises.readFile('./files.json', 'utf8'));

    if (filesJson.files[fileHash]) {
        // If the hash exists, use the existing filename
        const existingFilename = filesJson.files[fileHash];
        await fs.promises.unlink(req.file.path); // Delete the newly uploaded file
        return res.json({ success: true, fileUrl: `http://172.20.10.8:3000/userdata/${existingFilename}` });
    }

    // If the hash doesn't exist, add it to files.json
    filesJson.files[fileHash] = req.file.filename;
    await fs.promises.writeFile('./files.json', JSON.stringify(filesJson, null, 4));

    res.json({ success: true, fileUrl: `http://172.20.10.8:3000/userdata/${req.file.filename}` });
});

app.use('/userdata', express.static('userdata'));

io.use((socket, next) => {
    socket.request.ip = ipAnonymize(socket.request.ip);
    sessionMiddleware(socket.request, {}, next);
});

app.get('/api/v1/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

io.on('connection', (socket) => {
    console.log('a user connected');
    
    socket.on('request previous messages', () => {
        const messages = JSON.parse(fs.readFileSync('./messages.json', 'utf8'));
        socket.emit('chat messages', messages.messages.slice(-250));
    });

    socket.on('chat message', (data) => {
        const message = {
            id: data.id || new Date().toISOString(),
            message: data.message,
            username: data.username,
            nickname: data.nickname || data.username,
            isCurrentUser: data.isCurrentUser || false,
            profilePicture: data.profilePicture || '',
            fileURL: data.fileURL || null,
            isImage: data.isImage || false,
            isSystem: data.isSystem || false,
            timestamp: new Date().toISOString(),
            isAdmin: data.isAdmin || false
        };

        io.emit('chat message', message);
        const messages = JSON.parse(fs.readFileSync('./messages.json', 'utf8'));
        messages.messages.push(message);
        fs.writeFileSync('./messages.json', JSON.stringify(messages, null, 4));
    });

    socket.on('disconnect', () => {
        console.log('user disconnected');
        users.delete(socket.username);
        io.emit('update users', Array.from(users));
    });
    socket.on('user joined', (username) => {
        setTimeout(() => {
            socket.username = username;
            console.log(username);
            users.add(username);
            io.emit('update users', Array.from(users));
            io.emit('chat message', { message: `${username} has joined the chat`, username: 'System' });
        }, 500)
    });

});


app.get('/api/v1/messages', (req, res) => {
    const messages = JSON.parse(fs.readFileSync('./messages.json', 'utf8'));
    res.json(messages.messages.slice(-100));
});

app.get('/api/v1/users', (req, res) => {
    const userdata = JSON.parse(fs.readFileSync('./userdata.json', 'utf8'));
    res.json(userdata.accounts);
});

app.post('/api/v1/invite', (req, res) => {
    const { amount } = req.body;
    // create a new Small UUIDv4 key do it amount times
    const keys = [];
    for (let i = 0; i < amount; i++) {
        keys.push(crypto.randomUUID().substring(0, 10));
    }
    const keysJson = JSON.parse(fs.readFileSync('./keys.json', 'utf8'));
    keysJson.keys.push(...keys);
    fs.writeFileSync('./keys.json', JSON.stringify(keysJson, null, 2));
    const message = keys.map(key => `${key}`).join('\n');
    res.json({ success: true, message: message });
});


app.post('/api/v1/register', (req, res) => {
    const { username, password, inviteKey } = req.body;
    const keys = JSON.parse(fs.readFileSync('./keys.json', 'utf8'));
    const key = keys.keys.find(k => k === inviteKey);
    if (key) {
        keys.keys.splice(keys.keys.indexOf(key), 1);
        fs.writeFileSync('./keys.json', JSON.stringify(keys, null, 2));
        const userdata = JSON.parse(fs.readFileSync('./userdata.json', 'utf8'));
        userdata.accounts.push({ username, password, profilePicture: 'http://172.20.10.8:3000/userdata/leaf-19::09::2024::10::55.jpg', nickname: username, isAdmin: false });
        fs.writeFileSync('./userdata.json', JSON.stringify(userdata, null, 2));
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid invite key' });
    }
});

app.post('/api/v1/users/update', (req, res) => {
    const { nickname, profilePicture, username } = req.body;
    const userdata = JSON.parse(fs.readFileSync('./userdata.json', 'utf8'));
    const user = userdata.accounts.find(u => u.username === username);
    if (user) {
        Object.assign(user, { nickname, profilePicture });
        fs.writeFileSync('./userdata.json', JSON.stringify(userdata, null, 2));
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: 'User not found' });
    }
});

app.get('/api/v1/users/session', (req, res) => res.json({ username: req.session.username || null }));

app.post('/api/v1/login', (req, res) => {
    const { username, password } = req.body;
    const userdata = JSON.parse(fs.readFileSync('./userdata.json', 'utf8'));
    const user = userdata.accounts.find(u => u.username === username && u.password === password);
    if (user) {
        req.session.username = username;
        res.json({ success: true, user });
    } else {
        res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
});

app.get('/api/v1/userdata/user/:username', (req, res) => {
    const userdata = JSON.parse(fs.readFileSync('./userdata.json', 'utf8'));
    const user = userdata.accounts.find(u => u.username === req.params.username);
    if (user) {
        res.json({ success: true, user });
    } else {
        res.status(404).json({ success: false, message: 'User not found' });
    }
});

http.listen(process.env.PORT || 3000, () => console.log(`Server running on port ${process.env.PORT || 3000}`));
