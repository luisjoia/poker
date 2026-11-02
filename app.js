import { seatLayoutProfiles } from "./seat-layouts.js";

// Firebase web app settings. Authentication and Firestore are loaded below.
// The API key placeholder is replaced by build.js during deployment.
const firebaseConfig = {
  apiKey: "__FIREBASE_API_KEY__",
  authDomain: "scrumpoker-c1d01.firebaseapp.com",
  projectId: "scrumpoker-c1d01",
  storageBucket: "scrumpoker-c1d01.firebasestorage.app",
  messagingSenderId: "925776630633",
  appId: "1:925776630633:web:9a58b9601edfa78c23a3f8",
  measurementId: "G-GRLE4JYMCS"
};

const cards = ["1", "2", "3", "5", "8", "13", "21", "?"];
const numericCards = new Set(["1", "2", "3", "5", "8", "13", "21"]);
const firebaseReady = !Object.values(firebaseConfig).some(value => typeof value === "string" && (value.startsWith("__") || value.startsWith("REPLACE_")));
const state = { room: null, round: null, uid: crypto.randomUUID(), unsubscribe: null, demoChannel: null, seatAssignments: null };
const $ = selector => document.querySelector(selector);
let lastTableLayout = null;

console.log("[Firebase] Config API key:", firebaseConfig.apiKey);
console.log("[Firebase] firebaseReady:", firebaseReady);

$("#mode-note").textContent = firebaseReady
  ? "Firebase real-time sync is active."
  : "Local demo mode — open this page in another tab to test synchronization.";

let firestore;
let firebaseApi;
if (firebaseReady) {
  try {
    console.log("[Firebase] Initializing Firebase modules....");
    const [{ initializeApp }, authApi, fireApi] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js")
    ]);
    firebaseApi = fireApi;
    const app = initializeApp(firebaseConfig);
    const auth = authApi.getAuth(app);
    console.log("[Firebase] Signing in anonymously...");
    const userCredential = await authApi.signInAnonymously(auth);
    state.uid = userCredential.user.uid;
    console.log("[Firebase] Authenticated with UID:", state.uid);
    firestore = fireApi.getFirestore(app);
    console.log("[Firebase] Firestore initialized successfully.");
  } catch (error) {
    console.error("[Firebase] Failed to initialize:", error);
    showToast("Failed to connect to Firebase. Check console for details.");
  }
}

function newCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomValues = crypto.getRandomValues(new Uint32Array(4));
  return Array.from(randomValues, value => alphabet[value % alphabet.length]).join("");
}
function initials(name) { return name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase(); }
function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 2200); }
function roomKey(code) { return `estima-room-${code}`; }
function getDemoRoom(code) { return JSON.parse(localStorage.getItem(roomKey(code)) || "null"); }
function saveDemoRoom(room) { localStorage.setItem(roomKey(room.code), JSON.stringify(room)); state.demoChannel?.postMessage(room); render(room); }

async function createRoom(name) {
  const room = { code: newCode(), title: "New team", revealed: false, round: 1, creator: state.uid, participants: {} };
  room.participants[state.uid] = { name, vote: null };
  if (firebaseReady) {
    console.log("[CreateRoom] Writing to Firestore, room code:", room.code);
    try {
      const { doc, setDoc } = firebaseApi;
      await setDoc(doc(firestore, "rooms", room.code), { title: room.title, revealed: false, round: 1, creator: state.uid });
      console.log("[CreateRoom] Room document created successfully.");
      await setDoc(doc(firestore, "rooms", room.code, "participants", state.uid), room.participants[state.uid]);
      console.log("[CreateRoom] Participant document created successfully.");
    } catch (error) {
      console.error("[CreateRoom] Firebase error:", error);
      showToast("Error creating room: " + error.message);
      return;
    }
  } else {
    console.log("[CreateRoom] Demo mode - saving to localStorage");
    saveDemoRoom(room);
  }
  enterRoom(room.code, name);
}

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

