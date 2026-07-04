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

// 部屋の状態を管理するオブジェクト
const rooms = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // 部屋に参加する
    socket.on('joinRoom', (roomCode, callback) => {
        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            rooms[roomCode] = { host: socket.id, guests: [] };
            if (typeof callback === 'function') callback({ playerId: 1, isHost: true });
        } else {
            rooms[roomCode].guests.push(socket.id);
            if (typeof callback === 'function') callback({ playerId: 2, isHost: false });
            
            // 2人揃ったら、その部屋の全員に同期開始の合図を送る
            io.to(roomCode).emit('startSyncProcess');
        }
    });

    // ホストから送られた初期地形・プレイヤー配置を部屋の全員（ホスト・ゲスト両方）に一斉送信
    socket.on('syncTerrain', (data) => {
        io.to(data.roomCode).emit('receiveTerrain', data);
    });

    // ユニット選択のリアルタイム同期（自分以外に送信）
    socket.on('selectUnit', (data) => {
        socket.to(data.roomCode).emit('receiveActiveUnit', data.unitIndex);
    });

    // 【重要】撃った数式データを、その部屋の全員（自分も含めて）に一斉送信
    socket.on('sendFormula', (data) => {
        io.to(data.roomCode).emit('receiveFormula', data);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

// Renderのポート対応
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
