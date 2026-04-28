with open(r'C:\Users\lauta\OneDrive\Escritorio\Voice-Chat\frontend\js\app.js', 'r', encoding='utf-8') as f:
    content = f.read()

count = 0
idx = 0
while True:
    idx = content.find('window.API_BASE', idx)
    if idx == -1:
        break
    count += 1
    context = content[max(0,idx-20):idx+40].replace('\n', '\\n')
    print(f"{count}. pos {idx}: ...{context}...")
    idx += 1