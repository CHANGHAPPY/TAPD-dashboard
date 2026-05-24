#!/usr/bin/env python3
"""
TAPD 项目监控 - 数据拉取与分析模块
用法: python3 fetch.py [--iterations-only] [--iteration-id ID]
"""

import json, subprocess, datetime, sys, os
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

# 从外部配置文件读取认证凭据
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'auth.json')
with open(CONFIG_PATH) as f:
    AUTH = json.load(f)['auth']
WORKSPACE_ID = '66481329'
STORY_STATUS = {
    'new': '新建需求', 'developing': '开发中', 'suspended': '挂起',
    'resolved': '已实现', 'product_experience': '策划已验收',
    'status_1': '关闭', 'status_6': '测试验收中', 'status_7': '策划验收中',
    'status_11': 'BUG修复中', 'status_12': '三方已确认'
}
BUG_STATUS = {
    'new': '新建', 'planning': '修复中', 'resolved': '已解决',
    'verified': '测试复现', 'PMM_audited': '测试验收中', 'reopened': '重新打开',
    'suspended': '挂起', 'rejected': '已拒绝', 'closed': '已关闭'
}
CLOSED_STORY = {'resolved', 'status_1'}
CLOSED_BUG = {'closed', 'resolved', 'rejected'}
PARENT_STORY_TYPE = '1166481329001000137'  # 总单 = 主需求


def fetch(url, retries=2):
    """调用 curl 获取 TAPD API 数据，失败自动重试"""
    for attempt in range(retries + 1):
        try:
            r = subprocess.run(
                ['curl', '-s', '--noproxy', '*', '-u', AUTH, url],
                capture_output=True, text=True, timeout=30
            )
            return json.loads(r.stdout)
        except Exception as e:
            if attempt == retries:
                raise
            print(f'  API 调用失败，重试 ({attempt+1}/{retries}): {e}', file=sys.stderr)
            import time; time.sleep(1)


def fetch_paginated(base_url):
    """翻页获取全部数据，直到返回为空"""
    items = []
    page = 1
    while True:
        data = fetch(f'{base_url}&limit=200&page={page}')
        if not data.get('data'):
            break
        items.extend(data['data'])
        if len(data['data']) < 200:
            break
        page += 1
    return items


def get_iterations():
    """获取所有 open 状态的迭代（翻页拉全）"""
    items = fetch_paginated(f'https://api.tapd.cn/iterations?workspace_id={WORKSPACE_ID}')
    keep_fields = {'id', 'name', 'startdate', 'enddate', 'status'}
    return [{k: v for k, v in x['Iteration'].items() if k in keep_fields}
            for x in items if x['Iteration'].get('status') == 'open']


