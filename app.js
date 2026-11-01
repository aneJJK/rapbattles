const socket = io();

let localStream;
let peerConnection;
let userRole = 'rapper';
let myUsername = '';
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Элементы
const barUsername = document.getElementById('bar-username');
const barStatus = document.getElementById('bar-status');
const logoutBtn = document.getElementById('logout-btn');

const mainCard = document.getElementById('main-card');
const searching = document.getElementById('searching');
const battle = document.getElementById('battle');
const voting = document.getElementById('voting');

const prepMicBtn = document.getElementById('prep-mic-btn');
const beJudgeBtn = document.getElementById('be-judge-btn');
const cancelSearchBtn = document.getElementById('cancel-search-btn');

const loginModal = document.getElementById('login-modal');
const registerModal = document.getElementById('register-modal');

const loginUsername = document.getElementById('login-username');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');

const regUsername = document.getElementById('reg-username');
const regPassword = document.getElementById('reg-password');
const regPasswordConfirm = document.getElementById('reg-password-confirm');
const regError = document.getElementById('reg-error');

const timerEl = document.getElementById('timer');
const turnStatus = document.getElementById('turn-status');
const roundTitle = document.getElementById('round-title');
const remoteAudio = document.getElementById('remote-audio');
const roleBadge = document.getElementById('role-badge');
const judgesCounter = document.getElementById('judges-counter');

const voteP1Btn = document.getElementById('vote-p1');
const voteP2Btn = document.getElementById('vote-p2');
const judgeControls = document.getElementById('judge-controls');
const wrapperMsg = document.getElementById('wrapper-msg');
const winnerContainer = document.getElementById('winner-container');
const winnerBox = document.getElementById('winner-box');
const winnerText = document.getElementById('winner-text');
const rprDetails = document.getElementById('rpr-details');
const backToMenuBtn = document.getElementById('back-to-menu-btn');

function closeModals() {
  loginModal?.classList.add('hidden');
  registerModal?.classList.add('hidden');
}

document.getElementById('go-to-reg-btn')?.addEventListener('click', (e) => {
  e.preventDefault();
  loginModal.classList.add('hidden');
  registerModal.classList.remove('hidden');
});

document.getElementById('go-to-login-btn')?.addEventListener('click', (e) => {
  e.preventDefault();
  registerModal.classList.add('hidden');
  loginModal.classList.remove('hidden');
});

prepMicBtn?.addEventListener('click', () => {
  if (!myUsername) {
    closeModals();
    loginModal.classList.remove('hidden');
  } else {
    startBattleSearch();
  }
});

beJudgeBtn?.addEventListener('click', () => {
  if (!myUsername) {
    closeModals();
    loginModal.classList.remove('hidden');
  } else {
    startJudgeSearch();
  }
});

cancelSearchBtn?.addEventListener('click', () => {
  socket.emit('cancel_search');
  searching.classList.add('hidden');
  mainCard.classList.remove('hidden');
});

document.getElementById('login-btn')?.addEventListener('click', () => {
  loginError.classList.add('hidden');
  socket.emit('auth', {
    action: 'login',
    username: loginUsername.value,
    password: loginPassword.value
  });
});

document.getElementById('register-btn')?.addEventListener('click', () => {
  regError.classList.add('hidden');

  if (regPassword.value !== regPasswordConfirm.value) {
    regError.innerText = 'Пароли не совпадают!';
    regError.classList.remove('hidden');
    return;
  }

  socket.emit('auth', {
    action: 'register',
    username: regUsername.value,
    password: regPassword.value
  });
});

socket.on('auth_error', (msg) => {
  if (!registerModal.classList.contains('hidden')) {
    regError.innerText = msg;
    regError.classList.remove('hidden');
  } else {
    loginError.innerText = msg;
    loginError.classList.remove('hidden');
  }
});

socket.on('auth_success', (data) => {
  myUsername = data.username;
  closeModals();
  
  barUsername.innerText = data.username;
  barStatus.innerText = `${data.rpr} RPR (${data.rank})`;
  barStatus.style.color = '#a7f3d0';
  logoutBtn.classList.remove('hidden');

  // Выбрасываем на главную
  mainCard.classList.remove('hidden');
  searching.classList.add('hidden');
  battle.classList.add('hidden');
  voting.classList.add('hidden');
});

function updateProfileBar(username, rpr, rank) {
  barUsername.innerText = username;
  barStatus.innerText = `${rpr} RPR (${rank})`;
}

logoutBtn?.addEventListener('click', () => location.reload());

async function startBattleSearch() {
  userRole = 'rapper';
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mainCard.classList.add('hidden');
    searching.classList.remove('hidden');
    document.getElementById('search-status').innerText = '⏳ Ищем соперника и судей...';
    socket.emit('find_match');
  } catch (err) {
    alert('Нужен доступ к микрофону для участия в батле!');
  }
}

function startJudgeSearch() {
  userRole = 'judge';
  mainCard.classList.add('hidden');
  searching.classList.remove('hidden');
  document.getElementById('search-status').innerText = '⏳ Ждём батла...';
  socket.emit('join_as_judge');
}

function initWebRTC() {
  if (peerConnection) return;
  peerConnection = new RTCPeerConnection(config);

  if (localStream) {
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  }

  peerConnection.ontrack = (event) => {
    remoteAudio.srcObject = event.streams[0];
    remoteAudio.play().catch(() => {});
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', { candidate: event.candidate });
    }
  };
}

