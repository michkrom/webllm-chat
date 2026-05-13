"""Invoke tasks for webllm-chat project."""
import os
from invoke import task, Context


def _kill_port(c, port):
    """Kill any process listening on the given port."""
    try:
        # Try fuser first (Linux)
        c.run(f"fuser -k {port}/tcp 2>/dev/null", warn=True, hide=True)
    except:
        pass
    try:
        # Try lsof as fallback
        c.run(f"lsof -ti:{port} | xargs kill -9 2>/dev/null", warn=True, hide=True)
    except:
        pass


@task
def init(c):
    """Initialize the project - install dependencies."""
    print("🔧 Installing dependencies...")
    c.run("npm install")
    print("✅ Dependencies installed")


@task
def build(c):
    """Build the production bundle."""
    print("🏗️  Building production bundle...")
    c.run("npm run build")
    print("✅ Build complete - check dist/ directory")


@task
def serve(c, port=8085, restart=False):
    """Serve the built files using a simple HTTP server."""
    if restart:
        print(f"🔄 Killing processes on port {port}...")
        _kill_port(c, port)
    
    # First build if dist doesn't exist
    if not os.path.exists("dist"):
        print("📦 Building first...")
        build(c)
    
    print(f"🚀 Starting server on port {port}...")
    
    # Create index.html symlink if it doesn't exist (Python http.server needs index.html)
    if not os.path.exists("dist/index.html"):
        html_files = [f for f in os.listdir("dist") if f.endswith(".html")]
        if html_files:
            # Symlink needs relative path from the link location
            os.symlink(html_files[0], "dist/index.html")
            print(f"📎 Created index.html -> {html_files[0]}")
    
    # Use Python's built-in HTTP server
    c.run(f"python -m http.server {port} --directory dist", pty=True)


@task
def dev(c, port=8085, restart=False):
    """Start development server with hot reload."""
    if restart:
        print(f"🔄 Killing processes on port {port}...")
        _kill_port(c, port)
    
    print(f"🔥 Starting development server on http://localhost:{port}")
    c.run(f"npm start -- --port {port}", pty=True)


@task
def clean(c):
    """Clean build artifacts."""
    print("🧹 Cleaning build artifacts...")
    c.run("rm -rf dist .parcel-cache")
    print("✅ Cleaned")