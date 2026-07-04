const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors({ origin: "*" })); // すべてのアクセスを完全に許可

app.get('/', (req, res) => {
    res.send('Server is running perfectly!');
});

const server = http.createServer(app);

// 💡 どんな接続方法（WebSocket）でも絶対に弾かない設定
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["my-custom-header"],
        credentials: true
    },
    transports: ['websocket', 'polling'] 
});

const rooms = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    
socket.on('joinRoom', (roomCode, callback) => {
    console.log(`User ${socket.id} is trying to join room: ${roomCode}`);
    socket.join(roomCode);

    if (!rooms[roomCode]) {
        rooms[roomCode] = {
            hostId: socket.id,
            players: [socket.id],
            terrain: null,
            gamePlayersData: null
        };
        console.log(`Room ${roomCode} created by host ${socket.id}`);
        socket.emit('roomJoined', { playerId: 1, isHost: true });
    } else {
        const room = rooms[roomCode];
        if (room.players.length < 2) {
            room.players.push(socket.id);
            console.log(`User ${socket.id} joined room ${roomCode} as guest`);
            socket.emit('roomJoined', { playerId: 2, isHost: false });
            io.to(roomCode).emit('startSyncProcess');
        } else {
            socket.emit('roomFull');
            // 満員エラーの場合も返事をする
            if (typeof callback === 'function') callback({ status: 'error', message: 'Room is full' });
            return;
        }
    }

    // 💡 無事に処理が終わったら、フロントに「届いたよ！」とOKの返事を出す
    if (typeof callback === 'function') {
        callback({ status: 'ok' });
    }
});


    socket.on('syncTerrain', (data) => {
        console.log(`Received terrain sync for room ${data.roomCode}`);
        io.to(data.roomCode).emit('receiveTerrain', {
            terrain: data.terrain,
            players: data.players
        });
    });

    socket.on('sendFormula', (data) => {
        socket.to(data.roomCode).emit('receiveFormula', data.formula);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const index = room.players.indexOf(socket.id);
            if (index !== -1) {
                room.players.splice(index, 1);
                if (room.players.length === 0) {
                    delete rooms[roomCode];
                } else if (room.hostId === socket.id) {
                    room.hostId = room.players[0];
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});


