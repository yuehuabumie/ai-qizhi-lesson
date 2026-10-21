#!/usr/bin/env python3
"""Own only one explicitly allowed IPv4 host route, never a default/sysctl.

Run as root with PREP_PEER_IP set by /etc/aiq-prep/peer.env.
BBR support is optional. Conflicting administrator routes are never replaced.
"""
import argparse
import contextlib
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

ALLOWED_PEERS = frozenset({"43.131.233.40", "82.156.157.199"})
STATE_DIR = Path("/var/lib/aiq-prep-peer-route")
AVAILABLE_CC = Path("/proc/sys/net/ipv4/tcp_available_congestion_control")
SAFE_PATH = "/usr/sbin:/usr/bin:/sbin:/bin"


class RouteError(Exception):
    pass


def peer_ip(value):
    if value not in ALLOWED_PEERS:
        raise RouteError("PREP_PEER_IP 只能是本项目另一台服务器的 43.131.233.40 或 82.156.157.199")
    return value


def executable(name):
    for directory in SAFE_PATH.split(":"):
        path = Path(directory) / name
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
    raise RouteError("缺少系统命令：" + name)


def command(args):
    try:
        result = subprocess.run(args, text=True, encoding="utf-8", errors="replace",
                                capture_output=True, timeout=5, check=False,
                                env={"PATH": SAFE_PATH, "LC_ALL": "C"})
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RouteError("系统命令失败或超时：" + args[0]) from error
    if result.returncode:
        raise RouteError("系统命令被拒绝：" + " ".join(args) + ": " + result.stderr.strip()[:500])
    return result.stdout


def ip_json(ip, args):
    try:
        value = json.loads(command([ip, "-j", "-4"] + args))
    except json.JSONDecodeError as error:
        raise RouteError("iproute2 没有返回有效 JSON；保留现有网络配置") from error
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise RouteError("iproute2 JSON 结构不正确")
    return value


def ipv4(value, name):
    try:
        address = ipaddress.IPv4Address(value)
    except (ValueError, TypeError) as error:
        raise RouteError(name + " 不是 IPv4 地址") from error
    if address.is_unspecified or address.is_multicast or address.is_loopback:
        raise RouteError(name + " 不可用于公网对端路由")
    return str(address)


def path_from_lookup(peer, rows):
    if len(rows) != 1:
        raise RouteError("对端路由查询不唯一；保留现有配置")
    row = rows[0]
    if row.get("type", "unicast") != "unicast" or row.get("table", "main") not in ("main", 254, "254"):
        raise RouteError("仅支持 main 表中的普通单路径出口")
    if any(key in row for key in ("nexthops", "multipath", "nhid", "encap", "via")):
        raise RouteError("不接管多路径或封装路由")
    dev = row.get("dev", "")
    if not isinstance(dev, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:@-]{0,63}", dev) or dev == "lo":
        raise RouteError("路由出口设备不正确")
    source = ipv4(row.get("prefsrc") or row.get("src"), "源地址")
    if source == peer:
        raise RouteError("PREP_PEER_IP 指向本机；必须配置另一台服务器")
    flags = row.get("flags", [])
    if not isinstance(flags, list) or any(flag not in ("onlink",) for flag in flags):
        raise RouteError("出口包含不支持的路由标志")
    return {"dev": dev, "src": source,
            "gateway": ipv4(row["gateway"], "网关") if row.get("gateway") else None,
            "onlink": "onlink" in flags}


def metrics_of(row):
    raw = row.get("metrics", {})
    if isinstance(raw, list):
        result = {}
        for item in raw:
            if not isinstance(item, dict) or result.keys() & item.keys():
                raise RouteError("无法确认现有路由 metrics")
            result.update(item)
        return result
    if isinstance(raw, dict):
        return raw
    raise RouteError("无法确认现有路由 metrics")


def exact_routes(ip, peer):
    # Inspect every table: do not shadow an existing policy/local host route.
    return ip_json(ip, ["route", "show", "table", "all", "exact", peer + "/32"])


def assert_matching(row, peer, desired, text):
    allowed = {"dst", "gateway", "dev", "prefsrc", "src", "flags", "protocol", "scope", "type", "table", "metrics"}
    if set(row) - allowed:
        raise RouteError("已有 /32 路由含额外属性；拒绝覆盖")
    if row.get("dst") not in (peer, peer + "/32") or row.get("table", "main") not in ("main", 254, "254"):
        raise RouteError("已有 /32 路由不属于预期 main 表目的地址")
    if row.get("type", "unicast") != "unicast" or row.get("protocol", "boot") not in ("boot", "static", 3, 4):
        raise RouteError("不接管其他协议或类型的 /32 路由")
    actual = path_from_lookup(peer, [row])
    metrics = metrics_of(row)
    # iproute2 labels RTAX_CC_ALGO "congestion" in JSON, "congctl" in
    # human output; accept the latter spelling for compatible vendor builds.
    congestion = metrics.get("congestion", metrics.get("congctl"))
    if actual != desired or congestion != "bbr" or set(metrics) - {"congestion", "congctl", "lock"}:
        raise RouteError("已有 /32 路由与预期出口/源地址/BBR 不匹配；拒绝覆盖")
    # iproute2 exposes the algorithm in JSON but can omit the RTAX_LOCK bit.
    # Confirm lock from their own text formatter, never infer it from congctl.
    if not re.search(r"\bcongctl\s+lock\s+bbr(?:\s|$)", text):
        raise RouteError("无法确认已有 /32 路由锁定 BBR；拒绝覆盖")


