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

// reconnect saved accounts on boot
(async () => {
  const accounts = loadAccounts();
  for (const label of Object.keys(accounts)) {
    try {
      await getOrCreateClient(label, accounts[label].session);
      console.log(`[OK] Reconnected account: ${label}`);
    } catch (e) {
      console.error(`[FAIL] Reconnect ${label}:`, e.message);
    }
  }
})();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- LOGIN FLOW ----------

// Step 1: send OTP code to phone
app.post("/api/login/send-code", async (req, res) => {
  const { label, phone } = req.body;
  if (!label || !phone) return res.status(400).json({ error: "label & phone wajib diisi" });

  try {
    const client = await getOrCreateClient(label, "");
    const result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId: API_ID,
        apiHash: API_HASH,
        settings: new Api.CodeSettings({}),
      })
    );
    pending[label] = { client, phoneCodeHash: result.phoneCodeHash, phone };
    res.json({ ok: true, message: "Kode OTP terkirim ke Telegram/SMS" });
  } catch (e) {
    delete clients[label];
    res.status(500).json({ error: e.message });
  }
});

// Step 2: verify OTP code
app.post("/api/login/verify-code", async (req, res) => {
  const { label, code } = req.body;
  const state = pending[label];
  if (!state) return res.status(400).json({ error: "Belum ada proses login untuk label ini, panggil send-code dulu" });

  try {
    await state.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: state.phone,
        phoneCodeHash: state.phoneCodeHash,
        phoneCode: code,
      })
    );
    // success, no 2FA needed
    finishLogin(label, state);
    res.json({ ok: true, needPassword: false });
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
  const { label, password } = req.body;
  const state = pending[label];
  if (!state) return res.status(400).json({ error: "Belum ada proses login untuk label ini" });

  try {
    const passwordInfo = await state.client.invoke(new Api.account.GetPassword());
    const passwordCheck = await computeCheck(passwordInfo, password);
    await state.client.invoke(new Api.auth.CheckPassword({ password: passwordCheck }));
    finishLogin(label, state);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function finishLogin(label, state) {
  const sessionStr = state.client.session.save();
  const accounts = loadAccounts();
  accounts[label] = { phone: state.phone, session: sessionStr };
  saveAccounts(accounts);
  delete pending[label];
}

// Import an existing Pyrogram session directly — no phone/OTP needed.
// Converts Pyrogram's session format into a GramJS StringSession and
// verifies it actually works before saving.
app.post("/api/login/import-pyrogram", async (req, res) => {
  const { label, pyrogramSession } = req.body;
  if (!label || !pyrogramSession) {
    return res.status(400).json({ error: "label & pyrogramSession wajib diisi" });
  }

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

    // verify by actually connecting + fetching self info
    if (clients[label]) {
      try { await clients[label].disconnect(); } catch {}
      delete clients[label];
    }
    const client = await getOrCreateClient(label, gramjsSessionStr);
    const me = await client.getMe();

    const accounts = loadAccounts();
    accounts[label] = { phone: me.phone || userId, session: gramjsSessionStr };
    saveAccounts(accounts);

    res.json({ ok: true, userId, username: me.username, firstName: me.firstName });
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
