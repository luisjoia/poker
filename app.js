/* ============================================================
   CONFIGURAÇÃO DO FIREBASE
   Define a conexão com o Firebase para sincronização em tempo real.
   Se as credenciais não estiverem configuradas, usa modo demo local.
   ============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyDDbJzMv4TKCZVb2F8_3q80ZvsQTA2kkFw",
  authDomain: "scrumpoker-c1d01.firebaseapp.com",
  projectId: "scrumpoker-c1d01",
  storageBucket: "scrumpoker-c1d01.firebasestorage.app",
  messagingSenderId: "925776630633",
  appId: "1:925776630633:web:9a58b9601edfa78c23a3f8",
  measurementId: "G-GRLE4JYMCS"
};

/* Valores de estimativa do Planning Poker (Fibonacci + ?) */
const cards = ["1", "2", "3", "5", "8", "13", "21", "?"];
/* Valores numéricos para cálculo de média/mediana (exclui "?") */
const numericCards = new Set(["1", "2", "3", "5", "8", "13", "21"]);
/* Verifica se o Firebase está configurado. Se sim, usa sincronização real; senão, modo demo local. */
const firebaseReady = !Object.values(firebaseConfig).some(value => value.startsWith("REPLACE_"));

/* Estado global da aplicação: sala atual, ronda, ID único do utilizador, etc. */
const state = { room: null, round: null, uid: crypto.randomUUID(), unsubscribe: null, demoChannel: null };
/* Atalho para document.querySelector */
const $ = selector => document.querySelector(selector);

/* ============================================================
   MODO ESCURO / CLARO
   Alterna entre temas e guarda a preferência no localStorage.
   ============================================================ */
