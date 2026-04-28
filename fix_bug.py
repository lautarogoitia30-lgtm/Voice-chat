with open(r'C:\Users\lauta\OneDrive\Escritorio\Voice-Chat\frontend\js\app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the broken line - literal \n to real newlines
old = '// Logout on Ctrl+Shift+L\\ndocument.addEventListener("keydown", (e) => { if (e.ctrlKey && e.shiftKey && e.key === "L") { localStorage.clear(); location.reload(); } });\\n\\n// Expose state globally so livekit.js can check observer mode'
new = '// Logout on Ctrl+Shift+L\ndocument.addEventListener("keydown", (e) => { if (e.ctrlKey && e.shiftKey && e.key === "L") { localStorage.clear(); location.reload(); } });\n\n// Expose state globally so livekit.js can check observer mode'

content = content.replace(old, new)

with open(r'C:\Users\lauta\OneDrive\Escritorio\Voice-Chat\frontend\js\app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed!')