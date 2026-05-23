const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'dist')));

// ✨ 새로 추가할 마법의 내비게이션 (길 잃은 유저 멱살 잡기!)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const server = http.createServer(app);

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
    // ✨ 1번 해결: GM이 설정한 공용 효과음 사운드룸 개설
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
      // 방 입장 시 효과음 데이터도 동기화해서 넘겨줌
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

  // ✨ 1번 해결: GM이 업로드한 3대 지정 효과음을 서버 방 데이터에 저장하고 동기화
  socket.on('gm_update_sounds', ({ roomId, type, audioData }) => {
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      room.gmSounds[type] = audioData;
      io.to(roomId).emit('update_room_data', { players: room.players, gmId: room.gmId, gmSounds: room.gmSounds });
    }
  });

  // ✨ 1번 해결: GM 효과음 강제 공역 방송 재생 장치
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
      
      // 플롯 공개 시 GM 지정 공개음이 있다면 전원에 강제 방송 처리
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
      // 오의나 깨기 발동 시 GM이 지정한 공용 효과음 소스를 함께 실어 보냅니다.
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

  // ✨ 2번 해결: NPC 오의 공개 상태 저장용 통로 확장
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

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => { console.log(`🚀 시노비가미 서버 ${PORT}번 가동 중!`); });