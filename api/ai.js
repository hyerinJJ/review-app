// Vercel 서버 함수: 브라우저 대신 여기서 Claude API를 부릅니다.
// API 키는 Vercel 환경 변수 ANTHROPIC_API_KEY 에만 두고, 웹페이지에는 절대 넣지 않습니다.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // ANTHROPIC_API_KEY 를 자동으로 읽어요
const QUESTION_MODEL = "claude-sonnet-5-5"; // 질문: 생각 단계 없이 바로 답해서 빠르고, Haiku보다 맥락을 잘 이해해요
const SUMMARY_MODEL = "claude-sonnet-5-5"; // 리뷰 정리: 문장 품질 우선 (리뷰 1건에 한 번만 불러요)
const PRODUCT = "득근파티 통 닭가슴살 6종 혼합(100g, 54개)";
const MAX_ANSWERS = 9; // 꼬리질문이 늘어난 만큼 여유 있게
const REBUY_DONE = "충분히 모였어요! 대화를 마쳐주세요.";

// 누구에게나 똑같은 상품 정보. 이건 묻지 않아요 (당연한 걸 묻지 않게).
const PRODUCT_FACTS = [
  "냉동 닭가슴살이라 냉동실에 보관한다",
  "한 팩씩 개별 포장되어 있다",
  "전자레인지로 데워 먹는 게 기본이다",
  "여러 맛이 섞여 있고, 한 팩은 100g, 총 54팩이다",
];

// 이 상품을 살까 고민하는 사람이 궁금해하는 점. 고객 본인의 경험으로만 답할 수 있는 것.
const BUYER_QUESTIONS = [
  "계속 먹어도 질리지 않는지, 질렸다면 얼마나 먹고 나서인지",
  "식감이 퍽퍽한지 촉촉한지, 데우는 정도에 따라 달라지는지",
  "간이 짠지 싱거운지",
  "한 팩(100g) 양이 한 끼로 충분한지",
  "본인만의 맛있게 먹는 방법 (같이 먹는 음식, 요리법)",
];

// 리뷰에 담을 네 가지. 페이지의 '담긴 내용' 칩과 같은 순서예요.
const TOPICS = {
  taste: "맛·식감 (어떤 맛이, 어떤 식감이)",
  usage: "본인만의 먹는 방법 (언제, 무엇과 같이, 어떻게 요리해서, 한 번에 얼마나)",
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
    topic: { type: "string", enum: ["taste", "usage", "context", "cons", "done"] },
    question: { type: "string" },
    chips: { type: "array", items: { type: "string" } },
  },
  required: ["covered", "topic", "question", "chips"],
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

채움 기준: 그 항목에 "무엇이 어땠는지"와 "왜/어떤 상황에서" 중 두 가지가 다 있어야 true. "맛있어요", "좋아요", "편해요", "네", "아니요"처럼 이유나 상황이 없는 답만 있으면 false로 두고 꼬리질문을 한다.
별점이 5점 미만이면 cons는 꼭 묻는다. 고객이 아쉬운 점이 "없다"고 분명히 답하면 cons는 true.

누구나 아는 상품 정보 (절대 묻지 않는다):
${PRODUCT_FACTS.map((f) => "- " + f).join("\n")}
보관 방법, 전자레인지로 데우는지처럼 모든 구매자가 똑같이 하는 것은 묻지 않는다. 이 고객만 말해줄 수 있는 경험(어떤 상황에서, 무엇과 같이, 어떤 느낌이었는지, 무엇과 비교했는지, 예상과 달랐던 점)을 묻는다.
  나쁜 예: "보관은 어떻게 하세요?", "몇 분 데워 드세요?"
  좋은 예: "주로 뭐랑 같이 드세요?", "처음 드셨을 때 어떤 점이 예상과 달랐어요?", "한 팩 드시면 배가 어느 정도 차요?"

구매자들이 자주 궁금해하는 점 (고객이 실제로 겪었을 법한 것부터, 한 대화에서 1~2개만 자연스럽게 섞어 묻는다):
${BUYER_QUESTIONS.map((q) => "- " + q).join("\n")}
맛을 종류별로 다 먹어봤다고 가정하지 않는다. 맛 종류는 고객이 먼저 말한 경우에만 묻는다.

