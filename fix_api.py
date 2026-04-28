with open(r'C:\Users\lauta\OneDrive\Escritorio\Voice-Chat\frontend\js\app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Find all places where ${window.API_BASE} is NOT inside backticks and fix them
# Pattern: : ${window.API_BASE} + (needs backticks)
content = content.replace(': ${window.API_BASE} +', ': `${window.API_BASE}` +')

# Write back
with open(r'C:\Users\lauta\OneDrive\Escritorio\Voice-Chat\frontend\js\app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done! Fixed syntax errors')