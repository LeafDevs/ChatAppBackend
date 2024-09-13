const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      allowedHeaders: ["my-custom-header"],
      credentials: true
    }
  });
const session = require('express-session');
const FileStore = require('session-file-store')(session)
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Session middleware setup
const sessionMiddleware = session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
    store: new FileStore({
        path: './sessions',
        ttl: 86400, // 1 day
        reapInterval: 3600 // 1 hour
    }),
});

app.use(sessionMiddleware);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static('html'));

const users = new Set();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, './userdata/')
    },
    filename: function (req, file, cb) {
        const username = req.session.username;
        const date = new Date();
        const formattedDate = `${date.getDate().toString().padStart(2, '0')}::${(date.getMonth() + 1).toString().padStart(2, '0')}::${date.getFullYear()}::${date.getHours().toString().padStart(2, '0')}::${date.getMinutes().toString().padStart(2, '0')}`;
        const fileExtension = path.extname(file.originalname);
        cb(null, `${username}-${formattedDate}${fileExtension}`);
    }
});

const upload = multer({ storage: storage });

// File upload endpoint
app.post('/api/v1/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const fileUrl = `http://172.20.10.8:3000/userdata/${req.file.filename}`;
    res.json({ success: true, fileUrl: fileUrl });
});

// Serve static files from the userdata folder
app.use('/userdata', express.static('userdata'));

// Wrap the socket.io middleware
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('user joined', (username) => {
        socket.username = username;
        users.add(username);
        io.emit('update users', Array.from(users));
        io.emit('chat message', { message: `${username} has joined the chat`, username: 'System' });
    });

    socket.on('chat message', (data) => {
        io.emit('chat message', data);
        const messages = JSON.parse(fs.readFileSync('./messages.json', 'utf8'));
        messages.messages.push(data);
        fs.writeFileSync('./messages.json', JSON.stringify(messages, null, 4));
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
        if (socket.username) {
            users.delete(socket.username);
            io.emit('update users', Array.from(users));
        }
    });
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/html/file.html');
    // console.log(req.session)
    // if(req.session.username) {
    //     res.sendFile(__dirname + '/html/file.html');
    // } else {
    //     res.redirect('/login');
    // }
});

app.get('/api/v1/messages', (req, res) => {
    const messages = JSON.parse(fs.readFileSync('./messages.json', 'utf8'));
    const last100Messages = messages.messages.slice(-100);
    res.json(last100Messages);
});

app.post('/api/v1/users/update', (req, res) => {
    const { nickname, profilePicture, username } = req.body;
    const userdata = JSON.parse(fs.readFileSync('./userdata.json', 'utf8'));
    const user = userdata.accounts.find(u => u.username === username);
    if (user) {
        user.nickname = nickname;
        user.profilePicture = profilePicture;
        fs.writeFileSync('./userdata.json', JSON.stringify(userdata, null, 2));
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: 'User not found' });
    }
});

app.get('/api/v1/users/session', (req, res) => {
    res.json({ username: req.session.username || null });
});

app.post('/api/v1/login', (req, res) => {
    const { username, password } = req.body;
    const userdata = JSON.parse(fs.readFileSync('./userdata.json', 'utf8'));
    const user = userdata.accounts.find(u => u.username === username);
    if (user && user.password === password) {
        req.session.username = username;
        res.json({ success: true, user: user });
    } else {
        res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
});

app.get('/api/v1/userdata/user/:username', (req, res) => {
    const username = req.params.username;
    const userdata = JSON.parse(fs.readFileSync('./userdata.json', 'utf8'));
    const user = userdata.accounts.find(u => u.username === username);
    if (user) {
        res.json({ success: true, user: user });
    } else {
        res.status(404).json({ success: false, message: 'User not found' });
    }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
