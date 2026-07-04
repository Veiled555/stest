const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const rooms = {};

io.on('connection', (socket) => {

    socket.on('joinRoom', (roomCode) => {
        socket.join(roomCode);

        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                hostId: socket.id,
                players: [socket.id]
            };
            socket.emit('roomJoined', { playerId: 1, isHost: true });
        } else {
            const room = rooms[roomCode];
            if (room.players.length < 2) {
                room.players.push(socket.id);
                socket.emit('roomJoined', { playerId: 2, isHost: false });
                
                io.to(room.hostId).emit('requestTerrainSync');
            } else {
                socket.emit('roomFull');
            }
        }
    });

    socket.on('syncTerrain', (data) => {
        const room = rooms[data.roomCode];
        if (room) {
            socket.to(data.roomCode).emit('receiveTerrain', {
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

