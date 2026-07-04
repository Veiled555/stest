const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors({ origin: "*" }));

app.get('/', (req, res) => {
    res.send('Server is running perfectly!');
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling'] 
});

const rooms = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    // server.js 内の適切な場所（他の socket.on の並び）へ追加してください
socket.on('syncAngle', (data) => {
    socket.to(data.roomCode).emit('receiveAngleSync', data);
});

    socket.on('joinRoom', (roomCode, callback) => {
        socket.join(roomCode);

        // 既に存在する部屋で、前のプレイヤーが残っている古い残骸があればクリーンアップ
        if (rooms[roomCode] && rooms[roomCode].players.length >= 2) {
             // テストをスムーズにするため満杯なら一旦消して作り直す
             delete rooms[roomCode]; 
        }

        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                hostId: socket.id,
                players: [socket.id],
                rematchRequests: {} // 再戦希望を記録する箱
            };
            socket.emit('roomJoined', { playerId: 1, isHost: true });
        } else {
            const room = rooms[roomCode];
            if (room.players.length < 2) {
                room.players.push(socket.id);
                socket.emit('roomJoined', { playerId: 2, isHost: false });
                io.to(roomCode).emit('startSyncProcess');
            }
        }
        if (typeof callback === 'function') callback({ status: 'ok' });
    });

    socket.on('syncTerrain', (data) => {
        io.to(data.roomCode).emit('receiveTerrain', {
            terrain: data.terrain,
            players: data.players
        });
    });

    socket.on('sendFormula', (data) => {
        socket.to(data.roomCode).emit('receiveFormula', data.formula);
    });

    // 💡 改善③：再戦リクエストの処理
    socket.on('requestRematch', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return;

        room.rematchRequests[data.myPlayerId] = true;
        
        // 相手に「再戦したがってるよ」と通知
        socket.to(data.roomCode).emit('opponentWantsRematch');

        // 💡 2人とも再戦ボタンを押した場合
        if (room.rematchRequests[1] && room.rematchRequests[2]) {
            room.rematchRequests = {}; // リセット
            
            // ホスト(PLAYER 1)側の画面に「新ゲームを組んで送って！」と再び合図
            io.to(room.hostId).emit('roomJoined', { playerId: 1, isHost: true });
        }
    });

    // 💡 改善①：だれかが切断したときの処理
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const index = room.players.indexOf(socket.id);
            if (index !== -1) {
                // 部屋にいるもう片方のプレイヤーに切断を知らせる
                socket.to(roomCode).emit('opponentDisconnected');
                
                room.players.splice(index, 1);
                if (room.players.length === 0) {
                    delete rooms[roomCode];
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
