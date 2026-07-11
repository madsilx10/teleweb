let activeLabel = null;
let pendingLoginKey = null;

const $ = (id) => document.getElementById(id);

async function api(path, opts = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      ...opts,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request gagal");
    return data;
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error("Timeout — koneksi ke akun ini kelamaan, coba lagi");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Drawer (mobile slide-in panel) ---------- */
function openDrawer() {
  $("drawer").classList.add("open");
  $("drawerOverlay").classList.remove("hidden");
}
function closeDrawer() {
  $("drawer").classList.remove("open");
  $("drawerOverlay").classList.add("hidden");
}
$("btnDrawerToggle").onclick = openDrawer;
$("btnDrawerClose").onclick = closeDrawer;
$("drawerOverlay").onclick = closeDrawer;

/* ---------- Accounts ---------- */
async function refreshAccounts() {
  const accounts = await api("/api/accounts");
  const box = $("accountList");
  box.innerHTML = "";
  if (accounts.length === 0) {
    box.innerHTML = `<div class="statusText">Belum ada akun. Tambah dulu di bawah.</div>`;
  }
  accounts.forEach((acc) => {
    const div = document.createElement("div");
    div.className = "accItem" + (acc.label === activeLabel ? " active" : "");
    const initial = acc.label.charAt(0).toUpperCase();
    div.innerHTML = `
      <div class="accInfo">
        <div class="avatar">${initial}<span class="dot ${acc.connected ? "online" : ""}"></span></div>
        <div>
          <div class="accLabel">${acc.label}${acc.username ? ` <span class="accUsername">@${acc.username}</span>` : ""}</div>
          <div class="accPhoneRow">
            <span class="accPhone">${acc.phone}</span>
            <button class="copyBtn" data-phone="${acc.phone}" title="Copy nomor">⧉</button>
          </div>
        </div>
      </div>
      <span class="del" data-label="${acc.label}">✕</span>
    `;
    div.querySelector(".copyBtn").onclick = async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(btn.dataset.phone);
        btn.textContent = "✓";
        setTimeout(() => (btn.textContent = "⧉"), 1200);
      } catch {
        alert("Gagal copy, nomor: " + btn.dataset.phone);
      }
    };
    div.onclick = (e) => {
      if (e.target.classList.contains("del")) return;
      activeLabel = acc.label;
      $("activeAccountLabel").textContent = acc.label;
      refreshAccounts();
      showChatEntry();
      closeDrawer();
    };
    div.querySelector(".del").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Hapus akun "${acc.label}"?`)) return;
      await api(`/api/accounts/${acc.label}`, { method: "DELETE" });
      if (activeLabel === acc.label) {
        activeLabel = null;
        $("activeAccountLabel").textContent = "no account";
        $("messageView").innerHTML = `<div class="emptyState"><span class="prompt">›</span> Pilih atau tambah akun buat mulai</div>`;
      }
      refreshAccounts();
    };
    box.appendChild(div);
  });
}

/* ---------- Add account / login ---------- */
$("btnAddAccount").onclick = () => {
  $("loginBox").classList.toggle("hidden");
};

$("tabPhone").onclick = () => {
  $("tabPhone").classList.add("active");
  $("tabPyrogram").classList.remove("active");
  $("phoneLoginPanel").classList.remove("hidden");
  $("pyrogramPanel").classList.add("hidden");
};
$("tabPyrogram").onclick = () => {
  $("tabPyrogram").classList.add("active");
  $("tabPhone").classList.remove("active");
  $("pyrogramPanel").classList.remove("hidden");
  $("phoneLoginPanel").classList.add("hidden");
};

$("btnSendCode").onclick = async () => {
  const label = $("loginLabel").value.trim();
  const phone = $("loginPhone").value.trim();
  if (!phone) return alert("Isi no HP dulu");
  $("loginStatus").textContent = "Mengirim kode...";
  try {
    const result = await api("/api/login/send-code", {
      method: "POST",
      body: JSON.stringify({ label, phone }),
    });
    pendingLoginKey = result.key;
    $("codeBox").classList.remove("hidden");
    $("loginStatus").textContent = "Kode terkirim, cek Telegram/SMS";
  } catch (e) {
    $("loginStatus").textContent = "Error: " + e.message;
  }
};

$("btnVerifyCode").onclick = async () => {
  const code = $("loginCode").value.trim();
  try {
    const result = await api("/api/login/verify-code", {
      method: "POST",
      body: JSON.stringify({ key: pendingLoginKey, code }),
    });
    if (result.needPassword) {
      $("passBox").classList.remove("hidden");
      $("loginStatus").textContent = "Butuh password 2FA";
    } else {
      $("loginStatus").textContent = `Login berhasil sebagai ${result.label}!`;
      resetLoginForm();
      refreshAccounts();
    }
  } catch (e) {
    $("loginStatus").textContent = "Error: " + e.message;
  }
};

$("btnVerifyPassword").onclick = async () => {
  const password = $("loginPassword").value.trim();
  try {
    const result = await api("/api/login/verify-password", {
      method: "POST",
      body: JSON.stringify({ key: pendingLoginKey, password }),
    });
    $("loginStatus").textContent = `Login berhasil sebagai ${result.label}!`;
    resetLoginForm();
    refreshAccounts();
  } catch (e) {
    $("loginStatus").textContent = "Error: " + e.message;
  }
};

$("btnImportPyrogram").onclick = async () => {
  const label = $("pyroLabel").value.trim();
  const pyrogramSession = $("pyroSession").value.trim();
  if (!pyrogramSession) return alert("Isi session string dulu");
  $("loginStatus").textContent = "Mengonversi & verifikasi session...";
  try {
    const result = await api("/api/login/import-pyrogram", {
      method: "POST",
      body: JSON.stringify({ label, pyrogramSession }),
    });
    $("loginStatus").textContent = `Berhasil! Login sebagai ${result.label}`;
    $("pyroLabel").value = "";
    $("pyroSession").value = "";
    refreshAccounts();
  } catch (e) {
    $("loginStatus").textContent = "Error: " + e.message;
  }
};

function resetLoginForm() {
  $("loginBox").classList.add("hidden");
  $("codeBox").classList.add("hidden");
  $("passBox").classList.add("hidden");
  $("loginLabel").value = "";
  $("loginPhone").value = "";
  $("loginCode").value = "";
  $("loginPassword").value = "";
}

/* ---------- Chats & messages ---------- */
function renderMessages(messages) {
  const view = $("messageView");
  view.innerHTML = "";
  if (messages.length === 0) {
    view.innerHTML = `<div class="emptyState"><span class="prompt">›</span> Belum ada pesan di sini</div>`;
    return;
  }
  messages.forEach((m) => {
    const div = document.createElement("div");
    div.className = "msg" + (m.out ? " out" : "");
    div.innerHTML = `${m.text || "(media/no text)"}<div class="meta">${new Date(
      m.date * 1000
    ).toLocaleString()}</div>`;
    view.appendChild(div);
  });
  view.scrollTop = view.scrollHeight;
}

// Shows a single chat bubble ("Telegram") — messages only load when tapped.
async function showChatEntry() {
  const box = $("chatList");
  box.classList.remove("collapsed");
  box.innerHTML = "";

  const div = document.createElement("div");
  div.className = "chatItem";
  div.innerHTML = `
    <div class="avatar">T</div>
    <div class="chatMeta">
      <span>Telegram</span>
      <span class="chatSub">notifikasi resmi</span>
    </div>
  `;
  div.onclick = () => loadOfficialChat();
  box.appendChild(div);

  $("chatHeader").classList.add("hidden");
  $("messageView").innerHTML = `<div class="emptyState"><span class="prompt">›</span> Buka chat di sebelah buat lihat pesan</div>`;

  // check unread count for just this one chat (lightweight, single-peer check)
  try {
    const { unreadCount } = await api(`/api/chats/${activeLabel}/official/unread`);
    if (unreadCount > 0) {
      const badge = document.createElement("span");
      badge.className = "unreadBadge";
      badge.textContent = unreadCount;
      div.appendChild(badge);
    }
  } catch {
    // silently ignore — badge is a nice-to-have, not critical
  }
}

$("btnBack").onclick = () => showChatEntry();

async function loadOfficialChat() {
  if (!activeLabel) return;
  $("chatTitle").textContent = "Telegram";
  $("chatHeader").classList.remove("hidden");
  $("messageView").innerHTML = `<div class="emptyState"><span class="prompt">›</span> Memuat...</div>`;
  try {
    const messages = await api(`/api/chats/${activeLabel}/official`);
    renderMessages(messages);
    $("chatList").classList.add("collapsed");
  } catch (e) {
    $("messageView").innerHTML = `<div class="emptyState">Error: ${e.message}</div>`;
  }
}

async function loadMessages(usernameOrId) {
  if (!activeLabel) return;
  try {
    const messages = await api(
      `/api/messages/${activeLabel}?username=${encodeURIComponent(usernameOrId)}&limit=50`
    );
    $("chatTitle").textContent = usernameOrId;
    $("chatHeader").classList.remove("hidden");
    renderMessages(messages);
    $("chatList").classList.add("collapsed");
  } catch (e) {
    alert("Error: " + e.message);
  }
}

$("btnLoadUserChat").onclick = () => {
  const username = $("usernameInput").value.trim();
  if (!username) return;
  if (!activeLabel) return alert("Pilih akun dulu");
  loadMessages(username);
};

refreshAccounts();
