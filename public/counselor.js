/* global io, window */
const socket = io();
const appData = window.APP || {};
const name = appData.name || "";
const room = appData.room || "";
socket.emit("join", { name: name, room: room, role: "counselor" });

const messagesEl = document.getElementById("messages");
const chatInputEl = document.getElementById("message");
const sendBtn = document.getElementById("send");
const draftEl = document.getElementById("draft");
const instructionEl = document.getElementById("instruction");
const refineBtn = document.getElementById("refine");
const useDraftBtn = document.getElementById("use-draft");
const aiStatusEl = document.getElementById("ai-status");

sendBtn.addEventListener("click", () => {
  const txt = (chatInputEl.value || "").trim();
  if (!txt) return;
  socket.emit("counselor_send_final", txt);
  chatInputEl.value = "";
});

socket.on("message", (d) => {
  const roleLabel = d.role ? " (" + d.role + ")" : "";
  append(d.name + roleLabel + ": " + d.text);
});
socket.on("system", (d) => {
  append("[시스템] " + d.text);
});

socket.on("ai_draft", (d) => {
  draftEl.textContent = d && d.text ? d.text : "";
  const ts = d && d.ts ? d.ts : Date.now();
  aiStatusEl.textContent = "AI 초안 도착: " + new Date(ts).toLocaleString();
});
socket.on("ai_error", (err) => {
  const msg = err && err.message ? err.message : "알 수 없는 오류";
  aiStatusEl.textContent = "AI 오류: " + msg;
});

refineBtn.addEventListener("click", () => {
  const inst = (instructionEl.value || "").trim();
  if (!inst) {
    alert("수정/재생성 지시를 입력해 주세요.");
    return;
  }
  aiStatusEl.textContent = "AI에 수정 지시 전송 중...";
  socket.emit("counselor_refine", { instruction: inst });
});

useDraftBtn.addEventListener("click", () => {
  const txt = (draftEl.textContent || "").trim();
  if (!txt) {
    alert("보낼 초안이 없습니다.");
    return;
  }
  socket.emit("counselor_send_final", txt);
});

function append(line) {
  const html =
    '<div class="text">' +
    "<span>" +
    esc(line) +
    "</span>" +
    '<span class="muted"> ' +
    new Date().toLocaleString() +
    "</span>" +
    "</div>";
  messagesEl.insertAdjacentHTML("beforeend", html);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
