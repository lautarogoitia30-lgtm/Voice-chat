with open(r'C:\Users\lauta\OneDrive\Escritorio\Voice-Chat\frontend\js\app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Add the function after handleAutoGainChange
func = '''
// Handle noise suppression toggle
function handleNoiseSuppressionChange(enabled) {
    localStorage.setItem('voice_chat_noise_suppression', enabled ? 'true' : 'false');
    console.log('[SETTINGS] Noise suppression set to:', enabled);
    // Show notification
    showToast(enabled ? '🔇 Supresión de ruido ACTIVADA' : 'Supresión de ruido DESACTIVADA', 'success');
}
'''

# Find handleAutoGainChange and add after it
content = content.replace(
    '// Handle auto-gain change',
    func + '\n// Handle auto-gain change'
)

with open(r'C:\Users\lauta\OneDrive\Escritorio\Voice-Chat\frontend\js\app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done!')