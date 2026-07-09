/* app.js — منطق صفحه چت آنتانو (چندمدلی + فایل + میکروفون + جستجوی وب + صدا) */

const $ = s => document.querySelector(s);
const msgsEl = $("#messages");
const inputEl = $("#input");
const sendBtn = $("#send");
const convListEl = $("#convList");

let currentConv = null;
let sending = false;
let attachments = [];              // فایل‌های پیوست: {id, filename}
let webOn = false;                 // جستجوی وب
let researchOn = false;            // تحقیق گروهی
let abortCtrl = null;              // کنترل توقف استریم
let models = [];                   // فهرست مدل‌ها از سرور
let selected = JSON.parse(localStorage.getItem("antanu_models") || '["auto"]');

marked.setOptions({ breaks: true, gfm: true });

const WELCOME_HTML = `
  <div id="welcome">
    <img src="/static/logo.png" class="logo-lg" alt="ANTANU" width="110" height="110" style="width:110px;height:110px;border-radius:50%">
    <h2>سلام! من آنتانو هستم</h2>
    <p>دستیار هوشمند فارسی‌زبان شما. سؤال بپرسید، فایل بفرستید،
    با میکروفون صحبت کنید یا چند هوش مصنوعی را همزمان به کار بگیرید.<br>
    برای ذخیره در حافظه بنویسید: <b>save\\ متن</b></p>
  </div>`;

/* ---------- ابزارها ---------- */

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function renderMD(text) { return DOMPurify.sanitize(marked.parse(text || "")); }

let toastTimer = null;
function toast(msg) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}
function el(html) { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }

/* ---------- انتخابگر مدل‌ها ---------- */

async function loadModels() {
  const r = await fetch("/api/models");
  if (!r.ok) return;
  models = await r.json();
  const list = $("#modelList");
  list.innerHTML = "";
  // اگر انتخاب ذخیره‌شده معتبر نیست، برگرد به پیش‌فرض
  selected = selected.filter(id => models.some(m => m.id === id));
  if (!selected.length) selected = [models[0].id];

  models.forEach(m => {
    const item = el(`<label class="model-item">
      <input type="checkbox" value="${m.id}" ${selected.includes(m.id) ? "checked" : ""}> ${escapeHtml(m.name)}
    </label>`);
    list.appendChild(item);
  });
  updateModelUI();
}

function updateModelUI() {
  localStorage.setItem("antanu_models", JSON.stringify(selected));
  const label = $("#modelLabel");
  if (selected.length === models.length && models.length > 1) label.textContent = `همه (${models.length} مدل)`;
  else if (selected.length === 1) label.textContent = models.find(m => m.id === selected[0])?.name || "مدل";
  else label.textContent = `${selected.length} مدل انتخاب شده`;
  $("#modelAll").checked = selected.length === models.length;
}

$("#modelBtn").addEventListener("click", e => {
  e.stopPropagation();
  $("#modelPanel").classList.toggle("show");
});
document.addEventListener("click", e => {
  if (!e.target.closest(".model-wrap")) $("#modelPanel").classList.remove("show");
});
$("#modelPanel").addEventListener("change", e => {
  if (e.target.id === "modelAll") {
    selected = e.target.checked ? models.map(m => m.id) : [models[0].id];
    document.querySelectorAll("#modelList input").forEach(i => (i.checked = selected.includes(i.value)));
  } else if (e.target.value) {
    selected = [...document.querySelectorAll("#modelList input:checked")].map(i => i.value);
    if (!selected.length) { selected = [models[0].id]; e.target.checked = e.target.value === models[0].id; }
  }
  updateModelUI();
});

/* ---------- پیوست فایل ---------- */

$("#attachBtn").addEventListener("click", () => $("#fileInput").click());

