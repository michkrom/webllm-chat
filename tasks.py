"""Invoke tasks for webllm-chat project."""
import os
from invoke import task, Context


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
def serve(c, port=8085):
    """Serve the built files using a simple HTTP server."""
    # First build if dist doesn't exist
    if not os.path.exists("dist"):
        print("📦 Building first...")
        build(c)
    
    print(f"🚀 Starting server on port {port}...")
    
    # Use Python's built-in HTTP server
    c.run(f"python -m http.server {port} --directory dist", pty=True)


@task
def dev(c, port=8085):
    """Start development server with hot reload."""
    print(f"🔥 Starting development server on http://localhost:{port}")
    c.run(f"npm start -- --port {port}", pty=True)


@task
def clean(c):
    """Clean build artifacts."""
    print("🧹 Cleaning build artifacts...")
    c.run("rm -rf dist .parcel-cache")
    print("✅ Cleaned")