async function enterRoom(code) {
  state.room = code;
  $("#landing-view").classList.add("hidden"); $("#room-view").classList.remove("hidden");
  document.querySelector(".shell").classList.add("room-active");
  history.replaceState({}, "", `?room=${encodeURIComponent(code)}`);
  if (firebaseReady) {
    state.unsubscribe?.();
    const { collection, doc, onSnapshot } = firebaseApi;
    let header, people = [];
    const update = () => header && render({ code, ...header, participants: Object.fromEntries(people.map(person => [person.id, person.data()])) });
    const stopRoom = onSnapshot(doc(firestore, "rooms", code), snap => { header = snap.data(); update(); });
    const stopPeople = onSnapshot(collection(firestore, "rooms", code, "participants"), snap => { people = snap.docs; update(); });
    state.unsubscribe = () => { stopRoom(); stopPeople(); };
  } else {
    state.demoChannel?.close(); state.demoChannel = new BroadcastChannel(`estima-${code}`);
    state.demoChannel.onmessage = event => render(event.data);
    render(getDemoRoom(code));
  }
}

function render(room) {
  if (!room) return;
  state.round = room.round;
  // A vote only belongs to the current round. Old votes stay in Firestore but are ignored.
  const people = Object.entries(room.participants || {}).map(([id, person]) => {
    const currentVote = person.voteRound === room.round ? person.vote : null;
    const initialVote = person.initialVoteRound === room.round ? person.initialVote : null;
    const voteChanged = person.voteChangedRound === room.round;
    return {
      id,
      ...person,
      vote: currentVote,
      initialVote: initialVote,
      voteChanged: voteChanged
    };
  });
  const mine = people.find(person => person.id === state.uid);
  const isCreator = room.creator === state.uid;
  $("#copy-code").textContent = room.code;
  $("#round-label").textContent = `ROUND ${String(room.round).padStart(2, "0")}`;
  $("#round-heading").textContent = room.revealed ? "The team has revealed the cards" : "Choose your estimate";
  $("#round-subtitle").textContent = room.revealed ? "You can change your vote once." : "Votes stay private until someone reveals the cards.";
  $("#vote-state").textContent = mine?.vote ? `You chose ${mine.vote}` : "You have not voted yet";

  // Render participants around the table
  renderTableParticipants(people, room);
  // Render revealed votes in the center of the table
  renderTableCenter(people, room);

  // Keep old participants list for stats (hidden)
  $("#participants").innerHTML = people.map(person => {
    const voteDisplay = room.revealed && person.vote
      ? person.voteChanged
        ? `<span class="vote-value"><span class="vote-initial" title="Initial vote">${person.initialVote}</span><span class="vote-new">${person.vote}</span></span>`
        : `<span class="vote-value">${person.vote}</span>`
      : `<span class="participant-state">${person.vote ? "Voted ✓" : "Thinking…"}</span>`;
    return `<article class="participant ${person.vote ? "voted" : ""} ${person.voteChanged ? "vote-modified" : ""}"><span class="avatar">${initials(person.name)}</span><span class="participant-name">${escapeHtml(person.name)}</span>${voteDisplay}</article>`;
  }).join("");
  $("#cards").innerHTML = cards.map(card => `<button class="card ${mine?.vote === card ? "selected" : ""}" data-card="${card}"><span class="card-center">${card}</span></button>`).join("");
  $("#result-panel").classList.toggle("hidden", !room.revealed);
  $("#table-center").classList.toggle("revealed", room.revealed);
  $("#reveal-button").classList.toggle("hidden", room.revealed || !isCreator);
  $("#reset-button").classList.toggle("hidden", !isCreator);
  if (room.revealed) renderStats(people);
}

