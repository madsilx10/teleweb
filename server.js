// server.js
// Multi-account Telegram web client backend (MTProto via GramJS)
//
// SETUP:
// 1. Get API_ID & API_HASH from https://my.telegram.org -> API Development Tools
// 2. Set env vars: TG_API_ID and TG_API_HASH (or edit the fallback values below)
// 3. npm install
// 4. npm start
// 5. Open http://localhost:3000

require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { AuthKey } = require("telegram/crypto/AuthKey");
const { computeCheck } = require("telegram/Password");
const { decodePyrogramSession } = require("./pyrogram-to-gramjs");

const DC_IPS = {
  1: "149.154.175.53",
  2: "149.154.167.51",
  3: "149.154.175.100",
  4: "149.154.167.91",
  5: "91.108.56.130",
};

const API_ID = parseInt(process.env.TG_API_ID || "0", 10);
const API_HASH = process.env.TG_API_HASH || "";
const PORT = process.env.PORT || 3000;
const ACCOUNTS_FILE = path.join(__dirname, "accounts.json");

if (!API_ID || !API_HASH) {
  console.warn(
    "[WARN] TG_API_ID / TG_API_HASH belum di-set. Set dulu env var-nya (dari my.telegram.org) sebelum login."
  );
}

// ---------- persistence helpers ----------
function loadAccounts() {
  if (!fs.existsSync(ACCOUNTS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveAccounts(data) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2));
}

// in-memory: active connected clients, keyed by label
const clients = {}; // label -> TelegramClient
// in-memory: logins in progress, keyed by label
const pending = {}; // label -> { client, phoneCodeHash, phone }

async function getOrCreateClient(label, sessionStr = "") {
  if (clients[label]) return clients[label];
  const client = new TelegramClient(
    new StringSession(sessionStr),
    API_ID,
    API_HASH,
    { connectionRetries: 5 }
  );
  await client.connect();
  clients[label] = client;
  return client;
}

// NOTE: accounts are connected lazily (on first use via requireClient),
// not all at once on boot — keeps startup fast and memory low when you
// have many saved accounts but only use a few at a time.

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- LOGIN FLOW ----------

// Step 1: send OTP code to phone. Label is optional — if omitted, the
// final label is auto-derived from the Telegram profile after login.
app.post("/api/login/send-code", async (req, res) => {
  const { label, phone } = req.body;
  if (!phone) return res.status(400).json({ error: "phone wajib diisi" });

  const trimmedLabel = label && label.trim() ? label.trim() : null;
  const key = trimmedLabel || `_pending_${phone}_${Date.now()}`;

  try {
    const client = await getOrCreateClient(key, "");
    const result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId: API_ID,
        apiHash: API_HASH,
        settings: new Api.CodeSettings({}),
      })
    );
    pending[key] = { client, phoneCodeHash: result.phoneCodeHash, phone, requestedLabel: trimmedLabel };
    res.json({ ok: true, key, message: "Kode OTP terkirim ke Telegram/SMS" });
  } catch (e) {
    delete clients[key];
    res.status(500).json({ error: e.message });
  }
});

