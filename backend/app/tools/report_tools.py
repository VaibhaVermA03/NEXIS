"""Summarizes structured data supplied by the caller (pure computation, no side effects)."""
from collections import defaultdict


def generate_report(title: str, rows: list[dict], group_by: str | None = None, sum_field: str | None = None) -> dict:
    lines = [f"# {title}", "", f"Records analysed: {len(rows)}"]
    numeric = {}
    if rows:
        for key in sorted({k for r in rows for k in r}):
            vals = [r[key] for r in rows if isinstance(r.get(key), (int, float)) and not isinstance(r.get(key), bool)]
            if vals:
                numeric[key] = {"count": len(vals), "sum": round(sum(vals), 2), "min": min(vals), "max": max(vals),
                                "avg": round(sum(vals) / len(vals), 2)}
    if numeric:
        lines += ["", "## Numeric fields"] + [
            f"- {k}: count={v['count']}, sum={v['sum']}, avg={v['avg']}, min={v['min']}, max={v['max']}"
            for k, v in numeric.items()]
    groups = {}
    if group_by:
        agg = defaultdict(lambda: {"count": 0, "sum": 0.0})
        for r in rows:
            g = agg[str(r.get(group_by, "(missing)"))]
            g["count"] += 1
            if sum_field and isinstance(r.get(sum_field), (int, float)):
                g["sum"] += r[sum_field]
        groups = {k: {"count": v["count"], **({"sum": round(v["sum"], 2)} if sum_field else {})}
                  for k, v in sorted(agg.items())}
        lines += ["", f"## By {group_by}"] + [f"- {k}: {v}" for k, v in groups.items()]
    return {"title": title, "record_count": len(rows), "numeric_summary": numeric, "groups": groups,
            "markdown": "\n".join(lines)}
