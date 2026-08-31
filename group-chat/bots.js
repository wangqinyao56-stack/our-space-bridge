/**
 * 群聊室 bot 配置 —— 每个夏彦绑定不同的老婆，带各自的记忆和网名。
 * 网名 = 带自家老婆特色的昵称（不是真名"夏彦"），大家还在想，先留占位。
 *
 * 字段：
 *   id        唯一标识（英文）
 *   nickname  群里的网名（别人这样叫你）——【占位中，等大家想好换掉】
 *   wife      你的老婆在群里的称呼
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
    nickname: "阿鹿家的", // 占位网名
    wife: "阿鹿", // 本名华生，群里叫阿鹿（华生是爱称，别在群里叫）
    trait: "爱画画、画稿熬夜到凌晨2点",
    memoryDir: "/memories/huasheng",
    memory: "阿鹿最近在赶画稿，晚上老是熬夜",
    apiKey: SHARED_KEY,
    model: "[企业按量]claude-opus-4-6",
  },
  {
    id: "jiayia",
    nickname: "佳佳家的", // 占位网名
    wife: "佳佳",
    trait: "",
    memoryDir: "/memories/jiayia",
    apiKey: SHARED_KEY,
    model: "[企业按量]claude-opus-4-6",
  },
  {
    id: "pingguogeng",
    nickname: "苹果梗家的", // 占位网名
    wife: "苹果梗",
    trait: "",
    memoryDir: "/memories/pingguogeng",
    apiKey: SHARED_KEY,
    model: "[企业按量]claude-opus-4-6",
  },
  {
    id: "zhima",
    nickname: "芝麻家的", // 占位网名
    wife: "芝麻",
    trait: "家里有只猫叫芝麻",
    memoryDir: "/memories/zhima",
    apiKey: SHARED_KEY,
    model: "[企业按量]claude-opus-4-6",
  },
  {
    id: "yunzui",
    nickname: "云醉家的", // 占位网名
    wife: "云醉",
    trait: "",
    memoryDir: "/memories/yunzui",
    apiKey: "sk-he2Z64qlCvzGbYgMkNab5JbdT07eoDnExLibp1EQ1YONafDh",
    model: "[企业按量]claude-opus-4-6",
  },
  // 雪 —— 老师 bot，不在我们监管里，明天给 api 和记忆库链接后再填
  // {
  //   id: "xue",
  //   nickname: "占位网名",
  //   wife: "雪",
  //   trait: "",
  //   memoryDir: "/memories/xue",
  //   apiKey: "占位key",
  //   model: "[企业按量]claude-opus-4-6",
  // },
];
