const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// ルートアクセス時に生存確認ができるようにする
app.get('/', (req, res) => {
    res.send('Server is running perfectly!');
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const rooms = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('joinRoom', (roomCode) => {
        socket.join(roomCode);

        if (!rooms[roomCode]) {
            // 1人目（ホスト）の入場
            rooms[roomCode] = {
                hostId: socket.id,
                players: [socket.id],
                terrain: null,
                gamePlayersData: null
            };
            socket.emit('roomJoined', { playerId: 1, isHost: true });
        } else {
            // 2人目（ゲスト）の入場
            const room = rooms[roomCode];
            if (room.players.length < 2) {
                room.players.push(socket.id);
                socket.emit('roomJoined', { playerId: 2, isHost: false });
                
                // 2人目が揃ったことを全員に通知（これでホスト側に地形送信を促す）
                io.to(roomCode).emit('startSyncProcess');
            } else {
                socket.emit('roomFull');
            }
        }
    });

    // ホストから送られてきた地形データを部屋全員に送る
    socket.on('syncTerrain', (data) => {
        const room = rooms[data.roomCode];
        if (room) {
            io.to(data.roomCode).emit('receiveTerrain', {
                terrain: data.terrain,
                players: data.players
            });
        }
    });

    socket.on('sendFormula', (data) => {
        socket.to(data.roomCode).emit('receiveFormula', data.formula);
    });

    socket.on('disconnect', () => {
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

