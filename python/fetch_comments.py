"""fetch_comments.py —— 用 bilibili_api 取某视频的**一页**评论

⭐ 2026-10-26 改：**不再自己循环翻页**，一次只取一页。
   翻页交给**面板**：用户滚到底时前端再请求下一页。
   理由（使用者定的）：扫描时一口气翻 38 页要 200 多秒，体验很差；
   而且一页多少条本来就是接口自己的默认值，不该由我们猜。

⚠️ 这个文件会被插件 spawn 调用，参数：
    argv[1] = bvid
    argv[2] = page_index（页码，从 1 开始）
    argv[3] = order（'time' 或 'like'，默认 time）
输出：单行 JSON 到 stdout，形如
    {"ok":true,"aid":..,"title":..,"statReply":..,"page":1,"count":20,
     "total":765,"isEnd":false,"comments":[{...}]}
"""
import asyncio, json, os, sys

# ⚠️ stdout 必须是纯 JSON（插件要解析），所有日志走 stderr
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))


def out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


def fail(msg, **extra):
    out({"ok": False, "error": str(msg)[:600], **extra})
    sys.exit(0)


try:
    from bilibili_api import comment, Credential, video
except Exception as e:
    fail(f"没装 bilibili_api：{e}")


def load_cred():
    p = os.path.join(HERE, "bili_credential.json")
    if not os.path.exists(p):
        fail("没有 bili_credential.json（还没登录）")
    with open(p, encoding="utf-8") as f:
        d = json.load(f)
    return Credential(
        sessdata=d.get("sessdata", ""),
        bili_jct=d.get("bili_jct", ""),
        buvid3=d.get("buvid3") or "",
        dedeuserid=d.get("dedeuserid", ""),
    )


async def main():
    bvid = sys.argv[1] if len(sys.argv) > 1 else ""
    page_index = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    order_key = (sys.argv[3] if len(sys.argv) > 3 else "time").lower()
    if not bvid:
        fail("没有 bvid")
    if page_index < 1:
        page_index = 1

    order = comment.OrderType.LIKE if order_key == "like" else comment.OrderType.TIME
    cred = load_cred()

    # ① 视频信息（拿 aid / title / stat.reply）
    try:
        v = video.Video(bvid=bvid, credential=cred)
        info = await v.get_info()
    except Exception as e:
        fail(f"取视频信息失败：{type(e).__name__}: {e}")
        return

    aid = info["aid"]
    stat_reply = (info.get("stat") or {}).get("reply", 0)

    # ② 只取这一页（页码/每页条数都由接口自己定，我们不加 ps）
    try:
        resp = await comment.get_comments(
            oid=aid,
            type_=comment.CommentResourceType.VIDEO,
            page_index=page_index,
            order=order,
            credential=cred,
        )
    except Exception as e:
        fail(f"取第 {page_index} 页失败：{type(e).__name__}: {e}", aid=aid, statReply=stat_reply)
        return

    replies = resp.get("replies") or []
    page = resp.get("page") or {}

    comments = []
    for r in replies:
        member = r.get("member") or {}
        content = r.get("content") or {}
        comments.append({
            "rpid": str(r.get("rpid") or ""),
            "user": member.get("uname", ""),
            "mid": str(member.get("mid", "")),
            "content": content.get("message", ""),
            "members": [
                {"mid": str(m.get("mid", "")), "uname": m.get("uname", "")}
                for m in (content.get("members") or [])
            ],
            "like": r.get("like", 0),
            "rcount": r.get("rcount", 0),
            "ctime": r.get("ctime", 0),
            "state": r.get("state", 0),
        })

    total = int(page.get("count") or 0)
    size = int(page.get("size") or 0)

    out({
        "ok": True,
        "bvid": bvid,
        "aid": aid,
        "title": info.get("title", ""),
        "statReply": stat_reply,
        "page": page_index,
        "pageSize": size or len(comments),
        "count": len(comments),
        # ⭐ 用 page.count（B站 报的一级评论总数）判断还有没有下一页：
        #    page_index * size >= count 就是最后一页
        "total": total,
        "isEnd": bool(size and page_index * size >= total) or len(comments) == 0,
        "comments": comments,
    })


try:
    asyncio.run(main())
except Exception as e:
    fail(f"未预期异常：{type(e).__name__}: {e}")
