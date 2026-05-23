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
        this.currentIterId = data.iterations[0].id;
        this.setupIterSelector();
        this.render();
    },

    /** 聚合全部迭代数据 */
    buildAllData() {
        const result = {
            total_stories: 0, total_bugs: 0, open_stories: 0, open_bugs: 0,
            overdue_count: 0, late_closed_count: 0, severe_count: 0,
            parent_story_count: 0, parent_story_count_all: 0, child_story_count: 0,
            unassigned_stories: 0, unassigned_bugs: 0,
            bug_fix_priority_count: 0, pending_review_count: 0,
            overdue: [], severe_bugs: [], bug_fix_priority: [], pending_review: [],
            parent_stories: [], workload: {}, status_dist: {}, stories: [], bugs: []
        };
        const allParents = new Map();
        for (const iid in this.allData.data) {
            const d = this.allData.data[iid];
            result.total_stories += d.total_stories || 0;
            result.total_bugs += d.total_bugs || 0;
            result.open_stories += d.open_stories || 0;
            result.open_bugs += d.open_bugs || 0;
            result.overdue_count += d.overdue_count || 0;
            result.late_closed_count += d.late_closed_count || 0;
            result.severe_count += d.severe_count || 0;
            result.parent_story_count += d.parent_story_count || 0;
            result.parent_story_count_all += d.parent_story_count_all || 0;
            result.child_story_count += d.child_story_count || 0;
            result.unassigned_stories += d.unassigned_stories || 0;
            result.unassigned_bugs += d.unassigned_bugs || 0;
            result.bug_fix_priority_count += d.bug_fix_priority_count || 0;
            result.pending_review_count += d.pending_review_count || 0;
            if (d.overdue) result.overdue.push(...d.overdue);
            if (d.severe_bugs) result.severe_bugs.push(...d.severe_bugs);
            if (d.bug_fix_priority) result.bug_fix_priority.push(...d.bug_fix_priority);
            if (d.pending_review) result.pending_review.push(...d.pending_review);
            if (d.stories) result.stories.push(...d.stories);
            if (d.bugs) result.bugs.push(...d.bugs);
            for (const ps of (d.parent_stories || [])) {
                if (!allParents.has(ps.id)) allParents.set(ps.id, ps);
                else if (ps.is_open) allParents.set(ps.id, ps);
            }
            for (const [k, v] of Object.entries(d.workload || {})) {
                const w = result.workload[k] || { stories: 0, bugs: 0, late: 0 };
                w.stories += v.stories || 0;
                w.bugs += v.bugs || 0;
                w.late += v.late || 0;
                result.workload[k] = w;
            }
        }
        result.parent_stories = [...allParents.values()];
        result.overdue.sort((a, b) => (a.due || '').localeCompare(b.due || ''));
        return result;
    },

    /** 填充侧边栏迭代列表 */
    setupIterSelector() {
        const sidebar = document.getElementById('sidebar');
        const savedOrder = this.loadOrder();

        // 全部迭代汇总
        let allStories = 0, allBugs = 0;
        this.allData.iterations.forEach(it => {
            const d = this.allData.data[it.id] || {};
            allStories += (d.open_stories || 0);
            allBugs += (d.open_bugs || 0);
        });

        const items = [
            { id: '__all__', name: '全部迭代', stories: allStories, bugs: allBugs }
        ];
        // 按保存的顺序排列（过滤掉已不存在的）
        const idToIter = {};
        this.allData.iterations.forEach(it => { idToIter[it.id] = it; });
        (savedOrder || []).forEach(id => {
            if (idToIter[id]) items.push({ id, name: idToIter[id].name, stories: idToIter[id].stories, bugs: idToIter[id].bugs });
        });
        // 加上新出现的迭代
        this.allData.iterations.forEach(it => {
            if (!items.find(x => x.id === it.id)) items.push({ id: it.id, name: it.name });
        });
        // 填充 stories/bugs 计数
        items.forEach(item => {
            if (item.stories === undefined) {
                const d = this.allData.data[item.id] || {};
                item.stories = d.open_stories || 0;
                item.bugs = d.open_bugs || 0;
            }
        });

        sidebar.innerHTML = '';
        items.forEach((item, index) => {
            const btn = document.createElement('button');
            btn.className = 'sidebar-item';
            btn.draggable = true;
            btn.dataset.id = item.id;
            btn.innerHTML = `${item.name}<br><span class="count">${item.stories}需求 ${item.bugs}缺陷</span>`;
            btn.onclick = () => {
                if (item.id === '__all__') {
                    this.currentIterId = null;
                } else {
                    this.currentIterId = item.id;
                }
                this.render();
                sidebar.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            };
            // 拖拽事件
            btn.addEventListener('dragstart', (e) => {
                if (item.id === '__all__') { e.preventDefault(); return; }
                e.dataTransfer.setData('text/plain', item.id);
                e.dataTransfer.effectAllowed = 'move';
                setTimeout(() => btn.classList.add('dragging'), 0);
            });
            btn.addEventListener('dragend', () => {
                btn.classList.remove('dragging');
                sidebar.querySelectorAll('.sidebar-item').forEach(b => {
                    b.classList.remove('drop-above', 'drop-below');
                });
            });
            btn.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (item.id === '__all__') return;
                // 根据鼠标在目标上半部还是下半部决定插入位置
                const rect = btn.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                sidebar.querySelectorAll('.sidebar-item').forEach(b => {
                    b.classList.remove('drop-above', 'drop-below');
                });
                if (e.clientY < mid) {
                    btn.classList.add('drop-above');
                } else {
                    btn.classList.add('drop-below');
                }
            });
            btn.addEventListener('dragleave', () => {
                btn.classList.remove('drop-above', 'drop-below');
            });
            btn.addEventListener('drop', (e) => {
                e.preventDefault();
                btn.classList.remove('drop-above', 'drop-below');
                const fromId = e.dataTransfer.getData('text/plain');
                if (!fromId || fromId === item.id || fromId === '__all__') return;
                const fromBtn = sidebar.querySelector(`[data-id="${fromId}"]`);
                if (!fromBtn) return;
                const rect = btn.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                if (e.clientY < mid) {
                    btn.before(fromBtn);
                } else {
                    btn.after(fromBtn);
                }
                this.saveOrder();
            });

            const isActive = (item.id === '__all__' && this.currentIterId === null) || item.id === this.currentIterId;
            if (isActive) btn.classList.add('active');
            sidebar.appendChild(btn);
        });
    },

    loadOrder() {
        try { return JSON.parse(localStorage.getItem('tapd_iter_order') || 'null'); } catch { return null; }
    },
    saveOrder() {
        const ids = [...document.querySelectorAll('.sidebar-item')].map(b => b.dataset.id).filter(id => id !== '__all__');
        localStorage.setItem('tapd_iter_order', JSON.stringify(ids));
    },

    /** 主渲染 */
    render() {
        // 记录哪些面板是打开状态（首次默认展开延期）
        if (!this.openPanels) this.openPanels = new Set(['overdueList']);
        const panelIds = ['parentList', 'progressList', 'overdueList', 'bugList', 'personnelList', 'childList'];
        panelIds.forEach(id => {
            if (document.getElementById(id)) this.openPanels.add(id);
            // 不在 DOM 里的不删，保留默认值
        });

        panelIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
        const D = this.currentIterId ? this.allData.data[this.currentIterId] : this.buildAllData();
        if (!D) return;

        const it = this.currentIterId ? this.allData.iterations.find(i => i.id === this.currentIterId) : null;
        document.getElementById('dateLine').textContent = this.currentIterId
            ? `${it ? it.startdate + ' ~ ' + it.enddate : ''} | 预加载数据 | 点右上角刷新获取最新`
            : `全部迭代汇总 | ${this.allData.iterations.length} 个迭代 | 预加载数据`;

        this.renderSummary(D);
        this.setupParentClick(D);
        this.setupProgressClick(D, it);
        this.setupOverdueClick(D);
        this.setupBugClick(D);
        this.setupPersonnelClick(D);
        this.setupChildClick(D);
        // 恢复之前打开的面板（默认展开延期）
        const statMap = { parentList: 'parentStat', progressList: 'progressStat', overdueList: 'overdueStat', bugList: 'bugStat', personnelList: 'personnelStat', childList: 'childStat' };
        panelIds.forEach(id => {
            if (this.openPanels.has(id) && !document.getElementById(id)) {
                document.getElementById(statMap[id])?.click();
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
            <div class="stat stat-sub stat-clickable stat-lavender" id="childStat"><div class="num">${childCount}</div><div class="label">子需求 ▾</div></div>
            <div class="stat stat-clickable stat-green" id="progressStat"><div class="num">${pct}%</div><div class="label">完成率 ▾</div></div>
            <div class="stat stat-clickable stat-red" id="overdueStat"><div class="num" style="color:var(--red)">${D.overdue_count}</div><div class="label">延期 ▾</div></div>
            <div class="stat stat-clickable stat-yellow" id="bugStat"><div class="num" style="color:var(--purple)">${D.open_bugs || 0}</div><div class="label">缺陷 ▾</div></div>
            <div class="stat stat-clickable stat-stone" id="personnelStat"><div class="num">${Object.keys(D.workload).length}</div><div class="label">参与人员 ▾</div></div>`;
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

    /** 参与人员点击展开 */
    setupPersonnelClick(D) {
        const el = document.getElementById('personnelStat');
        if (!el) return;

        const buildChartData = (sortBy) => {
            const wl = D.workload || {};
            const entries = Object.entries(wl);
            const sortKey = (sortBy === 'bugs') ? (e => e[1].bugs) :
                           (sortBy === 'stories') ? (e => e[1].stories) :
                           (e => e[1].stories + e[1].bugs);
            entries.sort((a, b) => sortKey(b) - sortKey(a));
            return {
                labels: entries.map(e => e[0]),
                storyData: entries.map(e => e[1].stories),
                bugData: entries.map(e => e[1].bugs)
            };
        };

        const renderChart = (container, initialSort) => {
            const data = buildChartData(initialSort);
            const chart = new Chart(document.getElementById('workloadChart').getContext('2d'), {
                type: 'bar',
                data: {
                    labels: data.labels,
                    datasets: [
                        { label: '需求', data: data.storyData, backgroundColor: '#2563eb', borderRadius: 2 },
                        { label: '缺陷', data: data.bugData, backgroundColor: '#dc2626', borderRadius: 2 }
                    ]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { stacked: false, ticks: { stepSize: 1 } },
                        y: { ticks: { font: { size: 11 } } }
                    }
                }
            });
            return chart;
        };

        el.onclick = () => {
            const listId = 'personnelList';
            const statId = 'personnelStat';
            const existing = document.getElementById(listId);
            if (existing) {
                const oldChart = Chart.getChart('workloadChart');
                if (oldChart) oldChart.destroy();
                existing.remove();
                const stat = document.getElementById(statId);
                if (stat) { stat.classList.remove('stat-expanded'); const lb = stat.querySelector('.label'); if (lb) lb.innerHTML = lb.innerHTML.replace('▴', '▾'); }
                return;
            }
            const stat = document.getElementById(statId);
            if (stat) { stat.classList.add('stat-expanded'); const lb = stat.querySelector('.label'); if (lb) lb.innerHTML = lb.innerHTML.replace('▾', '▴'); }

            const wl = D.workload || {};
            const entries = Object.entries(wl).sort((a, b) => (b[1].stories + b[1].bugs) - (a[1].stories + a[1].bugs));
            if (entries.length === 0) {
                const div = document.createElement('div');
                div.id = listId;
                div.className = 'parent-list panel-stone';
                div.innerHTML = '<div class="parent-list-title">参与人员</div><div style="font-size:12px;color:var(--muted)">无数据</div>';
                document.getElementById('summary').after(div);
                return;
            }

            const height = Math.max(180, entries.length * 28);
            const div = document.createElement('div');
            div.id = listId;
            div.className = 'parent-list panel-stone';
            div.innerHTML = `<div class="parent-list-title">参与人员 (${entries.length}人)</div>
                <div style="display:flex;gap:8px;margin-bottom:6px">
                    <button class="sort-btn sort-btn-active" data-sort="total">总数</button>
                    <button class="sort-btn" data-sort="stories">需求</button>
                    <button class="sort-btn" data-sort="bugs">缺陷</button>
                </div>
                <div style="height:${height}px;position:relative"><canvas id="workloadChart"></canvas></div>
                <div class="chart-legend">
                    <span class="legend-item" data-ds="0"><span class="legend-dot" style="background:#2563eb"></span> 需求</span>
                    <span class="legend-item" data-ds="1"><span class="legend-dot" style="background:#dc2626"></span> 缺陷</span>
                </div>`;
            document.getElementById('summary').after(div);

            let chart = renderChart(div, 'total');

            // 排序按钮
            div.querySelectorAll('.sort-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    div.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('sort-btn-active'));
                    this.classList.add('sort-btn-active');
                    const sortBy = this.dataset.sort;
                    // 重新排序
                    const data = buildChartData(sortBy);
                    chart.data.labels = data.labels;
                    chart.data.datasets[0].data = data.storyData;
                    chart.data.datasets[1].data = data.bugData;
                    chart.update();
                });
            });

            // 图例点击切换
            div.querySelectorAll('.legend-item').forEach(item => {
                item.addEventListener('click', function() {
                    const dsIdx = parseInt(this.dataset.ds);
                    const meta = chart.getDatasetMeta(dsIdx);
                    meta.hidden = !meta.hidden;
                    this.classList.toggle('legend-off', meta.hidden);
                    chart.update();
                });
            });
        };
    },

    /** 子需求分类饼图 */
    setupChildClick(D) {
        const el = document.getElementById('childStat');
        if (!el) return;
        el.onclick = () => {
            const listId = 'childList';
            const statId = 'childStat';
            const existing = document.getElementById(listId);
            if (existing) {
                const oldChart = Chart.getChart('childPieChart');
                if (oldChart) oldChart.destroy();
                existing.remove();
                const stat = document.getElementById(statId);
                if (stat) { stat.classList.remove('stat-expanded'); const lb = stat.querySelector('.label'); if (lb) lb.innerHTML = lb.innerHTML.replace('▴', '▾'); }
                return;
            }
            const stat = document.getElementById(statId);
            if (stat) { stat.classList.add('stat-expanded'); const lb = stat.querySelector('.label'); if (lb) lb.innerHTML = lb.innerHTML.replace('▾', '▴'); }

            // 子需求分类规则（patterns 为数组，匹配任一即归入）
            const CATEGORIES = [
                { key: '策划需求', patterns: ['文档编辑'], color: '#f97316' },
                { key: '前端', patterns: ['前端开发', '前端实现', '前端制作'], color: '#3b82f6' },
                { key: '后端', patterns: ['后端开发', '后端实现', '后端制作'], color: '#6366f1' },
                { key: 'UI', patterns: ['UI设计'], color: '#ec4899' },
                { key: '数值', patterns: ['策划配置', '数值配置', '数值设计', '数值需求', '功能测试'], color: '#eab308' },
                { key: '测试验收', patterns: ['测试验收'], color: '#14b8a6' },
                { key: '策划验收', patterns: ['策划验收'], color: '#8b5cf6' },
                { key: '其他', patterns: ['英雄技能'], color: '#78716c' },
                { key: '美术', patterns: null, color: '#a1a1aa' }
            ];
            const counts = {};
            const catStories = {};
            CATEGORIES.forEach(c => { counts[c.key] = 0; catStories[c.key] = []; });
            const stories = D.stories || [];
            stories.forEach(s => {
                if (s.is_closed) return;
                let matched = false;
                for (const cat of CATEGORIES) {
                    if (cat.patterns && cat.patterns.some(p => s.name.includes(p))) {
                        counts[cat.key]++; catStories[cat.key].push(s); matched = true; break;
                    }
                }
                if (!matched) { counts['美术']++; catStories['美术'].push(s); }
            });
            const entries = CATEGORIES.filter(c => counts[c.key] > 0);
            const totalOpen = stories.filter(s => !s.is_closed).length;

            const div = document.createElement('div');
            div.id = listId;
            div.className = 'parent-list panel-lavender';
            div.innerHTML = `<div class="parent-list-title">子需求分类 (${totalOpen}个)</div>
                <div style="height:260px;position:relative"><canvas id="childPieChart"></canvas></div>
                <div class="chart-legend">${entries.map(c =>
                    `<span class="legend-item clickable-cat" data-key="${c.key}"><span class="legend-dot" style="background:${c.color}"></span> ${c.key} (${counts[c.key]})</span>`
                ).join('')}</div>
                <div id="catDetailPanel" class="cat-detail" style="display:none"></div>`;
            document.getElementById('summary').after(div);

            const ctx = document.getElementById('childPieChart').getContext('2d');
            const pieChart = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: entries.map(c => c.key),
                    datasets: [{ data: entries.map(c => counts[c.key]), backgroundColor: entries.map(c => c.color), borderWidth: 1 }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    onClick: (e, elements) => {
                        if (elements.length === 0) return;
                        const idx = elements[0].index;
                        const key = pieChart.data.labels[idx];
                        const items = catStories[key] || [];
                        const panel = document.getElementById('catDetailPanel');
                        if (!panel) return;
                        panel.style.display = 'block';
                        panel.innerHTML = `<div class="parent-list-title" style="margin-top:10px">${key} (${items.length}个)</div>
                            <ul>${items.map(s => `<li>${esc(s.name)} <span class="tag tag-gray">${esc(s.owner || '未分配')}</span></li>`).join('')}</ul>`;
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw}个 (${Math.round(ctx.raw / totalOpen * 100)}%)` } } }
                    }
                }
            );

            // 图例点击切换（同时滚动到分类详情）
            div.querySelectorAll('.clickable-cat').forEach(item => {
                item.addEventListener('click', function() {
                    const key = this.dataset.key;
                    const items = catStories[key] || [];
                    const panel = document.getElementById('catDetailPanel');
                    if (!panel) return;
                    panel.style.display = panel.style.display === 'block' && panel.__lastKey === key ? 'none' : 'block';
                    if (panel.style.display === 'block') {
                        panel.__lastKey = key;
                        panel.innerHTML = `<div class="parent-list-title" style="margin-top:10px">${key} (${items.length}个)</div>
                            <ul>${items.map(s => `<li>${esc(s.name)} <span class="tag tag-gray">${esc(s.owner || '未分配')}</span></li>`).join('')}</ul>`;
                    }
                });
            });
        };
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
            if (this.currentIterId && !this.allData.data[this.currentIterId]) {
                this.currentIterId = this.allData.iterations[0].id;
            }
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
