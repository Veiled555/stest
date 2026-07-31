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

    // --- コマンドシステム用の Socket イベント ---
    socket.on('sendCommand', (data) => {
        // 部屋の相手にコマンド要求をそのまま転送
        socket.to(data.roomCode).emit('receiveCommand', data);
    });

    socket.on('cancelCommand', (data) => {
        // コマンド拒否（通常発射）があったことを相手に通知
        socket.to(data.roomCode).emit('commandCancelled', data);
    });

// server.js の requestRematch イベント部分
socket.on('requestRematch', (data) => {
    const room = rooms[data.roomCode];
    if (!room) return;

    if (!room.rematchRequests) {
        room.rematchRequests = {};
    }

    room.rematchRequests[data.myPlayerId] = true;
    
    // 相手に「再戦を待っている」旨を通知
    socket.to(data.roomCode).emit('opponentWantsRematch');

    // ★ 2人とも再戦ボタンを押した場合のみゲームを再開
    if (room.rematchRequests[1] && room.rematchRequests[2]) {
        room.rematchRequests = {}; // リセット
        
        // 両者へ同期開始（ゲームリセット）イベントを送信
        io.to(data.roomCode).emit('startSyncProcess');
    }
});

// 部屋退室時や切断時に再戦リクエストの状態もクリアする処理を追加
socket.on('leaveRoom', ({ roomCode }) => {
    socket.leave(roomCode);
    
    const room = rooms[roomCode];
    if (room) {
        room.players = room.players.filter(id => id !== socket.id);
        if (room.rematchRequests) room.rematchRequests = {}; // リセット

        if (room.hostId === socket.id) {
            if (room.players.length > 0) {
                room.hostId = room.players[0];
            } else {
                delete rooms[roomCode];
                return;
            }
        }

        if (room.players.length === 0) {
            delete rooms[roomCode];
        } else {
            socket.to(roomCode).emit('playerLeft');
        }
    }
});
    //
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