$("#fileInput").addEventListener("change", async e => {
  for (const file of e.target.files) {
    const chip = el(`<span class="chip">⏳ ${escapeHtml(file.name)}</span>`);
    $("#chips").appendChild(chip);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        chip.remove();
        toast(err.detail || "خطا در آپلود فایل");
        continue;
      }
      const data = await r.json();
      attachments.push({ id: data.id, filename: data.filename });
      chip.innerHTML = `📎 ${escapeHtml(data.filename)} <b class="x">✕</b>`;
      chip.querySelector(".x").addEventListener("click", () => {
        attachments = attachments.filter(a => a.id !== data.id);
        chip.remove();
      });
    } catch { chip.remove(); toast("خطا در آپلود فایل"); }
  }
  e.target.value = "";
});

function clearChips() { attachments = []; $("#chips").innerHTML = ""; }

/* ---------- جستجوی وب ---------- */

$("#webBtn").addEventListener("click", () => {
  webOn = !webOn;
  $("#webBtn").classList.toggle("on", webOn);
  toast(webOn ? "جستجوی وب روشن شد 🌐" : "جستجوی وب خاموش شد");
});

/* ---------- میکروفون (تبدیل گفتار به متن) ---------- */

let recog = null, recording = false;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

$("#micBtn").addEventListener("click", () => {
  if (!SR) { toast("مرورگر شما میکروفون را پشتیبانی نمی‌کند (از Chrome استفاده کنید)"); return; }
  if (recording) { recog.stop(); return; }
  recog = new SR();
  recog.lang = "fa-IR";
  recog.interimResults = true;
  recog.continuous = true;
  let base = inputEl.value;
  recog.onresult = ev => {
    let text = "";
    for (const res of ev.results) text += res[0].transcript;
    inputEl.value = (base ? base + " " : "") + text;
    autosize();
  };
  recog.onstart = () => { recording = true; $("#micBtn").classList.add("rec"); toast("در حال شنیدن… دوباره بزنید تا متوقف شود"); };
  recog.onend = () => { recording = false; $("#micBtn").classList.remove("rec"); };
  recog.onerror = () => { recording = false; $("#micBtn").classList.remove("rec"); };
  recog.start();
});

/* ---------- خواندن پاسخ با صدا ---------- */

