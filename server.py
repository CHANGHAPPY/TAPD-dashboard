#!/usr/bin/env python3
"""本地开发服务器 - 用于预览 TAPD 监控面板"""
import http.server
import os
import sys
import subprocess
import json

PORT = 8080
ROOT = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):
        if self.path == '/refresh':
            try:
                result = subprocess.run(
                    ['python3', os.path.join(ROOT, 'build.py')],
                    capture_output=True, text=True, timeout=120, cwd=ROOT
                )
                if result.returncode != 0:
                    self.send_error(500, result.stderr[:500])
                    return
                with open(os.path.join(ROOT, 'data.js')) as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/javascript')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(content.encode())
            except Exception as e:
                self.send_error(500, str(e))
        else:
            self.send_error(404)

    def log_message(self, format, *args):
        print(f'  {args[0]}')

if __name__ == '__main__':
    print(f'''
  TAPD 监控面板开发服务器
  打开浏览器访问: http://localhost:{PORT}
  按 Ctrl+C 停止
''')
    with http.server.HTTPServer(('', PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n服务器已停止')