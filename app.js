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
const state = { room: null, round: null, uid: crypto.randomUUID(), unsubscribe: null, demoChannel: null };
const $ = selector => document.querySelector(selector);

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

async function createRoom(name, title) {
  const room = { code: newCode(), title: title.trim() || "New team", revealed: false, round: 1, creator: state.uid, participants: {} };
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
  const people = Object.entries(room.participants || {}).map(([id, person]) => ({
    id,
    ...person,
    vote: person.voteRound === room.round ? person.vote : null
  }));
  const mine = people.find(person => person.id === state.uid);
  const isCreator = room.creator === state.uid;
  $("#room-title-display").textContent = room.title;
  $("#copy-code").textContent = room.code;
  $("#round-label").textContent = `ROUND ${String(room.round).padStart(2, "0")}`;
  $("#round-heading").textContent = room.revealed ? "The team has revealed the cards" : "Choose your estimate";
  $("#round-subtitle").textContent = room.revealed ? "Any participant can start a new round." : "Votes stay private until someone reveals the cards.";
  $("#vote-state").textContent = mine?.vote ? `You chose ${mine.vote}` : "You have not voted yet";
  $("#participants").innerHTML = people.map(person => `<article class="participant ${person.vote ? "voted" : ""}"><span class="avatar">${initials(person.name)}</span><span class="participant-name">${escapeHtml(person.name)}</span>${room.revealed && person.vote ? `<span class="vote-value">${person.vote}</span>` : `<span class="participant-state">${person.vote ? "Voted ✓" : "Thinking…"}</span>`}</article>`).join("");
  $("#cards").innerHTML = cards.map(card => `<button class="card ${mine?.vote === card ? "selected" : ""}" data-card="${card}" ${room.revealed ? "disabled" : ""}>${card}</button>`).join("");
  $("#result-panel").classList.toggle("hidden", !room.revealed);
  $("#reveal-button").classList.toggle("hidden", room.revealed || !isCreator);
  $("#reset-button").classList.toggle("hidden", !isCreator);
  if (room.revealed) renderStats(people);
}
function escapeHtml(text) { const node = document.createElement("span"); node.textContent = text; return node.innerHTML; }
function renderStats(people) {
  const values = people.filter(person => numericCards.has(person.vote)).map(person => person.vote === "½" ? .5 : Number(person.vote)).sort((a,b) => a-b);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const median = values.length ? values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2 : null;
  const fmt = value => value === null ? "—" : String(value).replace(".5", ",5");
  $("#stats").innerHTML = [["Average", fmt(average && +average.toFixed(1))], ["Median", fmt(median)], ["Minimum", fmt(values[0] ?? null)], ["Maximum", fmt(values.at(-1) ?? null)]].map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join("");
}
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
}

$("#create-form").addEventListener("submit", event => { event.preventDefault(); createRoom($("#create-name").value.trim(), $("#room-title").value); });
$("#join-form").addEventListener("submit", event => { event.preventDefault(); joinRoom($("#room-code").value, $("#join-name").value.trim()); });
$("#cards").addEventListener("click", event => { const card = event.target.closest("[data-card]")?.dataset.card; if (card) vote(card); });
$("#reveal-button").addEventListener("click", reveal); $("#reset-button").addEventListener("click", resetRound);
$("#copy-code").addEventListener("click", async () => { await navigator.clipboard.writeText(state.room); showToast("Room code copied."); });
$("#leave-room").addEventListener("click", () => { state.unsubscribe?.(); state.demoChannel?.close(); history.replaceState({}, "", location.pathname); location.reload(); });

const urlRoom = new URLSearchParams(location.search).get("room");
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