// Use the exported 14-seat layout nearest to the current monitor width. When
// fewer people are present, each gets a random, unique seat that stays stable
// through votes and real-time room updates.
function renderTableParticipants(people, room) {
  const container = $("#table-participants");
  const stage = $(".table-container");
  const table = $("#table-surface");
  const count = people.length;
  if (count === 0) {
    container.innerHTML = "";
    lastTableLayout = null;
    state.seatAssignments = { room: state.room, byId: new Map() };
    return;
  }

  const stageWidth = stage.clientWidth;
  const tableWidth = Math.min(700, Math.max(100, stageWidth - 200));
  table.style.width = `${tableWidth}px`;
  const viewportWidth = window.innerWidth;
  const profile = seatLayoutProfiles.reduce((closest, candidate) =>
    Math.abs(candidate.viewportWidth - viewportWidth) < Math.abs(closest.viewportWidth - viewportWidth) ? candidate : closest
  );
  let stageHeight = profile.stageHeight;
  const overflowCount = Math.max(0, count - profile.positions.length);
  const radiusX = Math.min(stageWidth / 2 - 34, tableWidth / 2 + 64);
  const radiusY = tableWidth / 5 + 78;
  const extraPositions = [];
  for (let index = 0; index < overflowCount; index++) {
    const level = Math.floor(index / 4);
    const side = index % 4 < 2 ? 1 : -1;
    const vertical = index % 2 === 0 ? 1 : -1;
    extraPositions.push({ x: stageWidth / 2 + side * radiusX, y: vertical * (radiusY + 40 + level * 110) });
  }
  if (extraPositions.length) {
    const overflowExtent = Math.max(...extraPositions.map(position => Math.abs(position.y)));
    stageHeight = Math.max(stageHeight, overflowExtent * 2 + 96);
  }
  const positions = profile.positions.map(([x, y]) => ({
    x: stageWidth / 2 + (profile.stageWidth * (x / 100 - 0.5)) * ((tableWidth / 2 + 64) / (profile.tableWidth / 2 + 64)),
    y: stageHeight / 2 + (profile.stageHeight * (y / 100 - 0.5)) * ((tableWidth / 5 + 78) / (profile.tableWidth / 5 + 78))
  })).concat(extraPositions.map(position => ({ x: position.x, y: stageHeight / 2 + position.y })));
  stage.style.height = `${stageHeight}px`;
  lastTableLayout = { people, room };

  if (!state.seatAssignments || state.seatAssignments.room !== state.room) {
    state.seatAssignments = { room: state.room, byId: new Map() };
  }
  const activeIds = new Set(people.map(person => person.id));
  for (const [id, slot] of state.seatAssignments.byId) {
    if (!activeIds.has(id) || slot >= positions.length) state.seatAssignments.byId.delete(id);
  }
  const occupiedSlots = new Set(state.seatAssignments.byId.values());
  const availableSlots = Array.from({ length: positions.length }, (_, index) => index)
    .filter(index => !occupiedSlots.has(index));
  for (const person of people) {
    if (state.seatAssignments.byId.has(person.id)) continue;
    const pick = Math.floor(Math.random() * availableSlots.length);
    const slot = availableSlots.splice(pick, 1)[0];
    state.seatAssignments.byId.set(person.id, slot);
    occupiedSlots.add(slot);
  }

  container.innerHTML = people.map((person, index) => {

    const voteDisplay = room.revealed && person.vote
      ? person.voteChanged
        ? `<span class="vote-value"><span class="vote-initial" title="Initial vote">${person.initialVote}</span><span class="vote-new">${person.vote}</span></span>`
        : `<span class="vote-value">${person.vote}</span>`
      : `<span class="participant-state">${person.vote ? "Voted ✓" : "Thinking…"}</span>`;
    const pos = positions[state.seatAssignments.byId.get(person.id)];
    return `<div class="participant-wrapper" style="left:${pos.x}px;top:${pos.y}px">
      <article class="participant ${person.vote ? "voted" : ""} ${person.voteChanged ? "vote-modified" : ""}">
        <span class="avatar">${initials(person.name)}</span>
        ${voteDisplay}
      </article>
      <span class="participant-name">${escapeHtml(person.name)}</span>
    </div>`;
  }).join("");
}

