const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*" } // どこからのアクセスも許可する設定
});

io.on('connection', (socket) => {
  console.log('プレイヤーが接続しました：', socket.id);

  socket.on('joinRoom', (roomCode) => {
    socket.join(roomCode);
    console.log(`部屋 [${roomCode}] に入室しました`);
  });

  socket.on('sendFormula', (data) => {
    socket.to(data.roomCode).emit('receiveFormula', data.formula);
  });
});

// Render.comなどの環境に合わせたポート番号で起動する設定
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log('Server is running on port ' + PORT);
});
