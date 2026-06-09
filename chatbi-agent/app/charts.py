"""
Chart recommendation and ECharts HTML generation.
Port of chart-recommender.ts + code-generator.ts.
"""
import re
import json

COLUMN_LABELS = {
    "name": "姓名", "department": "部门", "month": "月份",
    "wechat_added": "加微数", "interaction": "互动数",
    "demand": "需求数", "deal": "成交数",
}


# ── Chart Type Detection ────────────────────────────────────────

def detect_chart_type(query: str) -> str | None:
    if re.search(r'饼图|占比|比例|百分比|分布', query): return 'pie'
    if re.search(r'折线|趋势|走势|变化趋势', query): return 'line'
    if re.search(r'柱状|柱形|条形|对比图', query): return 'bar'
    if re.search(r'表格|明细|列表|详情', query): return 'table'
    return None


def detect_dimension(query: str, records: list[dict]) -> str:
    person_kws = ['销售', '销售员', '销售人员', '人员', '谁', '个人', '每个人', '各人', '各位', '名字']
    month_kws = ['月份', '各月', '每月', '月度', '趋势', '变化', '走势', '月对比', '月比较', '对比月']
    dept_kws = ['部门', '校区', '各部', '各部门', '团队', '中心']

    keyword_dim = None
    if any(kw in query for kw in person_kws):
        keyword_dim = 'name'
    elif any(kw in query for kw in dept_kws):
        keyword_dim = 'department'
    elif any(kw in query for kw in month_kws):
        keyword_dim = 'month'
    elif re.search(r'\d+月', query):
        keyword_dim = 'month'

    # Validate keyword against data columns
    if records:
        all_keys: set[str] = set()
        for r in records:
            all_keys.update(r.keys())

        if keyword_dim and keyword_dim in all_keys:
            return keyword_dim

        # Data-driven detection
        if 'month' in all_keys:
            months = set(str(r.get('month', '')) for r in records)
            if len(months) > 1:
                return 'month'
        if 'name' in all_keys:
            names = set(str(r.get('name', '')) for r in records)
            if len(names) > 1:
                return 'name'
        if 'department' in all_keys:
            return 'department'

    return keyword_dim or 'name'


def detect_metric(query: str) -> str:
    metric_map = {
        'wechat_added': ['加微', '加微信'],
        'interaction': ['互动', '企微'],
        'demand': ['需求', '有需求'],
        'deal': ['成交', '销量', '成单', '卖出'],
    }
    for col, kws in metric_map.items():
        for kw in kws:
            if kw in query:
                return col
    return 'deal'


def recommend_chart(query: str, records: list[dict]) -> dict:
    chart_type = detect_chart_type(query)
    dimension = detect_dimension(query, records)
    metric = detect_metric(query)

    if not chart_type:
        unique_vals = set(str(r.get(dimension, '')) for r in records) if records else set()
        chart_type = 'bar' if len(unique_vals) >= 2 else 'table'

    return {'type': chart_type, 'dimension': dimension, 'metric': metric}


# ── Aggregation ─────────────────────────────────────────────────

def resolve_metric_value(record: dict, metric: str) -> float:
    if metric in record:
        return float(record[metric] or 0)
    for key in record:
        if metric in key:
            return float(record[key] or 0)
    return 0


def sort_months(months: list[str]) -> list[str]:
    def month_key(m: str) -> int:
        num = re.match(r'(\d+)', m)
        return int(num.group(1)) if num else 0
    return sorted(months, key=month_key)


def aggregate_for_chart(records: list[dict], dimension: str, metric: str) -> dict[str, float]:
    agg: dict[str, float] = {}
    for r in records:
        key = str(r.get(dimension, '其他')) or '其他'
        value = resolve_metric_value(r, metric)
        agg[key] = agg.get(key, 0) + value

    if dimension == 'month':
        return dict(sort_months(agg.keys()) if False else
                    sorted(agg.items(), key=lambda x: int(re.match(r'(\d+)', x[0]).group(1)) if re.match(r'(\d+)', x[0]) else 0))

    # Sort by value desc, filter zeros, limit 15
    filtered = sorted(
        ((k, v) for k, v in agg.items() if v > 0),
        key=lambda x: -x[1],
    )[:15]
    return dict(filtered)


def is_multi_series(records: list[dict]) -> bool:
    if len(records) < 2:
        return False
    all_keys: set[str] = set()
    for r in records:
        all_keys.update(r.keys())
    if 'month' not in all_keys or 'name' not in all_keys:
        return False
    names = set(str(r.get('name', '')) for r in records)
    months = set(str(r.get('month', '')) for r in records)
    return len(names) >= 2 and len(months) >= 2


# ── ECharts Option Builders ─────────────────────────────────────

