#!/usr/bin/env python3
"""Simple HTTP server for Workout Tracker PWA.
Usage: python3 server.py [port]
Default port: 8080
"""

import sys
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler

class PWAHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.join(os.path.dirname(__file__), 'public'), **kwargs)

    def end_headers(self):
        # Required for PWA service worker scope
        self.send_header('Service-Worker-Allowed', '/')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, format, *args):
        pass  # Suppress request logs

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = HTTPServer(('0.0.0.0', port), PWAHandler)
    print(f'Workout Tracker running at http://localhost:{port}')
    print('Press Ctrl+C to stop.')
    server.serve_forever()
