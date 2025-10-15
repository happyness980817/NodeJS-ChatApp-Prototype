/* global io, window */
const socket = io();

// 서버 렌더링으로 주입된 값
const { name = "", room = "" } = window.APP ?? {};
socket.emit("join", { name, room, role: "client" });

// DOM
const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("message");
const sendBtn = document.getElementById("send");

// 이벤트
sendBtn.addEventListener("click", () => send());
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") send();
});

socket.on("message", (data) => {
  const roleLabel = data.role ? ` (${data.role})` : "";
  appendLine(`${data.name}${roleLabel}: ${data.text}`);
});

socket.on("system", (data) => appendLine(`[시스템] ${data.text}`));

// 함수
const send = () => {
  const v = (inputEl.value ?? "").trim();
  if (!v) return;
  socket.emit("client_message", v);
  inputEl.value = "";
};

const appendLine = (line) => {
  const html = `
    <div class="text">
      <span>${escapeHtml(line)}</span>
      <span class="muted"> ${new Date().toLocaleString()}</span>
    </div>
  `;
  messagesEl.insertAdjacentHTML("beforeend", html);
  messagesEl.scrollTop = messagesEl.scrollHeight;
};

const escapeHtml = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