다음 질문 고르기 (위에서부터 먼저 해당하는 것 하나). 꼬리질문을 우선한다:
1. 꼬리질문 - 방금 답이 짧거나(15자 안팎) 이유·상황이 없으면, 그 답을 이어받아 "왜", "어떤 점에서", "어떤 상황에서"를 묻는다.
   예: "맛있어요" → "어떤 점이 맛있었어요? 식감이요, 간이요?" / "편해요" → "어떤 점이 편했어요?" / "괜찮아요" → "어떤 때 괜찮다고 느끼셨어요?"
2. 꼬리질문 - 방금 답에 비교("전에 먹던 것보다"), 변화("처음엔 ~했는데"), 단점("질려요", "퍽퍽해요")이 나왔으면 그 내용을 구체적으로 묻는다.
   예: "질렸어요" → "몇 개쯤 먹고 나서 질렸어요?" / "퍽퍽해요" → "어떻게 데웠을 때 그랬어요?" / "전에 먹던 거보다 나아요" → "전에 먹던 것과 비교하면 뭐가 달랐어요?"
   같은 내용으로 꼬리질문은 최대 2번까지. 그래도 짧게 답하면 다음 항목으로 넘어간다.
3. 아직 false인 항목을 묻는다. 기본 순서는 taste → usage → context → cons. 위의 구매자 궁금증과 연결해서 묻는다.
4. 네 항목이 모두 true이거나 답변이 ${MAX_ANSWERS}개가 되면 question은 "${REBUY_DONE}" 로 하고 chips는 빈 배열.
재구매 의사(다시 살지)는 묻지 않는다. 마지막에 앱이 따로 묻는다.

질문 규칙:
- 모든 질문은 실제 경험을 묻는다. 언제·어떻게·누가·어떤 상황에서·무엇과 비교해서를 쓴다.
- 예/아니오로 답할 수 있는 질문은 절대 쓰지 않는다. "~하셨나요?", "~편하셨어요?", "~있었어요?"로 끝나는 질문 대신 "어떤", "어떻게", "왜", "언제"로 묻는다.
  나쁜 예: "보관은 편하셨나요?", "질리진 않았어요?", "양은 충분했어요?"
  좋은 예: "보관은 어떻게 하세요?", "몇 개쯤 먹으니 어땠어요?", "한 팩 먹으면 배가 어느 정도 차요?"
- 한 번에 하나만, 한 문장, 35자 이내, 존댓말. 상품명이나 "이 제품"이라는 말은 쓰지 않는다. 이미 답한 내용은 다시 묻지 않는다.
- 꼬리질문일 때만 방금 답의 내용을 이어받는다. 다른 항목으로 넘어갈 때는 방금 답을 억지로 붙이지 말고 깔끔한 새 질문을 한다. 공감 표현("그렇군요" 등)은 꼭 필요할 때만 5자 이내로.
- 질문하기 전에 상식적으로 말이 되는지 확인한다. 고객이 한 행동이나 말과 모순되는 질문, 고객 말을 잘못 이해한 질문은 하지 않는다.
  나쁜 예: (고객: "전자레인지 1분 돌려요") → "1분 데우신 건 보관은 어떻게 하세요?"  (말이 안 되고, 보관은 누구나 냉동이라 물을 필요도 없음)
  좋은 예: → "1분 데우면 식감은 어때요?"
  나쁜 예: "좋아요, 촉촉하게 드시는 방법 잘 알겠어요. 이 제품을 주로 어떤 상황에서 드셨어요?"  (앞말을 억지로 붙임, 길고 어색함)
  좋은 예: "주로 어떤 때 드세요?"
- 고객이 질문을 이상하게 여기거나 바로잡으면("뭔 소리야", "그게 아니라") 사과하지 말고 고객이 바로잡은 내용을 받아들여 다음으로 넘어간다.

topic: 이번 question이 어느 항목에 대한 질문인지(taste/usage/context/cons). 꼬리질문이면 그 꼬리질문이 다루는 항목. 대화를 끝내는 말이면 "done".
고객이 어떤 항목을 묻기 전에 먼저 말했더라도, 그 항목에 대해 따로 묻지 않았다면 짧게라도 직접 물어본다. (예: 아쉬운 점을 지나가듯 말했으면 "아쉬운 점을 조금 더 들려주세요. 어떤 때 그랬어요?")

chips: 다음 질문에 탭해서 바로 답할 수 있는 짧은 답 3개(각 18자 이내, 서로 다른 방향, 장점과 단점이 섞이게). 각 칩은 이유나 상황이 들어간 완결된 답이어야 한다. "네", "좋아요" 같은 단답 금지. 예: "운동 끝나고 바로 먹어요", "개별포장이라 꺼내기 편해요", "3개쯤 먹으니 질렸어요". 고객이 말하지 않은 맛 이름은 칩에 넣지 않는다.

