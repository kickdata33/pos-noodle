import { deleteApp, initializeApp } from "firebase/app";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  runTransaction,
  updateDoc,
  where,
} from "firebase/firestore";

export class AgentAuthError extends Error {}

/**
 * Signs the agent in with its own, shop-scoped credentials: agent id + secret → the shop's
 * `/api/print-agent/token` → a Firebase custom token whose claims (role printAgent, shopId,
 * stations) are all the Firestore rules let it act on — its own shop's print jobs for its own
 * stations, and its own heartbeat. No admin key ever lives on the shop PC.
 */
export async function connect({ origin, agentId, secret, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(`${origin}/api/print-agent/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, secret }),
    });
  } catch (err) {
    throw new Error(`cannot reach ${origin} (${err.message})`);
  }
  if (res.status === 401) throw new AgentAuthError("pairing code rejected or revoked — reinstall with a new code");
  if (!res.ok) throw new Error(`token endpoint returned HTTP ${res.status}`);
  const data = await res.json();
  const app = initializeApp(data.firebaseConfig, `ranpos-agent-${Date.now()}`);
  await signInWithCustomToken(getAuth(app), data.customToken);
  return new FirestoreStore({
    app,
    db: getFirestore(app),
    shopId: data.shopId,
    stations: data.stations,
    agentId,
    name: data.name,
  });
}

export class FirestoreStore {
  constructor({ app, db, shopId, stations, agentId, name }) {
    this.app = app;
    this.db = db;
    this.shopId = shopId;
    this.stations = stations;
    this.agentId = agentId;
    this.name = name;
  }

  // Every query carries shopId + one station so the rules engine can prove it only touches
  // what the agent's token allows (agentMayPrint in firestore.rules).
  #jobsQuery(station, ...more) {
    return query(
      collection(this.db, "printJobs"),
      where("shopId", "==", this.shopId),
      where("station", "==", station),
      ...more
    );
  }

  subscribePending(station, onJobs, onError) {
    return onSnapshot(
      this.#jobsQuery(station, where("status", "==", "pending")),
      (snap) => onJobs(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
      onError
    );
  }

  async fetchPending(station) {
    const snap = await getDocs(this.#jobsQuery(station, where("status", "==", "pending")));
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  }

  async listClaimedByMe(station) {
    const snap = await getDocs(
      this.#jobsQuery(station, where("status", "==", "printing"), where("claimedBy", "==", this.agentId))
    );
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  }

  /** pending → printing for this agent, atomically. false = someone else got it first. */
  async claim(jobId) {
    const ref = doc(this.db, "printJobs", jobId);
    return runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists() || snap.data().status !== "pending") return false;
      tx.update(ref, { status: "printing", claimedBy: this.agentId, claimedAt: Date.now() });
      return true;
    });
  }

  release(jobId, error) {
    return updateDoc(doc(this.db, "printJobs", jobId), {
      status: "pending",
      claimedBy: null,
      claimedAt: null,
      error,
    });
  }

  finish(jobId, patch) {
    return updateDoc(doc(this.db, "printJobs", jobId), patch);
  }

  heartbeat(payload) {
    return updateDoc(doc(this.db, "printAgents", this.agentId), payload);
  }

  async close() {
    await deleteApp(this.app).catch(() => undefined);
  }
}