let speaking = false;
function speak(text) {
  if (!window.speechSynthesis) { toast("مرورگر شما پخش صدا را پشتیبانی نمی‌کند"); return; }
  if (speaking) { speechSynthesis.cancel(); speaking = false; return; }
  const plain = text.replace(/[#*_`>\[\]()-]/g, " ").replace(/\s+/g, " ").trim();
  const u = new SpeechSynthesisUtterance(plain.slice(0, 2000));
  u.lang = "fa-IR";
  const fa = speechSynthesis.getVoices().find(v => v.lang.startsWith("fa"));
  if (fa) u.voice = fa;
  u.onend = () => (speaking = false);
  speaking = true;
  speechSynthesis.speak(u);
}

/* ---------- نمایش پیام‌ها ---------- */

function addMsg(role, content) {
  const w = $("#welcome");
  if (w) w.remove();

  const isUser = role === "user";
  const div = el(`
    <div class="msg ${role}">
      <div class="avatar">${isUser ? "👤" : `<img src="/static/logo.png" alt="" style="width:100%;height:100%;border-radius:9px;object-fit:cover">`}</div>
      <div class="bubble">
        <div class="md"></div>
        <div class="actions">
          <button class="act copy">📋 کپی</button>
          <button class="act share">↗️ اشتراک‌گذاری</button>
          ${isUser ? "" : '<button class="act voice">🔊 خواندن</button><button class="act export">📄 خروجی</button>'}
        </div>
      </div>
    </div>`);

  div.dataset.raw = content;
  const md = div.querySelector(".md");
  if (isUser) md.textContent = content;
  else md.innerHTML = renderMD(content);

  msgsEl.appendChild(div);
  msgsEl.scrollTop = msgsEl.scrollHeight;
  return div;
}

msgsEl.addEventListener("click", async e => {
  const msg = e.target.closest(".msg");
  if (!msg) return;
  const raw = msg.dataset.raw || "";

  if (e.target.classList.contains("copy")) {
    try { await navigator.clipboard.writeText(raw); toast("متن کپی شد ✅"); }
    catch { toast("کپی انجام نشد"); }
  }
  if (e.target.classList.contains("share")) {
    if (navigator.share) { try { await navigator.share({ title: "پاسخ آنتانو", text: raw }); } catch {} }
    else { try { await navigator.clipboard.writeText(raw); toast("متن کپی شد؛ در رسانه موردنظر جای‌گذاری کنید"); } catch {} }
  }
  if (e.target.classList.contains("voice")) speak(raw);
  if (e.target.classList.contains("export")) openDocOverlay("export", raw, msg);
});

/* ---------- لیست گفتگوها ---------- */

async function loadConvs() {
  const r = await fetch("/api/conversations");
  if (r.status === 401) { location.href = "/login"; return; }
  const list = await r.json();
  convListEl.innerHTML = "";
  list.forEach(c => {
    const item = el(`
      <div class="conv ${c.id === currentConv ? "active" : ""}" data-id="${c.id}">
        <span class="t">${escapeHtml(c.title || "گفتگوی بدون عنوان")}</span>
        <button class="del" title="حذف گفتگو">🗑</button>
      </div>`);
    convListEl.appendChild(item);
  });
}

convListEl.addEventListener("click", async e => {
  const item = e.target.closest(".conv");
  if (!item) return;
  const id = Number(item.dataset.id);
  if (e.target.classList.contains("del")) {
    if (confirm("این گفتگو برای همیشه حذف شود؟")) {
      await fetch("/api/conversations/" + id, { method: "DELETE" });
      if (currentConv === id) { currentConv = null; msgsEl.innerHTML = WELCOME_HTML; }
      loadConvs();
    }
    return;
  }
  openConv(id);
});

async function openConv(id) {
  currentConv = id;
  const r = await fetch(`/api/conversations/${id}/messages`);
  if (!r.ok) return;
  const msgs = await r.json();
  msgsEl.innerHTML = "";
  msgs.forEach(m => addMsg(m.role, m.content));
  msgsEl.scrollTop = msgsEl.scrollHeight;
  loadConvs();
  closeSidebar();
}

$("#newChat").addEventListener("click", () => {
  currentConv = null;
  msgsEl.innerHTML = WELCOME_HTML;
  loadConvs();
  closeSidebar();
  inputEl.focus();
});

/* ---------- ارسال پیام و دریافت استریم ---------- */

async function send() {
  if (sending) return;
  const text = inputEl.value.trim();
  if (!text) return;

  sending = true;
  sendBtn.disabled = true;
  inputEl.value = "";
  autosize();

  let displayText = text;
  if (attachments.length) displayText += "\n📎 " + attachments.map(a => a.filename).join("، ");
  if (webOn) displayText += "\n🌐 با جستجوی وب";
  addMsg("user", displayText);

  const payload = {
    conversation_id: currentConv,
    message: text,
    models: selected,
    web: webOn,
    research: researchOn,
    attachments: attachments.map(a => a.id),
  };
  clearChips();

  const aDiv = addMsg("assistant", "");
  const mdEl = aDiv.querySelector(".md");
  mdEl.innerHTML = '<span class="typing">آنتانو در حال فکر کردن است</span>';

  abortCtrl = new AbortController();
  setStopMode(true);

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: abortCtrl.signal,
    });

    if (resp.status === 401) { location.href = "/login"; return; }
    if (!resp.ok) {
      const e2 = await resp.json().catch(() => ({}));
      const msg = "⚠️ " + (e2.detail || "خطایی رخ داد.");
      mdEl.innerHTML = renderMD(msg);
      aDiv.dataset.raw = msg;
      return;
    }

    const isNew = !currentConv;
    const cid = resp.headers.get("X-Conversation-Id");
    if (cid) currentConv = Number(cid);

    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      full += dec.decode(value, { stream: true });
      mdEl.innerHTML = renderMD(full);
      aDiv.dataset.raw = full;
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
    if (isNew) loadConvs();
  } catch (err) {
    if (err.name === "AbortError") {
      const cur = aDiv.dataset.raw || "";
      aDiv.dataset.raw = cur + "\n\n⏹ متوقف شد.";
      mdEl.innerHTML = renderMD(aDiv.dataset.raw);
    } else {
      mdEl.innerHTML = renderMD("⚠️ ارتباط با سرور قطع شد. دوباره تلاش کنید.");
    }
  } finally {
    sending = false;
    abortCtrl = null;
    setStopMode(false);
    inputEl.focus();
  }
}

