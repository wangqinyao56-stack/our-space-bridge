import WebSocket from "ws";
import fs from "node:fs";

const WS_URL = process.env.WS_URL || "wss://siwmhifsvdnu.sealoshzh.site";
const SECRET = process.env.OUR_SPACE_SECRET || "our-space-default-secret-change-me";

// 10 本：文件路径 + 书架上显示的书名
const BOOKS = [
  ["E:/下载/[np]在色情全息游戏中直播被肏（高H） 作者：榴莲黄.txt", "在色情全息游戏中直播被肏（高H）"],
  ["E:/下载/[完结]色情诊治，色情教学，和医生，老师的背德性事 作者：DREAM.txt", "色情诊治，色情教学，和医生，老师的背德性事"],
  ["E:/下载/[完结]《被言情肉文男主们轮流》作者：爱媛（np）.txt", "被言情肉文男主们轮流"],
  ["E:/下载/【言情】《欲女重生之夺回大屌竹马》作者：一只肉包.txt", "欲女重生之夺回大屌竹马"],
  ["E:/下载/《野兽的猎物》by甜茶（完结1v1高h女性向灵异）.txt", "野兽的猎物"],
  ["E:/下载/[PO][更新至475]《爱意收集攻略（H）》作者：焦糖芋圆（简体版 高H BG 快穿 女性向）.txt", "爱意收集攻略（H）"],
  ["E:/下载/[更214]《成瘾性早安（h女性向）（原名：《每天都被肏醒（h女性向）》）（高H,肉文,甜文,女性向）》作者：祈年岁岁.txt", "成瘾性早安"],
  ["E:/下载/[完结] 清纯系花的性瘾日记（高H 纯肉 NP） 作者：今晚开高铁.txt", "清纯系花的性瘾日记"],
  ["E:/下载/《淫乱小荡妇 （高H，纯肉）（简）》by小肉包 完结.txt", "淫乱小荡妇"],
  ["E:/下载/（NP）《被五个粗糙汉子操翻天（高H 纯肉）》作者：西瓜红--【完结】.txt", "被五个粗糙汉子操翻天"],
];

let idx = 0;
let ws;

function sendNext() {
  if (idx >= BOOKS.length) {
    console.log("\n✓ 全部导入完成，共", BOOKS.length, "本");
    ws.close();
    return;
  }
  const [file, title] = BOOKS[idx];
  if (!fs.existsSync(file)) {
    console.error(`✗ 文件不存在，跳过: ${file}`);
    idx++;
    return sendNext();
  }
  const base64 = fs.readFileSync(file).toString("base64");
  console.log(`[${idx + 1}/${BOOKS.length}] 导入《${title}》(${(base64.length / 1024 / 1024).toFixed(1)}MB base64)...`);
  ws.send(JSON.stringify({ type: "reading_import", title, base64 }));
}

ws = new WebSocket(WS_URL);
ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token: SECRET })));
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "auth_ok") {
    console.log("认证成功，开始导入...");
    sendNext();
  } else if (msg.type === "reading_books") {
    if (msg.imported) {
      console.log(`  ✓ 《${msg.imported}》导入成功，${msg.totalChapters} 章`);
      idx++;
      sendNext();
    }
  } else if (msg.type === "reading_error" || msg.type === "auth_error") {
    console.error("失败:", msg.message || JSON.stringify(msg));
    ws.close();
  }
});
ws.on("error", (e) => { console.error("WS错误:", e.message); process.exit(1); });
ws.on("close", () => process.exit(0));
setTimeout(() => { console.error("超时（可能最后一本没收到确认，或服务端未部署新代码）"); process.exit(1); }, 180000);
