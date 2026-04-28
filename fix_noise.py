with open(r'C:\Users\lauta\OneDrive\Escritorio\Voice-Chat\frontend\index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Add noise suppression checkbox after the krisp-status div
old = '''<div id="krisp-status" class="krisp-status">
                            <span class="krisp-spinner"></span>
                            <span class="krisp-text">Verificando...</span>
                        </div>'''

new = '''<div id="krisp-status" class="krisp-status">
                            <span class="krisp-spinner"></span>
                            <span class="krisp-text">Verificando...</span>
                        </div>
                        <label class="checkbox-label">
                            <input type="checkbox" id="settings-noise-suppression" checked onchange="handleNoiseSuppressionChange(this.checked)">
                            <span>🔇 Supresión de ruido (Krisp AI)</span>
                        </label>'''

content = content.replace(old, new)

with open(r'C:\Users\lauta\OneDrive\Escritorio\Voice-Chat\frontend\index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done!')