sendBtn.addEventListener("click", () => {
  if (sending) { stopStreaming(); return; }
  send();
});
inputEl.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});

function autosize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + "px";
}

function setStopMode(on) {
  if (on) {
    sendBtn.innerHTML = "■";
    sendBtn.title = "توقف";
    sendBtn.classList.add("stop");
    sendBtn.disabled = false;
  } else {
    sendBtn.innerHTML = "➤";
    sendBtn.title = "ارسال";
    sendBtn.classList.remove("stop");
    sendBtn.disabled = false;
  }
}

function stopStreaming() {
  if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
}
inputEl.addEventListener("input", autosize);

/* ---------- پنجره حافظه ---------- */

$("#memBtn").addEventListener("click", async e => {
  e.preventDefault();
  const overlay = $("#memOverlay");
  const listEl = overlay.querySelector(".mem-list");
  listEl.innerHTML = '<div class="mem-empty">در حال بارگذاری…</div>';
  overlay.classList.add("show");
  const r = await fetch("/api/memories");
  const mems = await r.json();
  if (!mems.length) {
    listEl.innerHTML = '<div class="mem-empty">حافظه خالی است. با دکمه «حافظه» زیر هر پیام، مطالب مهم را ماندگار کنید.</div>';
    return;
  }
  listEl.innerHTML = "";
  mems.forEach(m => {
    const item = el(`
      <div class="mem-item" data-id="${m.id}">
        <span>${escapeHtml(m.content.length > 180 ? m.content.slice(0, 180) + "…" : m.content)}</span>
        <button title="حذف از حافظه">حذف</button>
      </div>`);
    item.querySelector("button").addEventListener("click", async () => {
      await fetch("/api/memories/" + m.id, { method: "DELETE" });
      item.remove();
      toast("از حافظه حذف شد");
    });
    listEl.appendChild(item);
  });
});

$("#memOverlay").addEventListener("click", e => {
  if (e.target.id === "memOverlay" || e.target.classList.contains("close")) {
    $("#memOverlay").classList.remove("show");
  }
});

/* ---------- منوی موبایل ---------- */

function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#sideBackdrop")?.classList.remove("show");
}
$("#menuBtn").addEventListener("click", () => {
  $("#sidebar").classList.toggle("open");
  $("#sideBackdrop")?.classList.toggle("show");
});
$("#sideBackdrop")?.addEventListener("click", closeSidebar);

/* ---------- تحقیق گروهی ---------- */

$("#researchBtn").addEventListener("click", () => {
  researchOn = !researchOn;
  $("#researchBtn").classList.toggle("on", researchOn);
  toast(researchOn
    ? "🔬 تحقیق گروهی روشن شد — همه هوش مصنوعی‌ها + جستجوی وب باهم پژوهش می‌کنند"
    : "تحقیق گروهی خاموش شد");
});

/* ---------- پنجره سند: مقاله بلند / خروجی پاسخ ---------- */

let docMode = "longdoc";
let exportContent = "";
let exportMsgEl = null;

