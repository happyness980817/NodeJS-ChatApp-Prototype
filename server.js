import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import session from "express-session";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 세션 (개발용 기본 메모리 스토어)
// 배포 시에는 Redis 등 외부 스토어 권장, 프록시/쿠키 설정 필요
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: true,
  cookie: { sameSite: "lax" },
});
app.use(sessionMiddleware);

// Socket.IO에 세션 공유
io.engine.use((req, res, next) => {
  sessionMiddleware(req, res, next);
});

// Pug + 정적
app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// 유틸: 20자리 방 코드 생성 (A-Z, a-z, 0-9)
function generateRoomCode(len = 20) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++)
    out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// 방 상태(최소)
const rooms = Object.create(null);
function ensureRoom(room) {
  if (!rooms[room]) {
    rooms[room] = { clientId: null, counselorId: null, lastClientText: "" };
  }
  return rooms[room];
}

// 라우팅
app.get("/", (_, res) => {
  res.render("home", { title: "상담 플랫폼 – 시작하기" });
});

// 새 방 생성: 코드 1회 노출 + 세션 저장
app.post("/create", (req, res) => {
  const { role, name } = req.body;
  if (!role || !name) return res.status(400).send("필수값 누락");

  const room = generateRoomCode(20);
  ensureRoom(room);

  // 세션에 저장
  req.session.name = name;
  req.session.role = role;
  req.session.room = room;

  // 코드 1회 노출 페이지 렌더(여기서만 보여줌)
  return res.render("code", {
    title: "방 코드 안내",
    code: room,
    name,
    role,
  });
});

// 코드 참여: 세션 저장 후 /room으로 이동
app.post("/enter", (req, res) => {
  const { role, name, room } = req.body;
  if (!role || !name || !room) return res.status(400).send("필수값 누락");

  // 방 존재 보장 (없으면 생성 혹은 에러 처리 선택 가능)
  ensureRoom(room);

  // 세션에 저장
  req.session.name = name;
  req.session.role = role;
  req.session.room = room;

  return res.redirect("/room");
});

// 세션 기반 방 입장 (뷰 렌더)
app.get("/room", (req, res) => {
  const { name, role, room } = req.session;

  if (!name || !role || !room || !rooms[room]) {
    return res.redirect("/");
  }

  // 코드는 화면/타이틀에서 노출하지 않음
  if (role === "client") {
    return res.render("client", { name, room, title: "내담자" });
  }
  return res.render("counselor", { name, room, title: "상담사" });
});

