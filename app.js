/**
 * TAPD 项目监控 - 前端核心逻辑
 * 依赖: Chart.js (CDN)
 */

const App = {
    allData: null,
    currentIterId: null,

    /** 将短键名数据标准化为长键名 */
    normalizeData(data) {
        for (const iid in data.data) {
            const d = data.data[iid];
            // 顶层计数键名: ts→total_stories, os→open_stories, 等
            if (d.ts !== undefined) { d.total_stories = d.ts; d.total_bugs = d.tb; d.open_stories = d.os; d.open_bugs = d.ob; d.overdue_count = d.oc; d.late_closed_count = d.lc; d.severe_count = d.sc; d.unassigned_stories = d.us; d.unassigned_bugs = d.ub; d.status_dist = d.sd; d.parent_story_count = d.ps || 0; d.child_story_count = d.cs || d.os; }
            // 缺失时回退: parent_story_count→0, child_story_count→total_stories
            if (d.parent_story_count === undefined) d.parent_story_count = 0;
            if (d.child_story_count === undefined) d.child_story_count = d.total_stories || 0;
            if (d.bug_fix_priority === undefined) d.bug_fix_priority = [];
            if (d.bug_fix_priority_count === undefined) d.bug_fix_priority_count = 0;
            if (d.parent_stories === undefined) d.parent_stories = [];
            if (d.pending_review === undefined) d.pending_review = [];
            if (d.pending_review_count === undefined) d.pending_review_count = 0;
            // overdue 数组: ov→overdue, 条目内: i→id, n→name, o→owner, d→due, s→status
            d.overdue = (d.overdue || d.ov || []).map(x => ({ id: x.i || x.id || '', name: x.n || x.name || '', owner: x.o || x.owner || '', due: x.d || x.due || '', status: x.s || x.status || '' }));
            // late_closed 数组: lcv→late_closed, 条目内增加 c→completed
            d.late_closed = (d.late_closed || d.lcv || []).map(x => ({ id: x.i || x.id || '', name: x.n || x.name || '', owner: x.o || x.owner || '', due: x.d || x.due || '', completed: x.c || x.completed || '', status: x.s || x.status || '' }));
            // severe_bugs 数组: sv→severe_bugs, 条目内: t→title, v→severity
            d.severe_bugs = (d.severe_bugs || d.sv || []).map(x => ({ id: x.i || x.id || '', title: x.t || x.title || '', owner: x.o || x.owner || '', severity: x.v || x.severity || '', status: x.s || x.status || '' }));
            // workload: wl→workload, 条目内: s→stories, b→bugs, l→late
            const wlSrc = d.workload || d.wl || {};
            const wl = {}; for (const k in wlSrc) { const v = wlSrc[k]; wl[k] = { stories: v.stories !== undefined ? v.stories : (v.s || 0), bugs: v.bugs !== undefined ? v.bugs : (v.b || 0), late: v.late !== undefined ? v.late : (v.l || 0) }; }
            d.workload = wl;
        }
    },

    /** 初始化 */
    init(data) {
        this.normalizeData(data);
        this.allData = data;
        this.setupIterSelector();
        this.currentIterId = data.iterations[0].id;
        this.render();
    },

    /** 填充迭代下拉 */
    setupIterSelector() {
        const sel = document.getElementById('iterSelect');
        sel.innerHTML = '';
        this.allData.iterations.forEach(it => {
            const d = this.allData.data[it.id] || {};
            sel.innerHTML += `<option value="${it.id}">${it.name} (${d.total_stories || 0}需求)</option>`;
        });
        sel.onchange = () => {
            this.currentIterId = sel.value;
            this.render();
        };
    },

    /** 主渲染 */
    render() {
        ['parentList', 'progressList', 'overdueList', 'bugList'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
        const D = this.allData.data[this.currentIterId];
        if (!D) return;

        const it = this.allData.iterations.find(i => i.id === this.currentIterId);
        document.getElementById('dateLine').textContent =
            `${it ? it.startdate + ' ~ ' + it.enddate : ''} | 预加载数据 | 点右上角刷新获取最新`;

        this.renderSummary(D);
        this.setupParentClick(D);
        this.setupProgressClick(D, it);
        this.setupOverdueClick(D);
        this.setupBugClick(D);
        // 默认展开（按插入顺序：先完成率，再延期，最后缺陷）
        ['bugList', 'overdueList', 'progressList'].forEach(id => {
            if (!document.getElementById(id)) {
                const el = {progressList: 'progressStat', overdueList: 'overdueStat', bugList: 'bugStat'}[id];
                document.getElementById(el)?.click();
            }
        });
        this.renderInsights(D, it);
    },

    /** 摘要数字 */
    renderSummary(D) {
        const parentAll = D.parent_story_count_all || D.parent_story_count || 0;
        const parentDone = parentAll - (D.parent_story_count || 0);
        const childAll = D.total_stories || 0;
        const childDone = childAll - (D.open_stories || 0);
        const totalAll = parentAll + childAll;
        const totalDone = parentDone + childDone;
        const pct = totalAll > 0 ? Math.round(totalDone / totalAll * 100) : 0;
        const parentCount = D.parent_story_count || 0;
        const childCount = D.child_story_count || D.open_stories || 0;
        document.getElementById('summary').innerHTML =
            `<div class="stat stat-sub stat-clickable stat-parent" id="parentStat"><div class="num">${parentCount}</div><div class="label">主需求 ▾</div></div>
            <div class="stat stat-sub"><div class="num">${childCount}</div><div class="label">子需求</div></div>
            <div class="stat stat-clickable stat-green" id="progressStat"><div class="num">${pct}%</div><div class="label">完成率 ▾</div></div>
            <div class="stat stat-clickable stat-red" id="overdueStat"><div class="num" style="color:var(--red)">${D.overdue_count}</div><div class="label">延期 ▾</div></div>
            <div class="stat stat-clickable stat-yellow" id="bugStat"><div class="num" style="color:var(--purple)">${D.open_bugs || 0}</div><div class="label">缺陷 ▾</div></div>
            <div class="stat"><div class="num">${Object.keys(D.workload).length}</div><div class="label">参与人员</div></div>`;
    },

    /** 通用展开/收起 */
    toggleExpand(listId, statId, panelClass, buildContent) {
        const existing = document.getElementById(listId);
        const stat = document.getElementById(statId);
        if (existing) {
            existing.remove();
            if (stat) { stat.classList.remove('stat-expanded'); const lb = stat.querySelector('.label'); if (lb) lb.innerHTML = lb.innerHTML.replace('▴', '▾'); }
            return;
        }
        if (stat) { stat.classList.add('stat-expanded'); const lb = stat.querySelector('.label'); if (lb) lb.innerHTML = lb.innerHTML.replace('▾', '▴'); }
        const div = document.createElement('div');
        div.id = listId;
        div.className = 'parent-list ' + panelClass;
        div.innerHTML = buildContent();
        document.getElementById('summary').after(div);
    },

    /** 主需求点击展开 */
    setupParentClick(D) {
        const el = document.getElementById('parentStat');
        if (!el) return;
        el.onclick = () => this.toggleExpand('parentList', 'parentStat', '', () => {
            const parents = (D.parent_stories || []).filter(p => p.is_open);
            if (parents.length === 0) return '';
            const items = parents.map(p =>
                `<li>${esc(p.name)} <span class="tag tag-gray">${esc(p.owner || '未分配')}</span></li>`
            ).join('');
            return `<div class="parent-list-title">未完成主需求 (${parents.length}个)</div><ul>${items}</ul>`;
        });
    },

    /** 完成率点击展开 */
    setupProgressClick(D, it) {
        const el = document.getElementById('progressStat');
        if (!el) return;
        el.onclick = () => this.toggleExpand('progressList', 'progressStat', 'panel-green', () => {
            const parentAll = D.parent_story_count_all || D.parent_story_count || 0;
            const parentDone = parentAll - (D.parent_story_count || 0);
            const childAll = D.total_stories || 0;
            const childDone = childAll - (D.open_stories || 0);
            const totalAll = parentAll + childAll;
            const totalDone = parentDone + childDone;
            const pct = totalAll > 0 ? Math.round(totalDone / totalAll * 100) : 0;
            let msg = '';
            if (pct < 30 && it && it.enddate) msg = `进度偏慢，截止 ${it.enddate}。建议评估排期。`;
            else if (pct >= 80) msg = '进度良好。';
            else msg = '进度正常，按节奏推进。';
            return `<div class="parent-list-title">完成率 ${pct}%</div>
                <ul><li>已完成主需求 ${parentDone} / 全部 ${parentAll}</li>
                <li>已完成子需求 ${childDone} / 全部 ${childAll}</li>
                <li>合计已完成 ${totalDone} / 全部 ${totalAll}</li></ul>
                <div style="margin-top:4px;font-size:13px">${msg}</div>`;
        });
    },

    /** 延期点击展开 */
    setupOverdueClick(D) {
        const el = document.getElementById('overdueStat');
        if (!el) return;
        el.onclick = () => this.toggleExpand('overdueList', 'overdueStat', 'panel-red', () => {
            const overdue = D.overdue || [];
            if (overdue.length === 0) return '<div class="parent-list-title">无延期需求</div>';
            const owners = {};
            overdue.forEach(o => owners[o.owner] = (owners[o.owner] || 0) + 1);
            const topNames = Object.entries(owners).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => `${esc(e[0])}(${e[1]}个)`).join(', ');
            const items = overdue.slice(0, 8).map(o =>
                `<li>${esc(o.name)} <span class="tag tag-red">${o.due}</span> <span class="tag tag-gray">${esc(o.owner || '未分配')}</span></li>`
            ).join('');
            return `<div class="parent-list-title">${overdue.length} 个需求已延期</div>
                <div style="font-size:12px;color:var(--muted);margin-bottom:4px">集中在 ${topNames}</div>
                <ul>${items}${overdue.length > 8 ? `<li><small>...还有 ${overdue.length - 8} 个</small></li>` : ''}</ul>`;
        });
    },

    /** 缺陷点击展开 */
    setupBugClick(D) {
        const el = document.getElementById('bugStat');
        if (!el) return;
        el.onclick = () => this.toggleExpand('bugList', 'bugStat', 'panel-yellow', () => {
            const severe = D.severe_bugs || [];
            if (severe.length === 0) return `<div class="parent-list-title">无严重缺陷</div><div style="font-size:12px;color:var(--muted)">共 ${D.open_bugs || 0} 个未关闭缺陷，无高优/紧急缺陷</div>`;
            const items = severe.map(b =>
                `<li>${esc(b.title)} <span class="tag tag-red">${esc(b.severity)}</span> <span class="tag tag-gray">${esc(b.owner || '未分配')}</span></li>`
            ).join('');
            return `<div class="parent-list-title">${severe.length} 个严重缺陷</div>
                <div style="font-size:12px;color:var(--muted);margin-bottom:4px">共 ${D.open_bugs || 0} 个未关闭缺陷，其中高优/紧急如下</div>
                <ul>${items}</ul>`;
        });
    },

    /** 智能洞察 */
    renderInsights(D, it) {
        const alerts = [];
        const pct = D.total_stories > 0
            ? Math.round((D.total_stories - D.open_stories) / D.total_stories * 100) : 0;

        // 1. 推进策划验收
        const prCount = D.pending_review_count || 0;
        if (prCount > 0) {
            const prItems = (D.pending_review || []).map(p => {
                const childInfo = p.children ? p.children.map(c =>
                    `${esc(c.name)} <span class="tag tag-gray">${esc(c.status)}</span>`
                ).join('<br>') : '';
                return `<li><strong>${esc(p.name)}</strong> <span class="tag tag-gray">${esc(p.owner || '未分配')}</span><br><small>${childInfo || p.child_count + '个子需求'}</small></li>`;
            }).join('');
            alerts.push({
                cls: 'alert-teal',
                title: `${prCount} 个主需求待策划验收`,
                body: `子需求全部进入测试/策划验收阶段，需要推进验收：<ul>${prItems}</ul>`
            });
        }

        // 1.5 优先推进Bug修复（BUG修复中且已延期）
        const bfpCount = D.bug_fix_priority_count || 0;
        if (bfpCount > 0) {
            const bfpItems = (D.bug_fix_priority || []).slice(0, 5).map(o =>
                `<li>${esc(o.name)} <span class="tag tag-red">${o.due}</span> <span class="tag tag-gray">${esc(o.owner || '未分配')}</span></li>`
            ).join('');
            alerts.push({
                cls: 'alert-orange',
                title: `${bfpCount} 个需求优先推进Bug修复`,
                body: `以下需求状态为"BUG修复中"且已超过截止日期：<ul>${bfpItems}${(D.bug_fix_priority || []).length > 5 ? `<li><small>...还有 ${D.bug_fix_priority.length - 5} 个</small></li>` : ''}</ul>`
            });
        }

        if (alerts.length === 0) {
            alerts.push({ cls: 'alert-green', title: '一切正常', body: '当前迭代没有需要关注的问题。' });
        }

        document.getElementById('alerts').innerHTML = alerts.map(a =>
            `<div class="alert ${a.cls}"><div class="alert-title">${a.title}</div><div class="alert-body">${a.body}</div></div>`
        ).join('');
    },

    /** 刷新数据 */
    async refresh() {
        const btn = document.getElementById('btnRefresh');
        btn.disabled = true;
        btn.textContent = '刷新中...';
        document.getElementById('alerts').innerHTML = '<div class="updating"><span class="spin">&#x21bb;</span> 正在拉取最新数据...</div>';

        try {
            const resp = await fetch('/refresh', { method: 'POST' });
            if (!resp.ok) throw new Error(await resp.text() || `HTTP ${resp.status}`);
            const text = await resp.text();
            const jsonStr = text.replace(/^var PRELOAD_DATA = /, '').replace(/;$/, '');
            const newData = JSON.parse(jsonStr);
            this.allData = newData;
            this.normalizeData(this.allData);
            this.setupIterSelector();
            this.currentIterId = this.allData.iterations[0].id;
            this.render();
            document.getElementById('dateLine').textContent += ' | 已刷新 (' + new Date().toLocaleTimeString() + ')';
        } catch (e) {
            document.getElementById('alerts').innerHTML =
                `<div class="alert alert-red"><div class="alert-title">刷新失败</div><div class="alert-body">${esc(e.message)}<br><small>请在终端运行 <code>python3 build.py</code> 后刷新页面。</small></div></div>`;
        } finally {
            btn.disabled = false;
            btn.textContent = '刷新';
        }
    },

    /** 通过 MCP 调用 fetch.py 获取单个迭代数据（Cowork 环境） */
    async runFetch(iterationId) {
        await Utils.waitForCowork();
        const cmd = `python3 fetch.py --iteration-id ${iterationId}`;
        return await window.cowork.callMcpTool('mcp__workspace__bash', {
            command: cmd,
            timeout_ms: 120000
        });
    }
};

/** 工具函数 */
const Utils = {
    esc(s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    },

    extractText(r) {
        if (typeof r === 'string') return r;
        if (Array.isArray(r)) return r.map(x => (x && x.text) ? x.text : String(x)).join('\n');
        if (r && Array.isArray(r.content)) return r.content.map(c => (c && c.text) ? c.text : String(c)).join('\n');
        if (r && typeof r.content === 'string') return r.content;
        if (r && r.text) return r.text;
        return JSON.stringify(r);
    },

    waitForCowork() {
        return new Promise((resolve, reject) => {
            if (window.cowork && window.cowork.callMcpTool) { resolve(); return; }
            let n = 0;
            const t = setInterval(() => {
                n++;
                if (window.cowork && window.cowork.callMcpTool) { clearInterval(t); resolve(); }
                else if (n > 20) { clearInterval(t); reject(new Error('当前不在 Cowork 环境中，无法实时刷新。请在终端运行 python3 build.py 更新数据。')); }
            }, 200);
        });
    }
};

/** HTML 转义简写 */
function esc(s) { return Utils.esc(s); }

/** 初始化 */
window.onload = () => App.init(PRELOAD_DATA);