window.addEventListener("resize", () => {
  if (lastTableLayout && !$("#room-view").classList.contains("hidden")) {
    renderTableParticipants(lastTableLayout.people, lastTableLayout.room);
  }
});

// Keep only stats in the center of the table, no individual vote cards
function renderTableCenter(people, room) {
}
function escapeHtml(text) { const node = document.createElement("span"); node.textContent = text; return node.innerHTML; }
function renderStats(people) {
  const votes = people.filter(person => numericCards.has(person.vote)).map(person => person.vote);
  const values = votes.map(v => Number(v)).sort((a,b) => a-b);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const middleIndex = Math.floor(values.length / 2);
  const median = !values.length ? null : values.length % 2
    ? values[middleIndex]
    : (values[middleIndex - 1] + values[middleIndex]) / 2;
  const voteCounts = votes.reduce((counts, vote) => {
    counts[vote] = (counts[vote] || 0) + 1;
    return counts;
  }, {});
  const mostVotes = Math.max(0, ...Object.values(voteCounts));
  const mostVotedValues = Object.entries(voteCounts)
    .filter(([, count]) => count === mostVotes && mostVotes > 0)
    .map(([value]) => value);
  const isDraw = mostVotedValues.length > 1;
  const fmt = value => value === null ? "—" : String(value).replace(".5", ",5");
  const drawState = $("#draw-state");
  drawState.classList.toggle("hidden", !isDraw);
  drawState.textContent = isDraw ? `Draw · ${mostVotedValues.join(" / ")}` : "";
  const featuredLabel = isDraw ? "TIED VOTES" : "MOST VOTED";
  const featuredValue = mostVotedValues.length ? mostVotedValues.join(" / ") : "—";
  const infoStats = [
    ["Average", fmt(average === null ? null : +average.toFixed(1))],
    ["Median", fmt(median)],
    ["Highest", fmt(values.at(-1) ?? null)],
    ["Lowest", fmt(values[0] ?? null)]
  ];
  $("#stats").innerHTML = `<div class="preview-stats"><div class="preview-feature"><span>${featuredLabel}</span><strong>${featuredValue}</strong></div><div class="preview-info">${infoStats.map(([label, value]) => `<div class="preview-stat"><span>${label}</span><strong>${value}</strong></div>`).join("")}</div></div>`;
}
async function vote(card) {
  const room = firebaseReady ? null : getDemoRoom(state.room);
  const round = room?.round ?? state.round;
  // Get current participant data and room revealed state from Firebase or demo storage
  let me;
  let revealed = false;
  if (firebaseReady) {
    const [participantSnap, roomSnap] = await Promise.all([
      firebaseApi.getDoc(firebaseApi.doc(firestore, "rooms", state.room, "participants", state.uid)),
      firebaseApi.getDoc(firebaseApi.doc(firestore, "rooms", state.room))
    ]);
    me = participantSnap.exists() ? participantSnap.data() : null;
    revealed = roomSnap.exists() ? (roomSnap.data().revealed ?? false) : false;
  } else {
    me = room?.participants?.[state.uid];
    revealed = room?.revealed ?? false;
  }
  // After reveal, allow only one vote change; before reveal, allow unlimited changes
  if (revealed && me && me.voteChangedRound === round) {
    showToast("You can only change your vote once per round.");
    return;
  }
  // Save the initial vote the first time a person votes in a round
  const hasVotedBefore = me && me.voteRound === round;
  const payload = { vote: card, voteRound: round };
  if (!hasVotedBefore) {
    payload.initialVote = card;
    payload.initialVoteRound = round;
    payload.voteChangedRound = null;
  } else if (revealed && card !== me.initialVote) {
    // This is a change from the initial vote (only tracked after reveal)
    payload.voteChangedRound = round;
  }
  if (firebaseReady) {
    await firebaseApi.setDoc(firebaseApi.doc(firestore, "rooms", state.room, "participants", state.uid), payload, { merge: true });
  } else {
    Object.assign(room.participants[state.uid], payload);
    saveDemoRoom(room);
  }
}
async function reveal() {
  const room = firebaseReady ? null : getDemoRoom(state.room);
  if (room && room.creator !== state.uid) return showToast("Only the room creator can reveal the cards.");
  if (firebaseReady) {
    const { doc, getDoc } = firebaseApi;
    const snap = await getDoc(doc(firestore, "rooms", state.room));
    if (!snap.exists()) return showToast("Room not found.");
    if (snap.data().creator !== state.uid) return showToast("Only the room creator can reveal the cards.");
    await firebaseApi.updateDoc(firebaseApi.doc(firestore, "rooms", state.room), { revealed: true });
  } else {
    room.revealed = true; saveDemoRoom(room);
  }
}
async function resetRound() {
  if (!confirm("Start a new round for the entire team?")) return;
  const room = firebaseReady ? null : getDemoRoom(state.room);
  if (room && room.creator !== state.uid) return showToast("Only the room creator can start a new round.");
  if (firebaseReady) {
    const { doc, getDoc, increment, updateDoc } = firebaseApi;
    const snap = await getDoc(doc(firestore, "rooms", state.room));
    if (!snap.exists()) return showToast("Room not found.");
    if (snap.data().creator !== state.uid) return showToast("Only the room creator can start a new round.");
    await updateDoc(doc(firestore, "rooms", state.room), { revealed: false, round: increment(1) });
  } else {
    room.revealed = false;
    room.round += 1;
    saveDemoRoom(room);
  }
  // Hide the result panel to clear the table
  $("#result-panel").classList.add("hidden");
}