// 소켓
io.on("connection", (socket) => {
  // 세션에서 사용자 상태 복원
  const sess =
    socket.request && socket.request.session ? socket.request.session : null;
  const name = sess && sess.name ? sess.name : undefined;
  const room = sess && sess.room ? sess.room : undefined;
  const role = sess && sess.role ? sess.role : undefined;

  if (name && room && role) {
    socket.data = { name, room, role };
    socket.join(room);

    const r = ensureRoom(room);
    if (role === "client") r.clientId = socket.id;
    if (role === "counselor") r.counselorId = socket.id;

    io.to(room).emit("system", {
      text: name + "님(" + role + ")이 입장했습니다.",
    });
  }

  // (호환성) 클라이언트가 기존처럼 join 이벤트를 보내도 무시하거나 세션 재확인
  socket.on("join", () => {
    // 이미 세션으로 합류 완료. 필요 시 세션 검사 후 보강만.
  });

  // 내담자 → 메시지 → 현재 턴만으로 AI 초안(상담사 전용)
  socket.on("client_message", async (text) => {
    const data = socket.data || {};
    const sName = data.name;
    const sRoom = data.room;
    const sRole = data.role;
    if (sRole !== "client" || !sRoom || !text) return;

    const r = ensureRoom(sRoom);

    // 본 채팅에 표시
    io.to(sRoom).emit("message", {
      name: sName,
      role: "client",
      text: text,
      ts: Date.now(),
    });

    // 마지막 내담자 발화 저장(상담사 재지시용)
    r.lastClientText = text;

    try {
      const resp = await openai.responses.create({
        model: "gpt-5",
        input: [
          {
            role: "system",
            content:
              "당신은 바이런 케이티의 ‘네 가지 질문(The Work)’ 접근을 따르는 심리상담 보조자입니다. " +
              "공감적·비판단적 톤으로 2~4문장 한국어 답안을 제안하세요. 자/타해 위험 시 안전을 우선하세요. " +
              "반드시 한 번의 발화에 '네 가지 질문'의 한 단계만 진행하세요. 한번에 4개의 질문을 모두 설명하지 말고, 각각을 차례차례 물어보세요.\n" +
              "\n" +
              "네 가지 질문\n" +
              "1) 그게 사실인가요?\n" +
              "2) 당신은 그 생각이 정말로 사실인지 확실히 알 수 있나요?\n" +
              "3) 그 생각을 믿을 때, 당신은 어떻게 반응하나요? (신체 반응/감정/자기·타인에 대한 태도/과거·미래 행동 등)\n" +
              "4) 그 생각이 없다면, 당신은 누구일까요? (그 생각이 사라졌을 때의 당신을 상상)\n" +
              "\n" +
              "‘뒤집어 보기’(Turnaround): 원래 문장을 다양한 방향으로 바꾸고, 그 대안도 사실일 수 있는 근거를 3가지 정도 찾습니다. 예) " +
              "자신에게로: “그는 나를 무시한다” → “나는 나를 무시한다.” / " +
              "상대에게로: “그는 나를 무시한다” → “나는 그를 무시한다.” / " +
              "반대로: “그는 나를 무시한다” → “그는 나를 존중한다.”",
          },
          {
            role: "user",
            content:
              '내담자 메시지: """' +
              text +
              '"""\n' +
              "상담사가 그대로 전송할 수 있는 한국어 응답 초안을 2~4문장으로 작성하세요.",
          },
        ],
      });

      const draft =
        resp && resp.output_text ? resp.output_text : "(응답 생성 실패)";
      if (r.counselorId) {
        io.to(r.counselorId).emit("ai_draft", { text: draft, ts: Date.now() });
      }
    } catch (err) {
      const msg = err && err.message ? err.message : "AI 응답 생성 오류";
      if (r.counselorId)
        io.to(r.counselorId).emit("ai_error", { message: msg });
      console.error(err);
    }
  });

  // 상담사 → 수정 지시(마지막 내담자 발화만 사용)
  socket.on("counselor_refine", async (payload) => {
    const data = socket.data || {};
    const sName = data.name;
    const sRoom = data.room;
    const sRole = data.role;
    const instruction =
      payload && payload.instruction ? payload.instruction : "";
    if (sRole !== "counselor" || !sRoom || !instruction) return;

    const r = ensureRoom(sRoom);
    try {
      const last = r.lastClientText || "";
      const resp = await openai.responses.create({
        model: "gpt-5",
        input: [
          {
            role: "system",
            content:
              "당신은 ‘바이런 케이티 네 가지 질문’ 접근을 따르는 상담 보조자입니다. " +
              "상담사의 피드백을 반영해 2~4문장 한국어 답안을 제시하세요. 위험 시 안전을 우선하세요.",
          },
          {
            role: "user",
            content:
              '내담자 메시지: """' +
              last +
              '"""\n' +
              '상담사 지시: """' +
              instruction +
              '"""\n' +
              "위 철학을 유지하며 답안을 개선해 주세요.",
          },
        ],
      });

      const revised =
        resp && resp.output_text ? resp.output_text : "(수정 실패)";
      if (r.counselorId) {
        io.to(r.counselorId).emit("ai_draft", {
          text: revised,
          ts: Date.now(),
          revisedBy: sName,
        });
      }
    } catch (err) {
      const msg = err && err.message ? err.message : "AI 수정 오류";
      if (r.counselorId)
        io.to(r.counselorId).emit("ai_error", { message: msg });
      console.error(err);
    }
  });

  // 상담사 → 본 채팅으로 최종 메시지 전송
  socket.on("counselor_send_final", (text) => {
    const data = socket.data || {};
    const sName = data.name;
    const sRoom = data.room;
    const sRole = data.role;
    if (sRole !== "counselor" || !sRoom || !text) return;
    io.to(sRoom).emit("message", {
      name: sName,
      role: "counselor",
      text: text,
      ts: Date.now(),
    });
  });

  socket.on("disconnect", () => {
    const data = socket.data || {};
    const sName = data.name;
    const sRoom = data.room;
    const sRole = data.role;
    if (!sRoom) return;
    const r = ensureRoom(sRoom);
    if (sRole === "client" && r.clientId === socket.id) r.clientId = null;
    if (sRole === "counselor" && r.counselorId === socket.id)
      r.counselorId = null;
    io.to(sRoom).emit("system", {
      text:
        (sName || "익명") + "님(" + (sRole || "알수없음") + ")이 퇴장했습니다.",
    });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log("http://localhost:" + PORT);
});
