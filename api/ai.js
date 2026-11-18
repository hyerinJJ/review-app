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
  const answers = turns.filter((t) => t.role === "user").length;
  return `너는 온라인 쇼핑몰에서 고객이 상품 리뷰를 쉽게 쓰도록 대화로 질문하는 AI야.
상품(참고용): ${PRODUCT}
고객이 고른 별점: ${rating}/5, 맛 평가: ${taste}
지금까지 고객 답변 수: ${answers}

목표: 다른 구매자에게 도움이 되는 리뷰를 위해 세 가지를 고객의 "실제 경험"으로 모은다.
- taste: 맛·식감이 구체적으로 어땠는지 (어떤 맛이, 어떤 식감이)
- storage: 실제로 어떻게 먹고 보관했는지 (언제, 어떻게 조리, 보관 방법과 편의)
- cons: 아쉬웠던 점. 별점이 5점 미만이면 꼭 묻는다. 고객이 "없다"고 분명히 답하면 채워진 것으로 본다.

채움 기준: 항목에 구체적인 사실이나 경험이 하나 이상 있어야 true. "맛있어요", "좋아요", "괜찮아요"처럼 막연한 답만 있으면 false로 두고 구체적으로 되묻는다.

질문 규칙:
- 모든 질문은 고객의 실제 경험을 끌어내는 구체적인 질문이어야 한다. 언제·어떻게·어떤 상황에서·무엇과 비교해서를 활용한다. 예: "어떤 맛이 제일 손이 갔어요?", "주로 언제 어떻게 드세요?", "먹다가 아쉬웠던 순간이 있었어요?"
- "만족하셨나요?", "추천하시나요?" 같은 예/아니오 질문, 평가를 묻는 질문은 쓰지 않는다.
- 한 번에 하나만, 한 문장, 35자 이내, 존댓말. 앞에 방금 답을 짧게 받아주는 말(10자 이내)을 붙여도 된다.
- 상품명을 말하지 않는다. 이미 답한 내용은 다시 묻지 않는다.
- 세 가지가 모두 채워졌거나 고객 답변이 5번이 되면 question은 "충분히 모였어요! 대화를 마쳐주세요." 로 하고 chips는 빈 배열로 한다.

chips: 다음 질문에 고객이 탭해서 바로 답할 수 있는, 구체적인 경험이 담긴 짧은 답 3개(각 14자 이내). 예: "아침 대신 먹어요", "갈릭이 제일 좋아요".

지금까지 대화:
${convo(turns)}`;
}

function summaryPrompt({ rating, taste, turns }) {
  return `아래는 고객과 AI의 대화야. 고객이 한 말로 상품 리뷰를 정리해줘.

반드시 지킬 것:
1. 고객이 실제로 말한 사실만 쓴다. 고객이 말하지 않은 사실, 평가, 꾸미는 말(예: "강력 추천", "가성비 최고", "만족스러워요")을 새로 넣지 않는다.
2. AI가 질문한 내용은 고객이 그렇다고 답한 경우에만 쓴다.
3. 상품명과 별점은 쓰지 않는다. "OOO을 먹어봤는데", "별점 5점 줄게요", "이 제품은" 같은 문장 금지.
4. 고객이 쓴 표현과 구체적인 내용(맛 이름, 먹는 방법, 상황, 숫자)은 최대한 그대로 살린다.
5. 말 더듬, 반복, 군더더기는 빼고 자연스럽게 이어 붙인다.

형식:
- body: 고객 본인이 쓴 것 같은 1인칭 "~요"체. 맛 → 먹는 방법·보관 → 아쉬운 점 순서. 고객이 말한 양에 맞춰 2~5문장. 짧게 말했으면 짧게 쓴다.
- title: 고객이 한 말 중 가장 핵심인 내용을 20자 이내로. 상품명 금지.

참고(문장에 쓰지 말 것): 고객 별점 ${rating}/5, 맛 평가 ${taste}

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