// Step 2: verify OTP code
app.post("/api/login/verify-code", async (req, res) => {
  const { key, code } = req.body;
  const state = pending[key];
  if (!state) return res.status(400).json({ error: "Belum ada proses login untuk sesi ini, panggil send-code dulu" });

  try {
    await state.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: state.phone,
        phoneCodeHash: state.phoneCodeHash,
        phoneCode: code,
      })
    );
    // success, no 2FA needed
    const finalLabel = await finishLogin(key, state);
    res.json({ ok: true, needPassword: false, label: finalLabel });
  } catch (e) {
    if (e.message && e.message.includes("SESSION_PASSWORD_NEEDED")) {
      res.json({ ok: true, needPassword: true });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

// Step 3: verify 2FA password (only if needPassword=true from step 2)
app.post("/api/login/verify-password", async (req, res) => {
  const { key, password } = req.body;
  const state = pending[key];
  if (!state) return res.status(400).json({ error: "Belum ada proses login untuk sesi ini" });

  try {
    const passwordInfo = await state.client.invoke(new Api.account.GetPassword());
    const passwordCheck = await computeCheck(passwordInfo, password);
    await state.client.invoke(new Api.auth.CheckPassword({ password: passwordCheck }));
    const finalLabel = await finishLogin(key, state);
    res.json({ ok: true, label: finalLabel });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Finalizes login: fetches the Telegram profile, derives the account label
// (custom label if the user typed one, otherwise username/first name/phone),
// persists the session, and re-keys the in-memory client if needed.
async function finishLogin(tempKey, state) {
  const me = await state.client.getMe();
  const finalLabel = state.requestedLabel || me.firstName || me.username || state.phone;

  const sessionStr = state.client.session.save();
  const accounts = loadAccounts();
  accounts[finalLabel] = {
    phone: state.phone,
    username: me.username || null,
    firstName: me.firstName || null,
    session: sessionStr,
  };
  saveAccounts(accounts);

  if (finalLabel !== tempKey) {
    clients[finalLabel] = clients[tempKey];
    delete clients[tempKey];
  }
  delete pending[tempKey];
  return finalLabel;
}

// Import an existing Pyrogram session directly — no phone/OTP needed.
// Converts Pyrogram's session format into a GramJS StringSession and
// verifies it actually works before saving.
app.post("/api/login/import-pyrogram", async (req, res) => {
  const { label, pyrogramSession } = req.body;
  if (!pyrogramSession) {
    return res.status(400).json({ error: "pyrogramSession wajib diisi" });
  }
  const trimmedLabel = label && label.trim() ? label.trim() : null;

  try {
    const { dcId, authKey, userId } = decodePyrogramSession(pyrogramSession);
    const ip = DC_IPS[dcId];
    if (!ip) throw new Error(`DC ${dcId} gak dikenal`);

    const session = new StringSession("");
    const ak = new AuthKey();
    await ak.setKey(authKey);
    session.setDC(dcId, ip, 443);
    session.setAuthKey(ak, dcId);
    const gramjsSessionStr = session.save();

    const tempKey = `_temp_${userId}_${Date.now()}`;
    const client = await getOrCreateClient(tempKey, gramjsSessionStr);
    const me = await client.getMe();
    const finalLabel = trimmedLabel || me.firstName || me.username || userId;

    if (clients[finalLabel] && finalLabel !== tempKey) {
      try { await clients[finalLabel].disconnect(); } catch {}
    }
    clients[finalLabel] = client;
    if (finalLabel !== tempKey) delete clients[tempKey];

    const accounts = loadAccounts();
    accounts[finalLabel] = {
      phone: me.phone || userId,
      username: me.username || null,
      firstName: me.firstName || null,
      session: gramjsSessionStr,
    };
    saveAccounts(accounts);

    res.json({ ok: true, label: finalLabel, userId, username: me.username, firstName: me.firstName });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- ACCOUNT MANAGEMENT ----------

app.get("/api/accounts", (req, res) => {
  const accounts = loadAccounts();
  const list = Object.keys(accounts).map((label) => ({
    label,
    phone: accounts[label].phone,
    username: accounts[label].username || null,
    connected: !!clients[label],
  }));
  res.json(list);
});

app.delete("/api/accounts/:label", async (req, res) => {
  const { label } = req.params;
  const accounts = loadAccounts();
  delete accounts[label];
  saveAccounts(accounts);
  if (clients[label]) {
    try { await clients[label].disconnect(); } catch {}
    delete clients[label];
  }
  res.json({ ok: true });
});

// ---------- CHATS ----------

// Telegram's official service notifications account (login codes, announcements)
const TELEGRAM_OFFICIAL_ID = 777000;

// Lightweight unread check for just the official chat (single peer, not a full dialog scan)
app.get("/api/chats/:label/official/unread", async (req, res) => {
  const { label } = req.params;
  try {
    const client = await requireClient(label);
    const inputPeer = await client.getInputEntity(TELEGRAM_OFFICIAL_ID);
    const result = await client.invoke(
      new Api.messages.GetPeerDialogs({
        peers: [new Api.InputDialogPeer({ peer: inputPeer })],
      })
    );
    const dialog = result.dialogs[0];
    res.json({ unreadCount: dialog?.unreadCount || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// The only chat shown by default — Telegram's own service notifications chat.
app.get("/api/chats/:label/official", async (req, res) => {
  const { label } = req.params;
  try {
    const client = await requireClient(label);
    const messages = await client.getMessages(TELEGRAM_OFFICIAL_ID, { limit: 30 });
    const list = messages.map((m) => ({
      id: m.id,
      date: m.date,
      out: m.out,
      text: m.message,
    }));
    res.json(list.reverse());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// get messages with a specific username (or chat id)
app.get("/api/messages/:label", async (req, res) => {
  const { label } = req.params;
  const { username, limit } = req.query;
  if (!username) return res.status(400).json({ error: "query ?username= wajib diisi" });

  try {
    const client = await requireClient(label);
    const messages = await client.getMessages(username, { limit: parseInt(limit || "30", 10) });
    const list = messages.map((m) => ({
      id: m.id,
      date: m.date,
      out: m.out,
      senderId: m.senderId?.toString(),
      text: m.message,
    }));
    res.json(list.reverse());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function requireClient(label) {
  const accounts = loadAccounts();
  if (!accounts[label]) throw new Error(`Akun '${label}' belum login`);
  return getOrCreateClient(label, accounts[label].session);
}

app.listen(PORT, () => console.log(`Server jalan di http://localhost:${PORT}`));
