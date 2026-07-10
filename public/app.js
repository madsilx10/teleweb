let activeLabel = null;

const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request gagal");
  return data;
}

async function refreshAccounts() {
  const accounts = await api("/api/accounts");
  const box = $("accountList");
  box.innerHTML = "";
  accounts.forEach((acc) => {
    const div = document.createElement("div");
    div.className = "accItem" + (acc.label === activeLabel ? " active" : "");
    div.innerHTML = `<span>${acc.label} (${acc.phone})</span><span class="del" data-label="${acc.label}">✕</span>`;
    div.onclick = (e) => {
      if (e.target.classList.contains("del")) return;
      activeLabel = acc.label;
      $("activeAccountLabel").textContent = `Akun aktif: ${acc.label}`;
      refreshAccounts();
      loadOfficialChat();
    };
    div.querySelector(".del").onclick = async (e) => {
      e.stopPropagation();
      await api(`/api/accounts/${acc.label}`, { method: "DELETE" });
      if (activeLabel === acc.label) activeLabel = null;
      refreshAccounts();
    };
    box.appendChild(div);
  });
}

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

$("btnImportPyrogram").onclick = async () => {
  const label = $("pyroLabel").value.trim();
  const pyrogramSession = $("pyroSession").value.trim();
  if (!label || !pyrogramSession) return alert("Isi label & session string dulu");
  $("loginStatus").textContent = "Mengonversi & verifikasi session...";
  try {
    const result = await api("/api/login/import-pyrogram", {
      method: "POST",
      body: JSON.stringify({ label, pyrogramSession }),
    });
    $("loginStatus").textContent = `Berhasil! Login sebagai @${result.username || result.firstName || result.userId}`;
    $("pyroLabel").value = "";
    $("pyroSession").value = "";
    refreshAccounts();
  } catch (e) {
    $("loginStatus").textContent = "Error: " + e.message;
  }
};

$("btnSendCode").onclick = async () => {
  const label = $("loginLabel").value.trim();
  const phone = $("loginPhone").value.trim();
  if (!label || !phone) return alert("Isi label & no HP dulu");
  $("loginStatus").textContent = "Mengirim kode...";
  try {
    await api("/api/login/send-code", {
      method: "POST",
      body: JSON.stringify({ label, phone }),
    });
    $("codeBox").classList.remove("hidden");
    $("loginStatus").textContent = "Kode terkirim, cek Telegram/SMS";
  } catch (e) {
    $("loginStatus").textContent = "Error: " + e.message;
  }
};

$("btnVerifyCode").onclick = async () => {
  const label = $("loginLabel").value.trim();
  const code = $("loginCode").value.trim();
  try {
    const result = await api("/api/login/verify-code", {
      method: "POST",
      body: JSON.stringify({ label, code }),
    });
    if (result.needPassword) {
      $("passBox").classList.remove("hidden");
      $("loginStatus").textContent = "Butuh password 2FA";
    } else {
      $("loginStatus").textContent = "Login berhasil!";
      resetLoginForm();
      refreshAccounts();
    }
  } catch (e) {
    $("loginStatus").textContent = "Error: " + e.message;
  }
};

$("btnVerifyPassword").onclick = async () => {
  const label = $("loginLabel").value.trim();
  const password = $("loginPassword").value.trim();
  try {
    await api("/api/login/verify-password", {
      method: "POST",
      body: JSON.stringify({ label, password }),
    });
    $("loginStatus").textContent = "Login berhasil!";
    resetLoginForm();
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

// Lightweight default: only fetch messages from Telegram's official service chat.
// Much faster than loading the full dialog list.
async function loadOfficialChat() {
  if (!activeLabel) return;
  $("chatList").classList.add("hidden");
  try {
    const messages = await api(`/api/chats/${activeLabel}/official`);
    renderMessages(messages);
  } catch (e) {
    alert("Error: " + e.message);
  }
}

// Opt-in: full dialog list, only fetched when the user explicitly asks for it
async function loadChats() {
  if (!activeLabel) return;
  const chats = await api(`/api/chats/${activeLabel}`);
  const box = $("chatList");
  box.classList.remove("hidden");
  box.innerHTML = "";
  chats.forEach((c) => {
    const div = document.createElement("div");
    div.className = "chatItem";
    div.textContent = `${c.name}${c.unreadCount ? ` (${c.unreadCount})` : ""}`;
    div.onclick = () => loadMessages(c.name);
    box.appendChild(div);
  });
}

$("btnShowAllChats").onclick = () => {
  if (!activeLabel) return alert("Pilih akun dulu");
  loadChats();
};

function renderMessages(messages) {
  const view = $("messageView");
  view.innerHTML = "";
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

async function loadMessages(usernameOrId) {
  if (!activeLabel) return;
  try {
    const messages = await api(
      `/api/messages/${activeLabel}?username=${encodeURIComponent(usernameOrId)}&limit=50`
    );
    renderMessages(messages);
  } catch (e) {
    alert("Error: " + e.message);
  }
}

$("btnLoadUserChat").onclick = () => {
  const username = $("usernameInput").value.trim();
  if (!username) return;
  loadMessages(username);
};

refreshAccounts();
