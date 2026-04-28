with open(r'C:\Users\lauta\OneDrive\Escritorio\Voice-Chat\frontend\index.html', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    'id="settings-modal" class="modal-backdrop"',
    'id="settings-modal" class="modal-backdrop hidden"'
)

with open(r'C:\Users\lauta\OneDrive\Escritorio\Voice-Chat\frontend\index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed!')