$("#create-form").addEventListener("submit", event => { event.preventDefault(); createRoom($("#create-name").value.trim()); });
$("#join-form").addEventListener("submit", event => { event.preventDefault(); joinRoom($("#room-code").value, $("#join-name").value.trim()); });
$("#cards").addEventListener("click", event => { const card = event.target.closest("[data-card]")?.dataset.card; if (card) vote(card); });
$("#reveal-button").addEventListener("click", reveal); $("#reset-button").addEventListener("click", resetRound);
$("#copy-code").addEventListener("click", async () => { await navigator.clipboard.writeText(state.room); showToast("Room code copied."); });
$("#leave-room").addEventListener("click", () => { state.unsubscribe?.(); state.demoChannel?.close(); document.querySelector(".shell").classList.remove("room-active"); history.replaceState({}, "", location.pathname); location.reload(); });

const urlRoom = new URLSearchParams(location.search).get("room");
// Auto-uppercase room code input
$("#room-code").addEventListener("input", e => e.target.value = e.target.value.toUpperCase());

if (urlRoom) {
  $("#room-code").value = urlRoom;
  $("#join-name").focus();
  $("#landing-view").classList.add("join-only");
  $("#show-create").classList.remove("hidden");
  showToast("Enter your name to join the room.");
}
$("#show-create").addEventListener("click", () => {
  $("#landing-view").classList.remove("join-only");
  $("#show-create").classList.add("hidden");
  $("#create-name").focus();
});

// Theme toggle: cycles through light → dark → light
const themes = ["light", "dark"];
const themeIcons = { light: "🌙", dark: "☀️" };
const themeLabels = { light: "Dark", dark: "Light" };
const setTheme = (theme) => {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  document.querySelectorAll(".theme-toggle").forEach(btn => {
    btn.querySelector(".icon").textContent = themeIcons[theme];
    btn.querySelector(".label").textContent = themeLabels[theme];
  });
};
const toggleTheme = () => {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const nextIndex = (themes.indexOf(current) + 1) % themes.length;
  setTheme(themes[nextIndex]);
};
// Restore saved theme or respect system preference
const savedTheme = localStorage.getItem("theme");
if (savedTheme) {
  setTheme(savedTheme);
} else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
  setTheme("dark");
}
$("#theme-toggle-landing").addEventListener("click", toggleTheme);
$("#theme-toggle-room").addEventListener("click", toggleTheme);
