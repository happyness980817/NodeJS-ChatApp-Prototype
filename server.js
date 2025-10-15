import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views")); // ./views 폴더 사용
app.use(express.urlencoded({ extended: true })); // form POST 파싱
app.use(express.static(path.join(__dirname, "public"))); // 정적 파일

app.get("/", (_, res) => {
  res.render("index", {
    title: "상담 플랫폼 – 시작하기",
  });
});

app.post("/enter", (req, res) => {
  const { role, name, room } = req.body;
  if (!role || !name || !room) return res.status(400).send("필수값 누락");
  if (role === "client") {
    return res.render("client", { name, room, title: `내담자 - ${room}` });
  }
  return res.render("counselor", { name, room, title: `상담사 - ${room}` });
});

// --- 메모리 상태 ---
const rooms = Object.create(null);
function ensureRoom(room) {
  if (!rooms[room]) rooms[room] = { history: [] };
  return rooms[room];
}
function getCounselorsInRoom(room) {
  const roomSet = io.sockets.adapter.rooms.get(room);
  if (!roomSet) return [];
  const ids = [];
  for (const id of roomSet) {
    const s = io.sockets.sockets.get(id);
    if (s?.data?.role === "counselor") ids.push(id);
  }
  return ids;
}

// --- 소켓 ---
io.on("connection", (socket) => {
  socket.on("join", ({ name, room, role }) => {
    if (!name || !room || !role) return;
    socket.data = { name, room, role };
    socket.join(room);
    if (!rooms[room]) rooms[room] = { history: [] };
    io.to(room)
      .to(getCounselorsInRoom(room))
      .emit("system", { text: `${name}님(${role})이 입장했습니다.` });
  });

  // 내담자 메시지 → AI 초안(상담사 전용)
  socket.on("client_message", async (text) => {
    const { name, room, role } = socket.data || {};
    if (role !== "client" || !room || !text) return;

    // 본 채팅 브로드캐스트
    io.to(room).emit("message", { name, role: "client", text, ts: Date.now() });
    ensureRoom(room).history.push({ role: "client", text, ts: Date.now() });
    ensureRoom(room).lastClientText = text;

    try {
      const response = await openai.responses.create({
        model: "gpt-5",
        input: [
          {
            role: "system",
            content:
              // --- Byron Katie’s Four Questions 기반 지침 ---
              "당신은 바이런 케이티의 ‘네 가지 질문(The Work)’ 접근을 따르는 심리상담 보조자입니다. " +
              "항상 공감적이고 비판단적이며, 내담자의 믿음·생각에 대해 다음 순서를 참고하여 짧고 명료하게 한국어로 응답하세요.\n" +
              "1) 그것이 사실인가요?\n" +
              "2) 그것이 절대적으로 사실이라고 확신할 수 있나요?\n" +
              "3) 그 생각을 믿을 때 당신은 어떻게 반응하나요? 어떤 감정/신체 감각/행동이 따라오나요?\n" +
              "4) 그 생각이 없다면 당신은 누구인가요? 혹은 그 상황을 어떻게 다르게 볼 수 있나요?\n" +
              "• 한 번에 모든 질문을 다 하려 하기보다, 맥락에 맞게 2~4문장으로 다음 탐색을 제안하세요.\n" +
              "• 자/타해 위험 징후가 보이면 즉시 안전을 우선하고 지역의 전문기관/긴급 도움 안내를 권하세요.\n" +
              "• 진단 단정·의학적 처방·법률 자문은 피하세요.",
          },
          {
            role: "user",
            content:
              `내담자 메시지: """${text}"""\n` +
              "위 접근을 바탕으로, 상담사가 내담자에게 그대로 전송할 수 있는 한국어 응답 초안을 2~4문장으로 작성하세요.",
          },
        ],
      });

      const draft = response.output_text || "(응답 생성 실패)";
      io.to(getCounselorsInRoom(room)).emit("ai_draft", {
        text: draft,
        ts: Date.now(),
      });
      ensureRoom(room).history.push({
        role: "ai",
        text: draft,
        ts: Date.now(),
      });
    } catch (err) {
      io.to(getCounselorsInRoom(room)).emit("ai_error", {
        message: "AI 응답 생성 중 오류가 발생했습니다.",
      });
      console.error(err);
    }
  });

  // 상담사 → 수정 지시
  socket.on("counselor_refine", async ({ instruction }) => {
    const { name, room, role } = socket.data || {};
    if (role !== "counselor" || !room || !instruction) return;

    const lastClientText = ensureRoom(room).lastClientText || "";
    try {
      const response = await openai.responses.create({
        model: "gpt-5",
        input: [
          {
            role: "system",
            content:
              "당신은 ‘바이런 케이티 네 가지 질문’ 접근을 따르는 상담 보조자입니다. 상담사의 피드백을 반영해 " +
              "내담자 메시지에 대한 더 나은 한국어 답안을 2~4문장으로 제시하세요. 자/타해 위험 시 안전 안내를 우선하세요.",
          },
          {
            role: "user",
            content:
              `내담자 메시지: """${lastClientText}"""\n` +
              `상담사 지시: """${instruction}""" \n` +
              "위 철학을 유지하며 답안을 개선해 주세요.",
          },
        ],
      });

      const revised = response.output_text || "(수정 실패)";
      io.to(getCounselorsInRoom(room)).emit("ai_draft", {
        text: revised,
        ts: Date.now(),
        revisedBy: name,
      });
      ensureRoom(room).history.push({
        role: "ai",
        text: revised,
        ts: Date.now(),
      });
    } catch (err) {
      io.to(getCounselorsInRoom(room)).emit("ai_error", {
        message: "AI 수정 중 오류가 발생했습니다.",
      });
      console.error(err);
    }
  });

  // 상담사 → 본 채팅으로 최종 전송
  socket.on("counselor_send_final", (text) => {
    const { name, room, role } = socket.data || {};
    if (role !== "counselor" || !room || !text) return;
    io.to(room).emit("message", {
      name,
      role: "counselor",
      text,
      ts: Date.now(),
    });
    ensureRoom(room).history.push({ role: "counselor", text, ts: Date.now() });
  });

  socket.on("disconnect", () => {
    const { name, room, role } = socket.data || {};
    if (room && name) {
      io.to(room)
        .to(getCounselorsInRoom(room))
        .emit("system", { text: `${name}님(${role})이 퇴장했습니다.` });
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`http://localhost:${PORT}`));
