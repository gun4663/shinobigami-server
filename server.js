const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'dist')));

// ✨ 길 잃은 유저 멱살 잡기 (새로고침 에러 방지!)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// 🚨 딱 한 번만 있어야 하는 서버 선언!
const server = http.createServer(app);

const io = new Server(server, { 
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 5e7 // 50MB 용량 유지
});

let rooms = [];

io.on('connection', (socket) => {
  console.log('🥷 닌자 접속! (ID:', socket.id, ')');
  socket.emit('update_room_list', rooms);

  socket.on('create_room', (newRoom) => {
    newRoom.players = [];
    newRoom.gmId = socket.id;
    newRoom.gmSounds = { ougi: null, break: null, reveal: null }; 
    rooms.push(newRoom);
    io.emit('update_room_list', rooms);
  });

  socket.on('join_room', ({ roomId, playerInfo }) => {
    socket.join(roomId);
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      room.players = room.players.filter(p => p.socketId !== socket.id);
      room.players.push({ ...playerInfo, socketId: socket.id, isNpc: false });
      io.to(roomId).emit('update_room_data', { players: room.players, gmId: room.gmId, gmSounds: room.gmSounds });
    }
  });

  socket.on('leave_room', (roomId) => {
    socket.leave(roomId);
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      room.players = room.players.filter(p => p.socketId !== socket.id);
      io.to(roomId).emit('update_room_data', { players: room.players, gmId: room.gmId, gmSounds: room.gmSounds });
    }
    rooms = rooms.filter(r => r.players.filter(p => !p.isNpc).length > 0);
    io.emit('update_room_list', rooms);
  });

  socket.on('update_state', ({ roomId, playerInfo }) => {
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      const pIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (pIndex !== -1) {
        room.players[pIndex] = { ...playerInfo, socketId: socket.id, isNpc: false };
        io.to(roomId).emit('update_room_data', { players: room.players, gmId: room.gmId, gmSounds: room.gmSounds });
      }
    }
  });

  socket.on('gm_update_sounds', ({ roomId, type, audioData }) => {
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      room.gmSounds[type] = audioData;
      io.to(roomId).emit('update_room_data', { players: room.players, gmId: room.gmId, gmSounds: room.gmSounds });
    }
  });

  socket.on('gm_play_global_sound', ({ roomId, type, soundName }) => {
    const room = rooms.find(r => r.id === roomId);
    if (room && room.gmSounds[type]) {
      io.to(roomId).emit('global_receive_sound', { type, audioData: room.gmSounds[type], soundName });
    }
  });

  socket.on('gm_reveal_plots', ({ roomId, nickname }) => {
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      room.players = room.players.map(p => {
        if (['0','1','2','3','4','5','6','7'].includes(p.plot) && p.isHidden) {
          return { ...p, isHidden: false, isRevealed: true }; 
        }
        return p;
      });
      io.to(roomId).emit('update_room_data', { players: room.players, gmId: room.gmId, gmSounds: room.gmSounds });
      io.to(roomId).emit('global_plot_revealed', { gmNickname: nickname, audioData: room.gmSounds.reveal }); 
    }
  });

  socket.on('trigger_cutin', ({ roomId, type, nickname, tokenImg, ougiName, ougiEffect }) => {
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      if (type === 'ougi') {
        const pIndex = room.players.findIndex(p => p.socketId === socket.id);
        if (pIndex !== -1) {
          room.players[pIndex].ougiRevealed = true;
          io.to(roomId).emit('update_room_data', { players: room.players, gmId: room.gmId, gmSounds: room.gmSounds });
        }
      }
      const sharedAudio = type === 'ougi' ? room.gmSounds.ougi : room.gmSounds.break;
      io.to(roomId).emit('global_cutin', { type, nickname, tokenImg, ougiName, ougiEffect, sharedAudio });
    }
  });

  socket.on('send_chat', ({ roomId, log }) => {
    socket.broadcast.to(roomId).emit('receive_chat', log);
  });

  socket.on('gm_broadcast_audio', ({ roomId, audioData, audioName }) => {
    io.to(roomId).emit('global_play_audio', { audioData, audioName });
  });

  socket.on('gm_add_npc', ({ roomId, npcInfo }) => {
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      room.players.push(npcInfo);
      io.to(roomId).emit('update_room_data', { players: room.players, gmId: room.gmId, gmSounds: room.gmSounds });
    }
  });

  socket.on('gm_reveal_npc_ougi', ({ roomId, npcId }) => {
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      const npc = room.players.find(p => p.socketId === npcId);
      if (npc) {
        npc.ougiRevealed = true;
        io.to(roomId).emit('update_room_data', { players: room.players, gmId: room.gmId, gmSounds: room.gmSounds });
      }
    }
  });

  socket.on('gm_move_npc', ({ roomId, npcId, targetPlot }) => {
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      const npc = room.players.find(p => p.socketId === npcId);
      if (npc) {
        npc.plot = targetPlot;
        npc.isHidden = ['0','1','2','3','4','5','6','7'].includes(targetPlot);
        io.to(roomId).emit('update_room_data', { players: room.players, gmId: room.gmId, gmSounds: room.gmSounds });
      }
    }
  });

  socket.on('gm_delete_npc', ({ roomId, npcId }) => {
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      room.players = room.players.filter(p => p.socketId !== npcId);
      io.to(roomId).emit('update_room_data', { players: room.players, gmId: room.gmId, gmSounds: room.gmSounds });
    }
  });

  socket.on('disconnect', () => {
    console.log('💨 닌자 퇴장... (ID:', socket.id, ')');
    rooms.forEach(room => {
      room.players = room.players.filter(p => p.socketId !== socket.id);
      io.to(room.id).emit('update_room_data', { players: room.players, gmId: room.gmId, gmSounds: room.gmSounds });
    });
    rooms = rooms.filter(r => r.players.filter(p => !p.isNpc).length > 0);
    io.emit('update_room_list', rooms);
  });
});

// ✨ 클라우드용 방 번호 할당
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => { console.log(`🚀 시노비가미 서버 ${PORT}번 가동 중!`); });