function setMicState(activeSpeakerName) {
  if (!localStream) return;
  const isMyTurn = (myUsername === activeSpeakerName);
  localStream.getAudioTracks().forEach(track => { track.enabled = isMyTurn; });
}

socket.on('match_found', async (data) => {
  searching.classList.add('hidden');
  battle.classList.remove('hidden');

  roleBadge.innerText = userRole === 'judge' ? '⚖️ ВЫ — СУДЬЯ' : '🎤 ВЫ — РЭПЕР';
  judgesCounter.innerText = `👨‍⚖️ Судей в батле: ${data.judgesCount}`;
  
  document.getElementById('p1-name').innerText = data.p1;
  document.getElementById('p2-name').innerText = data.p2;

  voteP1Btn.innerText = `🎤 ${data.p1}`;
  voteP2Btn.innerText = `🎤 ${data.p2}`;

  initWebRTC();

  if (socket.id === data.p1Id) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('signal', { offer });
  }
});

socket.on('judges_count_update', (data) => {
  judgesCounter.innerText = `👨‍⚖️ Судей в батле: ${data.count}`;
});

socket.on('battle_cancelled', (data) => {
  alert(data.reason);
  location.reload();
});

socket.on('round_start', (data) => {
  roundTitle.innerText = `ROUND ${data.round}`;
  turnStatus.innerText = `Читает: ${data.activeSpeaker}`;
  setMicState(data.activeSpeaker);
});

socket.on('timer_tick', (data) => { timerEl.innerText = data.timeLeft; });

socket.on('battle_end', () => {
  battle.classList.add('hidden');
  voting.classList.remove('hidden');

  if (localStream) {
    localStream.getAudioTracks().forEach(t => t.enabled = false);
  }

  if (userRole === 'judge') {
    judgeControls.classList.remove('hidden');
    wrapperMsg.classList.add('hidden');
  } else {
    judgeControls.classList.add('hidden');
    wrapperMsg.classList.remove('hidden');
    wrapperMsg.innerText = 'Ждём вердикт...';
  }
});

socket.on('voting_timer_tick', (data) => {
  wrapperMsg.innerText = `До конца голосования: ${data.votingTimeLeft} сек.`;
});

voteP1Btn?.addEventListener('click', () => socket.emit('vote', 'p1'));
voteP2Btn?.addEventListener('click', () => socket.emit('vote', 'p2'));

socket.on('vote_registered', () => {
  judgeControls.classList.add('hidden');
  wrapperMsg.classList.remove('hidden');
  wrapperMsg.innerText = 'Твой голос принят!';
});

socket.on('voting_ended', (data) => {
  judgeControls.classList.add('hidden');
  wrapperMsg.classList.add('hidden');

  winnerBox.className = 'winner-box';

  if (data.isJudge) {
    winnerBox.classList.add('draw');
    winnerText.innerText = data.isDraw ? '🤝 НИЧЬЯ' : `🏆 ПОБЕДИТЕЛЬ: ${data.winnerName}`;
    rprDetails.innerHTML = `Счёт судей: <b>${data.votes.p1} : ${data.votes.p2}</b>`;
  } else if (data.isDraw) {
    winnerBox.classList.add('draw');
    winnerText.innerText = '🤝 НИЧЬЯ';
    rprDetails.innerHTML = `Счёт судей: <b>${data.votes.p1} : ${data.votes.p2}</b>`;
  } else if (data.isWinner) {
    winnerBox.classList.add('win');
    winnerText.innerText = '🔥 ТЫ ПОБЕДИЛ!';
    const changeStr = data.myChange > 0 ? `+${data.myChange}` : `${data.myChange}`;
    rprDetails.innerHTML = `Счёт судей: <b>${data.votes.p1} : ${data.votes.p2}</b><br><br>Твой рейтинг: <b>${changeStr} RPR</b> (Итого: ${data.newRpr})`;
    updateProfileBar(myUsername, data.newRpr, data.newRank);
  } else {
    winnerBox.classList.add('lose');
    winnerText.innerText = '💀 ТЫ ПРОИГРАЛ';
    rprDetails.innerHTML = `Счёт судей: <b>${data.votes.p1} : ${data.votes.p2}</b><br><br>Твой рейтинг: <b>${data.myChange} RPR</b> (Итого: ${data.newRpr})`;
    updateProfileBar(myUsername, data.newRpr, data.newRank);
  }

  winnerContainer.classList.remove('hidden');
  backToMenuBtn.classList.remove('hidden');
});

backToMenuBtn?.addEventListener('click', () => location.reload());

socket.on('signal', async (data) => {
  initWebRTC();

  if (data.offer) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('signal', { answer });
  } else if (data.answer) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
  } else if (data.candidate) {
    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});

socket.on('admin_granted', (data) => {
  const adminBadge = document.getElementById('admin-online');
  const onlineCount = document.getElementById('online-count');
  if (adminBadge) adminBadge.classList.remove('hidden');
  if (onlineCount) onlineCount.innerText = data.count;
});

socket.on('admin_denied', (msg) => { alert(msg); });

socket.on('online_count_update', (data) => {
  const onlineCount = document.getElementById('online-count');
  if (onlineCount) onlineCount.innerText = data.count;
});