def build_echarts_option(
    chart_type: str, title: str, labels: list[str], values: list[float],
    metric_label: str, dim_label: str,
) -> dict:
    base = {
        'title': {
            'text': title, 'left': 'center', 'top': 12,
            'textStyle': {'fontSize': 15, 'fontWeight': 'bold', 'color': '#1e293b'},
        },
        'tooltip': {'trigger': 'axis'},
        'grid': {'left': '3%', 'right': '4%', 'bottom': '3%', 'top': '18%', 'containLabel': True},
    }

    if chart_type == 'bar':
        return {
            **base,
            'xAxis': {'type': 'value'},
            'yAxis': {'type': 'category', 'data': labels, 'inverse': True,
                      'axisLabel': {'fontSize': 11}},
            'series': [{
                'type': 'bar', 'data': values,
                'itemStyle': {'borderRadius': [0, 4, 4, 0]},
                'label': {'show': True, 'position': 'right', 'fontSize': 11},
            }],
        }

    if chart_type == 'line':
        return {
            **base,
            'xAxis': {'type': 'category', 'data': labels, 'boundaryGap': False},
            'yAxis': {'type': 'value', 'name': metric_label},
            'series': [{
                'type': 'line', 'data': values, 'smooth': True,
                'areaStyle': {'opacity': 0.15},
                'itemStyle': {'color': '#2563EB'},
            }],
        }

    if chart_type == 'pie':
        return {
            **base,
            'tooltip': {'trigger': 'item'},
            'series': [{
                'type': 'pie', 'radius': ['35%', '65%'], 'center': ['50%', '55%'],
                'data': [{'name': n, 'value': v} for n, v in zip(labels, values)],
                'label': {'formatter': '{b}: {c}'},
            }],
        }

    # Fallback: bar
    return {
        **base,
        'xAxis': {'type': 'category', 'data': labels},
        'yAxis': {'type': 'value', 'name': metric_label},
        'series': [{'type': 'bar', 'data': values}],
    }


def build_multi_series_option(
    records: list[dict], title: str, metric: str,
    metric_label: str, chart_type: str,
) -> dict:
    by_name: dict[str, dict[str, float]] = {}
    all_months: set[str] = set()

    for r in records:
        name = str(r.get('name', ''))
        month = str(r.get('month', ''))
        value = resolve_metric_value(r, metric)
        all_months.add(month)
        by_name.setdefault(name, {})
        by_name[name][month] = by_name[name].get(month, 0) + value

    months = sort_months(list(all_months))
    colors = ['#2563EB', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6']
    resolved_type = 'line' if chart_type == 'line' else 'bar'

    series = []
    for i, (name, month_data) in enumerate(by_name.items()):
        s: dict = {
            'name': name,
            'type': resolved_type,
            'data': [month_data.get(m, 0) for m in months],
            'itemStyle': {'color': colors[i % len(colors)]},
        }
        if resolved_type == 'line':
            s['smooth'] = True
            s['areaStyle'] = {'opacity': 0.08}
        series.append(s)

    return {
        'title': {
            'text': title, 'left': 'center', 'top': 12,
            'textStyle': {'fontSize': 15, 'fontWeight': 'bold', 'color': '#1e293b'},
        },
        'color': colors,
        'tooltip': {'trigger': 'axis'},
        'legend': {'bottom': 10, 'textStyle': {'fontSize': 12}},
        'grid': {'left': '3%', 'right': '4%', 'bottom': '15%', 'top': '18%', 'containLabel': True},
        'xAxis': {'type': 'category', 'data': months, 'boundaryGap': False},
        'yAxis': {'type': 'value', 'name': metric_label},
        'series': series,
    }


# ── Main Entry ──────────────────────────────────────────────────

def generate_chart_html(query: str, records: list[dict], columns: list[str]) -> tuple[str, dict]:
    """Returns (html, option). Empty string if no data."""
    if not records:
        return '', {}

    rec = recommend_chart(query, records)
    title = query
    metric_label = COLUMN_LABELS.get(rec['metric'], rec['metric'])
    dim_label = COLUMN_LABELS.get(rec['dimension'], rec['dimension'])

    if is_multi_series(records):
        multi_type = rec['type'] if rec['type'] not in ('pie', 'table') else 'line'
        option = build_multi_series_option(records, title, rec['metric'], metric_label, multi_type)
    else:
        agg = aggregate_for_chart(records, rec['dimension'], rec['metric'])
        labels = list(agg.keys())
        values = list(agg.values())
        option = build_echarts_option(rec['type'], title, labels, values, metric_label, dim_label)

    html = (
        '<html>\n'
        '<head>\n'
        '<meta charset="UTF-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0, '
        'maximum-scale=1.0, user-scalable=no">\n'
        '<script src="/echarts.min.js"></script>\n'
        '<style>\n'
        '*{margin:0;padding:0;box-sizing:border-box}\n'
        'html,body{width:100%;height:100%;overflow:hidden}\n'
        '#chart{width:100%;height:100%}\n'
        '</style>\n'
        '</head>\n'
        '<body>\n'
        '<div id="chart"></div>\n'
        '<script>\n'
        '(function init() {\n'
        '  if (typeof echarts === "undefined") { setTimeout(init, 50); return; }\n'
        '  var dpr = window.devicePixelRatio || 1;\n'
        '  var chart = echarts.init(document.getElementById("chart"), null, {\n'
        '    renderer: "canvas",\n'
        '    devicePixelRatio: dpr\n'
        '  });\n'
        f'  chart.setOption({json.dumps(option)});\n'
        '  window.addEventListener("resize", function() { chart.resize(); });\n'
        '})();\n'
        '</script>\n'
        '</body>\n'
        '</html>'
    )

    return html, option
