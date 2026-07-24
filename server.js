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

    // server.js
socket.on('joinRoom', (roomCode, callback) => {
    socket.join(roomCode);

    // 部屋がまだ存在しない場合は作成（1人目）
    if (!rooms[roomCode]) {
        rooms[roomCode] = {
            hostId: socket.id,
            players: [socket.id],
            rematchRequests: {}
        };
        socket.emit('roomJoined', { playerId: 1, isHost: true });
    } 
    // 既に部屋が存在し、1人だけ待っている場合（2人目）
    else if (rooms[roomCode].players.length === 1) {
        rooms[roomCode].players.push(socket.id);
        socket.emit('roomJoined', { playerId: 2, isHost: false, isReady: true });
        
        // 2人揃ったので部屋全体に同期開始（ゲーム開始）の合図を送る
        io.to(roomCode).emit('startSyncProcess');
    } 
    // すでに2人満員の場合
    else {
        socket.emit('roomError', 'この部屋はすでに満員です。');
        socket.leave(roomCode);
    }

    if (typeof callback === 'function') callback({ status: 'ok' });
});


    socket.on('syncTerrain', (data) => {
        io.to(data.roomCode).emit('receiveTerrain', {
            terrain: data.terrain,
            players: data.players,
            startingPlayerIndex: data.startingPlayerIndex
        });
    });

    socket.on('sendFormula', (data) => {
        socket.to(data.roomCode).emit('receiveFormula', data);
    });

    // server.js 内の requestRematch 部分
socket.on('requestRematch', (data) => {
    const room = rooms[data.roomCode];
    if (!room) return;

    room.rematchRequests[data.myPlayerId] = true;
    
    // 相手に「再戦したがってるよ」と通知
    socket.to(data.roomCode).emit('opponentWantsRematch');

    // 💡 2人とも再戦ボタンを押した場合
    if (room.rematchRequests[1] && room.rematchRequests[2]) {
        room.rematchRequests = {}; // リセット
        
        // 初回と同じ startSyncProcess を送ることで、ホストがランダムな先攻を含めてステージを再生成・同期する
        io.to(data.roomCode).emit('startSyncProcess');[span_8](start_span)[span_8](end_span)
    }
});


socket.on('leaveRoom', ({ roomCode }) => {
    socket.leave(roomCode);
    
    const room = rooms[roomCode];
    if (room) {
        // 1. 部屋の players 配列から退室したユーザーの ID を確実に除去
        room.players = room.players.filter(id => id !== socket.id);
        
        // 2. もし退室したのがホスト（1人目）だった場合、ホストIDを更新するか部屋をリセットする
        if (room.hostId === socket.id) {
            if (room.players.length > 0) {
                // まだ誰か残っていればその人を新しいホストにする
                room.hostId = room.players[0];
            } else {
                // 誰もいなくなったら部屋データを完全に削除！
                delete rooms[roomCode];
                console.log(`🧹 部屋「${roomCode}」は空になったため削除されました。`);
                return;
            }
        }

        // 3. 誰もいなくなった場合の安全策（念のため）
        if (room.players.length === 0) {
            delete rooms[roomCode];
            console.log(`🧹 部屋「${roomCode}」は空になったため削除されました。`);
        } else {
            // 残ったプレイヤーに相手が退出したことを通知
            socket.to(roomCode).emit('playerLeft');
        }
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