def route_text(ip, peer):
    return command([ip, "-o", "-4", "route", "show", "table", "all", "exact", peer + "/32"])


def bbr_available():
    def available():
        try:
            return "bbr" in AVAILABLE_CC.read_text(encoding="ascii").split()
        except OSError:
            return False
    if available():
        return True
    try:
        command([executable("modprobe"), "tcp_bbr"])
    except RouteError:
        pass
    return available()


def private_directory():
    STATE_DIR.mkdir(mode=0o700, exist_ok=True)
    info = STATE_DIR.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o077:
        raise RouteError("路由状态目录必须是 root 拥有的真实 0700 目录")


def state_path(peer):
    return STATE_DIR / (peer + ".json")


def load_state(peer):
    path = state_path(peer)
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return None
    with os.fdopen(fd, "r", encoding="utf-8") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o077 or info.st_size > 16384:
            raise RouteError("路由状态文件权限或类型不正确")
        try:
            value = json.load(stream)
        except json.JSONDecodeError as error:
            raise RouteError("路由状态记录损坏；保留现有路由") from error
    if not isinstance(value, dict) or value.get("version") != 1 or value.get("peer") != peer or not isinstance(value.get("route"), dict):
        raise RouteError("路由状态记录不正确")
    return value


def save_state(peer, row, origin):
    fd, temporary = tempfile.mkstemp(prefix=".peer-", dir=STATE_DIR)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump({"version": 1, "peer": peer, "origin": origin, "route": row}, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, state_path(peer))
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def route_args(action, peer, desired, protocol="static"):
    args = ["-4", "route", action, peer + "/32", "table", "main"]
    if desired["gateway"]:
        args += ["via", desired["gateway"]]
    args += ["dev", desired["dev"], "proto", str(protocol), "src", desired["src"]]
    if desired["onlink"]:
        args.append("onlink")
    return args + ["congctl", "lock", "bbr"]


def apply_route(ip, peer):
    if not bbr_available():
        print("WARNING: BBR 不可用；保留系统现有路由与拥塞控制，broker/tunnel 可继续启动", file=sys.stderr)
        return
    desired = path_from_lookup(peer, ip_json(ip, ["route", "get", peer]))
    rows = exact_routes(ip, peer)
    if len(rows) > 1:
        raise RouteError("发现多个已有 /32 路由；拒绝覆盖")
    previous = load_state(peer)
    if rows:
        assert_matching(rows[0], peer, desired, route_text(ip, peer))
        if previous and previous["route"] != rows[0]:
            raise RouteError("已管理 /32 路由被外部修改；拒绝接管")
        save_state(peer, rows[0], previous.get("origin", "adopted-existing") if previous else "adopted-existing")
        print(peer + "/32 已锁定 BBR；现有同配置路由已登记，不替换")
        return
    # add is deliberately exclusive; a concurrent foreign route causes EEXIST.
    command([ip] + route_args("add", peer, desired))
    created = exact_routes(ip, peer)
    if len(created) != 1:
        raise RouteError("添加后的 /32 路由无法唯一确认；请人工检查")
    assert_matching(created[0], peer, desired, route_text(ip, peer))
    try:
        save_state(peer, created[0], "created")
    except OSError:
        # Never leave a successful mutation without an ownership record if its
        # verification still matches. Never use replace/flush as a rollback.
        if exact_routes(ip, peer) == created:
            command([ip] + route_args("del", peer, desired))
        raise
    print("已添加 " + peer + "/32 congctl lock bbr，出口 " + desired["dev"])


def remove_route(ip, peer):
    saved = load_state(peer)
    if not saved:
        print("没有本脚本的管理记录；保留所有现有路由")
        return
    rows = exact_routes(ip, peer)
    if not rows:
        state_path(peer).unlink()
        print("已管理的 /32 路由已不存在；仅清理管理记录")
        return
    if rows != [saved["route"]]:
        raise RouteError("当前 /32 路由已变化；拒绝删除其他配置")
    desired = path_from_lookup(peer, rows)
    assert_matching(rows[0], peer, desired, route_text(ip, peer))
    command([ip] + route_args("del", peer, desired, rows[0].get("protocol", "boot")))
    state_path(peer).unlink()
    print("已移除本脚本登记的 " + peer + "/32；恢复使用原有更宽路由")


@contextlib.contextmanager
def process_lock():
    import fcntl  # Linux only; imported here so pure validation can be tested elsewhere.
    fd = os.open("/run/lock/aiq-prep-peer-route.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o022:
            raise RouteError("路由锁文件不安全")
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("apply", "remove", "status"), nargs="?", default="apply")
    args = parser.parse_args()
    try:
        if not hasattr(os, "geteuid") or os.geteuid() != 0:
            raise RouteError("此脚本只在 Linux 宿主上由 root 运行")
        peer = peer_ip(os.environ.get("PREP_PEER_IP", ""))
        ip = executable("ip")
        private_directory()
        with process_lock():
            if args.action == "apply":
                apply_route(ip, peer)
            elif args.action == "remove":
                remove_route(ip, peer)
            else:
                print(json.dumps({"peer": peer, "managed": load_state(peer) is not None,
                                  "routes": exact_routes(ip, peer)}, ensure_ascii=False, sort_keys=True))
                print(route_text(ip, peer).strip() or "没有精确 /32 路由")
        return 0
    except (RouteError, OSError) as error:
        print("ERROR: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
