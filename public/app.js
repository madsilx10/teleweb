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
    div.innerHTML = `
      <div class="accInfo">
        <span class="dot ${acc.connected ? "online" : ""}"></span>
        <div>
          <div class="accLabel">${acc.label}</div>
          <div class="accPhone">${acc.phone}</div>
        </div>
      </div>
      <span class="del" data-label="${acc.label}">✕</span>
    `;
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
function showChatEntry() {
  const box = $("chatList");
  box.classList.remove("collapsed");
  box.innerHTML = "";

  const div = document.createElement("div");
  div.className = "chatItem";
  div.innerHTML = `<span>Telegram</span>`;
  div.onclick = () => loadOfficialChat();
  box.appendChild(div);

  $("messageView").innerHTML = `<div class="emptyState"><span class="prompt">›</span> Buka chat di sebelah buat lihat pesan</div>`;
}

async function loadOfficialChat() {
  if (!activeLabel) return;
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
