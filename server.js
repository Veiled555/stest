const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket']
});

const rooms = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // 部屋への参加
    socket.on('joinRoom', (roomCode, callback) => {
        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            rooms[roomCode] = { host: socket.id, guests: [] };
            callback({ playerId: 1, isHost: true });
        } else {
            rooms[roomCode].guests.push(socket.id);
            callback({ playerId: 2, isHost: false });
            // 2人揃ったら同期プロセスを開始
            io.to(roomCode).emit('startSyncProcess');
        }
    });

    // 地形と初期配置の同期（ホストからゲストへ）
    socket.on('syncTerrain', (data) => {
        io.to(data.roomCode).emit('receiveTerrain', data);
    });

    // ユニット選択の同期
    socket.on('selectUnit', (data) => {
        socket.to(data.roomCode).emit('receiveActiveUnit', data.unitIndex);
    });

    // 【重要】数式と発射の同期（部屋の全員へ io.to で一斉配信）
    socket.on('sendFormula', (data) => {
        io.to(data.roomCode).emit('receiveFormula', data);
    });

    // 【重要】ターン変更の同期（部屋の全員へ io.to で一斉配信）
    socket.on('changeTurn', (data) => {
        io.to(data.roomCode).emit('receiveTurnChange', data);
    });

    // リマッチ請求
    socket.on('requestRematch', (data) => {
        socket.to(data.roomCode).emit('startSyncProcess');
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
