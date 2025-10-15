/* global io, window */
const socket = io();
const appData = window.APP || {};
const name = appData.name || "";
const room = appData.room || "";
socket.emit("join", { name: name, room: room, role: "client" });

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("message");
const sendBtn = document.getElementById("send");

sendBtn.addEventListener("click", () => {
  send();
});
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") send();
});

socket.on("message", (d) => {
  const roleLabel = d.role ? " (" + d.role + ")" : "";
  append(d.name + roleLabel + ": " + d.text);
});
socket.on("system", (d) => {
  append("[시스템] " + d.text);
});

function send() {
  const v = (inputEl.value || "").trim();
  if (!v) return;
  socket.emit("client_message", v);
  inputEl.value = "";
}

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