function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = theme; /* Define o atributo data-theme no <html> */
  localStorage.setItem("poker-theme", theme); /* Guarda a preferência */
  $("#theme-toggle").setAttribute("aria-pressed", String(isDark));
  $("#theme-toggle").setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} mode`);
  $(".theme-icon").textContent = isDark ? "☀" : "☾";
  $(".theme-label").textContent = isDark ? "Light mode" : "Dark mode";
}

/* Carrega o tema guardado ou deteta a preferência do sistema */
const savedTheme = localStorage.getItem("poker-theme");
applyTheme(savedTheme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
/* Botão de alternância de tema */
$("#theme-toggle").addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

/* Mostra ao utilizador se está em modo Firebase ou demo local */
$("#mode-note").textContent = firebaseReady
  ? "Firebase real-time sync is active."
  : "Local demo mode — open this page in another tab to test synchronization.";

/* ============================================================
   INICIALIZAÇÃO DO FIREBASE
   Carrega os módulos apenas se o Firebase estiver configurado.
   Autenticação anónima dá um UID único a cada navegador.
   ============================================================ */
let firestore;
let firebaseApi;
if (firebaseReady) {
  const [{ initializeApp }, authApi, fireApi] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js")
  ]);
  firebaseApi = fireApi;
  const app = initializeApp(firebaseConfig);
  const auth = authApi.getAuth(app);
  await authApi.signInAnonymously(auth); /* Autenticação anónima para identificar cada navegador */
  state.uid = auth.currentUser.uid;
  firestore = fireApi.getFirestore(app);
}

/* ============================================================
   FUNÇÕES UTILITÁRIAS
   ============================================================ */

/* Gera um código de sala aleatório de 4 caracteres (sem I, O, 0, 1 para evitar ambiguidade) */
function newCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomValues = crypto.getRandomValues(new Uint32Array(4));
  return Array.from(randomValues, value => alphabet[value % alphabet.length]).join("");
}

/* Extrai as iniciais de um nome para o avatar (ex: "João Silva" → "JS") */
function initials(name) { return name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase(); }

/* Gera o HTML de uma carta de baralho com valor, naipe e classes de cor */
function pokerCard(value) {
  const suit = ["♠", "♥", "♦", "♣"][String(value).charCodeAt(0) % 4]; /* Atribui naipe baseado no valor */
  const suitClass = suit === "♥" || suit === "♦" ? "red-suit" : "black-suit";
  return `<span class="playing-card ${suitClass}"><span class="card-corner">${value}<small>${suit}</small></span><strong>${value}</strong><span class="card-suit">${suit}</span></span>`;
}

/* Calcula o estilo inline para posicionar um participante ao redor da mesa.
   O jogador atual (isMe=true) é sempre posicionado em baixo.
   Os outros são distribuídos num arco no topo da mesa. */
function pokerSeatStyle(index, total, isMe) {
  // O jogador atual fica sempre em baixo da arena
  if (isMe) {
    return `left:50%;top:92%;transform:translate(-50%,-50%);`;
  }
  // Outros jogadores são distribuídos ao longo do arco superior
  const otherCount = total - 1;
  if (otherCount === 0) {
    return `left:50%;top:8%;transform:translate(-50%,-50%);`;
  }
  // Distribui de esquerda para direita num arco
  const angle = Math.PI * 0.15 + (index / Math.max(otherCount - 1, 1)) * (Math.PI * 0.7);
  const radius = 42; /* Raio do arco em percentagem da arena */
  return `left:${50 + Math.cos(angle) * radius}%;top:${50 - Math.sin(angle) * radius + 10}%;transform:translate(-50%,-50%);`;
}

/* Mostra uma notificação temporária (toast) na parte inferior do ecrã */
function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 2200); }

/* Chave do localStorage para modo demo */
function roomKey(code) { return `estima-room-${code}`; }

/* Lê o estado da sala do localStorage (modo demo) */
function getDemoRoom(code) { return JSON.parse(localStorage.getItem(roomKey(code)) || "null"); }

/* Guarda o estado da sala no localStorage e notifica outras abas via BroadcastChannel */
function saveDemoRoom(room) { localStorage.setItem(roomKey(room.code), JSON.stringify(room)); state.demoChannel?.postMessage(room); render(room); }

/* ============================================================
   CRIAR / JUNTAR A SALA
   ============================================================ */

/* Cria uma nova sala com código aleatório e adiciona o criador como primeiro participante. */
async function createRoom(name, title) {
  const room = { code: newCode(), title: title.trim() || "New team", revealed: false, round: 1, participants: {} };
  room.participants[state.uid] = { name, vote: null };
  if (firebaseReady) {
    const { doc, setDoc } = firebaseApi;
    await setDoc(doc(firestore, "rooms", room.code), { title: room.title, revealed: false, round: 1 });
    await setDoc(doc(firestore, "rooms", room.code, "participants", state.uid), room.participants[state.uid]);
  } else saveDemoRoom(room);
  enterRoom(room.code, name);
}

/* Junta uma sala existente pelo código e adiciona o utilizador como participante. */
async function joinRoom(code, name) {
  code = code.trim().toUpperCase();
  if (firebaseReady) {
    const { doc, getDoc, setDoc } = firebaseApi;
    if (!(await getDoc(doc(firestore, "rooms", code))).exists()) return showToast("We could not find that room.");
    await setDoc(doc(firestore, "rooms", code, "participants", state.uid), { name, vote: null }, { merge: true });
  } else {
    const room = getDemoRoom(code);
    if (!room) return showToast("We could not find that room in this browser.");
    room.participants[state.uid] = { name, vote: null }; saveDemoRoom(room);
  }
  enterRoom(code, name);
}

/* Entra na sala: altera a vista, atualiza a URL e começa a ouvir atualizações em tempo real.
   Firebase: usa onSnapshot para escutar mudanças na sala e nos participantes.
   Demo: usa BroadcastChannel para sincronizar entre abas do mesmo navegador. */
async function enterRoom(code) {
  state.room = code;
  $("#landing-view").classList.add("hidden"); $("#room-view").classList.remove("hidden"); /* Troca a vista de entrada pela sala */
  history.replaceState({}, {}, `?room=${encodeURIComponent(code)}`); /* Adiciona o código à URL */
  if (firebaseReady) {
    state.unsubscribe?.();
    const { collection, doc, onSnapshot } = firebaseApi;
    let header, people = [];
    const update = () => header && render({ code, ...header, participants: Object.fromEntries(people.map(person => [person.id, person.data()])) });
    /* Escuta mudanças nos dados da sala (título, ronda, revelação) */
    const stopRoom = onSnapshot(doc(firestore, "rooms", code), snap => { header = snap.data(); update(); });
    /* Escuta mudanças nos participantes (entradadas, saídas, votos) */
    const stopPeople = onSnapshot(collection(firestore, "rooms", code, "participants"), snap => { people = snap.docs; update(); });
    state.unsubscribe = () => { stopRoom(); stopPeople(); };
  } else {
    /* Modo demo: BroadcastChannel sincroniza entre abas do mesmo navegador */
    state.demoChannel?.close(); state.demoChannel = new BroadcastChannel(`estima-${code}`);
    state.demoChannel.onmessage = event => render(event.data);
    render(getDemoRoom(code));
  }
}

/* ============================================================
   RENDERIZAÇÃO PRINCIPAL
   Atualiza toda a interface com base no estado da sala.
   É chamada sempre que há uma mudança (novo participante, voto, revelação).
   ============================================================ */
function render(room) {
  if (!room) return;
  state.round = room.round;
  
  /* Filtra os votos: apenas o voto da ronda atual é considerado.
     Votos antigos ficam no Firebase mas são ignorados. */
  const people = Object.entries(room.participants || {}).map(([id, person]) => ({
    id,
    ...person,
    vote: person.voteRound === room.round ? person.vote : null
  }));
  const mine = people.find(person => person.id === state.uid); /* Dados do jogador atual */
  
  /* Atualiza o cabeçalho da sala */
  $("#room-title-display").textContent = room.title;
  $("#copy-code").textContent = room.code;
  $("#round-label").textContent = `ROUND ${String(room.round).padStart(2, "0")}`;
  $("#round-heading").textContent = room.revealed ? "The team has revealed the cards" : "Choose your estimate";
  $("#round-subtitle").textContent = room.revealed ? "Any participant can start a new round." : "Votes stay private until someone reveals the cards.";

  /* ----------------------------------------------------------
     RENDERIZAR PARTICIPANTES
     O jogador atual fica em baixo, os outros no arco superior.
     Cada participante mostra: avatar, nome, estado e carta.
     ---------------------------------------------------------- */
  const others = people.filter(p => p.id !== state.uid);
  const mePerson = mine;
  let participantsHtml = others.map((person, index) => {
    const isMe = person.id === state.uid;
    return `<article class="participant poker-player ${person.vote ? "voted" : ""}" style="${pokerSeatStyle(index, people.length, isMe)}"><span class="avatar">${initials(person.name)}</span><span class="participant-name">${escapeHtml(person.name)}</span>${room.revealed && person.vote ? `<span class="player-card revealed-card">${pokerCard(person.vote)}</span>` : person.vote ? `<span class="player-card card-back">♠</span><span class="participant-state">Voted ✓</span>` : `<span class="participant-state">Thinking…</span>`}</article>`;
  }).join("");
  // Adiciona o jogador atual sempre em baixo
  if (mePerson) {
    participantsHtml += `<article class="participant poker-player ${mePerson.vote ? "voted" : ""}" style="${pokerSeatStyle(0, people.length, true)}"><span class="avatar">${initials(mePerson.name)}</span><span class="participant-name">${escapeHtml(mePerson.name)}</span>${room.revealed && mePerson.vote ? `<span class="player-card revealed-card">${pokerCard(mePerson.vote)}</span>` : mePerson.vote ? `<span class="player-card card-back">♠</span><span class="participant-state">Voted ✓</span>` : `<span class="participant-state">You</span>`}</article>`;
  }
  $("#participants").innerHTML = participantsHtml;

  /* ----------------------------------------------------------
     CARTAS EM LEQUE (MÃO DO JOGADOR)
     Aparecem apenas se a ronda não foi revelada e o jogador
     ainda não votou. Cada carta tem rotação para formar um leque.
     ---------------------------------------------------------- */
  const handEl = $("#player-hand");
  if (!room.revealed && !mine?.vote) {
    handEl.style.display = "flex";
    const totalCards = cards.length;
    handEl.innerHTML = cards.map((card, i) => {
      // Ângulo do leque: cartas no centro ficam retas, as laterais rotacionam
      const angle = (i - (totalCards - 1) / 2) * 6;
      // Deslocamento vertical: cartas laterais ficam mais baixas
      const yOffset = Math.abs(i - (totalCards - 1) / 2) * 3;
      return `<button class="card poker-choice" data-card="${card}" style="transform:rotate(${angle}deg) translateY(${yOffset}px)" aria-label="Vote ${card}">${pokerCard(card)}</button>`;
    }).join("");
  } else {
    handEl.style.display = "none"; /* Esconde o leque após votar ou revelar */
  }

  /* ----------------------------------------------------------
     CARTAS NA MESA
     - Revelada: mostra todas as cartas votadas.
     - Votado mas não revelado: mostra o verso da carta.
     - Não votou: esconde.
     ---------------------------------------------------------- */
  const tableCardsEl = $("#table-cards");
  if (room.revealed) {
    // Mostra todas as cartas reveladas na mesa
    const votedPeople = people.filter(p => p.vote);
    tableCardsEl.innerHTML = votedPeople.map(person =>
      `<div class="card poker-choice" style="transform:none;margin:0 4px;" title="${escapeHtml(person.name)}: ${person.vote}">${pokerCard(person.vote)}</div>`
    ).join("");
    tableCardsEl.style.display = "grid";
  } else if (mine?.vote) {
    // Jogador votou mas ainda não revelado — mostra o verso da carta na mesa
    tableCardsEl.innerHTML = `<div class="card poker-choice" style="transform:none;margin:0 4px;"><span class="playing-card card-back">♠</span></div>`;
    tableCardsEl.style.display = "block";
  } else {
    tableCardsEl.style.display = "none";
  }

  /* Painel de resultados e botões de ação */
  $("#result-panel").classList.toggle("hidden", !room.revealed); /* Mostra estatísticas só quando revelado */
  $("#reveal-button").classList.toggle("hidden", room.revealed); /* Esconde botão revelar após revelação */
  if (room.revealed) renderStats(people);
}
/* ============================================================
   ESTATÍSTICAS E AÇÕES
   ============================================================ */

/* Escapa HTML para evitar injeção de código nos nomes dos participantes */
function escapeHtml(text) { const node = document.createElement("span"); node.textContent = text; return node.innerHTML; }

/* Calcula e mostra as estatísticas: média, mediana, mínimo e máximo.
   Ignora o valor "?" que não é numérico. */
function renderStats(people) {
  const values = people.filter(person => numericCards.has(person.vote)).map(person => person.vote === "½" ? .5 : Number(person.vote)).sort((a,b) => a-b);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const median = values.length ? values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2 : null;
  const fmt = value => value === null ? "—" : String(value).replace(".5", ",5"); /* Formata com vírgula em vez de ponto */
  $("#stats").innerHTML = [["Average", fmt(average && +average.toFixed(1))], ["Median", fmt(median)], ["Minimum", fmt(values[0] ?? null)], ["Maximum", fmt(values.at(-1) ?? null)]].map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join("");
}
/* Grava o voto do jogador atual. Envia para o Firebase ou guarda no localStorage (demo).
   O voto inclui a ronda para que votos antigos sejam ignorados. */
async function vote(card) {
  const room = firebaseReady ? null : getDemoRoom(state.room);
  const round = room?.round ?? state.round;
  if (firebaseReady) {
    await firebaseApi.setDoc(firebaseApi.doc(firestore, "rooms", state.room, "participants", state.uid), { vote: card, voteRound: round }, { merge: true });
  } else {
    room.participants[state.uid].vote = card;
    room.participants[state.uid].voteRound = round;
    saveDemoRoom(room);
  }
}

/* Revela todas as cartas — torna visíveis os votos de todos os participantes. */
async function reveal() {
  if (firebaseReady) await firebaseApi.updateDoc(firebaseApi.doc(firestore, "rooms", state.room), { revealed: true });
  else { const room = getDemoRoom(state.room); room.revealed = true; saveDemoRoom(room); }
}

/* Inicia uma nova ronda: reseta a revelação e incrementa o número da ronda.
   Os votos antigos ficam no Firebase mas são ignorados porque a ronda mudou. */
async function resetRound() {
  if (!confirm("Start a new round for the entire team?")) return;
  if (firebaseReady) {
    const { doc, increment, updateDoc } = firebaseApi;
    await updateDoc(doc(firestore, "rooms", state.room), { revealed: false, round: increment(1) });
  } else {
    const room = getDemoRoom(state.room);
    room.revealed = false;
    room.round += 1;
    saveDemoRoom(room);
  }
}

/* ============================================================
   EVENT LISTENERS
   Liga os botões e formulários às funções da aplicação.
   ============================================================ */

/* Formulário de criar sala */
$("#create-form").addEventListener("submit", event => { event.preventDefault(); createRoom($("#create-name").value.trim(), $("#room-title").value); });

/* Formulário de juntar sala */
$("#join-form").addEventListener("submit", event => { event.preventDefault(); joinRoom($("#room-code").value, $("#join-name").value.trim()); });

/* Clique nas cartas em leque — grava o voto do jogador */
$("#player-hand").addEventListener("click", event => { const card = event.target.closest("[data-card]")?.dataset.card; if (card) vote(card); });

/* Botões de revelar e nova ronda */
$("#reveal-button").addEventListener("click", reveal);
$("#reset-button").addEventListener("click", resetRound);

/* Copiar código da sala para a área de transferência */
$("#copy-code").addEventListener("click", async () => { await navigator.clipboard.writeText(state.room); showToast("Room code copied."); });

/* Sair da sala — limpa subscrições e recarrega a página */
$("#leave-room").addEventListener("click", () => { state.unsubscribe?.(); state.demoChannel?.close(); history.replaceState({}, "", location.pathname); location.reload(); });

/* Se a URL contém ?room=XXX, pré-preenche o campo de código e foca o nome */
const urlRoom = new URLSearchParams(location.search).get("room");
if (urlRoom) { $("#room-code").value = urlRoom; $("#join-name").focus(); showToast("Enter your name to join the room."); }
