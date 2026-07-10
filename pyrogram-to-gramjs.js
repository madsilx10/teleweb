// pyrogram-to-gramjs.js
//
// Convert an existing Pyrogram session string into a GramJS-compatible
// StringSession, so you can skip phone+OTP login entirely for accounts
// you've already authenticated via Pyrogram.
//
// USAGE:
//   npm install telegram
//   node pyrogram-to-gramjs.js "<pyrogram_session_string>"
//
// It will print a GramJS session string AND verify it actually works
// by calling getMe() against Telegram's servers before printing.

const { StringSession } = require("telegram/sessions");
const { AuthKey } = require("telegram/crypto/AuthKey");
const { TelegramClient } = require("telegram");

const API_ID = parseInt(process.env.TG_API_ID || "0", 10);
const API_HASH = process.env.TG_API_HASH || "";

// Well-known production DC IPv4 addresses (same table Telethon/GramJS ship with)
const DC_IPS = {
  1: "149.154.175.53",
  2: "149.154.167.51",
  3: "149.154.175.100",
  4: "149.154.167.91",
  5: "91.108.56.130",
};

function decodePyrogramSession(pyroSession) {
  const padded = pyroSession + "=".repeat((4 - (pyroSession.length % 4)) % 4);
  const buf = Buffer.from(padded, "base64");

  let dcId, authKey, userId, isBot;
  if (buf.length === 271) {
    // v2 format: >BI?256sQ?  (dc_id, api_id, test_mode, auth_key, user_id, is_bot)
    dcId = buf.readUInt8(0);
    authKey = buf.slice(6, 6 + 256);
    userId = buf.readBigUInt64BE(262);
    isBot = !!buf.readUInt8(270);
  } else if (buf.length === 267) {
    // v1 format: >B?256sQ?  (dc_id, test_mode, auth_key, user_id, is_bot)
    dcId = buf.readUInt8(0);
    authKey = buf.slice(2, 2 + 256);
    userId = buf.readBigUInt64BE(258);
    isBot = !!buf.readUInt8(266);
  } else {
    throw new Error(
      `Panjang session gak dikenali (${buf.length} bytes) — mungkin format Pyrogram versi lain, atau string-nya kepotong/salah copy.`
    );
  }
  return { dcId, authKey, userId: userId.toString(), isBot };
}

async function convertAndVerify(pyroSessionStr) {
  const { dcId, authKey, userId, isBot } = decodePyrogramSession(pyroSessionStr);
  const ip = DC_IPS[dcId];
  if (!ip) throw new Error(`DC ${dcId} gak dikenal di tabel IP`);

  console.log(`[info] Terdeteksi: user_id=${userId}, is_bot=${isBot}, dc=${dcId}`);

  const session = new StringSession("");
  const ak = new AuthKey();
  await ak.setKey(authKey);
  session.setDC(dcId, ip, 443);
  session.setAuthKey(ak, dcId);

  const gramjsSessionStr = session.save();

  if (!API_ID || !API_HASH) {
    console.log(
      "[warn] TG_API_ID/TG_API_HASH belum di-set, skip verifikasi getMe(). Hasil konversi tetap dicetak di bawah, tapi belum tervalidasi."
    );
    return gramjsSessionStr;
  }

  // Verify: actually connect and check the session works
  const client = new TelegramClient(new StringSession(gramjsSessionStr), API_ID, API_HASH, {
    connectionRetries: 3,
  });
  await client.connect();
  const me = await client.getMe();
  console.log(`[ok] Berhasil connect sebagai: ${me.firstName || ""} (@${me.username || "-"})`);
  await client.disconnect();

  return gramjsSessionStr;
}

if (require.main === module) {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: node pyrogram-to-gramjs.js <pyrogram_session_string>");
    process.exit(1);
  }
  convertAndVerify(input)
    .then((s) => {
      console.log("\n=== GramJS session string (pakai ini di accounts.json) ===");
      console.log(s);
    })
    .catch((e) => {
      console.error("[error]", e.message);
      process.exit(1);
    });
}

module.exports = { convertAndVerify, decodePyrogramSession };
