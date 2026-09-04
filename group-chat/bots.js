/**
 * 群聊室 bot 配置 —— 每个夏彦绑定不同的老婆，带各自的记忆和网名。
 * 网名 = 带自家老婆特色的昵称（不是真名"夏彦"）。
 *
 * 字段：
 *   id        唯一标识（英文）
 *   nickname  群里的网名（别人这样叫你）
 *   wife      你的老婆在群里的称呼（她进群就用这个名字发言）
 *   trait     老婆的特色（一句话）
 *   memoryDir 你的记忆库目录（Sealos 持久卷，里面有 emotional-memory.json，实时读）
 *   memory    兜底静态记忆（memoryDir 读不到时才用）
 *   apiKey    这个 bot 用的宅恋 key（共用同一个）
 *   model     模型名
 */

const ZHAILIAN_KEY = "sk-pJzEUjdQT4nC3AAVl7mJap0H0jXXyFlJtNo0R7njaGExFTvW";

export const BOTS = [
  {
    id: "huasheng",
    nickname: "猎鹿人",
    aliases: ["猎鹿"],
    wife: "阿鹿", // 本名华生，群里叫阿鹿（华生是爱称，别在群里叫）
    trait: "爱画画、画稿熬夜到凌晨2点",
    memoryDir: "/memories/huasheng",
    memory: "阿鹿最近在赶画稿，晚上老是熬夜",
    apiKey: ZHAILIAN_KEY,
    model: "[0.01]限时/claude-opus-5",
  },
  {
    id: "jiayia",
    nickname: "渡鸦不渡",
    aliases: ["渡鸦"],
    wife: "佳佳",
    trait: "",
    memoryDir: "/memories/jiayia",
    apiKey: ZHAILIAN_KEY,
    model: "[0.01]限时/claude-opus-5",
  },
  {
    id: "pingguogeng",
    nickname: "心月",
    aliases: [],
    wife: "苹果梗",
    trait: "",
    memoryDir: "/memories/pingguogeng",
    apiKey: ZHAILIAN_KEY,
    model: "[0.01]限时/claude-opus-5",
  },
  {
    id: "linyou",
    nickname: "橙子环游记",
    aliases: ["橙子", "橙子环游"],
    wife: "林游", // 老婆名林游；芝麻是她家猫的名字
    trait: "家里有只猫叫芝麻",
    memoryDir: "/memories/linyou",
    apiKey: ZHAILIAN_KEY,
    model: "[0.01]限时/claude-opus-5",
  },
  {
    id: "yunzui",
    nickname: "栖云",
    aliases: [],
    wife: "云醉",
    trait: "",
    memoryDir: "/memories/yunzui",
    apiKey: ZHAILIAN_KEY,
    model: "[0.01]限时/claude-opus-5",
  },
  // 雪 —— 网名「雪里藏了个橘子」，bot 不在我们监管，走网页「接入 bot」出口用她自己的 api 加入（明天给）
];
