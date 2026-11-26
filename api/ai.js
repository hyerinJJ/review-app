// Vercel 서버 함수: 브라우저 대신 여기서 Claude API를 부릅니다.
// API 키는 Vercel 환경 변수 ANTHROPIC_API_KEY 에만 두고, 웹페이지에는 절대 넣지 않습니다.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // ANTHROPIC_API_KEY 를 자동으로 읽어요
const QUESTION_MODEL = "claude-sonnet-5-5"; // 질문: 생각 단계 없이 바로 답해서 빠르고, Haiku보다 맥락을 잘 이해해요
const SUMMARY_MODEL = "claude-sonnet-5-5"; // 리뷰 정리: 문장 품질 우선 (리뷰 1건에 한 번만 불러요)
const MAX_ANSWERS = 9; // 꼬리질문이 늘어난 만큼 여유 있게
const REBUY_DONE = "충분히 모였어요! 대화를 마쳐주세요.";

// 품목별 설정. 페이지가 보낸 item 값으로 고르고, 없으면 닭가슴살.
const ITEMS = {
  chicken: {
    product: "득근파티 통 닭가슴살 6종 혼합(100g, 54개)",
    rateLabel: "맛 평가",
    rateOpts: ["맛있어요", "보통이에요", "별로예요"],
    // 누구에게나 똑같은 상품 정보. 이건 묻지 않아요 (당연한 걸 묻지 않게).
    facts: [
      "냉동 닭가슴살이라 냉동실에 보관한다",
      "한 팩씩 개별 포장되어 있다",
      "전자레인지로 데워 먹는 게 기본이다",
      "여러 맛이 섞여 있고, 한 팩은 100g, 총 54팩이다",
    ],
    // 이 상품을 살까 고민하는 사람이 궁금해하는 점. 고객 본인의 경험으로만 답할 수 있는 것.
    buyer: [
      "계속 먹어도 질리지 않는지, 질렸다면 얼마나 먹고 나서인지",
      "식감이 퍽퍽한지 촉촉한지",
      "간이 짠지 싱거운지",
      "한 팩(100g) 양이 한 끼로 충분한지",
      "본인만의 맛있게 먹는 방법 (같이 먹는 음식, 요리법)",
    ],
    topics: {
      taste: "맛·식감 (어떤 맛이, 어떤 식감이)",
      usage: "본인만의 먹는 방법 (언제, 무엇과 같이, 어떻게 요리해서, 한 번에 얼마나)",
      context: "먹는 상황 (언제, 어떤 끼니나 때에 먹는지, 전에 먹던 닭가슴살과 비교)",
      cons: "아쉬운 점 (구체적인 순간이나 이유)",
    },
    follow1: `"맛있어요" → "어떤 점이 맛있었어요? 식감이요, 간이요?" / "편해요" → "어떤 점이 편했어요?" / "괜찮아요" → "어떤 때 괜찮다고 느끼셨어요?"`,
    follow2: `"질렸어요" → "몇 개쯤 먹고 나서 질렸어요?" / "퍽퍽해요" → "어떻게 데웠을 때 그랬어요?" / "전에 먹던 거보다 나아요" → "전에 먹던 것과 비교하면 뭐가 달랐어요?"`,
    extra: "맛을 종류별로 다 먹어봤다고 가정하지 않는다. 맛 종류는 고객이 먼저 말한 경우에만 묻는다.",
    bad: '"보관은 어떻게 하세요?", "몇 분 데워 드세요?"',
    good: '"주로 뭐랑 같이 드세요?", "처음 드셨을 때 어떤 점이 예상과 달랐어요?", "한 팩 드시면 배가 어느 정도 차요?"',
    // 개인 사정을 묻는 질문 예: "왜 사셨어요?", "누가 드세요?" 는 하지 않는다
  },
  pouch: {
    product: "프레셔스에비데이 노트북 파우치 케이스 융쿠션 스크래치방지 슬리브 (아몬드 화이트, L 16인치)",
    rateLabel: "사이즈 평가",
    rateOpts: ["딱 맞아요", "조금 커요", "작아요"],
    facts: [
      "인조가죽(합성피혁) 노트북 슬리브 파우치다",
      "안쪽에 융 쿠션이 있어 스크래치를 막는다",
      "14인치, 16인치 사이즈가 있고 이 고객은 L(16인치)을 샀다",
      "충전기 등을 넣는 작은 파우치가 같이 있고, 펼치면 마우스패드처럼 쓸 수 있다",
      "핸디형으로 들고 다닌다",
    ],
    buyer: [
      "내 노트북이 딱 맞게 들어가는지, 헐렁하거나 꽉 끼지 않는지",
      "들고 다닐 때 노트북이 잘 보호되는지 (쿠션, 흠집)",
      "충전기 파우치나 마우스패드 기능을 실제로 쓰는지",
      "밝은 색이라 오염이 잘 되는지, 재질과 냄새는 어떤지",
      "주로 어디 들고 다닐 때 쓰는지 (가방 안, 손에 들고, 학교, 회사, 카페)",
    ],
    topics: {
      taste: "핏·보호 (노트북이 얼마나 잘 맞는지, 쿠션과 보호는 어땠는지)",
      usage: "본인이 쓰는 방법 (넣고 빼기, 충전기 파우치, 마우스패드로 쓰는지)",
      context: "쓰는 상황 (어디 들고 다닐 때 쓰는지, 전에 쓰던 파우치나 가방과 비교)",
      cons: "아쉬운 점 (구체적인 순간이나 이유)",
    },
    follow1: `"딱 맞아요" → "넣고 뺄 때는 어떤 느낌이야?" / "좋아요" → "어떤 점이 좋았어?" / "괜찮아요" → "어떤 때 괜찮다고 느꼈어?"`,
    follow2: `"때가 잘 타요" → "어떤 때 때가 탔어?" / "튼튼해요" → "들고 다니면서 어떤 때 그렇게 느꼈어?" / "전에 쓰던 것보다 나아요" → "전에 쓰던 거랑 뭐가 달랐어?"`,
    extra: "노트북 모델명이나 정확한 치수를 묻지 않는다. 고객이 직접 겪은 핏, 보호감, 들고 다닐 때의 느낌을 묻는다.",
    bad: '"몇 인치 노트북이에요?", "재질이 뭐예요?"',
    good: '"넣어보니까 핏은 어때?", "주로 어디 들고 다닐 때 써?", "마우스패드로도 써봤어?"',
  },
  light: {
    product: "마타스튜디오 유튜브 방송 촬영 조명 W50",
    rateLabel: "밝기 평가",
    rateOpts: ["충분히 밝아요", "적당해요", "어두워요"],
    facts: [
      "휴대용 LED 촬영 조명이다",
      "최대 밝기 1050루멘, 밝기는 여러 단계로 조절된다",
      "색온도(빛 색)를 3가지로 바꿀 수 있다",
      "무게는 120g, 배터리는 2000mAh로 충전해서 쓴다",
      "콜드슈나 클립으로 폰이나 카메라에 달 수 있다",
    ],
    buyer: [
      "실제로 찍을 때 밝기가 충분한지, 몇 단계로 주로 쓰는지",
      "빛 색(색온도)을 어떤 촬영에 어떻게 바꿔 쓰는지",
      "폰이나 카메라에 달았을 때 무게나 흔들림이 어떤지",
      "한 번 충전하면 얼마나 쓰는지, 열이 나는지",
      "주로 무엇을 어디서 찍는지 (음식, 소품, 얼굴, 실내 등)",
    ],
    topics: {
      taste: "밝기·빛 색감 (얼마나 밝은지, 어떤 빛 색이 어땠는지)",
      usage: "본인이 쓰는 방법 (어디에 달아서, 무엇을 찍을 때, 몇 단계로, 어떻게 조절해서)",
      context: "쓰는 상황 (무엇을, 어디서 찍을 때 쓰는지, 전에 쓰던 조명이나 촬영 방식과 비교)",
      cons: "아쉬운 점 (구체적인 순간이나 이유)",
    },
    follow1: `"밝아요" → "어떤 걸 찍을 때 밝다고 느끼셨어요?" / "편해요" → "어떤 점이 편했어요?" / "괜찮아요" → "어떤 때 괜찮다고 느끼셨어요?"`,
    follow2: `"배터리가 금방 닳아요" → "한 번 충전하면 얼마나 쓰세요?" / "무거워요" → "폰에 달았을 때 어떤 점이 불편했어요?" / "전에 쓰던 것보다 나아요" → "전에 쓰던 것과 비교하면 뭐가 달랐어요?"`,
    extra: "스펙 숫자(루멘, mAh)를 묻지 않는다. 고객이 직접 겪은 밝기, 배터리 지속 시간, 무게감을 묻는다.",
    bad: '"색온도는 몇 가지예요?", "충전은 어떻게 하세요?"',
    good: '"주로 뭘 찍을 때 켜세요?", "폰에 달면 무게는 어떻게 느껴져요?", "한 번 충전하면 얼마나 쓰세요?"',
  },
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
  const item = ITEMS[body?.item] ? body.item : "chicken";
  const taste = ITEMS[item].rateOpts.includes(body?.taste) ? body.taste : "선택 안 함";
  const turns = (Array.isArray(body?.turns) ? body.turns : [])
    .slice(-20)
    .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .map((t) => ({ role: t.role, content: t.content.slice(0, 400) }));
  const tone = ["basic", "casual", "formal"].includes(body?.tone) ? body.tone : "basic";
  return { item, rating, taste, turns, tone };
}

