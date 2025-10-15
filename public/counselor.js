/* global io, window */
const socket = io();

// 서버 렌더링으로 주입된 값
const { name = "", room = "" } = window.APP ?? {};
socket.emit("join", { name, room, role: "counselor" });

// DOM
const messagesEl = document.getElementById("messages");
const chatInputEl = document.getElementById("message");
const sendBtn = document.getElementById("send");

const draftEl = document.getElementById("draft");
const instructionEl = document.getElementById("instruction");
const refineBtn = document.getElementById("refine");
const useDraftBtn = document.getElementById("use-draft");
const aiStatusEl = document.getElementById("ai-status");

// 본 채팅 이벤트
sendBtn.addEventListener("click", () => {
  const txt = (chatInputEl.value ?? "").trim();
  if (!txt) return;
  socket.emit("counselor_send_final", txt);
  chatInputEl.value = "";
});

socket.on("message", (data) => {
  const roleLabel = data.role ? ` (${data.role})` : "";
  appendLine(`${data.name}${roleLabel}: ${data.text}`);
});
socket.on("system", (data) => appendLine(`[시스템] ${data.text}`));

// AI 드래프트(상담사 전용)
socket.on("ai_draft", (data) => {
  draftEl.textContent = data.text ?? "";
  aiStatusEl.textContent = `AI 초안 도착: ${new Date(
    data.ts ?? Date.now()
  ).toLocaleString()}`;
});
socket.on("ai_error", (err) => {
  aiStatusEl.textContent = `AI 오류: ${err?.message ?? "알 수 없는 오류"}`;
});

// 우측 패널: 수정 지시 / 초안 전송
refineBtn.addEventListener("click", () => {
  const inst = (instructionEl.value ?? "").trim();
  if (!inst) {
    alert("수정/재생성 지시를 입력해 주세요.");
    return;
  }
  aiStatusEl.textContent = "AI에 수정 지시 전송 중...";
  socket.emit("counselor_refine", { instruction: inst });
});

useDraftBtn.addEventListener("click", () => {
  const txt = (draftEl.textContent ?? "").trim();
  if (!txt) {
    alert("보낼 초안이 없습니다.");
    return;
  }
  socket.emit("counselor_send_final", txt);
});

// 공통 함수
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
