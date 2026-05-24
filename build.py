#!/usr/bin/env python3
"""
构建脚本 - 拉取 TAPD 数据并生成 data.js
每次想更新预加载数据时运行: python3 build.py
"""
import json, subprocess, sys, os

print('正在拉取 TAPD 数据...')
result = subprocess.run(
    ['python3', os.path.join(os.path.dirname(__file__), 'fetch.py')],
    capture_output=True, text=True, timeout=300
)

if result.returncode != 0:
    print(f'拉取失败:\n{result.stderr}')
    sys.exit(1)

# 提取 JSON（使用 sentinel 分隔符）
parts = result.stdout.split('__JSON_START__')
if len(parts) >= 2:
    json_str = parts[-1].strip()
else:
    # 向后兼容：按行前缀提取
    lines = result.stdout.strip().split('\n')
    json_lines = [l for l in lines if l.startswith('{') or l.startswith('[')]
    json_str = json_lines[-1] if json_lines else result.stdout.strip()

try:
    data = json.loads(json_str)
except json.JSONDecodeError:
    # 尝试整个输出
    try:
        data = json.loads(result.stdout.strip())
    except json.JSONDecodeError as e:
        print(f'JSON 解析失败: {e}')
        print(f'输出前500字符: {result.stdout[:500]}')
        sys.exit(1)

# 写入 data.js
out_path = os.path.join(os.path.dirname(__file__), 'data.js')
with open(out_path, 'w') as f:
    f.write('var PRELOAD_DATA = ')
    json.dump(data, f, ensure_ascii=False)
    f.write(';')

total_stories = sum(d['total_stories'] for d in data['data'].values())
size = os.path.getsize(out_path)
print(f'已生成 data.js ({size // 1024}KB)')
print(f'迭代数: {len(data["iterations"])}')
print(f'总需求: {total_stories}')
print(f'运行 python3 server.py 预览')