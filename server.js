const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Отдача статики из корня проекта
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const ADMIN_PASSWORD = 'admin';
const USERS_FILE = path.join(__dirname, 'users.json');

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Ошибка чтения users.json:', err);
  }
  return {};
}

function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (err) {
    console.error('Ошибка сохранения users.json:', err);
  }
}

const users = loadUsers(); 
const activeBattles = {};
const onlineUsers = {};

function getRank(rpr) {
  if (rpr <= 99) return 'BRONZE';
  if (rpr <= 149) return 'SILVER';
  if (rpr <= 349) return 'GOLD';
  if (rpr <= 599) return 'PLATINUM';
  if (rpr <= 799) return 'DIAMOND';
  if (rpr <= 999) return 'MASTER';
  return 'CHALLENGER';
}

function calculateCustomRpr(winnerRpr, loserRpr, winnerVotes, loserVotes) {
  const totalVotes = winnerVotes + loserVotes;
  const margin = totalVotes > 0 ? (winnerVotes - loserVotes) / totalVotes : 1;
  
  // Победитель: +10 до +20
  const winGain = Math.round(10 + (10 * margin));

  // Проигравший: штраф зависит от текущего RPR
  const baseLoss = Math.round(10 + (10 * margin));
  const rankMultiplier = 1 + (loserRpr / 1000);
  const lossPenalty = Math.round(baseLoss * rankMultiplier);

  return { winGain, lossPenalty };
}

let waitingRappers = [];
let waitingJudges = [];

function broadcastOnlineCount() {
  const count = io.engine.clientsCount;
  io.to('admins').emit('online_count_update', { count });
}

io.on('connection', (socket) => {
  broadcastOnlineCount();

  socket.on('enable_admin', (pass) => {
    if (pass === ADMIN_PASSWORD) {
      socket.join('admins');
      socket.emit('admin_granted', { count: io.engine.clientsCount });
    } else {
      socket.emit('admin_denied', 'Неверный пароль админа!');
    }
  });

  socket.on('auth', (data) => {
    const { action, username, password } = data;
    const cleanName = username ? username.trim() : '';

    if (!cleanName || !password) {
      return socket.emit('auth_error', 'Заполни все поля!');
    }

    if (onlineUsers[cleanName]) {
      return socket.emit('auth_error', 'Этот аккаунт уже находится в сети!');
    }

    if (action === 'register') {
      if (users[cleanName]) {
        return socket.emit('auth_error', 'Этот никнейм уже занят!');
      }
      // Стартовый RPR = 50
      users[cleanName] = { password, rpr: 50 };
      saveUsers();

      socket.username = cleanName;
      onlineUsers[cleanName] = socket.id;

      socket.emit('auth_success', {
        username: cleanName,
        rpr: 50,
        rank: getRank(50)
      });
    } else if (action === 'login') {
      if (!users[cleanName] || users[cleanName].password !== password) {
        return socket.emit('auth_error', 'Неверный ник или пароль!');
      }

      socket.username = cleanName;
      onlineUsers[cleanName] = socket.id;

      socket.emit('auth_success', {
        username: cleanName,
        rpr: users[cleanName].rpr,
        rank: getRank(users[cleanName].rpr)
      });
    }
  });

  socket.on('find_match', () => {
    if (!socket.username) return;
    if (!waitingRappers.includes(socket)) {
      waitingRappers.push(socket);
    }
    checkAndStartBattle();
  });

  socket.on('join_as_judge', () => {
    if (!socket.username) return;
    if (!waitingJudges.includes(socket)) {
      waitingJudges.push(socket);
    }
    checkAndStartBattle();
  });

  socket.on('cancel_search', () => {
    waitingRappers = waitingRappers.filter(s => s.id !== socket.id);
    waitingJudges = waitingJudges.filter(s => s.id !== socket.id);
  });

  socket.on('vote', (target) => {
    const battleId = socket.battleId;
    if (!battleId || !activeBattles[battleId]) return;

    const battle = activeBattles[battleId];
    if (battle.phase === 'voting' && battle.judges.includes(socket.id)) {
      if (!battle.votes[socket.id]) {
        battle.votes[socket.id] = target;
        socket.emit('vote_registered');
      }
    }
  });

  socket.on('signal', (data) => {
    const battleId = socket.battleId;
    if (battleId && activeBattles[battleId]) {
      socket.to(battleId).emit('signal', data);
    }
  });

  socket.on('disconnect', () => {
    if (socket.username && onlineUsers[socket.username] === socket.id) {
      delete onlineUsers[socket.username];
    }

    waitingRappers = waitingRappers.filter(s => s.id !== socket.id);
    waitingJudges = waitingJudges.filter(s => s.id !== socket.id);

    const battleId = socket.battleId;
    if (battleId && activeBattles[battleId]) {
      const battle = activeBattles[battleId];
      
      if (socket.id === battle.p1.id || socket.id === battle.p2.id) {
        io.to(battleId).emit('battle_cancelled', { reason: 'Один из рэперов вышел из сети!' });
        clearInterval(battle.timer);
        delete activeBattles[battleId];
      } else {
        battle.judges = battle.judges.filter(id => id !== socket.id);
        io.to(battleId).emit('judges_count_update', { count: battle.judges.length });
      }
    }

    broadcastOnlineCount();
  });
});

