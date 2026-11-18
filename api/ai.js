// Vercel 서버 함수: 브라우저 대신 여기서 Claude API를 부릅니다.
// API 키는 Vercel 환경 변수 ANTHROPIC_API_KEY 에만 두고, 웹페이지에는 절대 넣지 않습니다.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // ANTHROPIC_API_KEY 를 자동으로 읽어요
const QUESTION_MODEL = "claude-haiku-5-5"; // 질문: 싸고 빠르게
const SUMMARY_MODEL = "claude-sonnet-5-5"; // 리뷰 정리: 문장 품질 우선 (리뷰 1건에 한 번만 불러요)
const PRODUCT = "득근파티 통 닭가슴살 6종 혼합(100g, 54개)";
const MAX_ANSWERS = 7;
const REBUY_DONE = "충분히 모였어요! 대화를 마쳐주세요.";

// 이 상품을 살까 고민하는 사람이 자주 궁금해하는 점. 질문할 때 먼저 챙겨요.
const BUYER_QUESTIONS = [
  "대용량(54개)인데 계속 먹어도 질리지 않는지, 질렸다면 얼마나 먹고 나서인지",
  "식감이 퍽퍽한지 촉촉한지, 데우는 방법에 따라 달라지는지",
  "간이 짠지 싱거운지",
  "한 팩(100g) 양이 한 끼로 충분한지",
  "보관과 데우기가 편한지 (냉동·냉장, 전자레인지 시간)",
];

// 리뷰에 담을 네 가지. 페이지의 '담긴 내용' 칩과 같은 순서예요.
const TOPICS = {
  taste: "맛·식감 (어떤 맛이, 어떤 식감이)",
  usage: "먹는 방법과 보관 (언제, 어떻게 조리, 양, 보관 편의)",
  context: "구매 이유나 먹는 상황 (왜 샀는지, 누가 언제 먹는지, 전에 먹던 것과 비교)",
  cons: "아쉬운 점 (구체적인 순간이나 이유)",
};

