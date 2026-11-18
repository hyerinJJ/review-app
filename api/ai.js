// Vercel 서버 함수: 브라우저 대신 여기서 Claude API를 부릅니다.
// API 키는 Vercel 환경 변수 ANTHROPIC_API_KEY 에만 두고, 웹페이지에는 절대 넣지 않습니다.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // ANTHROPIC_API_KEY 를 자동으로 읽어요
const MODEL = "claude-haiku-5-5"; // 싸고 빠른 모델
const PRODUCT = "득근파티 통 닭가슴살 6종 혼합(100g, 54개)";

const NEXT_SCHEMA = {
  type: "object",
  properties: {
    covered: {
      type: "object",
      properties: {
        taste: { type: "boolean" },
        storage: { type: "boolean" },
        cons: { type: "boolean" },
      },
      required: ["taste", "storage", "cons"],
      additionalProperties: false,
    },
    question: { type: "string" },
    chips: { type: "array", items: { type: "string" } },
  },
  required: ["covered", "question", "chips"],
  additionalProperties: false,
};

const SUMMARY_SCHEMA = {
  type: "object",
  properties: { title: { type: "string" }, body: { type: "string" } },
  required: ["title", "body"],
  additionalProperties: false,
};

// 브라우저가 보낸 값은 믿지 않고 모양과 길이를 제한해요 (아무 질문이나 대신 보내는 통로가 되지 않게)
function clean(body) {
  const rating = Math.min(5, Math.max(1, Number(body?.rating) || 0)) || 0;
  const taste = ["맛있어요", "보통이에요", "별로예요"].includes(body?.taste) ? body.taste : "선택 안 함";
  const turns = (Array.isArray(body?.turns) ? body.turns : [])
    .slice(-20)
    .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .map((t) => ({ role: t.role, content: t.content.slice(0, 300) }));
  return { rating, taste, turns };
}

function convo(turns) {
  return turns.map((t) => (t.role === "user" ? "고객: " : "AI: ") + t.content).join("\n");
}

function nextPrompt({ rating, taste, turns }) {
  return `너는 온라인 쇼핑몰에서 고객이 상품 리뷰를 쉽게 쓰도록 짧게 질문하는 AI야.
상품: ${PRODUCT}
고객이 고른 별점: ${rating}/5, 맛 평가: ${taste}
목표: 리뷰에 필요한 세 가지(taste=맛, storage=조리·보관 방법이나 편의, cons=아쉬운 점)를 대화로 모은다. 별점이 5점 미만이면 아쉬운 점을 꼭 묻는다. 5점이고 고객이 아쉬운 점이 없다고 답하면 cons는 채워진 것으로 본다.
지금까지 대화:
${convo(turns)}

규칙: 질문은 한 문장, 30자 이내, 존댓말. 방금 답에 짧게 공감한 뒤 아직 안 채워진 항목만 묻는다. 이미 답한 걸 다시 묻지 않는다. 세 가지가 모두 채워졌으면 question은 "충분히 모였어요! 대화를 마쳐주세요." 로 하고 chips는 빈 배열로 한다.
chips는 다음 질문에 고객이 탭해서 바로 답할 수 있는 짧은 답 3개(각 12자 이내).`;
}

function summaryPrompt({ rating, taste, turns }) {
  return `아래는 고객과 AI의 대화야. 고객이 한 말만 근거로 ${PRODUCT} 상품 리뷰를 써줘. 없는 내용은 지어내지 마.
고객 별점 ${rating}/5, 맛 평가 ${taste}.
문체: 고객 본인이 쓴 것처럼 1인칭, "~요"체, 2~4문장, 자연스럽게. 광고 문구 금지.
title은 25자 이내 한 줄 요약.
대화:
${convo(turns)}`;
}

// think=false: 생각 없이 바로 답해서 가장 빨라요 (다음 질문용)
async function ask(prompt, schema, think) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    thinking: think ? { type: "adaptive" } : { type: "disabled" },
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw Object.assign(new Error("refused"), { status: 422 });
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "no_api_key" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const input = clean(body);
    if (!input.turns.some((t) => t.role === "user")) return res.status(400).json({ error: "no_answer" });
    if (body?.task === "next") return res.status(200).json(await ask(nextPrompt(input), NEXT_SCHEMA, false));
    if (body?.task === "summary") return res.status(200).json(await ask(summaryPrompt(input), SUMMARY_SCHEMA, true));
    return res.status(400).json({ error: "unknown_task" });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "rate_limited" });
    if (err instanceof Anthropic.AuthenticationError) return res.status(500).json({ error: "bad_api_key" });
    if (err instanceof Anthropic.APIError) return res.status(502).json({ error: "upstream_error" });
    return res.status(err.status || 500).json({ error: err.message || "server_error" });
  }
}
