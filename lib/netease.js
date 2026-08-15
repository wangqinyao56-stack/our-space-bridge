/**
 * 网易云轻量封装 — 搜歌 / 歌词 / 歌曲详情。
 * 底层用 NeteaseCloudMusicApi（逆向接口，可能偶发失效，调用都带 try/catch 降级）。
 */

let _api = null;
async function getApi() {
  if (!_api) {
    const mod = await import("NeteaseCloudMusicApi");
    _api = mod.default;
  }
  return _api;
}

/** 搜歌：返回 {id,name,artist,album,cover} 列表 */
export async function searchSongs(keywords, limit = 6) {
  if (!keywords?.trim()) return [];
  try {
    const api = await getApi();
    const r = await api.search({ keywords: keywords.trim(), limit, type: 1 });
    const songs = (r.body?.result?.songs || []).map((s) => ({
      id: s.id,
      name: s.name,
      artist: (s.artists || []).map((a) => a.name).join("/"),
      album: s.album?.name || "",
      cover: s.album?.picUrl || "",
    }));
    return songs.filter((s) => s.id && s.name);
  } catch (e) {
    console.error("[netease] search failed:", e.message);
    return [];
  }
}

/** 歌词：去掉时间戳，返回纯文本 */
export async function getLyricText(songId) {
  if (!songId) return "";
  try {
    const api = await getApi();
    const r = await api.lyric({ id: songId });
    const raw = r.body?.lrc?.lyric || r.body?.lyric?.lyric || "";
    return raw.replace(/\[[\d:.]+\]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } catch (e) {
    console.error("[netease] lyric failed:", e.message);
    return "";
  }
}

/** 歌曲详情：{name,artist,cover} */
export async function getSongDetail(songId) {
  if (!songId) return null;
  try {
    const api = await getApi();
    const r = await api.song_detail({ ids: String(songId) });
    const s = r.body?.songs?.[0];
    if (!s) return null;
    return {
      name: s.name,
      artist: (s.ar || []).map((a) => a.name).join("/"),
      cover: s.al?.picUrl || "",
    };
  } catch (e) {
    console.error("[netease] detail failed:", e.message);
    return null;
  }
}