function checkAndStartBattle() {
  // Требуется строго >= 2 рэперов И >= 1 судьи
  if (waitingRappers.length >= 2 && waitingJudges.length >= 1) {
    const p1 = waitingRappers.shift();
    const p2 = waitingRappers.shift();
    const judges = [...waitingJudges];
    waitingJudges = [];

    const battleId = `battle_${Date.now()}`;
    
    p1.join(battleId);
    p2.join(battleId);
    judges.forEach(j => j.join(battleId));

    p1.battleId = battleId;
    p2.battleId = battleId;
    judges.forEach(j => j.battleId = battleId);

    const battleData = {
      id: battleId,
      p1,
      p2,
      judges: judges.map(j => j.id),
      votes: {},
      currentRound: 1,
      phase: 'round1_p1',
      timer: null
    };

    activeBattles[battleId] = battleData;

    io.to(battleId).emit('match_found', {
      battleId,
      p1: p1.username,
      p2: p2.username,
      p1Id: p1.id,
      p2Id: p2.id,
      judgesCount: judges.length
    });

    startRoundSequence(battleData);
  }
}

function startRoundSequence(battle) {
  let timeLeft = 30;
  
  io.to(battle.id).emit('round_start', {
    round: battle.currentRound,
    activeSpeaker: battle.p1.username
  });

  battle.timer = setInterval(() => {
    timeLeft--;
    io.to(battle.id).emit('timer_tick', { timeLeft });

    if (timeLeft <= 0) {
      clearInterval(battle.timer);
      
      if (battle.phase === 'round1_p1') {
        battle.phase = 'round1_p2';
        switchTurn(battle, battle.p2.username);
      } else if (battle.phase === 'round1_p2') {
        battle.currentRound = 2;
        battle.phase = 'round2_p1';
        switchTurn(battle, battle.p1.username);
      } else if (battle.phase === 'round2_p1') {
        battle.phase = 'round2_p2';
        switchTurn(battle, battle.p2.username);
      } else if (battle.phase === 'round2_p2') {
        startVotingPhase(battle);
      }
    }
  }, 1000);
}

function switchTurn(battle, activeSpeaker) {
  let timeLeft = 30;
  io.to(battle.id).emit('round_start', {
    round: battle.currentRound,
    activeSpeaker
  });

  battle.timer = setInterval(() => {
    timeLeft--;
    io.to(battle.id).emit('timer_tick', { timeLeft });

    if (timeLeft <= 0) {
      clearInterval(battle.timer);
      if (battle.phase === 'round1_p2') {
        battle.currentRound = 2;
        battle.phase = 'round2_p1';
        switchTurn(battle, battle.p1.username);
      } else if (battle.phase === 'round2_p1') {
        battle.phase = 'round2_p2';
        switchTurn(battle, battle.p2.username);
      } else if (battle.phase === 'round2_p2') {
        startVotingPhase(battle);
      }
    }
  }, 1000);
}

function startVotingPhase(battle) {
  battle.phase = 'voting';
  io.to(battle.id).emit('battle_end');

  let votingTimeLeft = 15;
  
  battle.timer = setInterval(() => {
    votingTimeLeft--;
    io.to(battle.id).emit('voting_timer_tick', { votingTimeLeft });

    if (votingTimeLeft <= 0) {
      clearInterval(battle.timer);
      finishBattle(battle);
    }
  }, 1000);
}

function finishBattle(battle) {
  let p1Votes = 0;
  let p2Votes = 0;

  Object.values(battle.votes).forEach(vote => {
    if (vote === 'p1') p1Votes++;
    if (vote === 'p2') p2Votes++;
  });

  const p1User = users[battle.p1.username];
  const p2User = users[battle.p2.username];

  let p1Change = 0;
  let p2Change = 0;
  let winner = null;
  let isDraw = false;

  if (p1Votes > p2Votes) {
    winner = battle.p1.username;
    const { winGain, lossPenalty } = calculateCustomRpr(p1User.rpr, p2User.rpr, p1Votes, p2Votes);
    p1Change = winGain;
    p2Change = -lossPenalty;
  } else if (p2Votes > p1Votes) {
    winner = battle.p2.username;
    const { winGain, lossPenalty } = calculateCustomRpr(p2User.rpr, p1User.rpr, p2Votes, p1Votes);
    p2Change = winGain;
    p1Change = -lossPenalty;
  } else {
    isDraw = true;
    p1Change = 0;
    p2Change = 0;
  }

  p1User.rpr = Math.max(0, p1User.rpr + p1Change);
  p2User.rpr = Math.max(0, p2User.rpr + p2Change);

  saveUsers();

  battle.p1.emit('voting_ended', {
    isWinner: winner === battle.p1.username,
    isDraw,
    winnerName: winner,
    myChange: p1Change,
    newRpr: p1User.rpr,
    newRank: getRank(p1User.rpr),
    votes: { p1: p1Votes, p2: p2Votes }
  });

  battle.p2.emit('voting_ended', {
    isWinner: winner === battle.p2.username,
    isDraw,
    winnerName: winner,
    myChange: p2Change,
    newRpr: p2User.rpr,
    newRank: getRank(p2User.rpr),
    votes: { p1: p1Votes, p2: p2Votes }
  });

  battle.judges.forEach(judgeId => {
    io.to(judgeId).emit('voting_ended', {
      isJudge: true,
      isDraw,
      winnerName: winner,
      votes: { p1: p1Votes, p2: p2Votes }
    });
  });

  delete activeBattles[battle.id];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));