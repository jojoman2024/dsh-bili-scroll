"""fetch_comments.py —— 用 bilibili_api 取某视频的全部一级评论

⚠️ 这个文件会被插件 spawn 调用，参数：
    argv[1] = bvid
    argv[2] = 最多取几条（可选，默认 500）
输出：单行 JSON 到 stdout，形如
    {"ok":true,"total":374,"comments":[{rpid,user,mid,content,members,like,rcount,ctime,state}]}
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
    want = int(sys.argv[2]) if len(sys.argv) > 2 else 500
    if not bvid:
        fail("没有 bvid")

    cred = load_cred()

    try:
        v = video.Video(bvid=bvid, credential=cred)
        info = await v.get_info()
    except Exception as e:
        fail(f"取视频信息失败：{type(e).__name__}: {e}")
        return

    aid = info["aid"]
    stat_reply = (info.get("stat") or {}).get("reply", 0)

    comments = []
    seen = set()
    page_index = 1
    max_page = 60
    last_err = ""

    while len(comments) < want and page_index <= max_page:
        try:
            resp = await comment.get_comments(
                oid=aid,
                type_=comment.CommentResourceType.VIDEO,
                page_index=page_index,
                order=comment.OrderType.TIME,   # ⭐ 按时间，能翻到底；LIKE 约 40 条就到底
                credential=cred,
            )
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            break

        replies = resp.get("replies") or []
        if not replies:
            break

        for r in replies:
            rpid = str(r.get("rpid") or "")
            if not rpid or rpid in seen:
                continue
            seen.add(rpid)
            member = r.get("member") or {}
            content = r.get("content") or {}
            comments.append({
                "rpid": rpid,
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

        page = resp.get("page") or {}
        page_index += 1
        await asyncio.sleep(1.5)   # ⭐ 知识库实测节奏：每页 1.3~2s
        if page_index % 5 == 1:
            await asyncio.sleep(20)

    out({
        "ok": True,
        "bvid": bvid,
        "aid": aid,
        "title": info.get("title", ""),
        "statReply": stat_reply,
        "pages": page_index - 1,
        "total": len(comments),
        "lastErr": last_err,
        "comments": comments[:want],
    })


try:
    asyncio.run(main())
except Exception as e:
    fail(f"未预期异常：{type(e).__name__}: {e}")