지금까지 대화:
${convo(turns)}`;
}

function summaryPrompt({ rating, taste, turns }) {
  return `아래는 고객과 AI의 대화야. 고객이 한 말로, 다른 구매자가 훑어만 봐도 파악되는 리뷰를 만들어줘.

반드시 지킬 것:
1. 고객이 실제로 말한 사실만 쓴다. 말하지 않은 사실, 평가, 꾸미는 말("강력 추천", "가성비 최고", "만족스러워요" 등)을 새로 넣지 않는다.
2. AI가 질문한 내용은 고객이 그렇다고 답한 경우에만 쓴다.
3. 상품명과 별점은 쓰지 않는다. "OOO을 먹어봤는데", "별점 5점 줄게요", "이 제품은" 같은 문장 금지.
4. 구체적인 내용(맛 이름, 먹는 방법, 상황, 숫자, 비교 대상)은 빠짐없이 살린다.

문장 다듬기 (중요):
고객이 말로 한 내용이라 그대로 옮기면 어색하다. 고객 본인이 자기 말을 글로 옮기면서 한 번 다듬은 것처럼 써라. 꾸미는 말을 넣으라는 뜻이 아니라, 읽기 편한 글로 정리하라는 뜻이다.
- 말할 때만 쓰는 표현은 글에 맞게 바꾼다. (예: "한 바퀴 돌면" → "여러 맛을 한 번씩 다 먹고 나면", "갖고 다니기 좀 그래요" → "들고 다니기엔 불편해요")
- 같은 말을 여러 번 하거나 앞뒤가 엇갈리면 하나의 분명한 문장으로 합친다. (예: "할인하면 무조건 살 건데, 다 먹어 보고 결정해야 할 것 같아요. 지금은 다시 사고 싶어요" → "지금은 다시 살 생각이 있고, 할인할 때 한 번 더 살 것 같아요.")
- "~것 같아요", "좀", "약간"이 반복되면 꼭 필요한 곳에만 남긴다.
- 원인과 결과, 장점과 단점의 관계가 드러나게 잇는다. (예: "배가 안 차서 고구마랑 먹어요" → "한 팩만으로는 배가 덜 차서 고구마와 같이 먹어요")
- 한 문장은 너무 길지 않게(40자 안팎), 주어와 서술어가 맞게 쓴다.
- 고객이 짐작으로 말한 것("질릴 것 같아요")은 짐작임이 드러나게 쓰고, 확정된 사실처럼 바꾸지 않는다.

형식:
- title: 리뷰 전체를 대표하는 한 줄, 25자 이내, 상품명 금지. 완결된 "~요" 문장으로 쓴다(메모처럼 "~듯", "~함"으로 끝내지 않는다). 장점과 단점이 둘 다 나왔으면 둘 다 담는다. (예: "맛은 좋은데 오래 먹으면 질려요") 한쪽만 나왔으면 그것만.
- body: 고객 본인이 쓴 것 같은 1인칭 "~요"체. 고객이 말한 양에 맞춰 3~7문장.
  - 문장마다 줄을 바꾸지 않는다. 서로 이어지는 내용(예: 구매 이유와 먹는 상황, 맛과 식감, 데우는 법과 보관)은 "~해서", "~인데", "~고" 같은 연결로 한 문단에 자연스럽게 잇는다.
  - 문단은 2~3개로 나누고, 이야기의 흐름이 크게 바뀔 때만 문단 사이에 빈 줄 하나(\\n\\n)를 넣는다. 문장이 3개 이하면 한 문단으로 쓴다.
  - 순서는 고정하지 않는다. 읽는 사람이 이해하기 쉬운 흐름으로 정한다. 보통은 왜·어떻게 먹는지(상황) → 좋았던 점 → 아쉬운 점 → 재구매 의사로 가되, 좋았던 점과 아쉬운 점이 같은 주제면(예: 맛은 좋은데 오래 먹으면 질림) 한 문장으로 묶는다.
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

// 질문: Sonnet 5.5, 생각 단계 없이 바로 답해서 빠르게 (between_tools = 생각 끄기)
async function askQuestion(input) {
  const response = await client.messages.create({
    model: QUESTION_MODEL,
    max_tokens: 2000,
    thinking: { type: "between_tools" },
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
    output_config: { effort: "medium", format: { type: "json_schema", schema: SUMMARY_SCHEMA } }, // 문장 다듬기에 조금 더 생각하게
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
