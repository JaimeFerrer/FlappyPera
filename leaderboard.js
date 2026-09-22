// Ranking global de Flappy Pera, respaldado por Firebase Firestore.
// Si assets/firebase-config.js no tiene valores reales todavía, este
// módulo se queda "desactivado" (window.Leaderboard.enabled === false) y
// el juego funciona exactamente igual que antes, sin ranking.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

const MAX_NAME_LEN = 16;
const MAX_SCORE = 9999;

function slugify(name) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "jugador";
}

const cfg = window.FIREBASE_CONFIG;
const configured = !!(cfg && cfg.apiKey && cfg.apiKey !== "REEMPLAZA_ESTO");

let db = null;
if (configured) {
  try {
    const app = initializeApp(cfg);
    db = getFirestore(app);
  } catch (e) {
    console.warn("Flappy Pera: no se pudo iniciar Firebase", e);
    db = null;
  }
}

const Leaderboard = {
  enabled: !!db,

  async submitScore(name, score) {
    if (!db) return false;
    const cleanName = String(name).trim().slice(0, MAX_NAME_LEN);
    const cleanScore = Math.max(0, Math.min(MAX_SCORE, Math.round(score)));
    if (!cleanName || cleanScore <= 0) return false;
    try {
      const ref = doc(db, "scores", slugify(cleanName));
      const snap = await getDoc(ref);
      if (snap.exists() && snap.data().score >= cleanScore) return false;
      await setDoc(ref, {
        name: cleanName,
        score: cleanScore,
        updatedAt: serverTimestamp(),
      });
      return true;
    } catch (e) {
      console.warn("Flappy Pera: no se pudo enviar la puntuación", e);
      return false;
    }
  },

  async getTop(n = 5) {
    if (!db) return [];
    try {
      const q = query(collection(db, "scores"), orderBy("score", "desc"), limit(n));
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data());
    } catch (e) {
      console.warn("Flappy Pera: no se pudo leer el ranking", e);
      return [];
    }
  },
};

window.Leaderboard = Leaderboard;
window.dispatchEvent(new Event("leaderboard-ready"));