def analyze_iteration(iteration_id):
    """分析单个迭代的数据"""
    sd = fetch_paginated(f'https://api.tapd.cn/stories?workspace_id={WORKSPACE_ID}&iteration_id={iteration_id}')
    bd = fetch_paginated(f'https://api.tapd.cn/bugs?workspace_id={WORKSPACE_ID}&iteration_id={iteration_id}')
    stories = [x['Story'] for x in sd]
    bugs = [x['Bug'] for x in bd]
    now = datetime.date.today()

    # 延期检测
    overdue, late_closed, bug_fix_priority = [], [], []
    for s in stories:
        if s.get('due') and s['due']:
            try:
                d = datetime.datetime.strptime(s['due'], '%Y-%m-%d').date()
                if d < now and s['status'] not in CLOSED_STORY:
                    item = {
                        'id': s['id'], 'name': s['name'][:60],
                        'owner': (s.get('owner') or '').strip().rstrip(';'),
                        'due': s['due'],
                        'status': STORY_STATUS.get(s['status'], s['status'])
                    }
                    if s['status'] == 'status_11':
                        bug_fix_priority.append(item)
                    else:
                        overdue.append(item)
                elif d < now and s['status'] in CLOSED_STORY and s.get('completed'):
                    cd = datetime.datetime.strptime(s['completed'], '%Y-%m-%d %H:%M:%S').date()
                    if cd > d:
                        late_closed.append({
                            'id': s['id'], 'name': s['name'][:60],
                            'owner': (s.get('owner') or '').strip().rstrip(';'),
                            'due': s['due'], 'completed': s['completed'][:10],
                            'status': STORY_STATUS.get(s['status'], s['status'])
                        })
            except (ValueError, TypeError) as e:
                print(f'  日期解析失败 story={s.get("id")}: {e}', file=sys.stderr)
    overdue.sort(key=lambda x: x['due'])
    bug_fix_priority.sort(key=lambda x: x['due'])

    # 严重缺陷（优先高/紧急且未关闭）
    severe = []
    for b in bugs:
        if b.get('priority', '') in ['high', 'urgent'] and b['status'] not in CLOSED_BUG:
            severe.append({
                'id': b['id'], 'title': b.get('title', '')[:60],
                'owner': (b.get('current_owner') or b.get('owner') or '').strip().rstrip(';'),
                'severity': b['priority'],
                'status': BUG_STATUS.get(b['status'], b['status'])
            })

    # 人员负载（排除未分配）
    wl, unassigned_s, unassigned_b = {}, 0, 0
    for s in stories:
        owner = (s.get('owner') or '').strip().rstrip(';')
        if not owner:
            if s['status'] not in CLOSED_STORY:
                unassigned_s += 1
            continue
        if s['status'] not in CLOSED_STORY:
            wl.setdefault(owner, {'stories': 0, 'bugs': 0, 'late': 0})['stories'] += 1
    for b in bugs:
        owner = (b.get('current_owner') or b.get('owner') or '').strip().rstrip(';')
        if not owner:
            if b['status'] not in CLOSED_BUG:
                unassigned_b += 1
            continue
        if b['status'] not in CLOSED_BUG:
            wl.setdefault(owner, {'stories': 0, 'bugs': 0, 'late': 0})['bugs'] += 1
    for o in overdue:
        if o['owner']:
            if o['owner'] not in wl:
                wl[o['owner']] = {'stories': 0, 'bugs': 0, 'late': 0}
            wl[o['owner']]['late'] += 1

    # 需求列表 + 主/子分类（parent_id 为空或 "0" = 主需求，否则 = 子需求）
    parent_ids_all = set()   # 所有子需求的父ID（用于拉取跨迭代父需求详情）
    parent_ids_open = set()  # 未关闭子需求的父ID
    story_list = [{
        'id': s['id'], 'name': s['name'][:80],
        'owner': (s.get('owner') or '').strip().rstrip(';'),
        'status': STORY_STATUS.get(s['status'], s['status']),
        'is_closed': s['status'] in CLOSED_STORY,
        'due': s.get('due', '') or '', 'priority': s.get('priority_label', '') or '',
        'is_parent': s.get('workitem_type_id') == PARENT_STORY_TYPE
    } for s in stories]
    top_open = [s for s in stories if s['status'] not in CLOSED_STORY and s.get('workitem_type_id') == PARENT_STORY_TYPE]
    top_all = [s for s in stories if s.get('workitem_type_id') == PARENT_STORY_TYPE]
    child_open = [s for s in stories if s['status'] not in CLOSED_STORY and s.get('workitem_type_id') != PARENT_STORY_TYPE]
    child_all = [s for s in stories if s.get('workitem_type_id') != PARENT_STORY_TYPE]
    for s in stories:
        pid = (s.get('parent_id') or '').strip()
        if pid and pid != '0':
            parent_ids_all.add(pid)
            if s['status'] not in CLOSED_STORY:
                parent_ids_open.add(pid)

    # 拉取父需求详情（批量，每批 30 个，用于跨迭代父需求信息）
    remote_parents = []
    if parent_ids_all:
        pids = list(parent_ids_all)
        for i in range(0, len(pids), 30):
            batch = ','.join(pids[i:i+30])
            resp = fetch(f'https://api.tapd.cn/stories?workspace_id={WORKSPACE_ID}&id={batch}')
            for item in resp.get('data', []):
                ps = item['Story']
                remote_parents.append({
                    'id': ps['id'],
                    'name': ps['name'][:80],
                    'owner': (ps.get('owner') or '').strip().rstrip(';'),
                    'is_open': ps['id'] in parent_ids_open
                })

    # 构建父需求列表（当前迭代中所有顶层需求，包含尚未建子需求的）
    parent_stories = [{
        'id': s['id'],
        'name': s['name'][:80],
        'owner': (s.get('owner') or '').strip().rstrip(';'),
        'is_open': s['status'] not in CLOSED_STORY
    } for s in top_all]

    # 推进策划验收：父需求下有且仅有【策划验收】和【测试验收】两个未关闭子需求
    parent_children = {}  # parent_id -> [open child stories]
    for s in stories:
        pid = (s.get('parent_id') or '').strip()
        if pid and pid != '0' and s['status'] not in CLOSED_STORY:
            parent_children.setdefault(pid, []).append(s)
    pending_review = []
    parent_map = {ps['id']: ps for ps in remote_parents}
    for pid, children in parent_children.items():
        if len(children) == 2:
            names = [c['name'] for c in children]
            has_review = any('策划验收' in n for n in names)
            has_test = any('测试验收' in n for n in names)
            if has_review and has_test:
                ps = parent_map.get(pid)
                pending_review.append({
                    'id': pid,
                    'name': ps['name'][:60] if ps else '(未知主需求)',
                    'owner': ps['owner'] if ps else '',
                    'child_count': 2,
                    'children': [{
                        'id': c['id'], 'name': c['name'][:60],
                        'status': STORY_STATUS.get(c['status'], c['status']),
                        'owner': (c.get('owner') or '').strip().rstrip(';')
                    } for c in children]
                })
    pending_review.sort(key=lambda x: x['name'])

    # 缺陷列表
    bug_list = [{
        'id': b['id'], 'title': b.get('title', '')[:80],
        'owner': (b.get('current_owner') or b.get('owner') or '').strip().rstrip(';'),
        'status': BUG_STATUS.get(b['status'], b['status']),
        'is_closed': b['status'] in CLOSED_BUG,
        'severity': b.get('severity', '') or ''
    } for b in bugs]

    return {
        'total_stories': len(stories), 'total_bugs': len(bugs),
        'open_stories': sum(1 for s in stories if s['status'] not in CLOSED_STORY),
        'open_bugs': sum(1 for b in bugs if b['status'] not in CLOSED_BUG),
        'overdue_count': len(overdue), 'late_closed_count': len(late_closed),
        'severe_count': len(severe),
        'parent_story_count': len(top_open), 'child_story_count': len(child_open),
        'parent_story_count_all': len(top_all), 'child_story_count_all': len(child_all),
        'parent_stories': parent_stories,
        'overdue': overdue, 'late_closed': late_closed, 'severe_bugs': severe,
        'bug_fix_priority': bug_fix_priority, 'bug_fix_priority_count': len(bug_fix_priority),
        'pending_review': pending_review, 'pending_review_count': len(pending_review),
        'unassigned_stories': unassigned_s, 'unassigned_bugs': unassigned_b,
        'workload': {k: {'stories': v['stories'], 'bugs': v['bugs'], 'late': v['late']}
                     for k, v in sorted(wl.items(), key=lambda x: -(x[1]['stories'] + x[1]['bugs']))},
        'stories': story_list, 'bugs': bug_list,
        'status_dist': {k: v for k, v in Counter(
            STORY_STATUS.get(s['status'], s['status']) for s in stories).most_common()}
    }


def fetch_all():
    """拉取所有活跃迭代的数据（并行）"""
    iterations = get_iterations()
    print(f'拉取 {len(iterations)} 个迭代...')
    data = {}
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(analyze_iteration, it['id']): it for it in iterations}
        for future in as_completed(futures):
            it = futures[future]
            iid = it['id']
            try:
                data[iid] = future.result()
                print(f'  {it["name"]}: {data[iid]["total_stories"]}需求 {data[iid]["total_bugs"]}缺陷')
            except Exception as e:
                print(f'  {it["name"]}: 拉取失败 - {e}', file=sys.stderr)
    return {'iterations': iterations, 'data': data}


if __name__ == '__main__':
    if '--iterations-only' in sys.argv:
        its = get_iterations()
        print('__JSON_START__')
        print(json.dumps(its, ensure_ascii=False, indent=2))
    elif '--iteration-id' in sys.argv:
        idx = sys.argv.index('--iteration-id')
        iid = sys.argv[idx + 1]
        result = analyze_iteration(iid)
        print('__JSON_START__')
        print(json.dumps(result, ensure_ascii=False))
    else:
        result = fetch_all()
        print('__JSON_START__')
        print(json.dumps(result, ensure_ascii=False))