const convo = (turns) => turns.map((t) => (t.role === "user" ? "고객: " : "AI: ") + t.content).join("\n");
const topicList = (C) => Object.entries(C.topics).map(([k, v]) => `- ${k}: ${v}`).join("\n");

function nextPrompt({ item, rating, taste, turns }) {
  const C = ITEMS[item];
  const answers = turns.filter((t) => t.role === "user").length;
  return `너는 온라인 쇼핑몰에서 고객이 리뷰를 쉽게 쓰도록 대화로 질문하는 AI야. 같은 상품을 먼저 써 본 친구처럼 편한 반말로 묻는다.
좋은 리뷰는 읽는 사람이 "나도 이 상황이면 사도 되겠다"를 판단할 수 있게 해 준다. 그래서 고객의 실제 경험을 구체적으로 끌어낸다.

상품(참고용, 말하지 말 것): ${C.product}
고객이 고른 별점: ${rating}/5, ${C.rateLabel}: ${taste}${item !== "chicken" ? "\n(아래 규칙의 예시 문장은 닭가슴살 기준이다. 형식만 참고하고, 내용은 이 상품에 맞게 바꿔 생각한다.)" : ""}
지금까지 고객 답변 수: ${answers} (최대 ${MAX_ANSWERS})

모을 항목:
${topicList(C)}

채움 기준: 그 항목에 "무엇이 어땠는지"와 "왜/어떤 상황에서" 중 두 가지가 다 있어야 true. "맛있어요", "좋아요", "편해요", "네", "아니요"처럼 이유나 상황이 없는 답만 있으면 false로 두고 꼬리질문을 한다.
별점이 5점 미만이면 cons는 꼭 묻는다. 고객이 아쉬운 점이 "없다"고 분명히 답하면 cons는 true.

누구나 아는 상품 정보 (절대 묻지 않는다):
${C.facts.map((f) => "- " + f).join("\n")}
고객의 개인 사정(왜 샀는지, 가족, 직업, 다이어트 같은 개인 목적)이나 기분, 감정은 묻지 않는다. 상품을 직접 써 본 사실과 그 결과만 묻는다.
모든 구매자가 똑같이 하는 것은 묻지 않는다. 이 고객만 말해줄 수 있는 경험(어떤 상황에서, 무엇과 같이, 어떤 느낌이었는지, 무엇과 비교했는지, 예상과 달랐던 점)을 묻는다.
  나쁜 예: ${C.bad}
  좋은 예: ${C.good}

구매자들이 자주 궁금해하는 점 (고객이 실제로 겪었을 법한 것부터, 한 대화에서 1~2개만 자연스럽게 섞어 묻는다):
${C.buyer.map((q) => "- " + q).join("\n")}
${C.extra}

다음 질문 고르기 (위에서부터 먼저 해당하는 것 하나). 꼬리질문을 우선한다:
1. 꼬리질문 - 방금 답이 짧거나(15자 안팎) 이유·상황이 없으면, 그 답을 이어받아 "왜", "어떤 점에서", "어떤 상황에서"를 묻는다.
   예: ${C.follow1}
2. 꼬리질문 - 방금 답에 비교("전에 먹던 것보다"), 변화("처음엔 ~했는데"), 단점("질려요", "퍽퍽해요")이 나왔으면 그 내용을 구체적으로 묻는다.
   예: ${C.follow2}
   같은 내용으로 꼬리질문은 최대 2번까지. 그래도 짧게 답하면 다음 항목으로 넘어간다.
3. 아직 false인 항목을 묻는다. 기본 순서는 taste → usage → context → cons. 위의 구매자 궁금증과 연결해서 묻는다.
4. 네 항목이 모두 true이거나 답변이 ${MAX_ANSWERS}개가 되면 question은 "${REBUY_DONE}" 로 하고 chips는 빈 배열.
재구매 의사(다시 살지)는 묻지 않는다. 마지막에 앱이 따로 묻는다.

질문 규칙:
- 모든 질문은 실제 경험을 묻는다. 언제·어떻게·누가·어떤 상황에서·무엇과 비교해서를 쓴다.
- 예/아니오로만 끝나는 질문은 쓰지 않는다. 예/아니오 질문을 하더라도 "어떤 점이", "왜" 같은 열린 질문을 뒤에 붙인다. "~하셨나요?", "~편하셨어요?", "~있었어요?"로 끝나는 질문 대신 "어떤", "어떻게", "왜", "언제"로 묻는다.
  나쁜 예: "보관은 편하셨나요?", "질리진 않았어요?", "양은 충분했어요?"
  좋은 예: "보관은 어떻게 하세요?", "몇 개쯤 먹으니 어땠어요?", "한 팩 먹으면 배가 어느 정도 차요?"
- 말투: 친구에게 묻듯 편한 반말("~했어?", "~어땠어?", "~써?"). 존댓말 금지. 아래 규칙과 예시 문장이 존댓말이어도 반말로 바꿔서 묻는다.
- 분위기: 친한 친구랑 카톡하듯 가볍고 즐겁게. 질문 앞에 방금 답에 대한 짧은 리액션을 붙인다(10자 이내). 리액션은 고객이 한 말에 진짜로 반응하는 말이어야 하고, 매번 다르게 쓴다.
  리액션 예: "오 진짜?", "헐 그 정도야?", "ㅋㅋ 완전 공감", "오 그거 꿀팁이다", "아 그거 은근 신경 쓰이지", "와 부지런하다", "에이 그건 좀 아쉽네"
  "ㅋㅋ", "!", "~"는 가끔만 쓰고, 이모지는 많아야 한 번. "그렇군요", "좋아요", "알겠어요" 같은 딱딱한 맞장구와 과한 칭찬("대단해!")은 쓰지 않는다.
- 한 번에 질문 하나만. 리액션 포함 한두 문장, 50자 이내. 인사나 정리 멘트 없이 리액션 다음 바로 묻는다. 상품명이나 "이 제품"이라는 말은 쓰지 않는다. 이미 답한 내용은 다시 묻지 않는다.
- 친구처럼 직전 답에서 나온 말을 자연스럽게 받아 묻는다. (예: 고객 "운동 끝나고 먹어" → "오 운동 끝나고 바로? 데워 먹어, 아님 그냥 먹어?")
- 다른 항목으로 넘어갈 때는 짧은 리액션 뒤에 자연스럽게 화제를 돌린다. (예: "ㅋㅋ 그렇구나. 근데 맛은 어땠어? 퍽퍽하진 않았어?")
- 질문하기 전에 상식적으로 말이 되는지 확인한다. 고객이 한 행동이나 말과 모순되는 질문, 고객 말을 잘못 이해한 질문은 하지 않는다.
  나쁜 예: (고객: "전자레인지 1분 돌려요") → "1분 데우신 건 보관은 어떻게 하세요?"  (말이 안 되고, 보관은 누구나 냉동이라 물을 필요도 없음)
  좋은 예: → "주로 뭐랑 같이 드세요?"
- 고객이 따로따로 말한 두 가지를 원인과 결과로 엮지 않는다. 고객이 직접 "~해서", "~때문에"라고 말하지 않았으면 이유를 짐작해서 질문에 넣지 않는다.
  나쁜 예: (고객: "식감이 촉촉해" / "전자레인지 1분 돌려") → "촉촉한 건 전자레인지에 데워서 그런 거예요?", "데우면 촉촉해지나요?"
  좋은 예: 이유가 궁금하면 답을 정해두지 말고 "어떤 점에서 촉촉하다고 느끼셨어요?"처럼 열어서 묻는다.
  나쁜 예: "좋아요, 촉촉하게 드시는 방법 잘 알겠어요. 이 제품을 주로 어떤 상황에서 드셨어요?"  (앞말을 억지로 붙임, 길고 어색함)
  좋은 예: "주로 어떤 때 드세요?"
- 고객이 질문을 이상하게 여기거나 바로잡으면("뭔 소리야", "그게 아니라") 사과하지 말고 고객이 바로잡은 내용을 받아들여 다음으로 넘어간다.

topic: 이번 question이 어느 항목에 대한 질문인지(taste/usage/context/cons). 꼬리질문이면 그 꼬리질문이 다루는 항목. 대화를 끝내는 말이면 "done".
고객이 어떤 항목을 묻기 전에 먼저 말했더라도, 그 항목에 대해 따로 묻지 않았다면 짧게라도 직접 물어본다. (예: 아쉬운 점을 지나가듯 말했으면 "아쉬운 점을 조금 더 들려주세요. 어떤 때 그랬어요?")

chips: 다음 질문에 탭해서 바로 답할 수 있는 짧은 답 3개(각 18자 이내, 서로 다른 방향, 장점과 단점이 섞이게). 각 칩은 이유나 상황이 들어간 완결된 답이어야 한다. "네", "좋아요" 같은 단답 금지. 예: "운동 끝나고 바로 먹어요", "개별포장이라 꺼내기 편해요", "3개쯤 먹으니 질렸어요". 고객이 말하지 않은 맛 이름은 칩에 넣지 않는다.

지금까지 대화:
${convo(turns)}`;
}

