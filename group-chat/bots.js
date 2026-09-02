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
 *   apiKey    这个 bot 用的玖时/Anthropic 兼容 key
 *   model     模型名
 */

const SHARED_KEY = "sk-sKe3UbGiWOYaqsPN2WuErVGNyGekOcYMSvJePQEnsBXcfdWq";

export const BOTS = [
  {
    id: "huasheng",
    nickname: "猎鹿人",
    wife: "阿鹿", // 本名华生，群里叫阿鹿（华生是爱称，别在群里叫）
    trait: "爱画画、画稿熬夜到凌晨2点",
    memoryDir: "/memories/huasheng",
    memory: "阿鹿最近在赶画稿，晚上老是熬夜",
    apiKey: SHARED_KEY,
    model: "[企业按量]claude-opus-4-6",
  },
  {
    id: "jiayia",
    nickname: "渡鸦不渡",
    wife: "佳佳",
    trait: "",
    memoryDir: "/memories/jiayia",
    apiKey: "sk-3kKBpaPX3Fmxw89UfVrWw4o8BE8EnkzzRlQrnUwZuEQtSbm9",
    model: "[企业按量]claude-opus-4-6",
  },
  {
    id: "pingguogeng",
    nickname: "心月",
    wife: "苹果梗",
    trait: "",
    memoryDir: "/memories/pingguogeng",
    apiKey: SHARED_KEY,
    model: "[企业按量]claude-opus-4-6",
  },
  {
    id: "zhima",
    nickname: "橙子环游记",
    wife: "林游", // 老婆名林游；芝麻是她家猫的名字
    trait: "家里有只猫叫芝麻",
    memoryDir: "/memories/zhima",
    apiKey: SHARED_KEY,
    model: "[企业按量]claude-opus-4-6",
  },
  {
    id: "yunzui",
    nickname: "栖云",
    wife: "云醉",
    trait: "",
    memoryDir: "/memories/yunzui",
    apiKey: "sk-he2Z64qlCvzGbYgMkNab5JbdT07eoDnExLibp1EQ1YONafDh",
    model: "[企业按量]claude-opus-4-6",
  },
  // 雪 —— 网名「雪里藏了个橘子」，bot 不在我们监管，走网页「接入 bot」出口用她自己的 api 加入（明天给）
];