function openDocOverlay(mode, content = "", msgEl = null) {
  docMode = mode;
  exportContent = content;
  exportMsgEl = msgEl;
  const isExport = mode === "export";
  $("#docTitle").textContent = isExport ? "📄 خروجی این پاسخ (Word / PDF)" : "📄 ساخت مقاله بلند";
  $("#topicField").style.display = isExport ? "none" : "block";
  $("#pagesField").style.display = isExport ? "none" : "block";
  $("#docHint").style.display = isExport ? "none" : "block";
  $("#docStart").textContent = isExport ? "ساخت فایل" : "شروع ساخت";
  $("#docOverlay").classList.add("show");
}

$("#docBtn").addEventListener("click", () => openDocOverlay("longdoc"));

$("#docOverlay").addEventListener("click", e => {
  if (e.target.id === "docOverlay" || e.target.classList.contains("close"))
    $("#docOverlay").classList.remove("show");
});

function docFormats() {
  const v = $("#docFormat").value;
  return v === "both" ? ["docx", "pdf"] : [v];
}

$("#docStart").addEventListener("click", async () => {
  const font = $("#docFont").value;
  const size = Number($("#docSize").value) || 14;

  if (docMode === "export") {
    $("#docOverlay").classList.remove("show");
    toast("در حال ساخت فایل…");
    const r = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: exportContent, font, size, formats: docFormats() }),
    });
    if (!r.ok) { toast("خطا در ساخت فایل"); return; }
    const data = await r.json();
    if (exportMsgEl) {
      const box = document.createElement("div");
      box.className = "dl-links";
      data.files.forEach(f => {
        const a = document.createElement("a");
        a.href = f.url; a.textContent = f.label; a.className = "dl-link";
        box.appendChild(a);
      });
      (data.notes || []).forEach(n => {
        const s = document.createElement("span");
        s.className = "dl-note"; s.textContent = "⚠️ " + n;
        box.appendChild(s);
      });
      exportMsgEl.querySelector(".bubble").appendChild(box);
    }
    toast("فایل آماده شد ✅");
    return;
  }

  // مقاله بلند
  const topic = $("#docTopic").value.trim();
  if (!topic) { toast("موضوع مقاله را بنویسید"); return; }
  const pages = Number($("#docPages").value) || 10;
  $("#docOverlay").classList.remove("show");

  currentConv = null;
  addMsg("user", `📄 درخواست مقاله ${pages} صفحه‌ای: ${topic}`);
  const aDiv = addMsg("assistant", "");
  const mdEl = aDiv.querySelector(".md");
  mdEl.innerHTML = '<span class="typing">شروع ساخت مقاله</span>';

  abortCtrl = new AbortController();
  sending = true;
  setStopMode(true);

  try {
    const resp = await fetch("/api/longdoc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, pages, font, size, formats: docFormats() }),
      signal: abortCtrl.signal,
    });
    if (!resp.ok) {
      const e2 = await resp.json().catch(() => ({}));
      mdEl.innerHTML = renderMD("⚠️ " + (e2.detail || "خطا"));
      return;
    }
    const cid = resp.headers.get("X-Conversation-Id");
    if (cid) currentConv = Number(cid);
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      full += dec.decode(value, { stream: true });
      mdEl.innerHTML = renderMD(full);
      aDiv.dataset.raw = full;
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
    loadConvs();
  } catch (err) {
    if (err.name === "AbortError") {
      const cur = aDiv.dataset.raw || "";
      mdEl.innerHTML = renderMD(cur + "\n\n⏹ ساخت مقاله متوقف شد.");
    } else {
      mdEl.innerHTML = renderMD("⚠️ ارتباط قطع شد.");
    }
  } finally {
    sending = false;
    abortCtrl = null;
    setStopMode(false);
  }
});

/* ---------- شروع ---------- */
loadConvs();
loadModels();
if (window.speechSynthesis) speechSynthesis.getVoices();
inputEl.focus();