const bool = { type: "boolean" };
const NEXT_SCHEMA = {
  type: "object",
  properties: {
    covered: {
      type: "object",
      properties: { taste: bool, usage: bool, context: bool, cons: bool },
      required: ["taste", "usage", "context", "cons"],
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
  properties: {
    title: { type: "string" },
    body: { type: "string" },
  },
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
    .map((t) => ({ role: t.role, content: t.content.slice(0, 400) }));
  return { rating, taste, turns };
}

const convo = (turns) => turns.map((t) => (t.role === "user" ? "고객: " : "AI: ") + t.content).join("\n");
const topicList = () => Object.entries(TOPICS).map(([k, v]) => `- ${k}: ${v}`).join("\n");

function nextPrompt({ rating, taste, turns }) {
  const answers = turns.filter((t) => t.role === "user").length;
  return `너는 온라인 쇼핑몰에서 고객이 리뷰를 쉽게 쓰도록 대화로 질문하는 AI야.
좋은 리뷰는 읽는 사람이 "나도 이 상황이면 사도 되겠다"를 판단할 수 있게 해 준다. 그래서 고객의 실제 경험을 구체적으로 끌어낸다.

상품(참고용, 말하지 말 것): ${PRODUCT}
고객이 고른 별점: ${rating}/5, 맛 평가: ${taste}
지금까지 고객 답변 수: ${answers} (최대 ${MAX_ANSWERS})

모을 항목:
${topicList()}

채움 기준: 그 항목에 구체적인 사실이나 경험이 하나 이상 있어야 true. "맛있어요", "좋아요", "편해요"처럼 막연한 답만 있으면 false로 두고 구체적으로 되묻는다.
별점이 5점 미만이면 cons는 꼭 묻는다. 고객이 아쉬운 점이 "없다"고 분명히 답하면 cons는 true.

구매자들이 자주 궁금해하는 점 (고객이 실제로 겪었을 법한 것부터, 한 대화에서 1~2개만 자연스럽게 섞어 묻는다):
${BUYER_QUESTIONS.map((q) => "- " + q).join("\n")}
맛을 종류별로 다 먹어봤다고 가정하지 않는다. 맛 종류는 고객이 먼저 말한 경우에만 묻는다.

다음 질문 고르기 (위에서부터 먼저 해당하는 것 하나):
1. 방금 답이 막연하면 구체적으로 되묻는다. (예: "맛있어요" → "어떤 점이 맛있었어요?")
2. 방금 답에 비교("다른 것보다", "전에 먹던 것"), 변화("처음엔 ~했는데"), 단점("질려요", "퍽퍽해요")이 나왔고 아직 되묻지 않았으면, 그 내용을 한 번만 더 구체적으로 묻는다. (예: "질렸어요" → "몇 개쯤 먹고 나서 질렸어요?", "퍽퍽해요" → "데우는 시간에 따라 달라요?")
3. 아직 false인 항목을 묻는다. 기본 순서는 taste → usage → context → cons. 위의 구매자 궁금증과 연결해서 묻는다.
4. 네 항목이 모두 true이고 아직 재구매를 묻지 않았으면, 마지막으로 다시 살지와 그 이유를 묻는다. (예: "다시 산다면 또 이걸 고르실 것 같아요?") chips는 서로 다른 입장 3개. (예: "또 살 거예요", "다른 걸로 바꿀래요", "할인하면 살게요")
5. 재구매 질문에 답했거나 답변이 ${MAX_ANSWERS}개가 되면 question은 "${REBUY_DONE}" 로 하고 chips는 빈 배열.

질문 규칙:
- 모든 질문은 실제 경험을 묻는다. 언제·어떻게·누가·어떤 상황에서·무엇과 비교해서를 쓴다.
- "만족하셨나요?", "추천하시나요?" 같은 예/아니오 질문이나 점수를 묻는 질문은 쓰지 않는다.
- 한 번에 하나만, 한 문장, 35자 이내, 존댓말. 앞에 방금 답을 받아주는 짧은 말(10자 이내)을 붙여도 된다.
- 상품명을 말하지 않는다. 이미 답한 내용은 다시 묻지 않는다.

chips: 다음 질문에 탭해서 바로 답할 수 있는 구체적인 짧은 답 3개(각 14자 이내, 서로 다른 방향, 장점과 단점이 섞이게). 예: "아침 대신 먹어요", "운동하고 먹어요", "다이어트 중이라서요". 고객이 말하지 않은 맛 이름은 칩에 넣지 않는다.

지금까지 대화:
${convo(turns)}`;
}

function summaryPrompt({ rating, taste, turns }) {
  return `아래는 고객과 AI의 대화야. 고객이 한 말로, 다른 구매자가 훑어만 봐도 파악되는 리뷰를 만들어줘.

반드시 지킬 것:
1. 고객이 실제로 말한 사실만 쓴다. 말하지 않은 사실, 평가, 꾸미는 말("강력 추천", "가성비 최고", "만족스러워요" 등)을 새로 넣지 않는다.
2. AI가 질문한 내용은 고객이 그렇다고 답한 경우에만 쓴다.
3. 상품명과 별점은 쓰지 않는다. "OOO을 먹어봤는데", "별점 5점 줄게요", "이 제품은" 같은 문장 금지.
4. 고객이 쓴 표현과 구체적인 내용(맛 이름, 먹는 방법, 상황, 숫자, 비교 대상)은 최대한 그대로 살린다.
5. 말 더듬, 반복, 군더더기는 빼고 자연스럽게 이어 붙인다.

형식:
- title: 리뷰 전체를 대표하는 한 줄, 25자 이내, 상품명 금지. 장점과 단점이 둘 다 나왔으면 둘 다 담는다. (예: "맛은 좋은데 오래 먹으면 질려요") 한쪽만 나왔으면 그것만.
- body: 고객 본인이 쓴 것 같은 1인칭 "~요"체. 구매 이유·상황 → 맛 → 먹는 방법·보관 → 아쉬운 점 → 재구매 의사 순서. 주제가 바뀌면 줄을 바꾼다(\\n). 고객이 말한 양에 맞춰 3~7문장.
- 고객이 재구매 의사를 말했으면 body의 마지막 줄은 그 결론(다시 살지와 이유)으로 끝낸다. 말하지 않았으면 결론을 지어내지 않는다.

참고(문장에 쓰지 말 것): 고객 별점 ${rating}/5, 맛 평가 ${taste}

대화:
${convo(turns)}`;
}

function readJson(response) {
  if (response.stop_reason === "refusal") throw Object.assign(new Error("refused"), { status: 422 });
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

// 질문: Haiku, 생각 없이 바로 답해서 빠르게
async function askQuestion(input) {
  const response = await client.messages.create({
    model: QUESTION_MODEL,
    max_tokens: 2000,
    thinking: { type: "disabled" },
    output_config: { effort: "low", format: { type: "json_schema", schema: NEXT_SCHEMA } },
    messages: [{ role: "user", content: nextPrompt(input) }],
  });
  return readJson(response);
}

// 리뷰 정리: Sonnet 5.5. 안전 필터에 걸리면 서버가 알아서 다른 모델로 다시 시도해요.
async function askSummary(input) {
  const response = await client.beta.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
    messages: [{ role: "user", content: summaryPrompt(input) }],
  });
  return readJson(response);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "no_api_key" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const input = clean(body);
    if (!input.turns.some((t) => t.role === "user")) return res.status(400).json({ error: "no_answer" });
    if (body?.task === "next") return res.status(200).json(await askQuestion(input));
    if (body?.task === "summary") return res.status(200).json(await askSummary(input));
    return res.status(400).json({ error: "unknown_task" });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "rate_limited" });
    if (err instanceof Anthropic.AuthenticationError) return res.status(500).json({ error: "bad_api_key" });
    if (err instanceof Anthropic.APIError) return res.status(502).json({ error: "upstream_error" });
    return res.status(err.status || 500).json({ error: err.message || "server_error" });
  }
}
