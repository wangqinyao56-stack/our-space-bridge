/**
 * 高德地图 Web 服务 API 封装（导航 / 地理编码 / 逆地理编码）。
 * 高德是国内直连，Sealos 上无需代理。
 */
const AMAP_KEY = process.env.AMAP_KEY || "";
const AMAP_HOST = "restapi.amap.com";

async function amapGet(path) {
  if (!AMAP_KEY) throw new Error("AMAP_KEY 未配置");
  const url = `https://${AMAP_HOST}${path}&key=${AMAP_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`amap ${res.status}`);
  const json = await res.json();
  if (json.status !== "1") throw new Error(`amap ${json.info || "error"}`);
  return json;
}

// 地理编码：地址 → 经纬度 + 规范化地址
export async function geocode(address) {
  const json = await amapGet(`/v3/geocode/geo?address=${encodeURIComponent(address)}`);
  const geocodes = json.geocodes;
  if (!geocodes || geocodes.length === 0) return null;
  const loc = geocodes[0].location; // "lng,lat"
  const [lng, lat] = loc.split(",").map(Number);
  return { lng, lat, formatted: geocodes[0].formatted_address || address };
}

// 逆地理编码：经纬度 → 可读地址
export async function regeocode(lng, lat) {
  const json = await amapGet(`/v3/geocode/regeo?location=${lng},${lat}&extensions=base`);
  const regeo = json.regeocode;
  if (!regeo) return null;
  return regeo.formatted_address || null;
}

// 驾车路径规划：起点/终点（地址或经纬度字符串）→ 路线摘要
export async function drivingRoute(origin, destination) {
  const o = await geocode(origin);
  const d = await geocode(destination);
  if (!o || !d) return null;
  const json = await amapGet(`/v3/direction/driving?origin=${o.lng},${o.lat}&destination=${d.lng},${d.lat}`);
  const route = json.route;
  if (!route || !route.paths || route.paths.length === 0) return null;
  const path = route.paths[0];
  const steps = (path.steps || []).map((s) => s.instruction).join(" → ");
  return {
    origin: o.formatted,
    destination: d.formatted,
    distance: `${Math.round(path.distance / 1000)}公里`,
    duration: `${Math.round(path.duration / 60)}分钟`,
    steps,
  };
}