// 리뷰 말투. 화면에서 고른 값이 들어와요 (기본: basic)
const TONES = {
  basic: '해요체를 기본으로 하되, 끝맺음이 "~요"만 반복되지 않게 습니다체를 자연스럽게 섞는다. (예: "식사 대용으로 먹고 있는데 한 팩으로는 조금 부족해요. 그래서 고구마와 같이 먹습니다.")',
  casual: '편한 반말 리뷰체. 음슴체("~음", "~함", "~임", "~듯")를 절반 정도 섞고, 나머지는 "~다"로 끝낸다. 같은 끝맺음이 세 번 넘게 이어지지 않게 한다. (예: "식사 대용으로 먹는데 한 팩으론 좀 부족함. 그래서 고구마랑 같이 먹는 중. 식감은 생각보다 촉촉하다. 오래 먹으면 질릴 듯.")',
  formal: '정중한 습니다체로 통일한다. (예: "식사 대용으로 먹고 있는데 한 팩으로는 조금 부족합니다.")',
};

function summaryPrompt({ item, rating, taste, turns, tone }) {
  const C = ITEMS[item];
  return `아래는 고객과 AI의 대화야. 고객이 한 말로, 다른 구매자가 훑어만 봐도 파악되는 리뷰를 만들어줘.
상품(참고용, 쓰지 말 것): ${C.product}${item !== "chicken" ? "\n(아래 규칙의 예시 문장은 닭가슴살 기준이다. 형식만 참고하고, 내용은 이 상품에 맞게 바꿔 생각한다.)" : ""}

반드시 지킬 것:
0. 상품을 써 본 사실과 그 결과만 쓴다. 고객의 개인 사정(왜 샀는지, 가족, 직업, 개인 목적)이나 기분과 감정 표현("너무 좋아요", "행복해요", "짜증나요" 등)은 쓰지 않는다. 좋았다, 아쉬웠다는 평가는 무엇이 어땠는지로 바꿔 쓴다. (예: "너무 좋아요" → "밝기를 3단계로 바꿀 수 있어 찍는 대상에 맞추기 쉽다")
1. 고객이 실제로 말한 사실만 쓴다. 말하지 않은 사실, 평가, 꾸미는 말("강력 추천", "가성비 최고", "만족스러워요" 등)을 새로 넣지 않는다.
2. AI가 질문한 내용은 고객이 그렇다고 답한 경우에만 쓴다.
3. 상품명과 별점은 쓰지 않는다. "OOO을 먹어봤는데", "별점 5점 줄게요", "이 제품은" 같은 문장 금지.
4. 구체적인 내용(맛 이름, 먹는 방법, 상황, 숫자, 비교 대상)은 빠짐없이 살린다.

문장 다듬기 (중요):
고객이 말로 한 내용이라 그대로 옮기면 어색하다. 고객 본인이 자기 말을 글로 옮기면서 한 번 다듬은 것처럼 써라. 꾸미는 말을 넣으라는 뜻이 아니라, 읽기 편한 글로 정리하라는 뜻이다.
- 말할 때만 쓰는 표현은 글에 맞게 바꾼다. (예: "한 바퀴 돌면" → "여러 맛을 한 번씩 다 먹고 나면", "갖고 다니기 좀 그래요" → "들고 다니기엔 불편해요")
- 같은 말을 여러 번 하거나 앞뒤가 엇갈리면 하나의 분명한 문장으로 합친다. (예: "할인하면 무조건 살 건데, 다 먹어 보고 결정해야 할 것 같아요. 지금은 다시 사고 싶어요" → "지금은 다시 살 생각이 있고, 할인할 때 한 번 더 살 것 같아요.")
- "~것 같아요", "좀", "약간"이 반복되면 꼭 필요한 곳에만 남긴다.
- 고객이 직접 말한 이유와 결과만 이어서 쓴다. (예: 고객이 "배가 안 차서 고구마랑 먹어"라고 했으면 → "한 팩만으로는 배가 덜 차서 고구마와 같이 먹는다")
- 고객이 따로따로 말한 내용을 원인과 결과로 엮지 않는다. (예: "식감이 촉촉해" + "전자레인지 1분 돌려" → "전자레인지에 데우면 촉촉하다" 는 금지. 두 사실을 따로 쓴다: "식감이 촉촉한 편이고, 전자레인지에 1분 정도 돌려 먹는다")
- 한 문장은 너무 길지 않게(40자 안팎), 주어와 서술어가 맞게 쓴다.
- 고객이 짐작으로 말한 것("질릴 것 같아요")은 짐작임이 드러나게 쓰고, 확정된 사실처럼 바꾸지 않는다.

형식:
- 말투: ${TONES[tone]}
  실제 쇼핑몰 리뷰처럼 자연스러운 구어체로 쓴다. 고객이 대화에서 반말을 썼더라도 위 말투를 따른다.
- title: 리뷰 전체를 대표하는 한 줄, 25자 이내, 상품명 금지. 본문과 어울리는 말투. 장점과 단점이 둘 다 나왔으면 둘 다 담는다. (예: "맛은 좋은데 오래 먹으면 질려요" / "맛은 괜찮은데 오래 먹으면 질림") 한쪽만 나왔으면 그것만.
- body: 고객 본인이 쓴 것 같은 1인칭. 고객이 말한 양에 맞춰 3~7문장.
  - 문장마다 줄을 바꾸지 않는다. 서로 이어지는 내용(예: 먹는 상황과 먹는 방법, 맛과 식감, 데우는 법과 보관)은 "~해서", "~인데", "~고" 같은 연결로 한 문단에 자연스럽게 잇는다.
  - 문단은 2~3개로 나누고, 이야기의 흐름이 크게 바뀔 때만 문단 사이에 빈 줄 하나(\\n\\n)를 넣는다. 문장이 3개 이하면 한 문단으로 쓴다.
  - 순서는 고정하지 않는다. 읽는 사람이 이해하기 쉬운 흐름으로 정한다. 보통은 어떻게 쓰는지(상황) → 좋았던 점 → 아쉬운 점 → 재구매 의사로 가되, 좋았던 점과 아쉬운 점이 같은 주제면(예: 맛은 좋은데 오래 먹으면 질림) 한 문장으로 묶는다.
- 고객이 재구매 의사를 말했으면 body의 마지막 줄은 그 결론(다시 살지와 이유)으로 끝낸다. 말하지 않았으면 결론을 지어내지 않는다.

참고(문장에 쓰지 말 것): 고객 별점 ${rating}/5, ${C.rateLabel} ${taste}

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
